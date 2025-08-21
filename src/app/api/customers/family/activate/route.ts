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

    return NextResponse.json({ success: true, subscription: subResult.subscription, clientSecret: subResult.clientSecret })

  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to activate child membership' }, { status: 500 })
  }
}


