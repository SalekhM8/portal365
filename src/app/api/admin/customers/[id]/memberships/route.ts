import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role as any)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { id } = await context.params
    const subjectUser = await prisma.user.findUnique({ where: { id }, select: { id: true, firstName: true, lastName: true, email: true } })
    if (!subjectUser) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Resolve family group: if the requested id is a child, pivot to the parent's id
    const childMembership = await prisma.membership.findFirst({ where: { userId: id }, orderBy: { createdAt: 'desc' }, select: { familyGroupId: true } })
    const familyRootId = childMembership?.familyGroupId || id

    const parentMemberships = await prisma.membership.findMany({
      where: { OR: [ { userId: familyRootId }, { familyGroupId: familyRootId } ] },
      include: { user: true }
    })

    const out = [] as Array<{
      userId: string
      memberName: string
      membershipType: string
      status: string
      nextBilling: string | null
      subscriptionId: string | null
      cancelAtPeriodEnd: boolean
    }>

    for (const m of parentMemberships) {
      const sub = await prisma.subscription.findFirst({ where: { userId: m.userId }, orderBy: { createdAt: 'desc' } })
      out.push({
        userId: m.userId,
        memberName: `${m.user.firstName} ${m.user.lastName}`,
        membershipType: m.membershipType,
        status: m.status,
        nextBilling: m.nextBillingDate ? m.nextBillingDate.toISOString() : null,
        subscriptionId: sub?.stripeSubscriptionId || null,
        cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd
      })
    }

    return NextResponse.json({ success: true, members: out, parent: { id: familyRootId, name: `${subjectUser.firstName} ${subjectUser.lastName}`, email: subjectUser.email } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load memberships' }, { status: 500 })
  }
}


