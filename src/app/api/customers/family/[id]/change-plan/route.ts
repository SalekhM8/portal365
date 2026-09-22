import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlanDbFirst } from '@/lib/plans'
import { settlePlanChangeNow } from '@/lib/plan-change-settlement'

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

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((subscription as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    const details = await getPlanDbFirst(newMembershipType)
    const stripeSub = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)

    // Find or create price
    const prices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
    const price = prices.data.find(p => p.unit_amount === details.monthlyPrice * 100 && p.recurring?.interval === 'month')
    const priceId = price ? price.id : (await stripe.prices.create({ unit_amount: details.monthlyPrice * 100, currency: 'gbp', recurring: { interval: 'month' }, product: stripeSub.items.data[0].price.product as string })).id
    const currentMonthly = (stripeSub.items.data[0]?.price?.unit_amount || 0) / 100
    if (priceId === stripeSub.items.data[0].price.id) return NextResponse.json({ error: 'Already on this plan' }, { status: 400 })

    // Settle the difference NOW (charge upgrade / refund downgrade). If the
    // charge declines the plan is left unchanged — no free upgrades.
    const settled = await settlePlanChangeNow({
      stripe, account: stripeAccount, stripeSub, newPriceId: priceId,
      currentMonthly, newMonthly: details.monthlyPrice,
      dbSubscriptionId: subscription.id, planLabel: details.name || newMembershipType
    })
    if (!settled.ok) return NextResponse.json({ error: settled.error || 'Plan change failed' }, { status: 402 })

    await prisma.$transaction(async (tx) => {
      await tx.membership.updateMany({ where: { userId: childId, endDate: null }, data: { membershipType: newMembershipType, monthlyPrice: details.monthlyPrice } })
      await tx.subscription.update({ where: { id: subscription.id }, data: { membershipType: newMembershipType, monthlyPrice: details.monthlyPrice } })
    })

    return NextResponse.json({ success: true, message: `Plan changed to ${details.name || newMembershipType}.${settled.note ? ' ' + settled.note : ''}` })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Change plan failed' }, { status: 500 })
  }
}


