import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    // Get the session - user must be properly logged in
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized - Please log in' }, { status: 401 })
    }

    const userEmail = session.user.email
    
    // Find user and verify they're a customer
    const user = await prisma.user.findUnique({
      where: { email: userEmail },
      select: { id: true, role: true }
    })
    
    if (!user || user.role !== 'CUSTOMER') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const userId = user.id

    // Get user data
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 10,
          include: {
            routedEntity: { select: { displayName: true } },
            routing: { select: { routingReason: true, confidence: true } }
          }
        }
      }
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Get real class schedule from database
    const classes = await prisma.class.findMany({
      where: { isActive: true },
      include: { service: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })

    // Membership snapshot
    const activeMembership = userData.memberships[0]
    const membershipData = activeMembership ? {
      type: activeMembership.membershipType,
      status: activeMembership.status,
      price: activeMembership.monthlyPrice,
      nextBilling: activeMembership.nextBillingDate.toISOString().split('T')[0],
      accessPermissions: JSON.parse(activeMembership.accessPermissions)
    } : null

    // Format class schedule with user's membership access
    const upcomingClasses = classes.map((cls: any) => ({
      id: cls.id,
      name: cls.name,
      instructor: cls.instructorName,
      time: `${getDayName(cls.dayOfWeek)} ${cls.startTime}`,
      location: cls.location,
      maxParticipants: cls.maxParticipants,
      duration: cls.duration,
      canAccess: membershipData ? canUserAccessClass(cls, activeMembership) : false
    }))

    return NextResponse.json({
      user: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        memberSince: userData.memberships[0]?.startDate.toISOString().split('T')[0] || userData.createdAt.toISOString().split('T')[0]
      },
      membership: membershipData,
      paymentHistory: userData.payments.map((payment: any) => ({
        id: payment.id,
        amount: payment.amount,
        date: payment.createdAt.toISOString().split('T')[0],
        status: payment.status,
        description: payment.description,
        routedTo: payment.routedEntity.displayName,
        routingReason: payment.routing?.routingReason || 'Standard routing',
        confidence: payment.routing?.confidence || 'MEDIUM',
        vatOptimized: true
      })),
      classSchedule: upcomingClasses
    })

  } catch (error) {
    console.error('❌ Error fetching customer dashboard data:', error)
    return NextResponse.json({ error: 'Failed to fetch dashboard data' }, { status: 500 })
  }
}

function getDayName(dayOfWeek: number): string {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  return days[dayOfWeek] || 'Unknown'
}

function canUserAccessClass(cls: any, membership: any): boolean {
  try {
    const requiredMemberships = JSON.parse(cls.requiredMemberships) as string[]
    if (requiredMemberships.includes(membership.membershipType)) {
      return true
    }
    // Weekend plans: allow Fri(5), Sat(6), Sun(0) regardless of legacy requiredMemberships
    const isFriSatSun = cls.dayOfWeek === 5 || cls.dayOfWeek === 6 || cls.dayOfWeek === 0
    if (isFriSatSun && (membership.membershipType === 'WEEKEND_ADULT' || membership.membershipType === 'WEEKEND_UNDER18')) {
      return true
    }
    return false
  } catch {
    return false
  }
} 