import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * DAILY CRON: Subscription status reconciler.
 *
 * The portal learns Stripe state via webhooks; a missed delivery leaves a DB
 * row stale forever (e.g. Ishaq Tuki, Aug 2026: scheduled cancel executed in
 * Stripe, portal stayed ACTIVE). This cron compares every DB-live subscription
 * against Stripe and:
 *
 *  - AUTO-FIXES exactly one unambiguous case: Stripe sub is `canceled`
 *    (or gone) but DB says live -> mark DB sub + membership CANCELLED, with an
 *    audit log. This is portal-state-only: it never writes to Stripe and never
 *    charges anyone.
 *  - FLAGS (report only) everything else, e.g. DB PAUSED while Stripe bills.
 *
 * Schedule: daily 07:00 UTC via vercel.json.
 */

function getAuthSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return request.headers.get('x-cron-secret')
}

const DB_LIVE = ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE']
const STRIPE_LIVE = new Set(['trialing', 'active', 'past_due', 'unpaid'])

export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const secret = getAuthSecret(request)
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const subs = await prisma.subscription.findMany({
    where: { status: { in: DB_LIVE }, stripeSubscriptionId: { startsWith: 'sub_' } },
    include: { user: { select: { email: true, firstName: true, lastName: true } } }
  })

  const fixed: any[] = []
  const flagged: any[] = []
  let checked = 0
  let errors = 0

  for (const sub of subs) {
    try {
      const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
      let stripeStatus: string
      try {
        const ss = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
        stripeStatus = ss.status
        checked++
        if (STRIPE_LIVE.has(ss.status)) {
          // billing is live — flag paused-drift for a human, never auto-touch
          if (sub.status === 'PAUSED' && !ss.pause_collection && ss.status === 'active') {
            flagged.push({ email: sub.user.email, db: sub.status, stripe: ss.status, note: 'DB paused but Stripe billing normally' })
          }
          continue
        }
      } catch (e: any) {
        if (!/No such subscription/.test(e.message || '')) throw e
        stripeStatus = 'not_found'
        checked++
      }

      // Stripe sub is canceled/incomplete_expired/not found — the member is NOT
      // being billed. Portal must not show them live.
      await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'CANCELLED', cancelAtPeriodEnd: false } })
      // Don't touch offline/cash memberships (endDate set) — only the sub-driven row
      await prisma.membership.updateMany({
        where: { userId: sub.userId, endDate: null, status: { in: ['ACTIVE', 'SUSPENDED', 'PAUSED'] } },
        data: { status: 'CANCELLED' }
      })
      try {
        await prisma.subscriptionAuditLog.create({
          data: {
            subscriptionId: sub.id,
            action: 'RECONCILED_CANCELLED',
            performedBy: 'SYSTEM',
            performedByName: 'Status Reconciler',
            reason: `Stripe subscription is ${stripeStatus} but portal showed ${sub.status} (missed webhook) — portal status corrected`,
            operationId: `reconcile_${sub.id}_${Date.now()}`,
            metadata: JSON.stringify({ stripeSubscriptionId: sub.stripeSubscriptionId, stripeStatus, dbStatusBefore: sub.status })
          }
        })
      } catch {}
      fixed.push({ email: sub.user.email, name: `${sub.user.firstName} ${sub.user.lastName}`, dbWas: sub.status, stripe: stripeStatus })
      console.log(`✅ [reconcile] ${sub.user.email}: DB ${sub.status} -> CANCELLED (Stripe: ${stripeStatus})`)
    } catch (e: any) {
      errors++
      console.error(`❌ [reconcile] ${sub.stripeSubscriptionId}: ${e.message}`)
    }
  }

  const result = { success: true, checked, fixed, flagged, errors, durationMs: Date.now() - startTime }
  console.log(`🏁 [reconcile] checked=${checked} fixed=${fixed.length} flagged=${flagged.length} errors=${errors}`)
  return NextResponse.json(result)
}

export async function POST(request: NextRequest) {
  return GET(request)
}
