import { prisma } from '@/lib/prisma'

/**
 * Single source of truth for the admin "Payments to-do" list.
 *
 * Returns the same set of FAILED payment rows that the admin dashboard surfaces
 * as outstanding actions. Used by:
 *   - src/app/api/admin/dashboard/route.ts (the user-facing list)
 *   - src/app/api/admin/cron/recover-canceled-pi-invoices/route.ts (auto-recovery)
 *
 * A payment is "in to-do" iff ALL of the following hold:
 *   1. Payment.status = 'FAILED'
 *   2. failureReason NOT IN ('DISMISSED_ADMIN', 'VOIDED_INVOICE')
 *   3. User has at least one subscription whose status is not CANCELLED
 *   4. Invoice has not been resolved later, where "resolved" means:
 *      - A subsequent CONFIRMED Payment row exists for the same stripeInvoiceId
 *        or with [inv:<id>] in description
 *      - A local Invoice row exists with status 'paid' or 'void'
 *      - The same user has any CONFIRMED payment AFTER this failure (covers
 *        manual recoveries that didn't carry the original invoice ID forward)
 *
 * Result is grouped: at most one failure per user (the most recent one), to
 * mirror the dashboard's per-user grouping.
 */

export type ToDoFailedPayment = {
  paymentId: string
  userId: string
  stripeInvoiceId: string | null
  /** Invoice ID extracted from the [inv:xxx] description marker if not on the column */
  parsedInvoiceId: string | null
  amount: number
  retryCount: number
  failureReason: string | null
  createdAt: Date
}

export async function getToDoListFailedPayments(): Promise<ToDoFailedPayment[]> {
  const allFailedPayments = await prisma.payment.findMany({
    where: {
      status: 'FAILED',
      OR: [
        { failureReason: null },
        { failureReason: { notIn: ['DISMISSED_ADMIN', 'VOIDED_INVOICE'] } }
      ],
      user: {
        subscriptions: {
          some: { status: { notIn: ['CANCELLED'] } }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      userId: true,
      amount: true,
      retryCount: true,
      failureReason: true,
      createdAt: true,
      stripeInvoiceId: true,
      description: true
    }
  })

  if (allFailedPayments.length === 0) return []

  // Build the same "resolved invoice ids" set the dashboard builds.
  const failedUserIds = Array.from(new Set(allFailedPayments.map((p) => p.userId)))
  const failedInvoiceIds = new Set<string>()
  for (const p of allFailedPayments) {
    if (p.stripeInvoiceId) failedInvoiceIds.add(p.stripeInvoiceId)
    const m = (p.description || '').match(/\[inv:([^\]]+)\]/)
    if (m?.[1]) failedInvoiceIds.add(m[1])
  }

  const recentConfirmedPayments = await prisma.payment.findMany({
    where: {
      status: 'CONFIRMED',
      userId: { in: failedUserIds }
    },
    select: {
      userId: true,
      stripeInvoiceId: true,
      description: true,
      createdAt: true
    }
  })

  const resolvedInvoiceIds = new Set<string>()
  const userLatestConfirmedDate: Record<string, Date> = {}
  for (const p of recentConfirmedPayments) {
    if (p.stripeInvoiceId) resolvedInvoiceIds.add(p.stripeInvoiceId)
    const m = (p.description || '').match(/\[inv:([^\]]+)\]/)
    if (m?.[1]) resolvedInvoiceIds.add(m[1])
    if (!userLatestConfirmedDate[p.userId] || p.createdAt > userLatestConfirmedDate[p.userId]) {
      userLatestConfirmedDate[p.userId] = p.createdAt
    }
  }

  const closedInvoiceIds = new Set<string>()
  if (failedInvoiceIds.size > 0) {
    const localInvoices = await prisma.invoice.findMany({
      where: {
        stripeInvoiceId: { in: Array.from(failedInvoiceIds) },
        status: { in: ['paid', 'void'] }
      },
      select: { stripeInvoiceId: true }
    })
    for (const inv of localInvoices) closedInvoiceIds.add(inv.stripeInvoiceId)
  }

  const unresolved = allFailedPayments.filter((payment) => {
    if (payment.stripeInvoiceId && resolvedInvoiceIds.has(payment.stripeInvoiceId)) return false
    const m = (payment.description || '').match(/\[inv:([^\]]+)\]/)
    if (m?.[1] && resolvedInvoiceIds.has(m[1])) return false
    if (m?.[1] && closedInvoiceIds.has(m[1])) return false
    const latestConfirmed = userLatestConfirmedDate[payment.userId]
    if (latestConfirmed && latestConfirmed > payment.createdAt) return false
    return true
  })

  // Group: most recent failure per user (mirrors dashboard's todoByUser)
  const byUser: Record<string, ToDoFailedPayment> = {}
  const sorted = [...unresolved].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  )
  for (const p of sorted) {
    if (byUser[p.userId]) continue
    const m = (p.description || '').match(/\[inv:([^\]]+)\]/)
    byUser[p.userId] = {
      paymentId: p.id,
      userId: p.userId,
      stripeInvoiceId: p.stripeInvoiceId,
      parsedInvoiceId: m?.[1] || null,
      amount: Number(p.amount),
      retryCount: p.retryCount,
      failureReason: p.failureReason,
      createdAt: p.createdAt
    }
  }

  return Object.values(byUser)
}
