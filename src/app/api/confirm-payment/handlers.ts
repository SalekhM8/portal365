import { NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { getPlan } from '@/config/memberships'

export async function handleSetupIntentConfirmation(body: { setupIntentId: string, subscriptionId: string }) {
  const { setupIntentId, subscriptionId } = body
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
  if (setupIntent.status !== 'succeeded') {
    return NextResponse.json({ success: false, error: 'Payment method setup not completed' }, { status: 400 })
  }
  const paymentMethodId = setupIntent.payment_method as string

  const subscription = await prisma.subscription.findUnique({ where: { id: subscriptionId }, include: { user: true } })
  if (!subscription) {
    return NextResponse.json({ success: false, error: 'Subscription not found' }, { status: 404 })
  }
  if (subscription.status === 'ACTIVE') {
    return NextResponse.json({ success: true, message: 'Subscription already active', subscription: { id: subscription.id, status: 'ACTIVE' }, user: { id: subscription.user.id, email: subscription.user.email, firstName: subscription.user.firstName, lastName: subscription.user.lastName } })
  }

  const proratedAmount = parseFloat((setupIntent as any).metadata?.proratedAmount || '0')
  const nextBillingDate = new Date((setupIntent as any).metadata?.nextBillingDate || subscription.nextBillingDate)
  const nextBillingKey = nextBillingDate.toISOString().split('T')[0]

  await stripe.customers.update(subscription.stripeCustomerId, { invoice_settings: { default_payment_method: paymentMethodId } })

  if (proratedAmount > 0) {
    await stripe.invoiceItems.create({ customer: subscription.stripeCustomerId, amount: Math.round(proratedAmount * 100), currency: 'gbp', description: `Prorated membership (${new Date().toISOString().split('T')[0]} → ${nextBillingKey})`, metadata: { dbSubscriptionId: subscription.id, reason: 'prorated_first_period' } }, { idempotencyKey: `prorate-item:${subscription.id}:${nextBillingKey}` })
    await stripe.invoices.create({ customer: subscription.stripeCustomerId, auto_advance: true, metadata: { dbSubscriptionId: subscription.id, reason: 'prorated_first_period' } }, { idempotencyKey: `prorate-invoice:${subscription.id}:${nextBillingKey}` })
  }

  const membershipDetails = getPlan(subscription.membershipType)
  const priceId = await getOrCreatePrice(membershipDetails)
  const trialEndTimestamp = Math.floor(nextBillingDate.getTime() / 1000)

  const stripeSubscription = await stripe.subscriptions.create({
    customer: subscription.stripeCustomerId,
    items: [{ price: priceId }],
    default_payment_method: paymentMethodId,
    collection_method: 'charge_automatically',
    trial_end: trialEndTimestamp,
    metadata: { userId: subscription.userId, membershipType: subscription.membershipType, routedEntityId: subscription.routedEntityId, dbSubscriptionId: subscription.id }
  }, { idempotencyKey: `start-sub:${subscription.id}:${trialEndTimestamp}` })

  // 🔄 Update subscription with Stripe ID but keep as PENDING_PAYMENT until webhook confirms payment
  await prisma.subscription.update({ 
    where: { id: subscription.id }, 
    data: { 
      stripeSubscriptionId: stripeSubscription.id,
      status: 'PENDING_PAYMENT', // Will be updated to ACTIVE by webhook after payment succeeds
      nextBillingDate 
    } 
  })

  console.log(`✅ Payment method setup completed for ${subscription.user.email}`)
  console.log(`🔄 Subscription status: PENDING_PAYMENT (will activate via webhook after payment)`)
  console.log(`💰 Prorated amount: £${proratedAmount} (will be charged via auto_advance invoice)`)

  return NextResponse.json({ 
    success: true, 
    message: 'Payment method setup completed. Subscription will activate after payment confirmation.',
    subscription: { 
      id: subscription.id, 
      status: 'PENDING_PAYMENT',
      stripeSubscriptionId: stripeSubscription.id,
      proratedAmount, 
      nextBillingDate: nextBillingKey 
    }, 
    user: { 
      id: subscription.user.id, 
      email: subscription.user.email, 
      firstName: subscription.user.firstName, 
      lastName: subscription.user.lastName 
    },
    note: 'Subscription will activate automatically after payment is processed'
  })
}

export async function handlePaymentIntentConfirmation(body: { paymentIntentId: string, subscriptionId: string }) {
  const { subscriptionId, paymentIntentId } = body
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  if (paymentIntent.status !== 'succeeded') {
    return NextResponse.json({ success: false, error: 'Payment not completed' }, { status: 400 })
  }

  const subscription = await prisma.subscription.update({ where: { id: subscriptionId }, data: { status: 'ACTIVE' }, include: { user: true } })
  await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'ACTIVE' } })
  await prisma.payment.create({ data: { userId: subscription.userId, amount: (paymentIntent.amount as number) / 100, currency: (paymentIntent.currency as string).toUpperCase(), status: 'CONFIRMED', description: 'Initial subscription payment (prorated)', routedEntityId: subscription.routedEntityId, processedAt: new Date() } })

  return NextResponse.json({ success: true, message: 'Payment confirmed and subscription activated', subscription: { id: subscription.id, status: subscription.status, userId: subscription.userId }, user: { id: subscription.user.id, email: subscription.user.email, firstName: subscription.user.firstName, lastName: subscription.user.lastName } })
}

export async function getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }): Promise<string> {
  const existingPrices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
  const existingPrice = existingPrices.data.find(price => price.unit_amount === membershipDetails.monthlyPrice * 100 && price.recurring?.interval === 'month')
  if (existingPrice) return existingPrice.id
  const product = await stripe.products.create({ name: `${membershipDetails.name} Membership`, description: `Monthly membership for ${membershipDetails.name}` })
  const recurringPrice = await stripe.prices.create({ unit_amount: membershipDetails.monthlyPrice * 100, currency: 'gbp', recurring: { interval: 'month' }, product: product.id })
  return recurringPrice.id
} 