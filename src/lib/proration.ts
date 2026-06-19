import { getStripeClient, getSubscriptionPeriod, type StripeAccountKey } from '@/lib/stripe'

/**
 * Charge a one-off prorated amount to a customer's saved card, off-session.
 *
 * This is the single, hardened charge path used by every mid-cycle proration
 * (resume, upgrade, reactivate). It mirrors the proven reactivate flow:
 *   invoice item -> invoice (charge_automatically) -> finalize -> pay -> verify.
 *
 * Safety guarantees:
 *  - idempotencyKey on both the invoice item and the invoice => calling twice
 *    (retry, webhook race) can NEVER double-charge; the second call returns the
 *    same objects.
 *  - returns { paid } based on the FINAL invoice status. Callers MUST check it
 *    and refuse to grant access / flip the plan when paid === false (off-session
 *    cards can decline or need 3DS). Never grant for free on a failed charge.
 */
export async function chargeProration(opts: {
  account: StripeAccountKey
  customerId: string
  amountPence: number
  description: string
  metadata?: Record<string, string>
  idempotencyKey: string
}): Promise<{ paid: boolean; invoiceId: string | null; amountPaidPence: number; error?: string }> {
  const { account, customerId, amountPence, description, metadata = {}, idempotencyKey } = opts

  if (!Number.isFinite(amountPence) || amountPence <= 0) {
    // Nothing to charge (e.g. resume on the 1st, or a downgrade). Treat as paid:true
    // so callers proceed — there is genuinely no money owed.
    return { paid: true, invoiceId: null, amountPaidPence: 0 }
  }

  const stripe = getStripeClient(account)

  await stripe.invoiceItems.create(
    { customer: customerId, amount: Math.round(amountPence), currency: 'gbp', description, metadata },
    { idempotencyKey: `${idempotencyKey}:ii` }
  )

  const invoice = await stripe.invoices.create(
    {
      customer: customerId,
      collection_method: 'charge_automatically',
      auto_advance: false,
      pending_invoice_items_behavior: 'include',
      description,
      metadata,
    },
    { idempotencyKey: `${idempotencyKey}:inv` }
  )

  const finalized = await stripe.invoices.finalizeInvoice(invoice.id!)

  let paid: any
  try {
    paid = await stripe.invoices.pay(finalized.id!)
  } catch (e: any) {
    return { paid: false, invoiceId: finalized.id || null, amountPaidPence: 0, error: e?.raw?.message || e?.message || 'pay failed' }
  }

  return {
    paid: paid.status === 'paid',
    invoiceId: finalized.id || null,
    amountPaidPence: paid.amount_paid || 0,
    error: paid.status === 'paid' ? undefined : `invoice status ${paid.status}`,
  }
}

/**
 * Calendar-month proration for the remainder of the current month.
 * Used by resume (full monthly price for the days left) — the gym bills on the 1st.
 */
export function prorateRemainderOfMonth(monthlyPrice: number, from: Date = new Date()): { amountPence: number; remainingDays: number; daysInMonth: number } {
  const y = from.getUTCFullYear()
  const m = from.getUTCMonth()
  const daysInMonth = new Date(Date.UTC(y, m + 1, 0)).getUTCDate()
  const firstNext = new Date(Date.UTC(y, m + 1, 1))
  const remainingDays = Math.max(0, Math.ceil((firstNext.getTime() - from.getTime()) / 86_400_000))
  const amountPence = Math.round(monthlyPrice * (remainingDays / daysInMonth) * 100)
  return { amountPence, remainingDays, daysInMonth }
}

/** Re-export for callers that need the period off a Stripe subscription. */
export { getSubscriptionPeriod }
