import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user and their subscription (include failed/incomplete subscriptions)
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'INCOMPLETE', 'PENDING_PAYMENT', 'PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    if (!user || user.subscriptions.length === 0) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    const subscription = user.subscriptions[0]

    // Get current payment method from Stripe
    const stripeCustomer = await stripe.customers.retrieve(subscription.stripeCustomerId)
    let currentPaymentMethod = null

    if (stripeCustomer && !stripeCustomer.deleted && stripeCustomer.invoice_settings?.default_payment_method) {
      const paymentMethod = await stripe.paymentMethods.retrieve(
        stripeCustomer.invoice_settings.default_payment_method as string
      )
      
      if (paymentMethod && paymentMethod.card) {
        currentPaymentMethod = {
          id: paymentMethod.id,
          brand: paymentMethod.card.brand,
          last4: paymentMethod.card.last4,
          exp_month: paymentMethod.card.exp_month,
          exp_year: paymentMethod.card.exp_year
        }
      }
    }

    // Create setup intent for new payment method
    const setupIntent = await stripe.setupIntents.create({
      customer: subscription.stripeCustomerId,
      payment_method_types: ['card', 'bacs_debit'], // Support UK bank cards and direct debit
      usage: 'off_session', // For future payments
      metadata: {
        userId: user.id,
        subscriptionId: subscription.id
      }
    })

    return NextResponse.json({
      success: true,
      currentPaymentMethod,
      setupIntentClientSecret: setupIntent.client_secret
    })

  } catch (error) {
    console.error('❌ Error fetching payment methods:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payment methods' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { setupIntentId } = await request.json()

    if (!setupIntentId) {
      return NextResponse.json({ error: 'Setup Intent ID required' }, { status: 400 })
    }

    // Verify the setup intent
    const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
    
    if (setupIntent.status !== 'succeeded') {
      return NextResponse.json({ error: 'Payment method setup not completed' }, { status: 400 })
    }

    // Update customer's default payment method
    await stripe.customers.update(setupIntent.customer as string, {
      invoice_settings: {
        default_payment_method: setupIntent.payment_method as string
      }
    })

    return NextResponse.json({
      success: true,
      message: 'Payment method updated successfully'
    })

  } catch (error) {
    console.error('❌ Error updating payment method:', error)
    return NextResponse.json(
      { error: 'Failed to update payment method' },
      { status: 500 }
    )
  }
} 