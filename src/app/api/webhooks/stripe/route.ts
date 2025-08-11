import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      console.error('❌ Missing Stripe signature')
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
    } catch (err) {
      console.error('❌ Webhook signature verification failed:', err)
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    console.log('🔔 Webhook received:', event.type)

    // Handle the event
    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object)
        break
      
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object)
        break
      
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break
      
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object)
        break
      
      default:
        console.log(`🔔 Unhandled event type: ${event.type}`)
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    console.error('❌ Webhook error:', error)
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
}

export async function handlePaymentSucceeded(invoice: any) {
  try {
    console.log('✅ Payment succeeded for invoice:', invoice.id)

    const subscriptionId = invoice.subscription
    const amountPaid = invoice.amount_paid / 100 // Convert from pence to pounds

    // Find subscription in our database
    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true }
    })

    if (!subscription) {
      console.error('❌ Subscription not found:', subscriptionId)
      return
    }

    // Idempotency: if we've already recorded this invoice, skip
    const existingInvoice = await prisma.invoice.findUnique({
      where: { stripeInvoiceId: invoice.id }
    })
    if (existingInvoice) {
      console.log('ℹ️ Invoice already processed, skipping:', invoice.id)
      return
    }

    // Record invoice
    await prisma.invoice.create({
      data: {
        subscriptionId: subscription.id,
        stripeInvoiceId: invoice.id,
        amount: amountPaid,
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        billingPeriodStart: new Date(invoice.lines.data[0]?.period?.start * 1000 || invoice.period_start * 1000),
        billingPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || invoice.period_end * 1000),
        dueDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
        paidAt: new Date()
      }
    })

    // Update subscription status to ACTIVE
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { 
        status: 'ACTIVE',
        currentPeriodStart: new Date(invoice.period_start * 1000),
        currentPeriodEnd: new Date(invoice.period_end * 1000),
        nextBillingDate: new Date(invoice.period_end * 1000)
      }
    })

    // Update membership status to ACTIVE
    await prisma.membership.updateMany({
      where: { userId: subscription.userId },
      data: { status: 'ACTIVE' }
    })

    // Create payment record
    await prisma.payment.create({
      data: {
        userId: subscription.userId,
        amount: amountPaid,
        currency: invoice.currency.toUpperCase(),
        status: 'CONFIRMED',
        description: invoice.billing_reason === 'subscription_create' 
          ? 'Initial subscription payment (prorated)'
          : 'Monthly membership payment',
        routedEntityId: subscription.routedEntityId,
        processedAt: new Date()
      }
    })

    console.log(`✅ Payment processed for user: ${subscription.user.email} - £${amountPaid}`)

  } catch (error) {
    console.error('❌ Error handling payment success:', error)
  }
}

export async function handlePaymentFailed(invoice: any) {
  try {
    console.log('❌ Payment failed for invoice:', invoice.id)

    const subscriptionId = invoice.subscription
    const amountDue = invoice.amount_due / 100

    // Find subscription in our database
    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subscriptionId },
      include: { user: true }
    })

    if (!subscription) {
      console.error('❌ Subscription not found:', subscriptionId)
      return
    }

    // Update subscription status to PAST_DUE
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'PAST_DUE' }
    })

    // Update membership status to SUSPENDED
    await prisma.membership.updateMany({
      where: { userId: subscription.userId },
      data: { status: 'SUSPENDED' }
    })

    // Create failed payment record
    await prisma.payment.create({
      data: {
        userId: subscription.userId,
        amount: amountDue,
        currency: invoice.currency.toUpperCase(),
        status: 'FAILED',
        description: 'Failed monthly membership payment',
        routedEntityId: subscription.routedEntityId,
        failureReason: 'Payment declined',
        processedAt: new Date()
      }
    })

    console.log(`❌ Payment failed for user: ${subscription.user.email} - £${amountDue}`)

  } catch (error) {
    console.error('❌ Error handling payment failure:', error)
  }
}

export async function handleSubscriptionUpdated(stripeSubscription: any) {
  try {
    console.log('🔄 Subscription updated:', stripeSubscription.id)

    // Update subscription in our database
    await prisma.subscription.updateMany({
      where: { stripeSubscriptionId: stripeSubscription.id },
      data: {
        status: stripeSubscription.status.toUpperCase(),
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000),
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000),
        nextBillingDate: new Date(stripeSubscription.current_period_end * 1000),
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
      }
    })

    console.log(`✅ Subscription updated: ${stripeSubscription.id}`)

  } catch (error) {
    console.error('❌ Error handling subscription update:', error)
  }
}

export async function handleSubscriptionCancelled(stripeSubscription: any) {
  try {
    console.log('❌ Subscription cancelled:', stripeSubscription.id)

    const subscription = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: stripeSubscription.id },
      include: { user: true }
    })

    if (!subscription) {
      console.error('❌ Subscription not found:', stripeSubscription.id)
      return
    }

    // Update subscription status to CANCELLED
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'CANCELLED' }
    })

    // Update membership status to CANCELLED
    await prisma.membership.updateMany({
      where: { userId: subscription.userId },
      data: { status: 'CANCELLED' }
    })

    console.log(`❌ Subscription cancelled for user: ${subscription.user.email}`)

  } catch (error) {
    console.error('❌ Error handling subscription cancellation:', error)
  }
} 