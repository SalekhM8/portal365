import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

// Reuse price helper from confirm-payment handlers
async function getOrCreatePriceLocal(membershipDetails: { monthlyPrice: number; name: string }): Promise<string> {
  const existingPrices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
  const existingPrice = existingPrices.data.find(price => price.unit_amount === membershipDetails.monthlyPrice * 100 && price.recurring?.interval === 'month')
  if (existingPrice) return existingPrice.id
  const product = await stripe.products.create({ name: `${membershipDetails.name} Membership`, description: `Monthly membership for ${membershipDetails.name}` })
  const recurringPrice = await stripe.prices.create({ unit_amount: membershipDetails.monthlyPrice * 100, currency: 'gbp', recurring: { interval: 'month' }, product: product.id })
  return recurringPrice.id
}

/**
 * ADMIN: Create a Stripe subscription for an EXISTING user (no user interaction).
 * Body:
 * {
 *   email: string,
 *   membershipType: string, // e.g. FULL_ADULT
 *   monthlyPrice?: number,  // optional override
 *   stripeCustomerId: string, // existing Stripe customer (cus_...)
 *   nextBillingDate?: string, // YYYY-MM-DD (defaults to first of next month)
 *   routedEntityId?: string  // optional; fallback to first ACTIVE BusinessEntity
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const { email, membershipType, monthlyPrice, stripeCustomerId, nextBillingDate, routedEntityId } = body || {}
    if (!email || !membershipType || !stripeCustomerId) {
      return NextResponse.json({ error: 'email, membershipType, stripeCustomerId are required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Resolve price/name
    const plan = getPlan(membershipType)
    const effectivePrice = typeof monthlyPrice === 'number' ? monthlyPrice : plan.monthlyPrice
    const priceId = await getOrCreatePriceLocal({ monthlyPrice: effectivePrice, name: plan.name })

    // Determine next billing date
    const now = new Date()
    const nbd = nextBillingDate ? new Date(nextBillingDate) : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
    const trialEndTs = Math.floor(nbd.getTime() / 1000)

    // Choose routed entity if not provided
    let entityId = routedEntityId
    if (!entityId) {
      const entity = await prisma.businessEntity.findFirst({ where: { status: 'ACTIVE' } })
      if (!entity) return NextResponse.json({ error: 'No active business entity configured' }, { status: 400 })
      entityId = entity.id
    }

    // Create Stripe subscription to start billing on nextBillingDate
    const stripeSub = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId }],
      collection_method: 'charge_automatically',
      trial_end: trialEndTs,
      metadata: {
        userId: user.id,
        membershipType,
        routedEntityId: entityId
      }
    })

    // Ensure membership exists and ACTIVE
    const existingMembership = await prisma.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    if (existingMembership) {
      await prisma.membership.update({
        where: { id: existingMembership.id },
        data: {
          membershipType,
          status: 'ACTIVE',
          monthlyPrice: effectivePrice,
          nextBillingDate: nbd
        }
      })
    } else {
      await prisma.membership.create({
        data: {
          userId: user.id,
          membershipType,
          status: 'ACTIVE',
          startDate: new Date(),
          monthlyPrice: effectivePrice,
          setupFee: 0,
          accessPermissions: JSON.stringify({}),
          scheduleAccess: JSON.stringify({}),
          ageCategory: membershipType.includes('UNDER14') ? 'YOUTH' : 'ADULT',
          billingDay: 1,
          nextBillingDate: nbd,
          isPrimaryMember: true
        }
      })
    }

    // Create local subscription record mapping to Stripe
    const localSub = await prisma.subscription.create({
      data: {
        userId: user.id,
        stripeSubscriptionId: stripeSub.id,
        stripeCustomerId,
        routedEntityId: entityId!,
        membershipType,
        monthlyPrice: effectivePrice,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: nbd,
        nextBillingDate: nbd,
        cancelAtPeriodEnd: false
      }
    })

    return NextResponse.json({ success: true, subscriptionId: localSub.id, stripeSubscriptionId: stripeSub.id, nextBillingDate: nbd.toISOString().split('T')[0] })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to create subscription' }, { status: 500 })
  }
}


