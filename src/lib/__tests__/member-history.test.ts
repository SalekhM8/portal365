import { describe, it, expect } from 'vitest'
import { invoiceEvent, auditEvent, humanizeAction, SYSTEM_ACTIONS, sortNewestFirst, makeLineOwnerResolver, stripeCancelEvent, type InvoiceLike } from '@/lib/member-history'

const nameForSub = (sub: string | null) => (sub === 'sub_kid1' ? 'Aariyah Fatima' : sub === 'sub_kid2' ? 'Aayah Fatima' : null)
const subLine = (amount: number, description: string, subscription: string) => ({ amount, description, parent: { type: 'subscription_item_details', invoice_item_details: null, subscription_item_details: { subscription, proration: false } } })
// A cancelled child's unused-time credit: Basil carries no subscription, only the invoice it credits
const creditLine = (amount: number, description: string, creditedInvoice: string) => ({ amount, description, parent: { type: 'invoice_item_details', subscription_item_details: null, invoice_item_details: { invoice_item: 'ii_x', proration: true, subscription: null, proration_details: { credited_items: { invoice: creditedInvoice } } } } })
const kidSepInvoices: InvoiceLike[] = [
  { id: 'in_kid1_sep', created: 1, status: 'paid', amount_due: 2500, amount_paid: 2500, total: 2500, lines: { data: [subLine(2500, "1 × Women's Classes Membership (at £25.00 / month)", 'sub_kid1')] } },
  { id: 'in_kid2_sep', created: 1, status: 'paid', amount_due: 2500, amount_paid: 2500, total: 2500, lines: { data: [subLine(2500, "1 × Women's Classes Membership (at £25.00 / month)", 'sub_kid2')] } },
]
const own = makeLineOwnerResolver(kidSepInvoices, nameForSub)

describe('member-history invoiceEvent', () => {
  it("explains Aisha's £21.60: plan £25 minus £3.40 account credit", () => {
    const ev = invoiceEvent({
      id: 'in_nov', created: 1793491800, status: 'paid', amount_due: 2160, amount_paid: 2160, total: 2500,
      starting_balance: -340, ending_balance: 0, billing_reason: 'subscription_cycle',
      lines: { data: [subLine(2500, "1 × Women's Classes Membership (at £25.00 / month)", 'sub_aisha')] },
    }, own)!
    expect(ev.title).toBe('Charged £21.60 to card')
    expect(ev.details).toEqual([
      "Plan £25.00 — Women's Classes Membership (at £25.00 / month)",
      'Minus £3.40 account credit already on the Stripe balance',
    ])
    expect(ev.member).toBeNull()
    expect(ev.atLabel).toMatch(/GMT$/)
  })

  it("explains Aisha's £0 October: the daughters' unused-time credits swallowed the bill and left £3.40", () => {
    const ev = invoiceEvent({
      id: 'in_oct', created: 1790813940, status: 'paid', amount_due: 0, amount_paid: 0, total: -340,
      starting_balance: 0, ending_balance: -340, billing_reason: 'subscription_cycle',
      lines: { data: [
        creditLine(-1420, "Unused time on Women's Classes Membership after 13 Sep 2026", 'in_kid1_sep'),
        creditLine(-1420, "Unused time on Women's Classes Membership after 13 Sep 2026", 'in_kid2_sep'),
        subLine(2500, "1 × Women's Classes Membership (at £25.00 / month)", 'sub_aisha'),
      ] },
    }, own)!
    expect(ev.title).toBe('Credits exceeded the bill — nothing charged')
    expect(ev.details).toEqual([
      "Plan £25.00 — Women's Classes Membership (at £25.00 / month)",
      "Minus £14.20 — Unused time on Women's Classes Membership after 13 Sep 2026 (Aariyah Fatima)",
      "Minus £14.20 — Unused time on Women's Classes Membership after 13 Sep 2026 (Aayah Fatima)",
      '£3.40 credit left on the account — it will come off the next bill',
    ])
  })

  it('describes an unpaid invoice with attempts, a mid-month upgrade charge, and skips £0 trial-start invoices', () => {
    const open = invoiceEvent({ id: 'in_o', created: 1790000000, status: 'open', amount_due: 5500, amount_paid: 0, total: 5500, attempt_count: 9, lines: { data: [{ amount: 5500, description: '1 × Adults (at £55.00 / month)' }] } }, own)!
    expect(open.title).toBe('Invoice £55.00 unpaid (9 card attempts)')
    const up = invoiceEvent({ id: 'in_u', created: 1790000000, status: 'paid', amount_due: 1100, amount_paid: 1100, total: 1100, lines: { data: [{ amount: 1100, description: 'Upgrade to Adults: remaining 12 days of September', parent: { type: 'invoice_item_details', invoice_item_details: { proration: true, subscription: 'sub_aisha' }, subscription_item_details: null } }] } }, own)!
    expect(up.details).toEqual(['Plus £11.00 — Upgrade to Adults: remaining 12 days of September'])
    expect(invoiceEvent({ id: 'in_t', created: 1, status: 'paid', amount_due: 0, amount_paid: 0, total: 0, billing_reason: 'subscription_create', lines: { data: [{ amount: 0, description: 'Trial period' }] } }, own)).toBeNull()
  })

  it("labels a child's own £25 invoice with the child's name", () => {
    const ev = invoiceEvent(kidSepInvoices[0], own)!
    expect(ev.member).toBe('Aariyah Fatima')
    expect(ev.details[0]).toBe("Plan £25.00 — Women's Classes Membership (at £25.00 / month) (Aariyah Fatima)")
  })
})

