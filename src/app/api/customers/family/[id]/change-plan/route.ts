import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const parent = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!parent) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const params = await context.params
    const childId = params.id
    const { newMembershipType } = await request.json()
    if (!newMembershipType) return NextResponse.json({ error: 'Missing newMembershipType' }, { status: 400 })

    const membership = await prisma.membership.findFirst({ where: { userId: childId }, orderBy: { createdAt: 'desc' } })
    if (!membership || membership.familyGroupId !== parent.id) return NextResponse.json({ error: 'Not permitted' }, { status: 403 })

    const subscription = await prisma.subscription.findFirst({ where: { userId: childId }, orderBy: { createdAt: 'desc' } })
    if (!subscription) return NextResponse.json({ error: 'No subscription found' }, { status: 404 })

    const details = getPlan(newMembershipType)
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)

    // Find or create price
    const prices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
    const price = prices.data.find(p => p.unit_amount === details.monthlyPrice * 100 && p.recurring?.interval === 'month')
    const priceId = price ? price.id : (await stripe.prices.create({ unit_amount: details.monthlyPrice * 100, currency: 'gbp', recurring: { interval: 'month' }, product: stripeSub.items.data[0].price.product as string })).id

    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      items: [{ id: stripeSub.items.data[0].id, price: priceId }],
      proration_behavior: 'create_prorations'
    })

    await prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { userId: childId }, data: { membershipType: newMembershipType, monthlyPrice: details.monthlyPrice } })
      await tx.subscription.update({ where: { id: subscription.id }, data: { membershipType: newMembershipType, monthlyPrice: details.monthlyPrice } })
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Change plan failed' }, { status: 500 })
  }
}


