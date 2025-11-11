import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'

function firstOfNextMonthUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
}

function projectMembershipFields(planKey: string, monthlyPrice: number, nextBillingDate: Date) {
  const plan = MEMBERSHIP_PLANS[planKey as keyof typeof MEMBERSHIP_PLANS]
  const ageCategory = plan?.key?.includes('KIDS') ? 'UNDER_14' : 'ADULT'
  const scheduleAccess =
    plan?.key?.includes('KIDS') ? 'WEEKEND_ONLY' :
    plan?.key?.includes('FULL') ? 'FULL_WEEK' :
    'STANDARD'
  // Minimal placeholder permissions; can be edited later in UI
  const accessPermissions = {}
  return {
    membershipType: planKey,
    monthlyPrice,
    status: 'ACTIVE' as const,
    startDate: new Date(),
    billingDay: 1,
    nextBillingDate,
    accessPermissions: JSON.stringify(accessPermissions),
    scheduleAccess,
    ageCategory
  }
}

export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions as any)
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    if (!['ADMIN','SUPER_ADMIN','STAFF'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { stripeSubscriptionId, newEmail, firstName, lastName } = await req.json()
    if (!stripeSubscriptionId || !newEmail) {
      return NextResponse.json({ error: 'Missing stripeSubscriptionId or newEmail' }, { status: 400 })
    }

    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId },
      include: { user: true }
    })
    if (!sub) {
      return NextResponse.json({ error: 'Portal subscription not found for given stripeSubscriptionId' }, { status: 404 })
    }

    // Find or create the destination user (shadow account)
    let targetUser = await prisma.user.findUnique({ where: { email: newEmail } })
    if (!targetUser) {
      targetUser = await prisma.user.create({
        data: {
          email: newEmail,
          firstName: firstName || '',
          lastName: lastName || '',
          role: 'CUSTOMER',
          status: 'ACTIVE'
        }
      })
    }

    // Re-link the subscription to the new user
    const updatedSub = await prisma.subscription.update({
      where: { id: sub.id },
      data: { userId: targetUser.id }
    })

    // Ensure the target user has a matching membership row
    const nextBill = sub.nextBillingDate || firstOfNextMonthUTC()
    const existingTargetMembership = await prisma.membership.findFirst({
      where: { userId: targetUser.id, membershipType: sub.membershipType }
    })
    if (existingTargetMembership) {
      await prisma.membership.update({
        where: { id: existingTargetMembership.id },
        data: {
          status: 'ACTIVE',
          monthlyPrice: Number(sub.monthlyPrice as any),
          billingDay: 1,
          nextBillingDate: nextBill as Date
        }
      })
    } else {
      const m = projectMembershipFields(sub.membershipType as string, Number((sub.monthlyPrice as any) || 0), nextBill as Date)
      await prisma.membership.create({
        data: {
          userId: targetUser.id,
          membershipType: m.membershipType,
          status: m.status,
          startDate: m.startDate,
          monthlyPrice: m.monthlyPrice,
          billingDay: m.billingDay,
          nextBillingDate: m.nextBillingDate,
          accessPermissions: m.accessPermissions,
          scheduleAccess: m.scheduleAccess,
          ageCategory: m.ageCategory
        }
      })
    }

    // Optionally set the old user's membership inactive if it's the same plan and no payments yet
    const oldMembership = await prisma.membership.findFirst({
      where: { userId: sub.userId, membershipType: sub.membershipType, status: 'ACTIVE' }
    })
    if (oldMembership) {
      const hasPaid = await prisma.payment.count({ where: { userId: sub.userId, status: 'CONFIRMED' } })
      if (hasPaid === 0) {
        await prisma.membership.update({ where: { id: oldMembership.id }, data: { status: 'INACTIVE' } })
      }
    }

    return NextResponse.json({ success: true, subscriptionId: updatedSub.id, newUserId: targetUser.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to reassign subscription' }, { status: 500 })
  }
}


