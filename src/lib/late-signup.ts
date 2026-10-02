import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import { chargeProration } from '@/lib/proration'
import type { StripeAccountKey } from '@/lib/stripe'

/**
 * Stalled signups: the joining fee is priced when the form is submitted
 * (pro-rata to the next 1st). If the member only completes payment AFTER that
 * 1st has passed, the stored first-bill date is in the past. Previously the
 * activation code just clamped the trial to the following 1st — a free month
 * (Ismaeel Khan: £1.83 for 30 Sep, paid 2 Oct, October free; 10 others since
 * March 2026). Two fixes:
 *   - reconcileLateSignupPrice(): when the member returns to pay, re-price the
 *     unpaid PaymentIntent for TODAY so they see and pay the right amount.
 *   - settleLateActivation(): safety net at activation — if the stored date has
 *     passed, charge the remaining days of the current month (less what the
 *     stalled payment already covered) before the subscription is created.
 */
export function firstOfNextMonthUTC(now = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
}

/** Same rule as signup: days from today to month end (inclusive) over days in month. */
export function remainingMonthProrationPence(monthlyPrice: number, now = new Date()): number {
  const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate()
  const daysRemaining = daysInMonth - now.getUTCDate() + 1
  return Math.max(0, Math.round(Math.round(monthlyPrice * 100) * (daysRemaining / daysInMonth)))
}

export function storedFirstBillHasPassed(nextBillingDate: Date | string, now = new Date()): boolean {
  return new Date(nextBillingDate).getTime() <= now.getTime()
}

/**
 * Re-price an unpaid signup PaymentIntent whose first-bill date has passed.
 * Only touches PIs Stripe allows amount changes on (not mid-3DS).
 */
export async function reconcileLateSignupPrice(stripe: Stripe, pi: Stripe.PaymentIntent, dbSub: { id: string; userId: string; monthlyPrice: any; nextBillingDate: Date }): Promise<Stripe.PaymentIntent> {
  if (!['requires_payment_method', 'requires_confirmation'].includes(pi.status)) return pi
  if (!storedFirstBillHasPassed(dbSub.nextBillingDate)) return pi
  const now = new Date()
  const newFirst = firstOfNextMonthUTC(now)
  const amount = remainingMonthProrationPence(Number(dbSub.monthlyPrice), now)
  const updated = await stripe.paymentIntents.update(pi.id, {
    amount: Math.max(amount, 30), // Stripe minimum charge is 30p
    metadata: { ...(pi.metadata || {}), nextBillingDate: newFirst.toISOString().slice(0, 10), repricedAt: now.toISOString(), repricedFrom: String(pi.amount) }
  })
  await prisma.subscription.update({ where: { id: dbSub.id }, data: { nextBillingDate: newFirst } })
  await prisma.membership.updateMany({ where: { userId: dbSub.userId, endDate: null }, data: { nextBillingDate: newFirst } })
  console.log(`💷 [late-signup] re-priced ${pi.id} £${pi.amount / 100} → £${updated.amount / 100}; first bill ${newFirst.toISOString().slice(0, 10)}`)
  return updated
}

/**
 * At activation: if the stored first-bill date is already past, charge the
 * remaining days of the current month, net of what the stalled payment already
 * covered. Returns the trial end (first full bill) to use.
 */
export async function settleLateActivation(opts: {
  stripe: Stripe
  account: StripeAccountKey
  dbSub: { id: string; userId: string; monthlyPrice: any; nextBillingDate: Date; membershipType: string; stripeCustomerId: string | null }
  paidPence: number
  paidForFirst: string | null // pi.metadata.nextBillingDate (YYYY-MM-DD) if known
}): Promise<{ trialEnd: Date; chargedPence: number; deferredPence: number }> {
  const { stripe, account, dbSub, paidPence, paidForFirst } = opts
  const now = new Date()
  const storedFirst = new Date(dbSub.nextBillingDate)
  if (!storedFirstBillHasPassed(storedFirst, now)) return { trialEnd: storedFirst, chargedPence: 0, deferredPence: 0 }

  const trialEnd = firstOfNextMonthUTC(now)
  const monthKey = trialEnd.toISOString().slice(0, 7)
  // The stalled payment covered a period ending at paidForFirst (or storedFirst). If that
  // period is already over, it bought nothing usable — credit it against this month.
  const paidEnds = new Date((paidForFirst || storedFirst.toISOString().slice(0, 10)) + 'T00:00:00Z')
  const creditPence = paidEnds.getTime() <= now.getTime() ? paidPence : 0
  const owedPence = Math.max(0, remainingMonthProrationPence(Number(dbSub.monthlyPrice), now) - creditPence)
  if (owedPence <= 0 || !dbSub.stripeCustomerId) return { trialEnd, chargedPence: 0, deferredPence: 0 }

  const description = `${dbSub.membershipType}: rest of ${now.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })} (signup completed ${now.toISOString().slice(0, 10)}; first renewal ${trialEnd.toISOString().slice(0, 10)})`
  const res = await chargeProration({
    account, customerId: dbSub.stripeCustomerId, amountPence: owedPence, description,
    metadata: { reason: 'late_signup_month_catchup', dbSubscriptionId: dbSub.id, userId: dbSub.userId },
    idempotencyKey: `late-signup-catchup:${dbSub.id}:${monthKey}`
  })
  let chargedPence = 0, deferredPence = 0
  if (res.paid) {
    chargedPence = res.amountPaidPence
  } else {
    // Card just succeeded for the signup PI, so a decline here is rare. Don't lose the
    // money: park it as a pending item so it rides the first renewal, and shout.
    deferredPence = owedPence
    try {
      await stripe.invoiceItems.create({ customer: dbSub.stripeCustomerId, amount: owedPence, currency: 'gbp', description, metadata: { reason: 'late_signup_month_catchup_deferred', dbSubscriptionId: dbSub.id } }, { idempotencyKey: `late-signup-catchup:${dbSub.id}:${monthKey}:deferred` })
    } catch (e: any) { console.error(`❌ [late-signup] could not defer catch-up for ${dbSub.id}: ${e?.message}`) }
    console.error(`⚠️ [late-signup] catch-up £${(owedPence / 100).toFixed(2)} NOT collected for ${dbSub.id} (${res.error}) — deferred to first renewal`)
  }
  try {
    await prisma.subscriptionAuditLog.create({ data: {
      subscriptionId: dbSub.id, action: 'LATE_SIGNUP_CATCHUP', performedBy: 'system', performedByName: 'system (activation)',
      reason: `Signup completed after its first-bill date (${storedFirst.toISOString().slice(0, 10)}): ${chargedPence ? `charged £${(chargedPence / 100).toFixed(2)}` : `£${(deferredPence / 100).toFixed(2)} deferred to first renewal`} for the rest of the month; first renewal ${trialEnd.toISOString().slice(0, 10)}`,
      operationId: `late_signup_${dbSub.id}_${Date.now()}`,
      metadata: JSON.stringify({ storedFirst, paidPence, creditPence, owedPence, chargedPence, deferredPence, invoiceId: res.invoiceId, trialEnd })
    } })
  } catch {}
  await prisma.subscription.update({ where: { id: dbSub.id }, data: { nextBillingDate: trialEnd } }).catch(() => {})
  await prisma.membership.updateMany({ where: { userId: dbSub.userId, endDate: null }, data: { nextBillingDate: trialEnd } }).catch(() => {})
  return { trialEnd, chargedPence, deferredPence }
}
