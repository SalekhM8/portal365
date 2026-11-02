import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { auditEvent, invoiceEvent, makeLineOwnerResolver, oneOffPaymentEvent, refundEvent, sortNewestFirst, stripeCancelEvent, type HistoryEvent } from '@/lib/member-history'

/**
 * GET /api/admin/customers/[id]/history
 *
 * Everything that happened to this member, newest first, with the reason:
 * Stripe invoices (plan / credits / balance breakdown), refunds, one-off
 * payments and every audit-log action. For a family payer the children's
 * events are included and labelled with the child's name, because the
 * children's credits and charges land on the parent's card.
 *
 * Read-only. Live from Stripe (invoices + charges per customer), so it is
 * correct for members whose history predates any DB bookkeeping.
 */
export async function GET(_req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await context.params
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true } })
  if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  // Children whose family group is this member (they bill on this member's card)
  const childMemberships = await prisma.membership.findMany({ where: { familyGroupId: id, userId: { not: id } }, select: { userId: true }, distinct: ['userId'] })
  const childIds = childMemberships.map(m => m.userId)
  const children = childIds.length ? await prisma.user.findMany({ where: { id: { in: childIds } }, select: { id: true, firstName: true, lastName: true } }) : []
  const nameOf = new Map<string, string | null>([[id, null], ...children.map(c => [c.id, `${c.firstName} ${c.lastName}`.trim()] as [string, string])])
  const allIds = [id, ...childIds]

  const subs = await prisma.subscription.findMany({
    where: { userId: { in: allIds } },
    select: { id: true, userId: true, stripeSubscriptionId: true, stripeCustomerId: true, stripeAccountKey: true, auditLogs: { select: { id: true, createdAt: true, action: true, performedByName: true, reason: true, metadata: true } } },
  })
  const subOwner = new Map<string, string | null>()
  for (const s of subs) if (s.stripeSubscriptionId) subOwner.set(s.stripeSubscriptionId, nameOf.get(s.userId) ?? null)
  const nameForSub = (subId: string | null) => (subId ? subOwner.get(subId) ?? null : null)

  const events: HistoryEvent[] = []
  const warnings: string[] = []

  for (const s of subs) for (const log of s.auditLogs) events.push(auditEvent(log, nameOf.get(s.userId) ?? null))
  const auditCancelTimes = subs.flatMap(s => s.auditLogs.filter(l => l.action.startsWith('CANCEL')).map(l => new Date(l.createdAt).getTime()))
  const hasAuditCancelNear = (atMs: number) => auditCancelTimes.some(t => Math.abs(t - atMs) < 5 * 60 * 1000)

  // One-off payments (no Stripe invoice): joining fees, admin prorations, partial refund rows
  const oneOffs = await prisma.payment.findMany({ where: { userId: { in: allIds }, stripeInvoiceId: null }, select: { id: true, userId: true, createdAt: true, amount: true, status: true, description: true } })
  for (const p of oneOffs) events.push(oneOffPaymentEvent({ ...p, amount: Number(p.amount) }, nameOf.get(p.userId) ?? null))

  // Stripe: one invoices.list + one charges.list per distinct (account, customer)
  const customers = new Map<string, { account: StripeAccountKey; customer: string }>()
  for (const s of subs) if (s.stripeCustomerId?.startsWith('cus_')) customers.set(`${s.stripeAccountKey}:${s.stripeCustomerId}`, { account: s.stripeAccountKey as StripeAccountKey, customer: s.stripeCustomerId })
  const seenInvoices = new Set<string>()
  for (const { account, customer } of customers.values()) {
    try {
      const stripe = getStripeClient(account)
      const invoices = await stripe.invoices.list({ customer, limit: 100 })
      const ownerOf = makeLineOwnerResolver(invoices.data as any, nameForSub)
      for (const inv of invoices.data) {
        const invId = inv.id as string
        if (seenInvoices.has(invId)) continue
        seenInvoices.add(invId)
        const ev = invoiceEvent(inv as any, ownerOf)
        if (ev) events.push(ev)
      }
      const stripeSubs = await stripe.subscriptions.list({ customer, status: 'all', limit: 100 })
      for (const ss of stripeSubs.data) {
        const ev = stripeCancelEvent(ss as any, nameForSub(ss.id), hasAuditCancelNear)
        if (ev) events.push(ev)
      }
      const charges = await stripe.charges.list({ customer, limit: 100, expand: ['data.refunds'] })
      for (const ch of charges.data) {
        const refunds = (ch as any).refunds?.data || []
        for (const r of refunds) events.push(refundEvent(r, ch.amount, null))
      }
    } catch (e: any) {
      warnings.push(`Stripe ${account} ${customer}: ${e?.message || 'unavailable'}`)
    }
  }

  const sorted = sortNewestFirst(events)
  return NextResponse.json({
    member: { id: user.id, name: `${user.firstName} ${user.lastName}`.trim() },
    children: children.map(c => ({ id: c.id, name: `${c.firstName} ${c.lastName}`.trim() })),
    events: sorted,
    warnings,
  })
}
