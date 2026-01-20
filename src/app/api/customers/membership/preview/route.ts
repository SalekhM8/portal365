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

    if (currentMembership?.membershipType === newMembershipType) {
      return NextResponse.json({ error: 'You are already on this plan' }, { status: 400 })
    }

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((subscription as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const stripeStatus = (stripeSubscription as any).status as string
    const item = stripeSubscription.items.data[0]
    const currentPriceAmount = ((item?.price?.unit_amount || 0) / 100)
    const newMonthly = newDetails.monthlyPrice

    // Calculate next billing date
    const periodEnd = (stripeSubscription as any).current_period_end || (stripeSubscription as any).trial_end
    const nextBillingDate = periodEnd ? new Date(periodEnd * 1000).toISOString().split('T')[0] : null

    // Calculate proration
    let prorationAmount = 0
    let isUpgrade = newMonthly > currentPriceAmount

    if (stripeStatus === 'trialing') {
      // Use calendar month proration for trial
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const nextFirst = new Date(Date.UTC(year, month + 1, 1))
      const remainingDays = Math.max(0, Math.ceil((nextFirst.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const fraction = Math.min(1, remainingDays / daysInMonth)
      prorationAmount = Math.round((newMonthly - currentPriceAmount) * fraction * 100) / 100
    } else {
      // For active subscriptions, calculate based on billing cycle
      const now = new Date()
      const periodStart = (stripeSubscription as any).current_period_start
      const periodEndTs = (stripeSubscription as any).current_period_end
      
      if (periodStart && periodEndTs) {
        const periodStartDate = new Date(periodStart * 1000)
        const periodEndDate = new Date(periodEndTs * 1000)
        const totalDays = Math.ceil((periodEndDate.getTime() - periodStartDate.getTime()) / (24 * 60 * 60 * 1000))
        const remainingDays = Math.max(0, Math.ceil((periodEndDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
        const fraction = remainingDays / totalDays
        prorationAmount = Math.round((newMonthly - currentPriceAmount) * fraction * 100) / 100
      }
    }

    return NextResponse.json({
      success: true,
      preview: {
        currentPlan: currentMembership?.membershipType || 'Unknown',
        currentPrice: currentPriceAmount,
        newPlan: newMembershipType,
        newPrice: newMonthly,
        isUpgrade,
        prorationAmount: Math.abs(prorationAmount),
        prorationAction: isUpgrade ? 'charge' : 'credit',
        nextBillingDate,
        stripeStatus
      }
    })

  } catch (error) {
    console.error('❌ Error previewing membership change:', error)
    return NextResponse.json(
      { error: 'Failed to preview membership change' },
      { status: 500 }
    )
  }
}

