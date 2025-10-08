import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { key } = await context.params

    // Validate plan exists (DB-first)
    const plan = await prisma.membershipPlan.findUnique({ where: { key } })

    // Fetch memberships for this key with user info and last payment (if any)
    const memberships = await prisma.membership.findMany({
      where: { membershipType: key },
      include: {
        user: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            createdAt: true,
            payments: {
              where: { status: 'CONFIRMED' },
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { createdAt: true }
            }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })

    const members = memberships.map((m: any) => ({
      id: m.user.id,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      email: m.user.email,
      status: m.status,
      joinedAt: m.startDate?.toISOString() || m.user.createdAt.toISOString(),
      nextBilling: m.nextBillingDate ? m.nextBillingDate.toISOString() : null,
      lastPaidAt: m.user.payments?.[0]?.createdAt ? new Date(m.user.payments[0].createdAt).toISOString() : null
    }))

    return NextResponse.json({
      success: true,
      planKey: key,
      planName: plan?.displayName || plan?.name || key,
      total: members.length,
      members
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to load members for plan' }, { status: 500 })
  }
}


