import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { newMembershipType } = await request.json()

    if (!newMembershipType) {
      return NextResponse.json({ error: 'Invalid membership type' }, { status: 400 })
    }

    const newDetails = getPlan(newMembershipType)

    // Get user and current subscription
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          take: 1
        },
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      }
    })

    if (!user || !user.subscriptions[0]) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    const currentMembership = user.memberships[0]
    const subscription = user.subscriptions[0]

    if (currentMembership.membershipType === newMembershipType) {
      return NextResponse.json({ error: 'You are already on this plan' }, { status: 400 })
    }

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((subscription as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    // Update Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    
    // Get or create the new price in Stripe
    const newPriceId = await getOrCreatePrice({ monthlyPrice: newDetails.monthlyPrice, name: newDetails.name }, stripe)
    
    // Update the subscription in Stripe to the new price
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{
        id: stripeSubscription.items.data[0].id,
        price: newPriceId,
      }],
      proration_behavior: 'create_prorations', // Handle prorations automatically
    })

    // Update membership in database
    await prisma.membership.updateMany({
      where: { 
        userId: user.id,
        status: 'ACTIVE'
      },
      data: {
        membershipType: newMembershipType,
        monthlyPrice: newDetails.monthlyPrice,
      }
    })

    // Update subscription record
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: {
        membershipType: newMembershipType,
        monthlyPrice: newDetails.monthlyPrice,
      }
    })

    console.log(`✅ Membership changed from ${currentMembership.membershipType} to ${newMembershipType} for user ${user.email}`)

    return NextResponse.json({
      success: true,
      message: `Successfully changed to ${newDetails.name}`,
      newMembership: {
        type: newMembershipType,
        price: newDetails.monthlyPrice,
        name: newDetails.name
      }
    })

  } catch (error) {
    console.error('❌ Error changing membership:', error)
    return NextResponse.json(
      { error: 'Failed to change membership plan' },
      { status: 500 }
    )
  }
}

async function getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }, stripe: ReturnType<typeof getStripeClient>): Promise<string> {
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