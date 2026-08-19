// Effective member status for check-in surfaces — the ONE place this rule lives.
//
// Cash/offline-package members have no live Stripe subscription (an old
// CANCELLED sub from a previous Stripe membership doesn't count) and a
// membership row with an endDate: their status derives from the package term.
// Everyone else takes their subscription status, falling back to the
// membership row.
const LIVE_SUB = new Set(['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'])

export function effectiveMemberStatus(
  sub: { status: string } | null | undefined,
  membership: { status: string; endDate: Date | null } | null | undefined,
): { status: string; isOfflinePackage: boolean } {
  const hasLiveSub = !!sub && LIVE_SUB.has(sub.status)
  const isOfflinePackage = !hasLiveSub && !!membership?.endDate
  let status = sub?.status || membership?.status || 'NONE'
  if (isOfflinePackage) status = membership!.endDate! >= new Date() ? 'ACTIVE' : 'EXPIRED'
  return { status, isOfflinePackage }
}
