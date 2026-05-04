import type Stripe from 'stripe'
import { prisma } from '@/lib/prisma'
import type { StripeAccountKey } from '@/lib/stripe'
import { persistSuccessfulPayment } from '@/app/api/webhooks/stripe/handlers'

/**
 * Shared recovery for invoices whose PaymentIntent has been canceled by Stripe
 * Smart Retries (or for any open invoice that needs a fresh charge attempt against
 * the customer's default card).
 *
 * Used by:
 *   - payment_intent.canceled webhook (immediate re-charge the moment Stripe gives up)
 *   - daily recover-canceled-pi-invoices cron (sweeps stragglers, persists across days)
 *   - admin "Retry" endpoint (manual click on the to-do list)
 *
 * Behaviour:
 *   1. Confirm invoice is still open with non-zero amount remaining
 *   2. Pick payment method: customer.invoice_settings.default_payment_method,
 *      else newest attached card
 *   3. paymentIntents.create({off_session, confirm}) for amount_remaining
 *   4. On success → invoices.pay(id, {paid_out_of_band: true}) and
 *      persistSuccessfulPayment so the Payment row flips to CONFIRMED
 *   5. On decline → return structured failure (caller decides to log/notify)
 */

export type RecoveryResult =
  | {
      kind: 'success'
      newPiId: string
      chargeId: string | null
      amount: number
      currency: string
      paymentRowId: string
    }
  | { kind: 'declined'; declineCode?: string; message: string; piId?: string }
  | { kind: 'requires_action'; message: string; piId?: string }
  | { kind: 'no_pm'; message: string }
  | { kind: 'invoice_not_open'; status: string; amountRemaining: number }
  | { kind: 'no_subscription'; message: string }
  | { kind: 'error'; message: string }

export interface RecoveryOptions {
  stripe: Stripe
  account: StripeAccountKey
  invoiceId: string
  /** Where this recovery is firing from (used in description + metadata + idempotency key) */
  trigger: 'webhook' | 'cron' | 'admin_retry'
  /**
   * Idempotency key suffix. Same key + same trigger → same Stripe PI (no double-charge).
   * Defaults to a day bucket for cron, original PI id for webhook, current ms for admin.
   */
  idempotencySuffix?: string
}

function pickPaymentMethodId(
  customer: Stripe.Customer | Stripe.DeletedCustomer | null,
  cards: Stripe.PaymentMethod[]
): string | null {
  if (!customer || customer.deleted) return null
  const defaultPm = (customer as Stripe.Customer).invoice_settings?.default_payment_method
  if (typeof defaultPm === 'string' && defaultPm) return defaultPm
  if (defaultPm && typeof defaultPm === 'object' && 'id' in defaultPm) return defaultPm.id
  // Fallback: newest attached card
  const newest = [...cards].sort((a, b) => b.created - a.created)[0]
  return newest?.id ?? null
}

