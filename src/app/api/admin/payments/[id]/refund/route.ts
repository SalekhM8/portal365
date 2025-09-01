import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

// Minimal, forward-only refunds: parse [pi:...] or [inv:...] from payment.description

function extractTag(description: string | null | undefined, tag: 'pi' | 'inv'): string | null {
  if (!description) return null
  const match = description.match(new RegExp(`\\[${tag}:(.*?)\\]`))
  return match ? match[1] : null
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Admin/Super admin only
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { id } = await context.params
    const body = await request.json().catch(() => ({}))
    const amountPounds: number | undefined = typeof body.amountPounds === 'number' ? body.amountPounds : undefined
    const reason: string | undefined = typeof body.reason === 'string' ? body.reason : undefined

    const payment = await prisma.payment.findUnique({ where: { id } })
    if (!payment) return NextResponse.json({ error: 'Payment not found' }, { status: 404 })
    if (payment.status === 'REFUNDED') return NextResponse.json({ success: true, message: 'Already refunded' })

    // Discover payment_intent
    let paymentIntentId = extractTag(payment.description || undefined, 'pi')
    if (!paymentIntentId) {
      const invoiceId = extractTag(payment.description || undefined, 'inv')
      if (invoiceId) {
        const inv = await stripe.invoices.retrieve(invoiceId)
        // Cast to any to avoid Stripe TS helper Response<T> property access issue during build
        paymentIntentId = ((inv as any).payment_intent as string) || null
      }
    }
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'Refund unavailable: missing Stripe identifiers on this payment' }, { status: 400 })
    }

    // Determine refund amount (in pence)
    const amountInPence = amountPounds !== undefined ? Math.round(amountPounds * 100) : undefined

    // Execute refund
    const refund = await stripe.refunds.create({
      payment_intent: paymentIntentId,
      amount: amountInPence,
      reason: 'requested_by_customer'
    }, {
      idempotencyKey: `refund:${payment.id}:${amountInPence ?? 'full'}`
    })

    // DB updates: full → mark payment REFUNDED; partial → insert negative row
    if (!amountInPence) {
      await prisma.payment.update({ where: { id: payment.id }, data: { status: 'REFUNDED', failureReason: reason || null, processedAt: new Date() } })
    } else {
      await prisma.payment.create({
        data: {
          userId: payment.userId,
          amount: -(amountInPence / 100),
          currency: payment.currency,
          status: 'REFUNDED',
          description: `Partial refund of ${payment.id} [pi:${paymentIntentId}]${reason ? ` — ${reason}` : ''}`,
          routedEntityId: payment.routedEntityId,
          processedAt: new Date()
        }
      })
    }

    return NextResponse.json({ success: true, refund })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Refund failed' }, { status: 500 })
  }
}


