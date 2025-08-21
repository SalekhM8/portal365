import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

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

    const { cancelationType = 'end_of_period' } = await request.json()

    const membership = await prisma.membership.findFirst({ where: { userId: childId }, orderBy: { createdAt: 'desc' } })
    if (!membership || membership.familyGroupId !== parent.id) {
      return NextResponse.json({ error: 'Not permitted' }, { status: 403 })
    }

    const subscription = await prisma.subscription.findFirst({ where: { userId: childId }, orderBy: { createdAt: 'desc' } })
    if (!subscription) return NextResponse.json({ error: 'No subscription found' }, { status: 404 })

    if (cancelationType === 'immediate') {
      const result = await stripe.subscriptions.cancel(subscription.stripeSubscriptionId, { prorate: true })
      try {
        const invoices = await stripe.invoices.list({ customer: result.customer as string, limit: 3 })
        for (const inv of invoices.data) if (inv.status === 'open' && inv.id) await stripe.invoices.voidInvoice(inv.id as string)
      } catch {}
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: subscription.id }, data: { status: 'CANCELLED', cancelAtPeriodEnd: false } })
        await tx.membership.updateMany({ where: { userId: childId, status: { in: ['ACTIVE', 'SUSPENDED'] } }, data: { status: 'CANCELLED' } })
      })
    } else {
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, { cancel_at_period_end: true })
      await prisma.subscription.update({ where: { id: subscription.id }, data: { cancelAtPeriodEnd: true } })
    }

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Cancel failed' }, { status: 500 })
  }
}


