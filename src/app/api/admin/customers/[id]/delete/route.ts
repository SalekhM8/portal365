import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

// Statuses that mean the customer still has a live or recoverable membership.
// Admin must cancel via Cancel Membership first — delete must NOT silently
// orphan a billable Stripe sub (the Usman Ahmed B9 5LT case, June 2026).
const BLOCKING_STATUSES = new Set([
  'ACTIVE',
  'TRIALING',
  'PAUSED',
  'PAST_DUE',
  'PENDING_PAYMENT',
  'INCOMPLETE',
])

// Stripe sub statuses that are terminal — no further cancel needed.
const STRIPE_TERMINAL = new Set(['canceled', 'incomplete_expired'])

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role as any)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await context.params
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: { include: { invoices: true } },
        payments: true,
        memberships: true,
      }
    }) as any
    if (!user) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    // Guard matches the UI promise: block while any non-terminal sub exists.
    const blocking = user.subscriptions.filter((s: any) => BLOCKING_STATUSES.has(s.status))
    if (blocking.length > 0) {
      const summary = blocking.map((s: any) => `${s.status}`).join(', ')
      return NextResponse.json({
        error: `Cannot delete customer with non-terminal subscription(s): ${summary}. Cancel the membership first.`
      }, { status: 400 })
    }

    // Defensive cancel of any Stripe sub still alive on the customer
    // (covers webhook gaps, prior partial-deletes, manual-only cancellations
    //  that never wrote back to the DB, etc.).
    const cancelLog: Array<{ subId: string; account: string; status: string; result: string }> = []

    // Pass 1 — cancel every DB-known Stripe sub.
    for (const s of user.subscriptions) {
      const subId = s.stripeSubscriptionId
      const account = s.stripeAccountKey || 'SU'
      if (typeof subId !== 'string' || !subId.startsWith('sub_')) continue
      try {
        const stripe = getStripeClient(account)
        const live = await stripe.subscriptions.retrieve(subId)
        if (STRIPE_TERMINAL.has(live.status)) {
          cancelLog.push({ subId, account, status: live.status, result: 'already_terminal' })
          continue
        }
        const cancelled = await stripe.subscriptions.cancel(subId, { prorate: false, invoice_now: false })
        cancelLog.push({ subId, account, status: cancelled.status, result: 'cancelled' })
      } catch (err: any) {
        // Don't block delete on Stripe errors — log and continue.
        cancelLog.push({ subId, account, status: 'unknown', result: `error:${err?.message || 'unknown'}` })
      }
    }

    // Pass 2 — for every unique (account, stripeCustomerId) seen, list any
    // remaining live subs Stripe still knows about (orphans not in our DB)
    // and cancel them. This is the safety net for the case where a prior
    // delete attempt nuked the DB row but left Stripe billing.
    const customerPairs = new Set<string>()
    for (const s of user.subscriptions) {
      if (!s.stripeCustomerId) continue
      customerPairs.add(`${s.stripeAccountKey || 'SU'}::${s.stripeCustomerId}`)
    }
    for (const pair of customerPairs) {
      const [account, customerId] = pair.split('::')
      try {
        const stripe = getStripeClient(account as any)
        const list = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 50 })
        for (const ss of list.data) {
          if (STRIPE_TERMINAL.has(ss.status)) continue
          try {
            const cancelled = await stripe.subscriptions.cancel(ss.id, { prorate: false, invoice_now: false })
            cancelLog.push({ subId: ss.id, account, status: cancelled.status, result: 'cancelled_orphan' })
          } catch (err: any) {
            cancelLog.push({ subId: ss.id, account, status: 'unknown', result: `orphan_error:${err?.message || 'unknown'}` })
          }
        }
      } catch (err: any) {
        cancelLog.push({ subId: '-', account, status: 'unknown', result: `list_error:${err?.message || 'unknown'}` })
      }
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { userId: id } })
      await tx.invoice.deleteMany({ where: { subscription: { userId: id } } })
      await tx.subscription.deleteMany({ where: { userId: id } })
      await tx.membership.deleteMany({ where: { userId: id } })
      await tx.user.delete({ where: { id } })
    })

    return NextResponse.json({ success: true, stripeCancellations: cancelLog })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete customer' }, { status: 500 })
  }
}


