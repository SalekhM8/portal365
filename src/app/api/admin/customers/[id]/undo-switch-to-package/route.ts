import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * Undo a scheduled monthly -> cash-package switch BEFORE it executes on the 1st.
 * Clears the pending package and, unless a cancellation had been scheduled
 * independently before the switch, removes the cancel-at-period-end in Stripe
 * so the monthly simply carries on.
 */
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id: customerId } = await context.params
    const membership = await prisma.membership.findFirst({ where: { userId: customerId, endDate: null, pendingPackageName: { not: null } }, orderBy: { createdAt: 'desc' } })
    if (!membership) return NextResponse.json({ error: 'No scheduled package switch found for this member' }, { status: 404 })
    const sub = await prisma.subscription.findFirst({ where: { userId: customerId, stripeSubscriptionId: { startsWith: 'sub_' } }, orderBy: { createdAt: 'desc' } })
    if (!sub) return NextResponse.json({ error: 'No subscription found' }, { status: 404 })

    const lastSwitch = await prisma.subscriptionAuditLog.findFirst({ where: { subscriptionId: sub.id, action: 'SWITCH_TO_PACKAGE_SCHEDULED' }, orderBy: { createdAt: 'desc' } })
    let cancelWasAlreadyScheduled = false
    try { cancelWasAlreadyScheduled = !!JSON.parse(lastSwitch?.metadata || '{}').cancelWasAlreadyScheduled } catch {}

    const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
    if (stripeSub.status === 'canceled') {
      return NextResponse.json({ error: 'Too late — the monthly has already ended in Stripe. The package will apply (or has applied); use Switch to monthly to reverse it.', code: 'ALREADY_EXECUTED' }, { status: 409 })
    }

    const meta = { ...(stripeSub.metadata || {}) } as Record<string, string>
    delete meta.pending_package; delete meta.pending_package_start
    if (!cancelWasAlreadyScheduled) {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { cancel_at_period_end: false, metadata: { ...meta, pending_package: '', pending_package_start: '' } })
    } else {
      await stripe.subscriptions.update(sub.stripeSubscriptionId, { metadata: { ...meta, pending_package: '', pending_package_start: '' } })
    }

    const undoneName = membership.pendingPackageName
    await prisma.$transaction(async (tx) => {
      if (!cancelWasAlreadyScheduled) await tx.subscription.update({ where: { id: sub.id }, data: { cancelAtPeriodEnd: false } })
      await tx.membership.update({ where: { id: membership.id }, data: { pendingPackageName: null, pendingPackageStart: null, pendingPackageEnd: null, pendingPackagePrice: null, pendingPackageCash: null } })
      await tx.subscriptionAuditLog.create({
        data: {
          subscriptionId: sub.id,
          action: 'SWITCH_TO_PACKAGE_UNDONE',
          performedBy: admin.id,
          performedByName: `${admin.firstName} ${admin.lastName}`,
          reason: `Scheduled switch to "${undoneName}" undone — ${cancelWasAlreadyScheduled ? 'the pre-existing scheduled cancellation stays' : 'monthly continues as normal'}`,
          operationId: `undo_switch_pkg_${sub.id}_${Date.now()}`,
          metadata: JSON.stringify({ undoneName, cancelWasAlreadyScheduled, pendingCash: membership.pendingPackageCash })
        }
      })
    })
    return NextResponse.json({
      success: true,
      message: cancelWasAlreadyScheduled
        ? `Switch to ${undoneName} undone. Note: the cancellation scheduled before the switch is still in place.`
        : `Switch to ${undoneName} undone — monthly membership continues as normal.${membership.pendingPackageCash != null ? ` Remember to refund £${membership.pendingPackageCash} cash if it was taken.` : ''}`
    })
  } catch (e: any) {
    console.error('❌ undo-switch-to-package failed:', e)
    return NextResponse.json({ error: e?.message || 'Failed to undo switch' }, { status: 500 })
  }
}
