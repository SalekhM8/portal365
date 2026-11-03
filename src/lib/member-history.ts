/**
 * Member History — one dated list that explains what happened to a member and
 * why: every Stripe invoice (with its breakdown: plan, unused-time credits,
 * account credit applied), every refund, every one-off payment, and every
 * admin/system action from the subscription audit log. Family payers also see
 * the children's events that touched their card, labelled with the child's name.
 *
 * Pure helpers live here so they can be unit-tested without Stripe or Prisma.
 */
import { ukDateTime } from '@/lib/uk-time'

export type HistoryKind = 'payment' | 'refund' | 'action' | 'system'

export interface HistoryEvent {
  id: string
  at: string          // ISO
  atLabel: string     // "13/09/2026, 23:55 BST"
  kind: HistoryKind
  title: string       // one line: what happened
  details: string[]   // the why / the breakdown, one line each
  who: string | null  // who did it (admin name, "Member (self-serve)", "Stripe", "System")
  member: string | null // child's name when the event belongs to a family child, else null
  amount: number | null // signed pounds for money events
}

const gbp = (pence: number) => `£${(Math.abs(pence) / 100).toFixed(2)}`

/** Audit actions produced by automated retry/reconcile loops — hidden by default. */
export const SYSTEM_ACTIONS = new Set([
  'RETRY_INVOICE_RECOVERY', 'CANCELED_PI_RECOVERY', 'RETRY_INVOICE', 'RECONCILE_STATUS', 'RECONCILED_CANCELLED',
])

const ACTION_TITLES: Record<string, string> = {
  CANCEL_IMMEDIATE: 'Membership cancelled immediately',
  CANCEL_SCHEDULED: 'Cancellation scheduled for end of period',
  CANCEL_UNSCHEDULED: 'Scheduled cancellation removed',
  UNCANCEL: 'Scheduled cancellation removed',
  REINSTATED: 'Membership reinstated',
  REACTIVATE: 'Membership reactivated',
  PAUSE: 'Membership paused',
  PAUSE_STARTED: 'Pause started',
  PAUSE_ENDED: 'Pause ended',
  PAUSE_COMPLETED: 'Pause completed',
  PAUSE_EXTENDED: 'Pause extended',
  PAUSE_SCHEDULE_CREATE: 'Pause scheduled',
  PAUSE_WINDOW_CREATED: 'Pause scheduled',
  PAUSE_WINDOW_CANCELLED: 'Scheduled pause cancelled',
  RESUME: 'Membership resumed',
  PLAN_CHANGED: 'Plan changed',
  SWITCH_TO_PACKAGE_SCHEDULED: 'Switch to cash package scheduled',
  SWITCH_TO_PACKAGE_UNDONE: 'Switch to cash package undone',
  PACKAGE_HANDOVER_APPLIED: 'Cash package started (monthly ended)',
  LINKED_TO_CASH_PACKAGE: 'Linked to cash package',
  PACKAGE_RENEWED: 'Cash package renewed',
  PACKAGE_ENDED: 'Cash package ended',
  INVOICE_VOIDED: 'Invoice voided',
  REFUND: 'Refund issued',
  MEMBERSHIP_CORRECTION: 'Membership corrected by admin',
  DUNNING_AUTOCANCEL_REVIVED: 'Revived after Stripe auto-cancel',
  RETRY_INVOICE_RECOVERY: 'Payment retry attempted',
  CANCELED_PI_RECOVERY: 'Payment retry attempted',
  RETRY_INVOICE: 'Payment retry attempted',
  RECONCILE_STATUS: 'Status reconciled with Stripe',
  RECONCILED_CANCELLED: 'Status reconciled with Stripe',
}

export function humanizeAction(action: string): string {
  return ACTION_TITLES[action] || action.toLowerCase().replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase())
}

export function auditEvent(log: {
  id: string; createdAt: Date | string; action: string; performedByName: string | null; reason: string | null; metadata?: string | null
}, member: string | null): HistoryEvent {
  const details: string[] = []
  if (log.reason && log.reason.trim()) details.push(log.reason.trim())
  try {
    const meta = log.metadata ? JSON.parse(log.metadata) : null
    if (meta && typeof meta === 'object') {
      if (meta.cancelationType === 'immediate' && meta.prorate === true) details.push('Stripe credited unused days to the account balance (old prorate-on-cancel behaviour).')
      if (meta.chargedPence) details.push(`Charged ${gbp(meta.chargedPence)} now.`)
      if (meta.refundedPence) details.push(`Refunded ${gbp(meta.refundedPence)} to card.`)
      if (meta.fromPlan && meta.toPlan) details.push(`${meta.fromPlan} → ${meta.toPlan}`)
    }
  } catch { /* metadata is free-form */ }
  const who = log.performedByName && log.performedByName.trim() ? log.performedByName.trim() : null
  return {
    id: `audit_${log.id}`,
    at: new Date(log.createdAt).toISOString(),
    atLabel: ukDateTime(log.createdAt),
    kind: SYSTEM_ACTIONS.has(log.action) ? 'system' : 'action',
    title: humanizeAction(log.action),
    details,
    who,
    member,
    amount: null,
  }
}

