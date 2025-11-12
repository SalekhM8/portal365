import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, getPublishableKey } from '@/lib/stripe'

/**
 * Resume a pending signup by returning a usable client_secret for either:
 * - PaymentIntent (prorated-first-payment flow)
 * - SetupIntent (admin/no-proration flow)
 *
 * Response shape:
 * { mode: 'payment_intent' | 'setup_intent', subscriptionId: string, clientSecret: string }
 */
export async function POST(_request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Find the latest pending/incomplete subscription for this user
    const user = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const subscription = await prisma.subscription.findFirst({
      where: {
        userId: user.id,
        status: { in: ['PENDING_PAYMENT', 'INCOMPLETE', 'INCOMPLETE_EXPIRED'] }
      },
      orderBy: { createdAt: 'desc' }
    })

    if (!subscription) {
      return NextResponse.json({ error: 'No pending subscription to resume' }, { status: 404 })
    }

    // Determine flow by the stored identifier shape
    const id = subscription.stripeSubscriptionId
    const isPaymentIntentPlaceholder = typeof id === 'string' && id.startsWith('pi_')
    const stripe = getStripeClient((subscription as any).stripeAccountKey || 'SU')

    if (isPaymentIntentPlaceholder) {
      // Try to reuse existing PaymentIntent; else create a replacement
      try {
        const existing = await stripe.paymentIntents.retrieve(id)
        const reusableStatuses = new Set([
          'requires_payment_method','requires_action','requires_confirmation'
        ])
        if (existing.client_secret && reusableStatuses.has(existing.status)) {
          return NextResponse.json({
            mode: 'payment_intent',
            subscriptionId: subscription.id,
            clientSecret: existing.client_secret,
            publishableKey: getPublishableKey((subscription as any).stripeAccountKey || 'SU')
          })
        }
      } catch {}

      // Create a fresh PaymentIntent mirroring the original intent
      // Compute prorated amount consistent with original logic
      const now = new Date()
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const daysRemaining = daysInMonth - now.getDate() + 1
      const fullAmountPence = Math.round(Number(subscription.monthlyPrice) * 100)
      const proratedAmountPence = Math.max(0, Math.round(fullAmountPence * (daysRemaining / daysInMonth)))

      const pi = await stripe.paymentIntents.create({
        amount: proratedAmountPence,
        currency: 'gbp',
        customer: subscription.stripeCustomerId,
        automatic_payment_methods: { enabled: true },
        setup_future_usage: 'off_session',
        metadata: {
          userId: subscription.userId,
          membershipType: subscription.membershipType,
          routedEntityId: subscription.routedEntityId,
          nextBillingDate: new Date(subscription.nextBillingDate).toISOString().split('T')[0],
          reason: 'prorated_first_period',
          dbSubscriptionId: subscription.id
        }
      })

      // Update placeholder id to new PI
      await prisma.subscription.update({
        where: { id: subscription.id },
        data: { stripeSubscriptionId: pi.id }
      })

      return NextResponse.json({
        mode: 'payment_intent',
        subscriptionId: subscription.id,
        clientSecret: pi.client_secret,
        publishableKey: getPublishableKey((subscription as any).stripeAccountKey || 'SU')
      })
    }

    // SetupIntent path (admin/no-proration flow or trialing without PM)
    const setup = await stripe.setupIntents.create({
      customer: subscription.stripeCustomerId,
      usage: 'off_session',
      metadata: {
        userId: subscription.userId,
        membershipType: subscription.membershipType,
        routedEntityId: subscription.routedEntityId,
        nextBillingDate: new Date(subscription.nextBillingDate).toISOString().split('T')[0],
        dbSubscriptionId: subscription.id,
        reason: 'resume_signup_setup'
      }
    })

    return NextResponse.json({
      mode: 'setup_intent',
      subscriptionId: subscription.id,
      clientSecret: setup.client_secret,
      publishableKey: getPublishableKey((subscription as any).stripeAccountKey || 'SU')
    })

  } catch (error) {
    console.error('resume-signup error:', error)
    return NextResponse.json({ error: 'Failed to resume signup' }, { status: 500 })
  }
}


