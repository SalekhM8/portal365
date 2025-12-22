import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params = await context.params
    const userId = params.id
    const { newMembershipType } = await request.json()
    if (!newMembershipType) return NextResponse.json({ error: 'newMembershipType required' }, { status: 400 })

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
    if (!sub) return NextResponse.json({ error: 'No subscription' }, { status: 404 })

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((sub as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
    const stripeStatus = (stripeSub as any).status as string
    const currentItem = (stripeSub as any).items?.data?.[0]
    const currentPriceAmount = (currentItem?.price?.unit_amount || 0) / 100
    const plan = getPlan(newMembershipType)
    const newMonthly = plan.monthlyPrice

    let result: any = {
      stripeStatus,
      nextBillingDate: new Date(((stripeSub as any).current_period_end || (stripeSub as any).trial_end) * 1000).toISOString().split('T')[0],
      currentMonthly: currentPriceAmount,
      newMonthly
    }

    if (stripeStatus === 'trialing') {
      // Use calendar month proration (not trial window)
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const nextFirst = new Date(Date.UTC(year, month + 1, 1))
      const remainingDays = Math.max(0, Math.ceil((nextFirst.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const fraction = Math.min(1, remainingDays / daysInMonth)
      const delta = Math.round((newMonthly - currentPriceAmount) * fraction * 100) / 100
      result.deltaNow = delta
      return NextResponse.json({ success: true, preview: result })
    }

    // Active: try Stripe Upcoming Invoice preview (guarded for SDKs without types), else null
    try {
      const api: any = stripe as any
      if (api?.invoices?.retrieveUpcoming) {
        const upcoming = await api.invoices.retrieveUpcoming({
          customer: (stripeSub as any).customer as string,
          subscription: stripeSub.id,
          subscription_items: [{ id: currentItem.id, price: currentItem.price.id }, { price: currentItem.price.id, deleted: true }],
        })
        const total = (upcoming.amount_due || 0) / 100
        result.upcomingPreviewTotal = total
      } else {
        result.upcomingPreviewTotal = null
      }
    } catch {
      result.upcomingPreviewTotal = null
    }

    return NextResponse.json({ success: true, preview: result })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Preview failed' }, { status: 500 })
  }
}


