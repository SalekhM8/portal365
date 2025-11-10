import { NextRequest, NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { getStripeClient, getWebhookSecrets, type StripeAccountKey } from '@/lib/stripe'
import { handlePaymentSucceeded, handlePaymentFailed, handleSubscriptionUpdated, handleSubscriptionCancelled, handlePaymentActionRequired } from './handlers'

// Support multiple Stripe accounts: try all configured webhook secrets, capture which one verifies

export async function POST(request: NextRequest) {
  try {
    const body = await request.text()
    const headersList = await headers()
    const signature = headersList.get('stripe-signature')

    if (!signature) {
      return NextResponse.json({ error: 'Missing signature' }, { status: 400 })
    }

    let event: any = null
    let accountKeyVerified: StripeAccountKey | null = null
    for (const { account, secret } of getWebhookSecrets()) {
      try {
        const client = getStripeClient(account)
        event = client.webhooks.constructEvent(body, signature, secret)
        accountKeyVerified = account
        break
      } catch {}
    }
    if (!event || !accountKeyVerified) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }

    switch (event.type) {
      case 'invoice.payment_succeeded':
        await handlePaymentSucceeded(event.data.object, accountKeyVerified)
        break
      case 'invoice.paid':
        // When invoices are paid manually via API (retry) Stripe may emit invoice.paid
        await handlePaymentSucceeded(event.data.object, accountKeyVerified)
        break
      case 'invoice.payment_failed':
        await handlePaymentFailed(event.data.object, accountKeyVerified)
        break
      case 'customer.subscription.created':
        // Treat creation the same as update so trialing -> ACTIVE mapping applies immediately
        await handleSubscriptionUpdated(event.data.object, accountKeyVerified)
        break
      case 'invoice.payment_action_required':
        await handlePaymentActionRequired(event.data.object, accountKeyVerified)
        break
      case 'customer.subscription.updated':
        await handleSubscriptionUpdated(event.data.object, accountKeyVerified)
        break
      case 'customer.subscription.deleted':
        await handleSubscriptionCancelled(event.data.object, accountKeyVerified)
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
              await activateFromPaymentIntent(pi, accountKeyVerified)
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