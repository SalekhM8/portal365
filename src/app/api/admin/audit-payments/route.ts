import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const email: string | undefined = body?.email

    const backfillStartIso: string | undefined = body?.backfillStartIso

    const summary: any = {
      scope: email ? 'single_user' : 'all_users',
      zeroAmountPayments: 0,
      zeroAmountInvoices: 0,
      proratedDbCount: 0,
      monthlyDbCount: 0
    }

    // Zero-amount diagnostics (optionally scoped to backfill window)
    const zeroWhere: any = { amount: 0 }
    if (backfillStartIso) zeroWhere.createdAt = { gte: new Date(backfillStartIso) }
    summary.zeroAmountPayments = await prisma.payment.count({ where: zeroWhere })

    const zeroInvWhere: any = { amount: 0 }
    if (backfillStartIso) zeroInvWhere.createdAt = { gte: new Date(backfillStartIso) }
    summary.zeroAmountInvoices = await prisma.invoice.count({ where: zeroInvWhere })

    // DB counts
    summary.proratedDbCount = await prisma.payment.count({ where: { status: 'CONFIRMED', description: { contains: 'prorated', mode: 'insensitive' } } })
    summary.monthlyDbCount = await prisma.payment.count({ where: { status: 'CONFIRMED', description: { contains: 'Monthly membership payment', mode: 'insensitive' } } })

    let details: any = {}

    if (email) {
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user) return NextResponse.json({ success: true, summary, details: { note: 'User not found' } })

      const dbPayments = await prisma.payment.findMany({
        where: { userId: user.id },
        orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }]
      })

      // Stripe: paid invoices (amount_paid > 0) + prorated PaymentIntents
      const subscriptions = await prisma.subscription.findMany({ where: { userId: user.id } })
      let stripeInvoices: any[] = []
      for (const sub of subscriptions) {
        if (!sub.stripeSubscriptionId) continue
        const invList: any = await stripe.invoices.list({
          customer: sub.stripeCustomerId,
          limit: 100
        })
        const paid = invList.data.filter((i: any) => i.status === 'paid' && Number(i.amount_paid) > 0)
        stripeInvoices.push(...paid)
      }

      // Prorated PIs via metadata (best-effort)
      // Note: Stripe API does not support search by metadata directly here; customers typically have few charges
      let prorated: any[] = []
      if (subscriptions[0]?.stripeCustomerId) {
        const charges: any = await stripe.charges.list({ customer: subscriptions[0].stripeCustomerId, limit: 100 })
        prorated = charges.data
          .filter((c: any) => c.paid && c.amount > 0 && c.metadata?.reason === 'prorated_first_period')
          .map((c: any) => ({
            id: c.id,
            amount: c.amount / 100,
            paid_at: c.created ? new Date(c.created * 1000).toISOString() : null
          }))
      }

      details[email] = {
        dbPayments,
        stripe: {
          invoices: stripeInvoices.map(i => ({ id: i.id, amount: i.amount_paid / 100, paid_at: i.status_transitions?.paid_at ? new Date(i.status_transitions.paid_at * 1000).toISOString() : null })),
          prorated
        }
      }
    }

    return NextResponse.json({ success: true, summary, details })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Audit failed' }, { status: 500 })
  }
}


