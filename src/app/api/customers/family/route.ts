import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET: list dependents (children) for the logged-in parent
export async function GET() {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parent = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!parent) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const familyMemberships = await prisma.membership.findMany({
      where: { familyGroupId: parent.id },
      include: { user: true }
    })
    // Include a flag if parent has a default payment method to improve UI decisions
    let parentHasDefaultPm = false
    try {
      const latestParentSub = await prisma.subscription.findFirst({ where: { userId: parent.id }, orderBy: { createdAt: 'desc' } })
      if (latestParentSub?.stripeCustomerId) {
        const sc = await (await import('@/lib/stripe')).stripe.customers.retrieve(latestParentSub.stripeCustomerId)
        parentHasDefaultPm = !!(!("deleted" in sc) && (sc as any)?.invoice_settings?.default_payment_method)
      }
    } catch {}

    const children = familyMemberships.map(m => ({
      childId: m.userId,
      childName: `${m.user.firstName} ${m.user.lastName}`,
      membershipType: m.membershipType,
      status: m.status,
      nextBilling: m.nextBillingDate
    }))

    return NextResponse.json({ success: true, parentId: parent.id, parentHasDefaultPm, children })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to fetch family' }, { status: 500 })
  }
}

// POST: create a child and a membership under the parent
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const parent = await prisma.user.findUnique({ where: { email: session.user.email } })
    if (!parent) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const body = await request.json()
    const { firstName, lastName, dateOfBirth, membershipType } = body || {}
    if (!firstName || !lastName || !membershipType) {
      return NextResponse.json({ error: 'Missing fields' }, { status: 400 })
    }

    // Create child user account without password (managed by parent)
    const child = await prisma.user.create({
      data: {
        firstName,
        lastName,
        email: `${crypto.randomUUID()}@child.local`, // placeholder email; can be updated later
        role: 'CUSTOMER',
        status: 'ACTIVE',
        dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
        emergencyContact: parent.phone ? JSON.stringify({ name: `${parent.firstName} ${parent.lastName}`, phone: parent.phone, relationship: 'parent' }) : null
      }
    })

    // Create membership linked to parent via familyGroupId
    const now = new Date()
    const startNextMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
    const membership = await prisma.membership.create({
      data: {
        userId: child.id,
        membershipType,
        status: 'PENDING_PAYMENT',
        startDate: now,
        monthlyPrice: 0, // price inherited at subscription time; optional override later
        setupFee: 0,
        accessPermissions: JSON.stringify({}),
        scheduleAccess: JSON.stringify({}),
        ageCategory: 'YOUTH',
        billingDay: 1,
        nextBillingDate: startNextMonth,
        familyGroupId: parent.id,
        isPrimaryMember: false
      }
    })

    return NextResponse.json({ success: true, child: { id: child.id, firstName, lastName }, membership: { id: membership.id, membershipType } })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to create child' }, { status: 500 })
  }
}


