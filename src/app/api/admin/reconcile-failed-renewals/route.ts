import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * Backfill FAILED monthly renewals from Stripe into local DB
 * - Scans recent Stripe invoices (status = 'uncollectible' | 'open' | 'void' with amount_due > 0)
 * - Maps to local subscriptions via subscription ID or customer metadata
 * - Inserts Payment rows with status 'FAILED' where missing
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const sinceIso: string | undefined = body?.sinceIso
    const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 35 * 24 * 60 * 60 * 1000)

    let fixed = 0
    let examined = 0
    let mapped = 0

    let hasMore = true
    let startingAfter: string | undefined

    while (hasMore) {
      const batch: any = await stripe.invoices.list({
        created: { gte: Math.floor(since.getTime()/1000) },
        limit: 100,
        starting_after: startingAfter
      })

      for (const inv of batch.data) {
        examined++
        const isFailed = (inv.status === 'uncollectible' || inv.status === 'open') && Number(inv.amount_due) > 0
        if (!isFailed) continue

        const subscriptionId = (inv as any).subscription
        let subscription = null as any
        if (subscriptionId) {
          subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
        }
        if (!subscription && inv.customer) {
          try {
            const sc = await stripe.customers.retrieve(inv.customer as string)
            const userId = (sc as any).metadata?.userId
            if (userId) {
              subscription = await prisma.subscription.findFirst({ where: { userId }, include: { user: true }, orderBy: { createdAt: 'desc' } })
            }
          } catch {}
        }
        if (!subscription) continue
        mapped++

        const amountDue = Number(inv.amount_due) / 100
        const already = await prisma.payment.findFirst({
          where: {
            userId: subscription.userId,
            status: 'FAILED',
            amount: amountDue,
            description: 'Failed monthly membership payment',
            processedAt: { gte: new Date((inv.created || Date.now()/1000) * 1000 - 7*24*60*60*1000), lte: new Date((inv.created || Date.now()/1000) * 1000 + 7*24*60*60*1000) }
          }
        })
        if (already) continue

        await prisma.payment.create({
          data: {
            userId: subscription.userId,
            amount: amountDue,
            currency: (inv.currency || 'gbp').toUpperCase(),
            status: 'FAILED',
            description: 'Failed monthly membership payment',
            routedEntityId: subscription.routedEntityId,
            failureReason: inv.collection_method === 'charge_automatically' ? 'Card charge failed' : 'Invoice unpaid',
            processedAt: new Date((inv.created || Date.now()/1000) * 1000)
          }
        })
        await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
        await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'SUSPENDED' } })
        fixed++
      }

      hasMore = batch.has_more
      startingAfter = batch.data[batch.data.length - 1]?.id
    }

    return NextResponse.json({ success: true, examined, mapped, fixed })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to reconcile failed renewals' }, { status: 500 })
  }
}


