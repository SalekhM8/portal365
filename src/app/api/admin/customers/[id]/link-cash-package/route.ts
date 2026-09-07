import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * Convert an abandoned ONLINE signup (no card, no money) into a CASH package.
 *
 * The member signed up on the website, never entered a card, then paid cash at
 * the desk for a fixed-term package. Today the only admin options were Void
 * (leaves a bare user) or nothing. This keeps the user (id, PIN, check-ins),
 * deletes the online placeholder exactly the way Void does, and converts the
 * existing membership row into an offline package in place.
 *
 * Guards mirror void-signup: placeholder-only subscription, zero money.
 */
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id: customerId } = await context.params
    const body = await request.json().catch(() => ({}))
    const months = Number(body.months)
    const startDateStr: string | undefined = typeof body.startDate === 'string' ? body.startDate : undefined
    const cashPaid = body.cashPaid != null && Number.isFinite(Number(body.cashPaid)) ? Number(body.cashPaid) : null
    if (!Number.isInteger(months) || months < 1 || months > 24) return NextResponse.json({ error: 'months must be 1-24' }, { status: 400 })
    if (!startDateStr || !/^\d{4}-\d{2}-\d{2}$/.test(startDateStr)) return NextResponse.json({ error: 'startDate (YYYY-MM-DD) required' }, { status: 400 })

    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        memberships: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    const subscription = customer.subscriptions[0]
    const membership = customer.memberships[0]
    if (!subscription || !membership) return NextResponse.json({ error: 'No pending signup found for this member' }, { status: 404 })

    // ── Guards: must be an abandoned online signup with zero money ──
    if (!['PENDING_PAYMENT', 'INCOMPLETE', 'INCOMPLETE_EXPIRED'].includes(subscription.status)) {
      return NextResponse.json({ error: `Subscription is ${subscription.status} — only pending/incomplete signups can be linked to a cash package` }, { status: 400 })
    }
    if (subscription.stripeSubscriptionId?.startsWith('sub_')) {
      return NextResponse.json({ error: 'This member has a real Stripe subscription — cancel it via Membership Management first' }, { status: 400 })
    }
    const paidInvoice = await prisma.invoice.findFirst({ where: { subscriptionId: subscription.id, status: 'paid' } })
    if (paidInvoice) return NextResponse.json({ error: 'Subscription has a paid invoice; cannot convert' }, { status: 400 })
    const confirmed = await prisma.payment.findFirst({ where: { userId: customer.id, status: 'CONFIRMED', createdAt: { gte: subscription.createdAt } } })
    if (confirmed) return NextResponse.json({ error: 'Member has confirmed payments since signup; cannot convert' }, { status: 400 })

    const start = new Date(`${startDateStr}T00:00:00.000Z`)
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + months, start.getUTCDate()))
    const packageName = `${months}-Month Cash`
    const placeholderId = subscription.stripeSubscriptionId
    const placeholderAccount = (subscription.stripeAccountKey as StripeAccountKey) || 'SU'

    await prisma.$transaction(async (tx) => {
      // Same cleanup as void-signup — proven deletes, nothing new
      await tx.invoice.deleteMany({ where: { subscriptionId: subscription.id, status: { in: ['open', 'void', 'uncollectible', 'draft'] } } })
      const orphan = await tx.payment.findMany({ where: { userId: customer.id, status: { in: ['PENDING', 'FAILED'] }, createdAt: { gte: subscription.createdAt } }, select: { id: true } })
      const ids = orphan.map(p => p.id)
      if (ids.length > 0) {
        await tx.paymentRouting.deleteMany({ where: { paymentId: { in: ids } } })
        await tx.payment.deleteMany({ where: { id: { in: ids } } })
      }
      await tx.subscriptionRouting.deleteMany({ where: { subscriptionId: subscription.id } })
      await tx.subscriptionAuditLog.deleteMany({ where: { subscriptionId: subscription.id } })
      await tx.subscription.delete({ where: { id: subscription.id } })

      // Convert the membership row IN PLACE into a cash package (same shape as
      // admin-created offline members: endDate set, no subscription)
      await tx.membership.update({
        where: { id: membership.id },
        data: {
          membershipType: packageName,
          status: 'ACTIVE',
          startDate: start,
          endDate: end,
          monthlyPrice: 0,
          nextBillingDate: end
        }
      })
      await tx.user.update({ where: { id: customer.id }, data: { status: 'ACTIVE' } })
    })

    // Best-effort: cancel the dangling online payment request so it can't linger
    if (placeholderId?.startsWith('pi_')) {
      try { await getStripeClient(placeholderAccount).paymentIntents.cancel(placeholderId) } catch {}
    }

    // Audit: no subscription FK available (placeholder deleted) — record on the
    // membership via a payment-free system log line
    console.log(`✅ [link-cash-package] ${customer.email}: ${packageName} ${startDateStr} -> ${end.toISOString().slice(0,10)} cashPaid=${cashPaid ?? '-'} by ${admin.firstName} ${admin.lastName} (removed placeholder ${placeholderId})`)

    return NextResponse.json({
      success: true,
      message: `${customer.firstName} linked to ${packageName} — runs ${startDateStr} to ${end.toISOString().slice(0, 10)}${cashPaid != null ? ` (£${cashPaid} cash)` : ''}. PIN ${customer.pin ?? '—'}.`,
      packageName,
      endDate: end.toISOString().slice(0, 10)
    })
  } catch (e: any) {
    console.error('❌ link-cash-package failed:', e)
    return NextResponse.json({ error: e?.message || 'Failed to link cash package' }, { status: 500 })
  }
}
