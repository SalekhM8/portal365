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

    // Get user data (parent)
    const userData = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })

    if (!userData) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 })
    }

    // Family: fetch children memberships to surface their payments too
    const childrenMemberships = await prisma.membership.findMany({
      where: { familyGroupId: userId },
      include: { user: true }
    })

    // Gather payments for parent and children (member-aware)
    const memberIds = [userId, ...childrenMemberships.map((m: any) => m.userId)]
    // Only payments for these members; do not include parent placeholder users
    const paymentsRaw = await prisma.payment.findMany({
      where: { userId: { in: memberIds }, amount: { gt: 0 } },
      orderBy: [ { processedAt: 'desc' }, { createdAt: 'desc' } ],
      take: 50,
      include: {
        routedEntity: { select: { displayName: true } },
        routing: { select: { routingReason: true, confidence: true } }
      }
    })

    const idToMember = new Map<string, { id: string; name: string }>()
    idToMember.set(userId, { id: userId, name: `${userData.firstName} ${userData.lastName}` })
    for (const cm of childrenMemberships) {
      idToMember.set(cm.userId, { id: cm.userId, name: `${cm.user.firstName} ${cm.user.lastName}` })
    }

    const paymentsWithMember = paymentsRaw.map((p: any) => {
      const desc: string = p.description || ''
      const memberTagMatch = desc.match(/\[member:([^\]]+)\]/)
      const taggedMemberId = memberTagMatch?.[1]
      const effectiveMemberId = (taggedMemberId && idToMember.has(taggedMemberId)) ? taggedMemberId : p.userId
      return {
        id: p.id,
        memberId: effectiveMemberId,
        memberName: (idToMember.get(effectiveMemberId)?.name) || 'Member',
        amount: p.amount,
        date: (p.processedAt || p.createdAt).toISOString().split('T')[0],
        status: p.status,
        description: p.description,
        entity: p.routedEntity?.displayName || 'N/A'
      }
    })

    const membersList = [
      { id: userId, name: `${userData.firstName} ${userData.lastName}` },
      ...childrenMemberships.map((cm: any) => ({ id: cm.userId, name: `${cm.user.firstName} ${cm.user.lastName}` }))
    ]

    // Get real class schedule from database
    const classes = await prisma.class.findMany({
      where: { isActive: true },
      include: { service: true },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })

    // Membership snapshot + effective schedule policy (membership.scheduleAccess or plan.schedulePolicy)
    const activeMembership = userData.memberships[0]
    let effectiveSchedule: any = null
    if (activeMembership) {
      // Prefer plan policy so changes in Package Management reflect immediately for all users on the plan
      try {
        const planRow = await prisma.membershipPlan.findUnique({ where: { key: activeMembership.membershipType } })
        effectiveSchedule = planRow?.schedulePolicy ? JSON.parse(planRow.schedulePolicy as any) : null
      } catch {}
      // Fallback to membership-specific schedule if plan policy not present
      if (!effectiveSchedule) {
        try { effectiveSchedule = activeMembership.scheduleAccess ? JSON.parse(activeMembership.scheduleAccess) : null } catch {}
      }
    }
    const membershipData = activeMembership ? {
      type: activeMembership.membershipType,
      status: activeMembership.status,
      price: activeMembership.monthlyPrice,
      nextBilling: activeMembership.nextBillingDate.toISOString().split('T')[0],
      accessPermissions: JSON.parse(activeMembership.accessPermissions),
      scheduleAccess: effectiveSchedule
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
      canAccess: membershipData ? canUserAccessClass(cls, activeMembership, effectiveSchedule) : false
    }))

    return NextResponse.json({
      user: {
        firstName: userData.firstName,
        lastName: userData.lastName,
        email: userData.email,
        memberSince: userData.memberships[0]?.startDate.toISOString().split('T')[0] || userData.createdAt.toISOString().split('T')[0]
      },
      membership: membershipData,
      members: membersList,
      paymentsWithMember,
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

function canUserAccessClass(cls: any, membership: any, schedule: any): boolean {
  // 1) Membership type gate (class-level restriction)
  try {
    const requiredMemberships = JSON.parse(cls.requiredMemberships) as string[]
    if (Array.isArray(requiredMemberships) && requiredMemberships.length > 0) {
      if (!requiredMemberships.includes(membership.membershipType)) return false
    }
  } catch {
    // If class has malformed requiredMemberships, fail closed on type gate
    return false
  }

  // 2) Time-window gate (package schedule)
  const dayCodeMap = ['sun','mon','tue','wed','thu','fri','sat']
  const classDayCode = dayCodeMap[cls.dayOfWeek] || ''
  const classStart = cls.startTime as string // 'HH:mm'
  const classEnd = cls.endTime as string // 'HH:mm'

  // Use provided effective schedule (already chosen from membership or plan). If absent, allow by default for back-compat.
  const windows: Array<{ days: string[]; start: string; end: string }> = Array.isArray(schedule?.allowedWindows) ? schedule.allowedWindows : []
  if (windows.length === 0) return true

  // Check if class time overlaps any allowed window for the class day
  return windows.some((w: any) => {
    try {
      if (!Array.isArray(w.days) || !w.start || !w.end) return false
      if (!w.days.includes(classDayCode)) return false
      // time overlap: classStart..classEnd within w.start..w.end or overlapping
      return timeOverlap(classStart, classEnd, w.start as string, w.end as string)
    } catch { return false }
  })
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = (hhmm || '00:00').split(':').map((x: string) => parseInt(x, 10))
  return (h * 60) + (m || 0)
}

function timeOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  const aS = timeToMinutes(aStart)
  const aE = timeToMinutes(aEnd)
  const bS = timeToMinutes(bStart)
  const bE = timeToMinutes(bEnd)
  return Math.max(aS, bS) < Math.min(aE, bE)
}