/** Minimal shape of a Stripe invoice we read (stripe@18 / Basil payloads). */
export interface InvoiceLike {
  id: string
  created: number
  status: string | null
  amount_due: number
  amount_paid: number
  total: number
  starting_balance?: number | null
  ending_balance?: number | null
  billing_reason?: string | null
  attempt_count?: number
  lines: { data: Array<{ amount: number; description: string | null; proration?: boolean; parent?: any; subscription?: string | null; period?: { start: number; end: number } | null }> }
}

type InvoiceLine = InvoiceLike['lines']['data'][number]

/** Basil moved `proration` and the owning subscription under `line.parent.*`. */
export const lineIsProration = (l: InvoiceLine): boolean =>
  Boolean(l.proration ?? l.parent?.invoice_item_details?.proration ?? l.parent?.subscription_item_details?.proration ?? false)

export const lineSubscription = (l: InvoiceLine): string | null =>
  l.parent?.subscription_item_details?.subscription || l.parent?.invoice_item_details?.subscription || l.parent?.subscription_details?.subscription || l.subscription || null

/** For an unused-time credit line, the invoice it is crediting (Basil: parent.invoice_item_details.proration_details.credited_items.invoice). */
export const lineCreditedInvoice = (l: InvoiceLine): string | null =>
  l.parent?.invoice_item_details?.proration_details?.credited_items?.invoice || null

/**
 * Build a resolver that names the member behind any invoice line. Plan lines carry
 * their subscription directly; a cancelled child's unused-time credit carries only
 * the invoice it credits, so we look that invoice up to find the child's subscription.
 */
export function makeLineOwnerResolver(invoices: InvoiceLike[], nameForSub: (subId: string | null) => string | null) {
  const invoiceSub = new Map<string, string>()
  for (const inv of invoices) for (const l of inv.lines?.data || []) {
    const sub = l.parent?.subscription_item_details?.subscription || l.subscription
    if (sub && !invoiceSub.has(inv.id)) invoiceSub.set(inv.id, sub)
  }
  return (l: InvoiceLine): string | null => {
    const direct = lineSubscription(l)
    if (direct) return nameForSub(direct)
    const credited = lineCreditedInvoice(l)
    if (credited && invoiceSub.has(credited)) return nameForSub(invoiceSub.get(credited)!)
    return null
  }
}

/**
 * Turn a Stripe invoice into one event that says what the card was charged and why.
 * `ownerOf` names the member behind a line (null = the member whose history this is).
 */
export function invoiceEvent(inv: InvoiceLike, ownerOf: (line: InvoiceLine) => string | null): HistoryEvent | null {
  const lines = inv.lines?.data || []
  const planLines = lines.filter(l => l.amount > 0 && !lineIsProration(l))
  const creditLines = lines.filter(l => l.amount < 0)
  const chargeLines = lines.filter(l => l.amount > 0 && lineIsProration(l))
  const total = inv.total ?? 0
  const startingCredit = Math.max(0, -(inv.starting_balance ?? 0))        // credit on the account before this invoice
  const creditApplied = Math.min(startingCredit, Math.max(0, total))       // how much of it this invoice used
  const endingCredit = Math.max(0, -(inv.ending_balance ?? 0))

  // Trial-start invoices (£0, nothing to explain)
  if (inv.billing_reason === 'subscription_create' && total === 0 && creditLines.length === 0) return null

  const details: string[] = []
  for (const l of planLines) {
    const owner = ownerOf(l)
    details.push(`Plan ${gbp(l.amount)}${l.description ? ` — ${l.description.replace(/^1 × /, '')}` : ''}${owner ? ` (${owner})` : ''}`)
  }
  for (const l of chargeLines) details.push(`Plus ${gbp(l.amount)} — ${l.description || 'proration'}`)
  for (const l of creditLines) {
    const owner = ownerOf(l)
    details.push(`Minus ${gbp(l.amount)} — ${l.description || 'credit'}${owner ? ` (${owner})` : ''}`)
  }
  if (creditApplied > 0) details.push(`Minus ${gbp(creditApplied)} account credit already on the Stripe balance`)
  if (endingCredit > 0) details.push(`${gbp(endingCredit)} credit left on the account — it will come off the next bill`)

  const status = inv.status || 'unknown'
  let title: string
  let amount: number | null = null
  if (status === 'paid') {
    if (inv.amount_paid > 0) { title = `Charged ${gbp(inv.amount_paid)} to card`; amount = inv.amount_paid / 100 }
    else if (total > 0 && creditApplied >= total) title = `Bill of ${gbp(total)} covered entirely by account credit — nothing charged`
    else if (total <= 0 && creditLines.length) title = 'Credits exceeded the bill — nothing charged'
    else title = 'Nothing to pay'
  } else if (status === 'open') {
    title = `Invoice ${gbp(inv.amount_due)} unpaid${inv.attempt_count ? ` (${inv.attempt_count} card attempt${inv.attempt_count === 1 ? '' : 's'})` : ''}`
    amount = inv.amount_due / 100
  } else if (status === 'void') {
    title = `Invoice ${gbp(total)} voided`
  } else if (status === 'uncollectible') {
    title = `Invoice ${gbp(inv.amount_due)} written off as uncollectible`
  } else if (status === 'draft') {
    title = `Draft invoice ${gbp(total)}`
  } else {
    title = `Invoice ${gbp(total)} (${status})`
  }

  // Whose invoice: the subscription behind the plan line (children bill on the parent's customer)
  const owner = planLines[0] ? ownerOf(planLines[0]) : lines[0] ? ownerOf(lines[0]) : null
  return {
    id: `inv_${inv.id}`,
    at: new Date(inv.created * 1000).toISOString(),
    atLabel: ukDateTime(inv.created * 1000),
    kind: 'payment',
    title,
    details,
    who: 'Stripe',
    member: owner,
    amount,
  }
}

