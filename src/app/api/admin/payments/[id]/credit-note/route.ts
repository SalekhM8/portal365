import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

/**
 * Create a customer credit to be applied to the user's next invoice.
 * This does NOT refund the card; it creates a Stripe customer balance transaction
 * with a negative amount so the next invoice is reduced by this credit.
 * Idempotent per (paymentId, amountPounds).
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const amountPounds: number | undefined = typeof body.amountPounds === 'number' ? body.amountPounds : undefined
    const reason: string | undefined = typeof body.reason === 'string' ? body.reason : undefined

    const payment = await prisma.payment.findUnique({ where: { id } })
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })

    // Determine Stripe customer
    const sub = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
    if (!sub?.stripeCustomerId) {
      return NextResponse.json({ error: 'Customer not found on Stripe for this user' }, { status: 400 })
    }
    const s = getStripeClient((sub as any)?.stripeAccountKey || 'SU')

    // Amount to credit: default full amount if not specified
    const creditMinor = Math.round((amountPounds != null ? amountPounds : Number(payment.amount)) * 100)
    if (!Number.isFinite(creditMinor) || creditMinor <= 0) {
      return NextResponse.json({ error: 'Invalid credit amount' }, { status: 400 })
    }

    // Create customer balance transaction (negative => credit) – idempotent
    const balanceTx = await s.customers.createBalanceTransaction(
      sub.stripeCustomerId,
      {
        amount: -creditMinor,
        currency: (payment.currency || 'GBP').toLowerCase(),
        description: `Credit note for payment ${payment.id}${reason ? ` — ${reason}` : ''}`
      },
      {
        idempotencyKey: `credit-note:${payment.id}:${creditMinor}`
      }
    )

    // Record a local negative entry for clarity in admin/customer views
    await prisma.payment.create({
      data: {
        userId: payment.userId,
        amount: -(creditMinor / 100),
        currency: payment.currency,
        status: 'CREDITED',
        description: `Credit note applied to next invoice [credit:${(balanceTx as any)?.id || 'balance'}] [member:${payment.userId}]`,
        routedEntityId: payment.routedEntityId,
        processedAt: new Date()
      }
    })

    return NextResponse.json({ success: true, credit: balanceTx })

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Credit note failed' }, { status: 500 })
  }
}


