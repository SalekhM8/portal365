import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { stripe } from '@/lib/stripe'
import { handlePaymentSucceeded, handlePaymentFailed, handleSubscriptionUpdated, handleSubscriptionCancelled, handlePaymentActionRequired } from './handlers'

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
      case 'invoice.paid':
        // When invoices are paid manually via API (retry) Stripe may emit invoice.paid
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
        await handlePaymentActionRequired(event.data.object)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object)
        break
      case 'payment_intent.succeeded':
        // Handle async success (e.g., Klarna) to activate pending signups
        try {
          const pi: any = event.data.object
          const metadata = pi.metadata || {}
          if (metadata?.reason === 'prorated_first_period' && metadata?.dbSubscriptionId) {
            // Reuse our confirm-payment logic server-side
            const { activateFromPaymentIntent } = await import('./handlers') as any
            if (activateFromPaymentIntent) {
              await activateFromPaymentIntent(pi)
            }
          }
        } catch {}
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