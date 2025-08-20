import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { handlePaymentSucceeded, handlePaymentFailed, handleSubscriptionUpdated, handleSubscriptionCancelled } from './handlers'

const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET!

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    let event
    try {
      event = stripe.webhooks.constructEvent(body, signature, endpointSecret)
    } catch (err) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object)
        break
      case 'customer.subscription.created':
        // Treat creation the same as update so trialing -> ACTIVE mapping applies immediately
        await handleSubscriptionUpdated(event.data.object)
        break
      case 'invoice.payment_action_required':
        // Handle 3D Secure and other payment authentication requirements
        console.log('🔐 Payment action required for invoice:', event.data.object.id)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object)
        break
      default:
        // ignore
        break
    }

    return NextResponse.json({ received: true })

  } catch (error) {
    return NextResponse.json({ error: 'Webhook handler failed' }, { status: 500 })
  }
} 