export async function recoverCanceledPiInvoice(opts: RecoveryOptions): Promise<RecoveryResult> {
  const { stripe, account, invoiceId, trigger } = opts

  // 1) Pull invoice + customer state
  let invoice: Stripe.Invoice
  try {
    invoice = await stripe.invoices.retrieve(invoiceId)
  } catch (err: any) {
    return { kind: 'error', message: `Failed to retrieve invoice: ${err?.message || err}` }
  }

  const amountRemaining = invoice.amount_remaining ?? 0
  if (invoice.status !== 'open' || amountRemaining <= 0) {
    return {
      kind: 'invoice_not_open',
      status: invoice.status || 'unknown',
      amountRemaining
    }
  }

  const customerId = typeof invoice.customer === 'string' ? invoice.customer : invoice.customer?.id
  if (!customerId) {
    return { kind: 'error', message: 'Invoice has no customer id' }
  }

  // 2) DB subscription lookup (invoice.subscription may be null on dead invoices,
  //    so match by stripeCustomerId and prefer the newest)
  const dbSub = await prisma.subscription.findFirst({
    where: { stripeCustomerId: customerId },
    orderBy: { updatedAt: 'desc' },
    select: { id: true, userId: true, routedEntityId: true, stripeSubscriptionId: true }
  })
  if (!dbSub) {
    return { kind: 'no_subscription', message: `No DB subscription for cus=${customerId}` }
  }

  // 3) Pick PM
  let customer: Stripe.Customer | Stripe.DeletedCustomer
  let cards: Stripe.PaymentMethod[]
  try {
    customer = await stripe.customers.retrieve(customerId)
    const list = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 10 })
    cards = list.data
  } catch (err: any) {
    return { kind: 'error', message: `Failed to load customer/cards: ${err?.message || err}` }
  }
  const pmId = pickPaymentMethodId(customer, cards)
  if (!pmId) {
    return { kind: 'no_pm', message: `Customer ${customerId} has no card on file` }
  }

  // 4) Build idempotency key
  let idemSuffix = opts.idempotencySuffix
  if (!idemSuffix) {
    if (trigger === 'cron') {
      idemSuffix = new Date().toISOString().slice(0, 10) // day bucket
    } else if (trigger === 'admin_retry') {
      idemSuffix = String(Date.now()) // fresh per click
    } else {
      idemSuffix = 'webhook'
    }
  }
  const idempotencyKey = `recovery_${invoiceId}_${pmId}_${trigger}_${idemSuffix}`

  // 5) Off-session PI
  let pi: Stripe.PaymentIntent
  try {
    pi = await stripe.paymentIntents.create(
      {
        amount: amountRemaining,
        currency: invoice.currency || 'gbp',
        customer: customerId,
        payment_method: pmId,
        off_session: true,
        confirm: true,
        description: `Recovery (${trigger}): invoice ${invoiceId} after Smart Retries gave up`,
        metadata: {
          reason: 'canceled_pi_recovery',
          trigger,
          originalInvoiceId: invoiceId,
          originalSubId: dbSub.stripeSubscriptionId || '',
          userId: dbSub.userId,
          portalSubId: dbSub.id,
          account
        }
      },
      { idempotencyKey }
    )
  } catch (err: any) {
    // Stripe wraps card declines in StripeCardError with .raw containing the failed PI
    const code = err?.code || err?.raw?.code
    const declineCode = err?.decline_code || err?.raw?.decline_code
    const piId = err?.payment_intent?.id || err?.raw?.payment_intent?.id
    if (code === 'card_declined' || code === 'authentication_required' || code === 'expired_card' || code === 'insufficient_funds') {
      return {
        kind: 'declined',
        declineCode: declineCode || code,
        message: err?.message || 'Card declined',
        piId
      }
    }
    return { kind: 'error', message: err?.message || String(err) }
  }

  if (pi.status === 'requires_action' || pi.status === 'requires_confirmation') {
    return {
      kind: 'requires_action',
      message: `PI in ${pi.status} — 3DS or further auth needed`,
      piId: pi.id
    }
  }

  if (pi.status !== 'succeeded') {
    return {
      kind: 'declined',
      declineCode: (pi.last_payment_error?.decline_code as string | undefined) || (pi.last_payment_error?.code as string | undefined),
      message: pi.last_payment_error?.message || `PI ended in ${pi.status}`,
      piId: pi.id
    }
  }

  // 6) Charge succeeded → mark invoice paid out of band
  try {
    await stripe.invoices.pay(invoiceId, { paid_out_of_band: true })
  } catch (err: any) {
    // The PI succeeded so the customer is charged — log loudly but don't unwind.
    console.error(`⚠️ Recovery PI ${pi.id} succeeded but invoices.pay(OOB) failed:`, err?.message || err)
  }

  // 7) Persist Payment row (CONFIRMED). Reuses the webhook helper which handles the
  //    P2002 / existing-row case (e.g. row was previously written as FAILED).
  const charge = pi.latest_charge
  const chargeId = typeof charge === 'string' ? charge : charge?.id || null
  const amountGBP = amountRemaining / 100
  const description = `Monthly membership payment (auto-recovered via ${trigger}) [inv:${invoiceId}] [pi:${pi.id}] [sub:${dbSub.id}]${chargeId ? ` [charge:${chargeId}]` : ''}`

  let paymentRowId = ''
  try {
    const payment = await persistSuccessfulPayment({
      invoiceId,
      userIdForPayment: dbSub.userId,
      amountPaid: amountGBP,
      currency: (invoice.currency || 'gbp').toUpperCase(),
      description,
      routedEntityId: dbSub.routedEntityId,
      operationId: `recovery_${trigger}_${invoiceId}_${Date.now()}`
    })
    paymentRowId = payment.id
  } catch (err: any) {
    console.error(`⚠️ Recovery PI ${pi.id} succeeded but Payment row write failed:`, err?.message || err)
  }

  // 8) Audit log so we can see all recoveries on the subscription page
  try {
    await prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: dbSub.id,
        action: 'CANCELED_PI_RECOVERY',
        performedBy: dbSub.userId,
        performedByName: `system (${trigger})`,
        reason: `Recovered invoice ${invoiceId} after Smart Retries canceled the original PI`,
        operationId: `recovery_${trigger}_${invoiceId}_${pi.id}`,
        metadata: JSON.stringify({
          newPiId: pi.id,
          chargeId,
          amountGBP,
          trigger,
          account,
          paymentMethodId: pmId
        })
      }
    })
  } catch {
    /* audit log is best-effort */
  }

  return {
    kind: 'success',
    newPiId: pi.id,
    chargeId,
    amount: amountGBP,
    currency: (invoice.currency || 'gbp').toUpperCase(),
    paymentRowId
  }
}