describe('member-history auditEvent', () => {
  it('humanises actions, keeps the typed reason, and flags retry noise as system', () => {
    const ev = auditEvent({ id: 'a1', createdAt: '2026-11-01T14:00:00Z', action: 'CANCEL_IMMEDIATE', performedByName: 'Admin User', reason: 'Bshshdhdhhdhd', metadata: JSON.stringify({ cancelationType: 'immediate', prorate: true }) }, null)
    expect(ev.title).toBe('Membership cancelled immediately')
    expect(ev.who).toBe('Admin User')
    expect(ev.details[0]).toBe('Bshshdhdhhdhd')
    expect(ev.details[1]).toMatch(/credited unused days/)
    expect(ev.kind).toBe('action')
    expect(auditEvent({ id: 'a2', createdAt: new Date(), action: 'RETRY_INVOICE_RECOVERY', performedByName: 'Admin User', reason: null }, null).kind).toBe('system')
    expect(SYSTEM_ACTIONS.has('CANCELED_PI_RECOVERY')).toBe(true)
    expect(humanizeAction('SOME_NEW_THING')).toBe('Some new thing')
  })
  it('sorts newest first', () => {
    const a = auditEvent({ id: '1', createdAt: '2026-01-01T00:00:00Z', action: 'PAUSE', performedByName: 'x', reason: null }, null)
    const b = auditEvent({ id: '2', createdAt: '2026-02-01T00:00:00Z', action: 'PAUSE', performedByName: 'x', reason: null }, null)
    expect(sortNewestFirst([a, b]).map(e => e.id)).toEqual(['audit_2', 'audit_1'])
  })
})

describe('member-history stripeCancelEvent', () => {
  const t = Math.floor(Date.UTC(2026, 8, 13, 22, 55) / 1000) // 13 Sep 2026 22:55 UTC = 23:55 BST
  const kid = { id: 'sub_kid1', status: 'canceled', created: 1, canceled_at: t, ended_at: t, cancellation_details: { reason: 'cancellation_requested' } }
  it("surfaces a self-serve cancel that wrote no audit row, labelled with the child's name", () => {
    const ev = stripeCancelEvent(kid, 'Aariyah Fatima', () => false)!
    expect(ev.title).toBe('Subscription cancelled on Stripe')
    expect(ev.member).toBe('Aariyah Fatima')
    expect(ev.atLabel).toBe('13/09/2026, 23:55 BST')
  })
  it('is suppressed when an audit cancellation exists within five minutes (no double entry)', () => {
    expect(stripeCancelEvent(kid, null, (ms) => Math.abs(ms - t * 1000) < 300000)).toBeNull()
  })
  it('names Stripe dunning auto-cancels as such', () => {
    const ev = stripeCancelEvent({ ...kid, cancellation_details: { reason: 'payment_failed' } }, null, () => false)!
    expect(ev.title).toBe('Cancelled by Stripe after repeated failed payments')
    expect(ev.who).toBe('Stripe (automatic)')
  })
  it('ignores live subscriptions', () => {
    expect(stripeCancelEvent({ id: 'x', status: 'active', created: 1, canceled_at: null }, null, () => false)).toBeNull()
  })
})
