import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

function minorUnits(amount: number) {
  return Math.max(0, Math.round(amount * 100))
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const amount: number = Number(body?.amount || 0)
    const reason: string = (body?.reason || '').toString().trim()

    if (!amount || amount <= 0) return NextResponse.json({ error: 'Amount must be > 0' }, { status: 400 })
    if (!reason) return NextResponse.json({ error: 'Reason is required' }, { status: 400 })

    const payment = await prisma.payment.findUnique({ where: { id }, include: { user: true } })
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (payment.status !== 'CONFIRMED') return NextResponse.json({ error: 'Only confirmed payments can be refunded' }, { status: 400 })

    // Calculate refundable balance = original - existing refunds
    const refundsSum = await prisma.payment.aggregate({
      where: { userId: payment.userId, status: 'REFUND', description: { contains: id } },
      _sum: { amount: true }
    })
    const alreadyRefunded = Number(refundsSum._sum.amount || 0)
    const refundable = Number(payment.amount) - alreadyRefunded
    if (amount > refundable) return NextResponse.json({ error: `Amount exceeds refundable balance (£${refundable.toFixed(2)})` }, { status: 400 })

    // Map to Stripe charge via customer invoices (best match by time/amount)
    // Find the user's latest subscription to get stripeCustomerId
    const subscription = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
    if (!subscription?.stripeCustomerId) return NextResponse.json({ error: 'Cannot locate Stripe customer for this user' }, { status: 400 })

    const invList: any = await stripe.invoices.list({ customer: subscription.stripeCustomerId, status: 'paid', limit: 50 })
    const paidInvoices = invList.data.filter((i: any) => Number(i.amount_paid) > 0)
    // Score invoices by closeness to processedAt and amount match
    const target = paidInvoices
      .map((i: any) => ({
        inv: i,
        score: Math.abs(((payment.processedAt || payment.createdAt).getTime()) - ((i.status_transitions?.paid_at || i.created) * 1000)) + (Math.abs(Number(payment.amount) - (Number(i.amount_paid)/100)) > 0.01 ? 1e12 : 0)
      }))
      .sort((a: any, b: any) => a.score - b.score)[0]?.inv

    if (!target?.charge) return NextResponse.json({ error: 'Could not determine Stripe charge to refund. Select invoice manually.' }, { status: 409 })

    const idempotencyKey = `refund_${id}_${minorUnits(amount)}`
    const refund = await stripe.refunds.create({
      charge: target.charge as string,
      amount: minorUnits(amount),
      reason: 'requested_by_customer',
      metadata: { paymentId: id, userId: payment.userId, adminId: admin.id, app: 'portal365' }
    }, { idempotencyKey })

    // Store as a separate Payment row with status REFUND and link back via description
    await prisma.payment.create({
      data: {
        userId: payment.userId,
        amount: amount,
        currency: payment.currency,
        status: 'REFUND',
        description: `Refund for payment ${id}: ${reason}`,
        routedEntityId: payment.routedEntityId,
        processedAt: new Date()
      }
    })

    // Optional: clean up FAILED todos if any exist and this refund clears balance (no-op for now)

    return NextResponse.json({ success: true, refund: { id: refund.id, status: refund.status }, matchedInvoiceId: target.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Refund failed' }, { status: 500 })
  }
}


