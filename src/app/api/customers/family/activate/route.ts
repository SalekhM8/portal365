import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { SubscriptionProcessor } from '@/lib/stripe'

// POST: initiate child subscription using parent's payer account
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parent = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!parent) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const { childId, customPrice } = await request.json()
    if (!childId) return NextResponse.json({ error: 'childId required' }, { status: 400 })

    const child = await prisma.user.findUnique({ where: { id: childId } })
    if (!child) return NextResponse.json({ error: 'Child not found' }, { status: 404 })

    const membership = await prisma.membership.findFirst({ where: { userId: childId }, orderBy: { createdAt: 'desc' } })
    if (!membership) return NextResponse.json({ error: 'Child has no membership' }, { status: 400 })

    // Create subscription for child using parent's Stripe customer (payerUserId)
    const subResult = await SubscriptionProcessor.createSubscription({
      userId: child.id,
      membershipType: membership.membershipType,
      businessId: 'aura_mma',
      customerEmail: parent.email,
      customerName: `${parent.firstName} ${parent.lastName}`,
      customPrice: customPrice,
      isAdminCreated: true,
      payerUserId: parent.id
    })

    // Check if payment already succeeded (no further action needed)
    const paymentStatus = (subResult as any).paymentStatus || 'unknown'
    const paymentSucceeded = paymentStatus === 'succeeded' || 
                             subResult.subscription.status === 'ACTIVE' ||
                             subResult.subscription.status === 'TRIALING'

    return NextResponse.json({ 
      success: true, 
      subscription: subResult.subscription, 
      clientSecret: subResult.clientSecret,
      paymentSucceeded // If true, no need to redirect to payment-methods
    })

  } catch (e: any) {
    const msg: string = e?.message || ''
    // Card declined on the child's prorated first payment: tell the parent exactly
    // what to do instead of a bare 500 (they were re-pressing Activate against an
    // expired card with no idea why — Ibrahim Ganny, 26 Sep 2026).
    if (/Prorated charge failed/i.test(msg) || /card/i.test(msg)) {
      const reason = msg.replace(/^Prorated charge failed:\s*/i, '').replace(/\.$/, '')
      return NextResponse.json({
        error: `Payment declined: ${reason}. Update your card under Payment Methods, then press Activate again.`,
        code: 'CARD_DECLINED',
        reason
      }, { status: 402 })
    }
    return NextResponse.json({ error: msg || 'Failed to activate child membership' }, { status: 500 })
  }
}


