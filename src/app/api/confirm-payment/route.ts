import { NextRequest, NextResponse } from 'next/server'
import { stripe } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    console.log('🔄 Confirming payment/setup:', body)

    // Handle different confirmation types
    if (body.setupIntentId) {
      return await handleSetupIntentConfirmation(body)
    } else if (body.paymentIntentId) {
      return await handlePaymentIntentConfirmation(body)
    } else {
      return NextResponse.json({
        success: false,
        error: 'Missing setupIntentId or paymentIntentId'
      }, { status: 400 })
    }

  } catch (error) {
    console.error('❌ Confirmation error:', error)
    return NextResponse.json({
      success: false,
      error: 'Confirmation failed'
    }, { status: 500 })
  }
}

async function handleSetupIntentConfirmation(body: { setupIntentId: string, subscriptionId: string }) {
  const { setupIntentId, subscriptionId } = body

  // 1. Verify the SetupIntent with Stripe
  const setupIntent = await stripe.setupIntents.retrieve(setupIntentId)
  
  if (setupIntent.status !== 'succeeded') {
    console.error('❌ Setup not succeeded:', setupIntent.status)
    return NextResponse.json({
      success: false,
      error: 'Payment method setup not completed'
    }, { status: 400 })
  }

  const paymentMethodId = setupIntent.payment_method as string
  console.log('✅ Payment method setup confirmed:', paymentMethodId)

  // 2. Get subscription record from database
  const subscription = await prisma.subscription.findUnique({
    where: { id: subscriptionId },
    include: { user: true }
  })

  if (!subscription) {
    return NextResponse.json({
      success: false,
      error: 'Subscription not found'
    }, { status: 404 })
  }

  // 3. Extract metadata from SetupIntent
  const proratedAmount = parseFloat(setupIntent.metadata?.proratedAmount || '0')
  const nextBillingDate = new Date(setupIntent.metadata?.nextBillingDate || subscription.nextBillingDate)

  // 4. Set payment method as default for customer
  await stripe.customers.update(subscription.stripeCustomerId, {
    invoice_settings: {
      default_payment_method: paymentMethodId
    }
  })

  // 5. Create and charge prorated invoice if amount > 0
  if (proratedAmount > 0) {
    await stripe.invoiceItems.create({
      customer: subscription.stripeCustomerId,
      amount: Math.round(proratedAmount * 100), // Convert to pence
      currency: 'gbp',
      description: `Prorated membership (${new Date().toISOString().split('T')[0]} → ${nextBillingDate.toISOString().split('T')[0]})`,
    })

    const invoice = await stripe.invoices.create({
      customer: subscription.stripeCustomerId,
      auto_advance: true, // Automatically finalize and charge
    })

    console.log('✅ Prorated invoice created and charged:', invoice.id)
  }

  // 6. Create Stripe subscription with trial until 1st of next month
  const membershipDetails = getMembershipDetails(subscription.membershipType)
  const priceId = await getOrCreatePrice(membershipDetails)
  
  const trialEndTimestamp = Math.floor(nextBillingDate.getTime() / 1000)
  
  const stripeSubscription = await stripe.subscriptions.create({
    customer: subscription.stripeCustomerId,
    items: [{ price: priceId }],
    default_payment_method: paymentMethodId,
    collection_method: 'charge_automatically',
    trial_end: trialEndTimestamp, // Trial ends on 1st of next month
    metadata: {
      userId: subscription.userId,
      membershipType: subscription.membershipType,
      routedEntityId: subscription.routedEntityId,
      dbSubscriptionId: subscription.id
    }
  })

  console.log('✅ Stripe subscription created with trial until:', new Date(trialEndTimestamp * 1000))

  // 7. Update subscription status in database
  await prisma.subscription.update({
    where: { id: subscription.id },
    data: {
      stripeSubscriptionId: stripeSubscription.id, // Replace SetupIntent ID with real subscription ID
      status: 'ACTIVE'
    }
  })

  // 8. Update membership status
  await prisma.membership.updateMany({
    where: { userId: subscription.userId },
    data: {
      status: 'ACTIVE'
    }
  })

  // 9. Create payment record for prorated amount
  if (proratedAmount > 0) {
    await prisma.payment.create({
      data: {
        userId: subscription.userId,
        amount: proratedAmount,
        currency: 'GBP',
        status: 'COMPLETED',
        description: 'Prorated first month payment',
        routedEntityId: subscription.routedEntityId,
        processedAt: new Date()
      }
    })
  }

  console.log('✅ Subscription activated with prorated billing')

  return NextResponse.json({
    success: true,
    message: 'Payment method setup completed and subscription activated',
    subscription: {
      id: subscription.id,
      status: 'ACTIVE',
      proratedAmount,
      nextBillingDate: nextBillingDate.toISOString().split('T')[0]
    },
    user: {
      id: subscription.user.id,
      email: subscription.user.email,
      firstName: subscription.user.firstName,
      lastName: subscription.user.lastName
    }
  })
}

