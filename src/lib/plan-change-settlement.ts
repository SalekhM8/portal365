import type Stripe from 'stripe'
import { chargeProration } from '@/lib/proration'
import type { StripeAccountKey } from '@/lib/stripe'

/**
 * Settle a plan change THERE AND THEN — no deferral, so the 1st-of-month
 * invoice is always the flat price of whatever plan the member is on.
 *
 * Trial (first month — joining fee was taken as a one-off, Stripe's own
 * proration is £0): compute the calendar-month delta ourselves.
 *   upgrade  -> charge the difference now (refuse the change if it declines)
 *   downgrade-> refund the difference to the card (from the joining payment),
 *               falling back to a balance credit only if no refundable payment
 * Active (past first month): Stripe proration with always_invoice, paid now;
 *   a negative (downgrade) proration is refunded to the card and the balance
 *   credit Stripe parks is neutralised, so nothing carries to the 1st.
 *
 * Returns ok:false WITHOUT touching the subscription when money can't move.
 */
export async function settlePlanChangeNow(opts: {
  stripe: Stripe
  account: StripeAccountKey
  stripeSub: Stripe.Subscription
  newPriceId: string
  currentMonthly: number
  newMonthly: number
  dbSubscriptionId: string
  planLabel: string
}): Promise<{ ok: boolean; error?: string; chargedPence: number; refundedPence: number; note: string | null }> {
  const { stripe, account, stripeSub, newPriceId, currentMonthly, newMonthly, dbSubscriptionId, planLabel } = opts
  const item = stripeSub.items.data[0]
  const customerId = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer.id
  const oldPriceId = item.price.id
  const monthKey = new Date().toISOString().slice(0, 7)

  if (stripeSub.status === 'trialing') {
    const now = new Date()
    const y = now.getUTCFullYear(), m = now.getUTCMonth()
    const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
    const remaining = Math.max(0, Math.ceil((Date.UTC(y, m + 1, 1) - now.getTime()) / 86_400_000))
    const deltaPence = Math.round((newMonthly - currentMonthly) * Math.min(1, remaining / daysInMonth) * 100)

    if (deltaPence > 0) {
      const res = await chargeProration({
        account, customerId, amountPence: deltaPence,
        description: `Plan change to ${planLabel}: difference for the rest of this month`,
        metadata: { reason: 'plan_change_delta', dbSubscriptionId },
        idempotencyKey: `plan-change:${dbSubscriptionId}:${newPriceId}:${monthKey}`,
      })
      if (!res.paid) return { ok: false, error: `Could not collect £${(deltaPence / 100).toFixed(2)} for the plan change (${res.error || 'card declined'}). Plan unchanged.`, chargedPence: 0, refundedPence: 0, note: null }
      await stripe.subscriptions.update(stripeSub.id, { items: [{ id: item.id, price: newPriceId }], proration_behavior: 'none' })
      return { ok: true, chargedPence: deltaPence, refundedPence: 0, note: `£${(deltaPence / 100).toFixed(2)} charged now for the rest of this month.` }
    }

    if (deltaPence < 0) {
      const refundPence = -deltaPence
      let refunded = false
      // Refund from the joining payment (the one-off prorated first period)
      let joiningPi: string | null = (stripeSub.metadata?.proratePaymentIntentId as string) || null
      if (!joiningPi) {
        try {
          const pis = await stripe.paymentIntents.list({ customer: customerId, limit: 10 })
          joiningPi = pis.data.find(p => p.status === 'succeeded' && p.metadata?.dbSubscriptionId === dbSubscriptionId)?.id || null
        } catch {}
      }
      if (joiningPi) {
        try {
          await stripe.refunds.create({ payment_intent: joiningPi, amount: refundPence, metadata: { reason: 'plan_change_downgrade', dbSubscriptionId } }, { idempotencyKey: `plan-change-refund:${dbSubscriptionId}:${newPriceId}:${monthKey}` })
          refunded = true
        } catch (e: any) { console.warn(`⚠️ downgrade refund failed (${e?.message}); falling back to balance credit`) }
      }
      if (!refunded) {
        await stripe.customers.createBalanceTransaction(customerId, { amount: -refundPence, currency: 'gbp', description: `Downgrade credit: ${planLabel}` })
      }
      await stripe.subscriptions.update(stripeSub.id, { items: [{ id: item.id, price: newPriceId }], proration_behavior: 'none' })
      return { ok: true, chargedPence: 0, refundedPence: refunded ? refundPence : 0, note: refunded ? `£${(refundPence / 100).toFixed(2)} refunded to the card for the rest of this month.` : `£${(refundPence / 100).toFixed(2)} credited against the next invoice (no refundable joining payment found).` }
    }

    await stripe.subscriptions.update(stripeSub.id, { items: [{ id: item.id, price: newPriceId }], proration_behavior: 'none' })
    return { ok: true, chargedPence: 0, refundedPence: 0, note: null }
  }

  // ── ACTIVE: Stripe proration, invoiced and paid right now
  await stripe.subscriptions.update(stripeSub.id, { items: [{ id: item.id, price: newPriceId }], proration_behavior: 'always_invoice' })
  const invoices = await stripe.invoices.list({ customer: customerId, subscription: stripeSub.id, limit: 3 })
  const proration = invoices.data.find(i => i.billing_reason === 'subscription_update')
  if (proration && proration.status === 'open' && proration.amount_due > 0) {
    try {
      const paid = await stripe.invoices.pay(proration.id!)
      if (paid.status !== 'paid') throw new Error(`invoice ${paid.status}`)
      return { ok: true, chargedPence: proration.amount_due, refundedPence: 0, note: `£${(proration.amount_due / 100).toFixed(2)} charged now for the rest of this month.` }
    } catch (e: any) {
      // Money didn't move: put the plan back and void the invoice so nothing lingers
      try { await stripe.invoices.voidInvoice(proration.id!) } catch {}
      try { await stripe.subscriptions.update(stripeSub.id, { items: [{ id: item.id, price: oldPriceId }], proration_behavior: 'none' }) } catch {}
      return { ok: false, error: `Could not collect £${(proration.amount_due / 100).toFixed(2)} for the plan change (${e?.raw?.message || e?.message || 'card declined'}). Plan unchanged.`, chargedPence: 0, refundedPence: 0, note: null }
    }
  }
  if (proration && proration.total < 0) {
    // Downgrade: Stripe parked the credit on the balance. Refund it to the card instead
    // and neutralise the balance so the 1st stays a clean flat price.
    const creditPence = -proration.total
    try {
      const charges = await stripe.charges.list({ customer: customerId, limit: 5 })
      const lastPaid = charges.data.find(c => c.status === 'succeeded' && c.amount - (c.amount_refunded || 0) >= creditPence)
      if (lastPaid) {
        await stripe.refunds.create({ charge: lastPaid.id, amount: creditPence, metadata: { reason: 'plan_change_downgrade', dbSubscriptionId } }, { idempotencyKey: `plan-change-refund:${dbSubscriptionId}:${newPriceId}:${monthKey}` })
        await stripe.customers.createBalanceTransaction(customerId, { amount: creditPence, currency: 'gbp', description: `Downgrade credit refunded to card (${planLabel})` })
        return { ok: true, chargedPence: 0, refundedPence: creditPence, note: `£${(creditPence / 100).toFixed(2)} refunded to the card for the rest of this month.` }
      }
    } catch (e: any) { console.warn(`⚠️ active downgrade refund failed: ${e?.message}`) }
    return { ok: true, chargedPence: 0, refundedPence: 0, note: `£${(creditPence / 100).toFixed(2)} credited against the next invoice (could not refund to card).` }
  }
  return { ok: true, chargedPence: 0, refundedPence: 0, note: null }
}
