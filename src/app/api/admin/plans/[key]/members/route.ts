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

    // Compute totals for users (all time) and last calendar month
    const nowUtc = new Date()
    const thisMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1))
    const lastMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1))

    const userIds = memberships.map((m: any) => m.user.id)
    const totals = await prisma.payment.groupBy({ by: ['userId'], where: { status: 'CONFIRMED', userId: { in: userIds } }, _sum: { amount: true } })
    const totalsMap: Record<string, number> = {}
    for (const t of totals) totalsMap[t.userId] = Number(t._sum.amount || 0)

    const lastMonthTotals = await prisma.payment.groupBy({ by: ['userId'], where: { status: 'CONFIRMED', userId: { in: userIds }, processedAt: { gte: lastMonthStartUtc, lt: thisMonthStartUtc } }, _sum: { amount: true } })
    const lastMonthMap: Record<string, number> = {}
    for (const t of lastMonthTotals) lastMonthMap[t.userId] = Number(t._sum.amount || 0)

    const members = memberships.map((m: any) => ({
      id: m.user.id,
      name: `${m.user.firstName} ${m.user.lastName}`.trim(),
      email: m.user.email,
      status: m.status,
      joinedAt: m.startDate?.toISOString() || m.user.createdAt.toISOString(),
      nextBilling: m.nextBillingDate ? m.nextBillingDate.toISOString() : null,
      lastPaidAt: m.user.payments?.[0]?.createdAt ? new Date(m.user.payments[0].createdAt).toISOString() : null,
      totalPaid: totalsMap[m.user.id] || 0,
      lastMonthPaid: lastMonthMap[m.user.id] || 0
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