export interface RefundLike { id: string; created: number; amount: number; status: string | null; reason?: string | null }

export function refundEvent(r: RefundLike, chargeAmount: number, member: string | null): HistoryEvent {
  return {
    id: `re_${r.id}`,
    at: new Date(r.created * 1000).toISOString(),
    atLabel: ukDateTime(r.created * 1000),
    kind: 'refund',
    title: `Refunded ${gbp(r.amount)} to card${r.amount < chargeAmount ? ` (partial, of ${gbp(chargeAmount)})` : ''}`,
    details: r.status && r.status !== 'succeeded' ? [`Refund status: ${r.status}`] : [],
    who: 'Admin (Refund button)',
    member,
    amount: -(r.amount / 100),
  }
}

/** One-off DB payments (joining fees, admin prorations) that have no Stripe invoice. */
export function oneOffPaymentEvent(p: { id: string; createdAt: Date | string; amount: number; status: string; description: string }, member: string | null): HistoryEvent {
  const desc = p.description.replace(/\s*\[[a-z]+:[^\]]*\]/g, '').trim()
  const paid = p.status === 'CONFIRMED' || p.status === 'REFUNDED'
  const abs = `£${Math.abs(p.amount).toFixed(2)}`
  const title = paid ? `Charged ${abs} to card`
    : p.status === 'CREDITED' ? `${abs} credit note — will come off the next bill`
    : p.status === 'FAILED' ? `Payment ${abs} failed`
    : `Payment ${abs} ${p.status.toLowerCase()}`
  return {
    id: `pay_${p.id}`,
    at: new Date(p.createdAt).toISOString(),
    atLabel: ukDateTime(p.createdAt),
    kind: 'payment',
    title,
    details: desc ? [desc] : [],
    who: 'Stripe',
    member,
    amount: p.amount,
  }
}

export interface StripeSubLike { id: string; status: string; created: number; canceled_at?: number | null; ended_at?: number | null; cancel_at_period_end?: boolean; cancellation_details?: { reason?: string | null; comment?: string | null } | null; trial_end?: number | null }

/**
 * Stripe's own record of a subscription being cancelled. Used only when the audit log has
 * no cancellation within a few minutes of it, so historical self-serve cancels (which wrote
 * no audit row) still show up, and dunning auto-cancels by Stripe are visible as such.
 */
export function stripeCancelEvent(sub: StripeSubLike, member: string | null, hasAuditCancelNear: (atMs: number) => boolean): HistoryEvent | null {
  if (!sub.canceled_at) return null
  const atMs = sub.canceled_at * 1000
  if (hasAuditCancelNear(atMs)) return null
  const reason = sub.cancellation_details?.reason || null
  const byStripe = reason === 'payment_failed'
  const scheduled = Boolean(sub.ended_at && sub.canceled_at && sub.ended_at - sub.canceled_at > 120)
  return {
    id: `subcancel_${sub.id}`,
    at: new Date(atMs).toISOString(),
    atLabel: ukDateTime(atMs),
    kind: 'action',
    title: byStripe ? 'Cancelled by Stripe after repeated failed payments' : scheduled ? 'Cancellation scheduled (ran at end of period)' : 'Subscription cancelled on Stripe',
    details: [
      byStripe ? 'Stripe\'s "cancel after failed retries" setting ended the subscription. No admin action.' : 'No admin audit entry at this time — this was done from the member\'s own dashboard or family page, or directly in Stripe.',
      ...(scheduled && sub.ended_at ? [`Access ended ${ukDateTime(sub.ended_at * 1000)}.`] : []),
    ],
    who: byStripe ? 'Stripe (automatic)' : 'Member / parent (self-serve) or Stripe dashboard',
    member,
    amount: null,
  }
}

export function sortNewestFirst(events: HistoryEvent[]): HistoryEvent[] {
  return [...events].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
}
