import { prisma } from '@/lib/prisma'

/**
 * Cash-package term end for a given start. Packages that start on the 1st end
 * on the last day of their final month (1 Oct + 6 months = 31 Mar), matching
 * the gym's existing cash packages. Any other start keeps the day-of-month.
 */
export function packageEndFor(start: Date, months: number): Date {
  const y = start.getUTCFullYear(), m = start.getUTCMonth(), d = start.getUTCDate()
  if (d === 1) return new Date(Date.UTC(y, m + months, 0))
  return new Date(Date.UTC(y, m + months, d))
}

export function utcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * Apply a scheduled monthly -> cash-package switch for a member whose Stripe
 * subscription has now ended. Converts the subscription-driven membership row
 * IN PLACE (type, dates, price) so the member keeps their account, PIN and
 * history. Idempotent: returns null when nothing is pending.
 *
 * Called from: the subscription-deleted webhook, the nightly reconcile cron
 * (backstop if the webhook is missed), and the switch route itself when the
 * subscription is found already cancelled.
 */
export async function applyPendingPackage(userId: string, trigger: string) {
  const m = await prisma.membership.findFirst({
    where: { userId, endDate: null, pendingPackageName: { not: null } },
    orderBy: { createdAt: 'desc' }
  })
  if (!m || !m.pendingPackageStart || !m.pendingPackageEnd) return null

  const updated = await prisma.membership.update({
    where: { id: m.id },
    data: {
      membershipType: m.pendingPackageName!,
      status: 'ACTIVE',
      startDate: m.pendingPackageStart,
      endDate: m.pendingPackageEnd,
      monthlyPrice: m.pendingPackagePrice ?? 0,
      nextBillingDate: m.pendingPackageEnd,
      packageCashPaid: m.pendingPackageCash,
      pendingPackageName: null,
      pendingPackageStart: null,
      pendingPackageEnd: null,
      pendingPackagePrice: null,
      pendingPackageCash: null
    }
  })
  // Package members must be able to check in / sign in regardless of the old sub's fate
  await prisma.user.update({ where: { id: userId }, data: { status: 'ACTIVE' } }).catch(() => {})

  try {
    const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
    if (sub) await prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: sub.id,
        action: 'PACKAGE_HANDOVER_APPLIED',
        performedBy: 'system',
        performedByName: `system (${trigger})`,
        reason: `Monthly ended; cash package "${updated.membershipType}" now active ${updated.startDate.toISOString().slice(0, 10)} → ${updated.endDate!.toISOString().slice(0, 10)}`,
        operationId: `pkg_handover_${m.id}_${Date.now()}`,
        metadata: JSON.stringify({ membershipId: m.id, trigger, packageName: updated.membershipType, start: updated.startDate, end: updated.endDate, price: updated.monthlyPrice, cashPaid: updated.packageCashPaid })
      }
    })
  } catch {}
  console.log(`📦 [package-handover:${trigger}] user ${userId}: "${updated.membershipType}" ${updated.startDate.toISOString().slice(0, 10)} → ${updated.endDate!.toISOString().slice(0, 10)}`)
  return updated
}
