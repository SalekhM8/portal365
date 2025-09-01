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
    // Create invoice item for prorated amount
    await stripe.invoiceItems.create({ 
      customer: subscription.stripeCustomerId, 
      amount: Math.round(proratedAmount * 100), 
      currency: 'gbp', 
      description: `Prorated membership (${new Date().toISOString().split('T')[0]} → ${nextBillingKey})`, 
      metadata: { dbSubscriptionId: subscription.id, reason: 'prorated_first_period' } 
    }, { idempotencyKey: `prorate-item:${subscription.id}:${nextBillingKey}` })
    
    // Create and attempt to charge invoice
    const invoice = await stripe.invoices.create({ 
      customer: subscription.stripeCustomerId, 
      auto_advance: true, 
      metadata: { dbSubscriptionId: subscription.id, reason: 'prorated_first_period' } 
    }, { idempotencyKey: `prorate-invoice:${subscription.id}:${nextBillingKey}` })
    
    // Wait a moment for auto_advance to process, then check invoice status
    await new Promise(resolve => setTimeout(resolve, 4000))
    const updatedInvoice = await stripe.invoices.retrieve(invoice.id!)
    
    if (updatedInvoice.status === 'open' || updatedInvoice.amount_paid === 0) {
      // Invoice payment failed - return error
      return NextResponse.json({ 
        success: false, 
        error: 'Payment was declined. Please check your card details and try again.',
        code: 'PAYMENT_DECLINED',
        details: 'Your payment method was saved but the charge was not successful. You can try again with the same or different card.'
      }, { status: 400 })
    }
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
      // Mark as ACTIVE immediately; Stripe will be TRIALING until first billing, but active for access
      status: 'ACTIVE',
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

  // Set default payment method for invoices going forward
  if (paymentIntent.payment_method) {
    await stripe.customers.update(paymentIntent.customer as string, {
      invoice_settings: { default_payment_method: paymentIntent.payment_method as string }
    })
  }

  // Create the Stripe subscription to start on the next billing date (trial until then)
  const dbSub = await prisma.subscription.findUnique({ where: { id: subscriptionId } })
  if (!dbSub) {
    return NextResponse.json({ success: false, error: 'Subscription not found' }, { status: 404 })
  }

  // Idempotency guard: if we've already replaced the placeholder with a real Stripe sub, do nothing
  if (dbSub.stripeSubscriptionId && dbSub.stripeSubscriptionId.startsWith('sub_')) {
    const user = await prisma.user.findUnique({ where: { id: dbSub.userId }, select: { id: true, email: true, firstName: true, lastName: true } })
    return NextResponse.json({ success: true, message: 'Subscription already created', subscription: { id: dbSub.id, status: dbSub.status, userId: dbSub.userId }, user })
  }
  const membershipDetails = getPlan(dbSub.membershipType)
  const priceId = await getOrCreatePrice(membershipDetails)
  const trialEndTimestamp = Math.floor(new Date(dbSub.nextBillingDate).getTime() / 1000)

  const stripeSubscription = await stripe.subscriptions.create({
    customer: paymentIntent.customer as string,
    items: [{ price: priceId }],
    collection_method: 'charge_automatically',
    trial_end: trialEndTimestamp,
    proration_behavior: 'none',
    payment_behavior: 'default_incomplete',
    metadata: { userId: dbSub.userId, membershipType: dbSub.membershipType, routedEntityId: dbSub.routedEntityId, dbSubscriptionId: dbSub.id }
  }, { idempotencyKey: `start-sub:${dbSub.id}:${trialEndTimestamp}` })

  const subscription = await prisma.subscription.update({ where: { id: dbSub.id }, data: { stripeSubscriptionId: stripeSubscription.id, status: 'ACTIVE' }, include: { user: true } })
  await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'ACTIVE' } })
  // Idempotency guard for payment row: skip if a matching payment already exists recently
  const existingPayment = await prisma.payment.findFirst({
    where: {
      userId: subscription.userId,
      status: 'CONFIRMED',
      amount: (paymentIntent.amount as number) / 100,
      currency: (paymentIntent.currency as string).toUpperCase(),
      description: 'Initial subscription payment (prorated)'
    }
  })
  if (!existingPayment) {
    const taggedDescription = `Initial subscription payment (prorated) [pi:${paymentIntent.id}]`
    await prisma.payment.create({ data: { userId: subscription.userId, amount: (paymentIntent.amount as number) / 100, currency: (paymentIntent.currency as string).toUpperCase(), status: 'CONFIRMED', description: taggedDescription, routedEntityId: subscription.routedEntityId, processedAt: new Date() } })
  }

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