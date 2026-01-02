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

    // Discover payment_intent - ALWAYS prefer charge lookup by date/amount over [pi:...] tag
    // The [pi:...] tag can be wrong (copied from another payment)
    let paymentIntentId: string | null = null
    
    // Get subscription info for Stripe client
    const sub = await prisma.subscription.findFirst({ where: { userId: payment.userId }, orderBy: { createdAt: 'desc' } })
    const stripeCustomerId = sub?.stripeCustomerId
    const s = getStripeClient((sub as any)?.stripeAccountKey || 'SU')
    
    // Step 1: Try invoice ID (from DB field first, then description tag)
    const invoiceId = payment.stripeInvoiceId || extractTag(payment.description || undefined, 'inv')
    if (invoiceId) {
      try {
        const inv = await s.invoices.retrieve(invoiceId)
        // Get the payment_intent from invoice if it exists
        paymentIntentId = ((inv as any).payment_intent as string) || null
      } catch (invErr: any) {
        console.warn(`Invoice lookup failed for ${invoiceId}:`, invErr.message)
      }
    }
    
    // Step 2: If invoice has no payment_intent, search for matching charge by date and amount
    // This handles cases where invoices are not properly linked to charges in Stripe
    if (!paymentIntentId && stripeCustomerId) {
      const targetTs = payment.processedAt || payment.createdAt
      const targetMinor = Math.round(Number(payment.amount) * 100)
      const ts = Math.floor(new Date(targetTs).getTime() / 1000)
      
      try {
        // Search for charges within ±2 days of the payment date, matching amount
        const chargeList: any = await s.charges.list({ 
          customer: stripeCustomerId, 
          created: { gte: ts - 2 * 24 * 60 * 60, lte: ts + 2 * 24 * 60 * 60 }, 
          limit: 20 
        })
        
        // Find a successful, non-refunded charge with matching amount
        const matchingCharge = chargeList.data.find((ch: any) => 
          ch.amount === targetMinor && 
          ch.status === 'succeeded' && 
          !ch.refunded &&
          ch.payment_intent
        )
        
        if (matchingCharge) {
          paymentIntentId = matchingCharge.payment_intent
          console.log(`Found matching charge ${matchingCharge.id} with PI ${paymentIntentId}`)
        }
      } catch (chargeErr: any) {
        console.warn('Charge search failed:', chargeErr.message)
      }
    }
    
    // Step 3: Only use [pi:...] tag as LAST RESORT (it's often wrong!)
    if (!paymentIntentId) {
      const taggedPi = extractTag(payment.description || undefined, 'pi')
      if (taggedPi) {
        // Verify this PI is not already fully refunded before using it
        try {
          const pi = await s.paymentIntents.retrieve(taggedPi)
          const refunds: any = await s.refunds.list({ payment_intent: taggedPi, limit: 10 })
          const totalRefunded = refunds.data.reduce((sum: number, r: any) => sum + r.amount, 0)
          const remaining = (pi.amount_received || 0) - totalRefunded
          
          if (remaining > 0) {
            paymentIntentId = taggedPi
            console.log(`Using [pi:...] tag ${taggedPi} with ${remaining} pence remaining`)
          } else {
            console.warn(`[pi:...] tag ${taggedPi} is already fully refunded, ignoring`)
          }
        } catch (piErr: any) {
          console.warn(`[pi:...] tag verification failed:`, piErr.message)
        }
      }
    }

    // Guard: not a Stripe charge (e.g., GoCardless/demo)
    if (!paymentIntentId && payment.goCardlessPaymentId) {
      return NextResponse.json({ error: 'Refund unavailable: non-Stripe payment' }, { status: 400 })
    }
    if (!paymentIntentId) {
      return NextResponse.json({ error: 'Refund unavailable: missing Stripe identifiers on this payment' }, { status: 400 })
    }

    // Determine refund amount (in pence)
    const amountInPence = amountPounds !== undefined ? Math.round(amountPounds * 100) : undefined

    // Execute refund (use Stripe client already initialized above)
    const refund = await s.refunds.create({
      payment_intent: paymentIntentId,
      amount: amountInPence,
      reason: 'requested_by_customer'
    }, {
      // Include payment_intent in idempotency key so different PIs get different keys
      idempotencyKey: `refund:${payment.id}:${paymentIntentId}:${amountInPence ?? 'full'}`
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


