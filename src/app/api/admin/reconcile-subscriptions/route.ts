import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

type StripeLikeStatus = 'trialing' | 'active' | 'incomplete' | 'incomplete_expired' | 'past_due' | 'unpaid' | 'canceled' | string

export async function POST(request: NextRequest) {
  try {
    // Auth + safety guards
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
    if (!me || !['ADMIN','SUPER_ADMIN'].includes(me.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (process.env.ALLOW_MAINTENANCE !== 'true') {
      return NextResponse.json({ error: 'Maintenance not allowed (ALLOW_MAINTENANCE!=true)' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({} as any))
    const dryRun: boolean = body?.dryRun !== false // default true
    const withinDays: number = Math.max(1, Math.min(90, Number(body?.withinDays ?? 30)))

    const since = new Date(Date.now() - withinDays * 24 * 60 * 60 * 1000)

    // Find candidate subs
    const candidates = await prisma.subscription.findMany({
      where: {
        status: 'PENDING_PAYMENT',
        updatedAt: { gte: since },
        NOT: [{ stripeSubscriptionId: { startsWith: 'setup_placeholder_' } }]
      },
      include: { user: true }
    })

    const results: any[] = []
    let activated = 0
    let paused = 0
    let cancelled = 0
    let leftPending = 0
    let pastDue = 0

    for (const sub of candidates) {
      try {
        const stripeSubId = sub.stripeSubscriptionId as string
        if (!stripeSubId || stripeSubId.startsWith('setup_placeholder_')) {
          leftPending++
          results.push({ id: sub.id, action: 'skipped', reason: 'no_stripe_subscription_id' })
          continue
        }

        const resp = await stripe.subscriptions.retrieve(stripeSubId)
        const s: any = (resp as any).data ?? resp
        const stripeStatus = (s.status || '').toLowerCase() as StripeLikeStatus

        // Determine target local status
        let target: 'ACTIVE' | 'PAUSED' | 'CANCELLED' | 'PAST_DUE' | null = null
        if (s.pause_collection?.behavior === 'void') {
          target = 'PAUSED'
        } else if (stripeStatus === 'trialing' || stripeStatus === 'active') {
          target = 'ACTIVE'
        } else if (stripeStatus === 'canceled') {
          target = 'CANCELLED'
        } else if (stripeStatus === 'past_due' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired') {
          target = 'PAST_DUE'
        }

        if (!target) {
          leftPending++
          results.push({ id: sub.id, action: 'no_change', stripeStatus })
          continue
        }

        // Compute period dates from Stripe when available
        const currentPeriodStart = s.current_period_start ? new Date(s.current_period_start * 1000) : sub.currentPeriodStart
        const currentPeriodEnd = s.current_period_end ? new Date(s.current_period_end * 1000) : sub.currentPeriodEnd
        const nextBillingDate = s.current_period_end ? new Date(s.current_period_end * 1000) : sub.nextBillingDate

        if (!dryRun) {
          await prisma.$transaction(async (tx) => {
            await tx.subscription.update({
              where: { id: sub.id },
              data: {
                status: target,
                currentPeriodStart,
                currentPeriodEnd,
                nextBillingDate,
                cancelAtPeriodEnd: s.cancel_at_period_end ?? false
              }
            })

            // Membership mirror
            await tx.membership.updateMany({
              where: { userId: sub.userId },
              data: { status: target === 'PAUSED' ? 'SUSPENDED' : target === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE' }
            })

            // Optional audit log if table exists
            try {
              await tx.subscriptionAuditLog.create({
                data: {
                  subscriptionId: sub.id,
                  action: 'RECONCILE_STATUS',
                  performedBy: me.id,
                  performedByName: session.user.email,
                  reason: `Stripe ${stripeStatus} → Local ${target}`,
                  operationId: `reconcile_${sub.id}_${Date.now()}`,
                  metadata: JSON.stringify({ stripeSubscriptionId: stripeSubId, pause: s.pause_collection?.behavior, cancelAtPeriodEnd: s.cancel_at_period_end })
                }
              })
            } catch {}
          })
        }

        if (target === 'ACTIVE') activated++
        else if (target === 'PAUSED') paused++
        else if (target === 'CANCELLED') cancelled++
        else if (target === 'PAST_DUE') pastDue++

        results.push({ id: sub.id, action: dryRun ? 'would_update' : 'updated', to: target, stripeStatus })
      } catch (e: any) {
        leftPending++
        results.push({ id: sub.id, action: 'error', error: e?.message || 'unknown' })
      }
    }

    return NextResponse.json({
      dryRun,
      scanned: candidates.length,
      activated,
      paused,
      cancelled,
      pastDue,
      leftPending,
      results
    })
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Reconcile failed' }, { status: 500 })
  }
}


