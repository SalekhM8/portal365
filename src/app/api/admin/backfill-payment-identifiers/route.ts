import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * Attach Stripe charge/invoice IDs to historical CONFIRMED payments (behind the scenes)
 * Safe behavior: skip amount=0, skip if ambiguous, dryRun option
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const dryRun: boolean = body?.dryRun !== false // default true
    const sinceIso: string | undefined = body?.sinceIso
    const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 120*24*60*60*1000)

    const payments = await prisma.payment.findMany({
      where: {
        status: 'CONFIRMED',
        amount: { gt: 0 },
        OR: [
          { stripeChargeId: null },
          { stripeInvoiceId: null }
        ],
        createdAt: { gte: since }
      },
      orderBy: { createdAt: 'asc' }
    })

    const results: any[] = []

    for (const p of payments) {
      const subs = await prisma.subscription.findMany({ where: { userId: p.userId } })
      const stripeCustomerId = subs[0]?.stripeCustomerId
      if (!stripeCustomerId) { results.push({ paymentId: p.id, status: 'skip_no_customer' }); continue }

      const invs: any = await stripe.invoices.list({ customer: stripeCustomerId, status: 'paid', limit: 100 })
      const candidates = invs.data.filter((i: any) => Number(i.amount_paid) > 0 && Math.abs((i.status_transitions?.paid_at || i.created) * 1000 - (p.processedAt || p.createdAt).getTime()) < 45 * 24*60*60*1000)
      const exact = candidates.filter((i: any) => Math.abs(Number(i.amount_paid)/100 - Number(p.amount)) < 0.01)
      let chosen: any = null
      if (exact.length === 1) chosen = exact[0]
      else if (exact.length > 1) chosen = exact.sort((a:any,b:any)=>Math.abs((a.status_transitions?.paid_at||a.created)-(p.processedAt?Math.floor(p.processedAt.getTime()/1000):Math.floor(p.createdAt.getTime()/1000))) - Math.abs((b.status_transitions?.paid_at||b.created)-(p.processedAt?Math.floor(p.processedAt.getTime()/1000):Math.floor(p.createdAt.getTime()/1000))))[0]
      else if (candidates.length > 0) chosen = candidates.sort((a:any,b:any)=>Math.abs((a.status_transitions?.paid_at||a.created)-(p.processedAt?Math.floor(p.processedAt.getTime()/1000):Math.floor(p.createdAt.getTime()/1000))) - Math.abs((b.status_transitions?.paid_at||b.created)-(p.processedAt?Math.floor(p.processedAt.getTime()/1000):Math.floor(p.createdAt.getTime()/1000))))[0]

      if (!chosen || !chosen.charge) { results.push({ paymentId: p.id, status: 'ambiguous_or_no_match' }); continue }

      if (!dryRun) {
        await prisma.payment.update({ where: { id: p.id }, data: { stripeInvoiceId: chosen.id as string, stripeChargeId: chosen.charge as string } })
      }
      results.push({ paymentId: p.id, status: dryRun ? 'would_update' : 'updated', invoiceId: chosen.id, chargeId: chosen.charge })
    }

    return NextResponse.json({ success: true, dryRun, examined: payments.length, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backfill failed' }, { status: 500 })
  }
}