async function handlePaymentIntentConfirmation(body: { paymentIntentId: string, subscriptionId: string }) {
  // Legacy flow - keep existing logic
  const { subscriptionId, paymentIntentId } = body

  console.log('🔄 Confirming payment:', { subscriptionId, paymentIntentId })

  // 1. Verify the PaymentIntent with Stripe
  const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId)
  
  if (paymentIntent.status !== 'succeeded') {
    console.error('❌ Payment not succeeded:', paymentIntent.status)
    return NextResponse.json({
      success: false,
      error: 'Payment not completed'
    }, { status: 400 })
  }

  console.log('✅ Payment confirmed with Stripe')

  // 2. Update subscription status in database
  const subscription = await prisma.subscription.update({
    where: { id: subscriptionId },
    data: {
      status: 'ACTIVE'
    },
    include: {
      user: true
    }
  })

  // 3. Update membership status
  await prisma.membership.updateMany({
    where: { userId: subscription.userId },
    data: {
      status: 'ACTIVE'
    }
  })

  // 4. Create payment record
  await prisma.payment.create({
    data: {
      userId: subscription.userId,
      amount: paymentIntent.amount / 100, // Convert from pence to pounds
      currency: paymentIntent.currency.toUpperCase(),
      status: 'COMPLETED',
      description: 'Initial subscription payment (prorated)',
      routedEntityId: subscription.routedEntityId,
      processedAt: new Date()
    }
  })

  console.log('✅ Database updated successfully')

  return NextResponse.json({
    success: true,
    message: 'Payment confirmed and subscription activated',
    subscription: {
      id: subscription.id,
      status: subscription.status,
      userId: subscription.userId
    },
    user: {
      id: subscription.user.id,
      email: subscription.user.email,
      firstName: subscription.user.firstName,
      lastName: subscription.user.lastName
    }
  })
}

// Helper functions
function getMembershipDetails(membershipType: string) {
  const memberships: Record<string, { monthlyPrice: number; name: string }> = {
    'WEEKEND_ADULT': { monthlyPrice: 59, name: 'Weekend Adult' },
    'WEEKEND_UNDER18': { monthlyPrice: 49, name: 'Weekend Youth' },
    'FULL_ADULT': { monthlyPrice: 89, name: 'Full Adult Access' },
    'FULL_UNDER18': { monthlyPrice: 69, name: 'Full Youth Access' },
    'PERSONAL_TRAINING': { monthlyPrice: 120, name: 'Personal Training' },
    'WOMENS_CLASSES': { monthlyPrice: 65, name: "Women's Classes" },
    'WELLNESS_PACKAGE': { monthlyPrice: 95, name: 'Wellness Package' }
  }
  return memberships[membershipType]
}

async function getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }): Promise<string> {
  // Reuse existing prices
  const existingPrices = await stripe.prices.list({
    limit: 100,
    active: true,
    type: 'recurring',
    currency: 'gbp'
  })

  const existingPrice = existingPrices.data.find(price => 
    price.unit_amount === membershipDetails.monthlyPrice * 100 &&
    price.recurring?.interval === 'month'
  )

  if (existingPrice) {
    return existingPrice.id
  }

  // Create new product and price
  const product = await stripe.products.create({
    name: `${membershipDetails.name} Membership`,
    description: `Monthly membership for ${membershipDetails.name}`,
  })

  const recurringPrice = await stripe.prices.create({
    unit_amount: membershipDetails.monthlyPrice * 100,
    currency: 'gbp',
    recurring: { interval: 'month' },
    product: product.id,
  })

  return recurringPrice.id
} 