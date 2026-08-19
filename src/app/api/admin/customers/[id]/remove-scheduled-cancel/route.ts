import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

/**
 * Remove a scheduled cancellation (undo cancel_at_period_end) BEFORE it executes.
 *
 * This exists because the only prior "undo" was Reactivate — which is for
 * already-cancelled subs and creates a new subscription + prorate charge.
 * Using it on a merely-scheduled cancellation creates broken states
 * (see Ishaq Tuki, Aug 2026). Before execution the undo is one Stripe flag.
 */
export async function POST(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const params = await context.params
    const customerId = params.id

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: customerId,
        cancelAtPeriodEnd: true,
        status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'] }
      },
      include: { user: { select: { firstName: true, lastName: true, email: true } } }
    })
    if (!subscription) {
      return NextResponse.json({ error: 'No scheduled cancellation found for this customer' }, { status: 404 })
    }

    const stripe = getStripeClient((subscription as any).stripeAccountKey || 'SU')

    // Verify the Stripe sub is still alive — once the cancellation has executed
    // this undo is impossible and the right tool is Reactivate.
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    if (stripeSub.status === 'canceled') {
      return NextResponse.json({
        error: 'Too late — the cancellation has already executed in Stripe. Use Reactivate to set up a new subscription.',
        code: 'ALREADY_EXECUTED'
      }, { status: 409 })
    }
    if (!stripeSub.cancel_at_period_end && !stripeSub.cancel_at) {
      // Stripe already has no scheduled cancel — just heal the DB flag.
      await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: false } })
      return NextResponse.json({ success: true, message: 'Scheduled cancellation removed' })
    }

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: false })
    await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: false } })

    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'CANCEL_UNSCHEDULED',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: 'Scheduled cancellation removed — membership continues as normal',
          operationId: `uncancel_${subscription.id}_${Date.now()}`,
          metadata: JSON.stringify({ stripeSubscriptionId: subscription.stripeSubscriptionId })
        }
      })
    } catch {}

    console.log(`✅ Removed scheduled cancellation for ${subscription.user.email} (${subscription.stripeSubscriptionId})`)
    return NextResponse.json({
      success: true,
      message: `Scheduled cancellation removed — ${subscription.user.firstName}'s membership continues as normal.`
    })
  } catch (e: any) {
    console.error('❌ remove-scheduled-cancel failed:', e)
    return NextResponse.json({ error: e.message || 'Failed to remove scheduled cancellation' }, { status: 500 })
  }
}
