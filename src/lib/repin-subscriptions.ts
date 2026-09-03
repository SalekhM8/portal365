import type Stripe from 'stripe'

/**
 * After a card update, re-point any subscription-level pinned payment method
 * on this customer to the new card. Stripe's charge order is invoice PM ->
 * subscription default -> customer default; some of our creation rails pin the
 * card on the subscription, and without this, a card update only changes the
 * customer default — invoices keep charging the old pinned card forever.
 * Touches ONLY subscriptions that already pin a different card; never sets a
 * pin where none exists. Best-effort: failures are logged, never thrown.
 */
export async function repinSubscriptionsToNewCard(stripe: Stripe, customerId: string, newPmId: string): Promise<void> {
  try {
    const subs = await stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 20 })
    for (const sub of subs.data) {
      if (['canceled', 'incomplete_expired'].includes(sub.status)) continue
      const pin = typeof sub.default_payment_method === 'string' ? sub.default_payment_method : sub.default_payment_method?.id
      if (!pin || pin === newPmId) continue
      try {
        await stripe.subscriptions.update(sub.id, { default_payment_method: newPmId })
        console.log(`✅ [repin] ${sub.id}: pinned PM ${pin} -> ${newPmId}`)
      } catch (e: any) {
        console.warn(`⚠️ [repin] ${sub.id} failed: ${e?.message}`)
      }
    }
  } catch (e: any) {
    console.warn(`⚠️ [repin] list failed for ${customerId}: ${e?.message}`)
  }
}
