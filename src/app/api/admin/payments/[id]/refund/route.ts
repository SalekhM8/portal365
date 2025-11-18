import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

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
        // Resolve account first to use correct Stripe client
        const subForInvoice = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
        const s = getStripeClient((subForInvoice as any)?.stripeAccountKey || 'SU')
        const inv = await s.invoices.retrieve(invoiceId)
        // Cast to any to avoid Stripe TS helper Response<T> property access issue during build
        paymentIntentId = ((inv as any).payment_intent as string) || null
      }
    }

    // Fallback enrichment: try to resolve identifiers from Stripe if still missing
    if (!paymentIntentId) {
      // Guard: not a Stripe charge (e.g., GoCardless/demo)
      if (payment.goCardlessPaymentId) {
        return NextResponse.json({ error: 'Refund unavailable: non-Stripe payment' }, { status: 400 })
      }

      // Find a Stripe customer for this user
      const sub = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
      const stripeCustomerId = sub?.stripeCustomerId
      const s = getStripeClient((sub as any)?.stripeAccountKey || 'SU')

      if (stripeCustomerId) {
        const targetTs = payment.processedAt || payment.createdAt
        const targetMinor = Math.round(Number(payment.amount) * 100)
        let resolvedInvoiceId: string | null = null
        let resolvedPi: string | null = null

        try {
          // Prefer invoices (paid) close to the payment time and matching amount
          const ts = Math.floor(new Date(targetTs).getTime() / 1000)
          const invList: any = await s.invoices.list({ customer: stripeCustomerId, status: 'paid', created: { gte: ts - 60 * 24 * 60 * 60, lte: ts + 60 * 24 * 60 * 60 }, limit: 100 })
          const candidates = invList.data.filter((inv: any) => Number(inv.amount_paid || 0) === targetMinor)
          if (candidates.length) {
            // Pick the closest by paid_at/created timestamp
            const best = candidates.reduce((a: any, b: any) => {
              const aTs = (a.status_transitions?.paid_at || a.created) * 1000
              const bTs = (b.status_transitions?.paid_at || b.created) * 1000
              return Math.abs(aTs - Number(targetTs)) <= Math.abs(bTs - Number(targetTs)) ? a : b
            })
            resolvedInvoiceId = best.id
            resolvedPi = (best as any).payment_intent || null
          }
        } catch {}

        // If no invoice match, try charges
        if (!resolvedPi) {
          try {
            const ts = Math.floor(new Date(targetTs).getTime() / 1000)
            const chList: any = await s.charges.list({ customer: stripeCustomerId, created: { gte: ts - 60 * 24 * 60 * 60, lte: ts + 60 * 24 * 60 * 60 }, limit: 100 })
            const ch = chList.data.find((c: any) => Number(c.amount || 0) === targetMinor)
            if (ch) {
              resolvedPi = (ch as any).payment_intent || null
            }
          } catch {}
        }

        if (resolvedPi) {
          paymentIntentId = resolvedPi
          // Persist tags for future operations (idempotent append)
          const desc = payment.description || 'Monthly membership payment'
          const withInv = resolvedInvoiceId && !desc.includes(`[inv:${resolvedInvoiceId}]`) ? `${desc} [inv:${resolvedInvoiceId}]` : desc
          const withPi = !withInv.includes(`[pi:${resolvedPi}]`) ? `${withInv} [pi:${resolvedPi}]` : withInv
          try {
            await prisma.payment.update({ where: { id: payment.id }, data: { description: withPi } })
          } catch {}
        }
      }
    }
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'Refund unavailable: missing Stripe identifiers on this payment' }, { status: 400 })
    }

    // Determine refund amount (in pence)
    const amountInPence = amountPounds !== undefined ? Math.round(amountPounds * 100) : undefined

    // Execute refund
    const subForRefund = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
    const sFinal = getStripeClient((subForRefund as any)?.stripeAccountKey || 'SU')
    const refund = await sFinal.refunds.create({
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


