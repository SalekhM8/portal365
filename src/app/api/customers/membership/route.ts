import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user and their current membership
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      }
    })

    if (!user) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    const membership = user.memberships[0]
    const subscription = user.subscriptions[0]

    if (!membership) {
      return NextResponse.json({ error: 'No active membership found' }, { status: 404 })
    }

    return NextResponse.json({
      success: true,
      membership: {
        type: membership.membershipType,
        price: membership.monthlyPrice,
        status: membership.status,
        nextBilling: membership.nextBillingDate.toISOString().split('T')[0],
        startDate: membership.startDate.toISOString().split('T')[0],
        accessPermissions: JSON.parse(membership.accessPermissions),
        subscriptionId: subscription?.id || null
      }
    })

  } catch (error) {
    console.error('❌ Error fetching membership:', error)
    return NextResponse.json(
      { error: 'Failed to fetch membership details' },
      { status: 500 }
    )
  }
} 