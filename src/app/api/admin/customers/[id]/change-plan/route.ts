import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params = await context.params
    const userId = params.id
    const body = await request.json()
    const { newMembershipType, effective, settlement } = body || {}
    if (!newMembershipType || !['now','period_end'].includes(effective)) {
      return NextResponse.json({ error: 'newMembershipType and effective required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
    if (!sub) return NextResponse.json({ error: 'No subscription' }, { status: 404 })

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((sub as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
    const stripeStatus = (stripeSub as any).status as string
    const item = (stripeSub as any).items?.data?.[0]
    const currentMonthly = ((item?.price?.unit_amount || 0) / 100)
    const plan = getPlan(newMembershipType)
    const newMonthly = plan.monthlyPrice

    // Ensure price exists
    const prices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
    let newPrice = prices.data.find(p => p.unit_amount === newMonthly * 100 && p.recurring?.interval === 'month')
    if (!newPrice) {
      const product = await stripe.products.create({ name: `${plan.name} Membership`, description: `Monthly membership for ${plan.name}` })
      newPrice = await stripe.prices.create({ unit_amount: newMonthly * 100, currency: 'gbp', recurring: { interval: 'month' }, product: product.id })
    }

    const nextBillingDate = new Date(((stripeSub as any).current_period_end || (stripeSub as any).trial_end) * 1000)

    // Helper: compute delta for trial using calendar month proration
    const computeTrialDelta = () => {
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const nextFirst = new Date(Date.UTC(year, month + 1, 1))
      const remainingDays = Math.max(0, Math.ceil((nextFirst.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const fraction = Math.min(1, remainingDays / daysInMonth)
      const delta = Math.round((newMonthly - currentMonthly) * fraction * 100)
      return delta // pence
    }

    if (effective === 'period_end') {
      // Price change effective at next billing; no proration now
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, price: (newPrice as any).id }],
        proration_behavior: 'none',
        metadata: {
          ...(stripeSub as any).metadata,
          pending_plan: newMembershipType,
          pending_apply_ts: String(Math.floor(nextBillingDate.getTime() / 1000))
        }
      })

      // Keep access as-is; flip on rollover via webhook
      await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
      return NextResponse.json({ success: true, applied: 'period_end', nextBillingDate: nextBillingDate.toISOString().split('T')[0] })
    }

    // effective === 'now'
    if (stripeStatus === 'trialing') {
      // Update price without proration (Stripe won’t prorate trial), then settle delta now
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, price: (newPrice as any).id }],
        proration_behavior: 'none'
      })

      const deltaPence = computeTrialDelta()
      if (deltaPence > 0) {
        // Upgrade: charge delta now via invoice item + invoice
        await stripe.invoiceItems.create({
          customer: (stripeSub as any).customer as string,
          amount: deltaPence,
          currency: 'gbp',
          description: `Trial proration adjustment (${newMembershipType})`,
          metadata: { dbSubscriptionId: sub.id, reason: 'trial_proration_adjustment' }
        })
        const inv = await stripe.invoices.create({
          customer: (stripeSub as any).customer as string,
          auto_advance: true,
          metadata: { dbSubscriptionId: sub.id, reason: 'trial_proration_adjustment' }
        })
        // Best-effort immediate payment
        try { if (inv.id) await stripe.invoices.pay(inv.id) } catch {}
      } else if (deltaPence < 0) {
        // Downgrade: refund partial amount from the original proration PI when possible
        const abs = Math.abs(deltaPence)
        // Find the most recent proration payment for this sub
        const recentPayment = await prisma.payment.findFirst({
          where: { userId, status: 'CONFIRMED' },
          orderBy: { createdAt: 'desc' }
        })
        if (recentPayment) {
          const piMatch = (recentPayment.description || '').match(/\[pi:([^\]]+)\]/)
          const piId = piMatch?.[1]
          if (piId) {
            try { await stripe.refunds.create({ payment_intent: piId, amount: abs }) } catch {}
          }
        }
        // Optionally record a refund marker if needed
      }

      await prisma.membership.updateMany({ where: { userId }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
      await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
      return NextResponse.json({ success: true, applied: 'now', deltaPounds: deltaPence / 100 })
    }

    // ACTIVE now: use Stripe proration
    await stripe.subscriptions.update(stripeSub.id, {
      items: [{ id: item.id, price: (newPrice as any).id }],
      proration_behavior: 'create_prorations'
    })

    if (settlement === 'charge_now') {
      // Attempt to pay open invoice containing proration; else create/pay a new invoice
      try {
        const list = await stripe.invoices.list({ customer: (stripeSub as any).customer as string, limit: 5 })
        const open = list.data.find(i => i.status === 'open')
        if (open?.id) {
          await stripe.invoices.pay(open.id)
        } else {
          const inv = await stripe.invoices.create({ customer: (stripeSub as any).customer as string, auto_advance: true })
          try { if (inv.id) await stripe.invoices.pay(inv.id) } catch {}
        }
      } catch {}
    }

    await prisma.membership.updateMany({ where: { userId }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
    await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })

    return NextResponse.json({ success: true, applied: 'now', settlement: settlement || 'defer' })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Change plan failed' }, { status: 500 })
  }
}


