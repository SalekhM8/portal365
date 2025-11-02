import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const sp = req.nextUrl.searchParams
    const page = Math.max(1, Number(sp.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, Number(sp.get('limit') || '50')))
    const skip = (page - 1) * limit

    const users = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true,
        memberships: { orderBy: { createdAt: 'desc' }, take: 1, select: { membershipType: true, status: true, startDate: true } },
        payments: { where: { status: 'CONFIRMED' }, orderBy: { processedAt: 'desc' }, take: 1, select: { amount: true } }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit
    })

    const rows = users.map(u => ({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.trim(),
      email: u.email,
      phone: u.phone || '',
      membershipType: u.memberships[0]?.membershipType || 'None',
      status: u.memberships[0]?.status || 'INACTIVE',
      joinDate: (u.memberships[0]?.startDate || u.createdAt).toISOString(),
      lastPayment: u.payments[0]?.amount ? Number(u.payments[0].amount) : 0
    }))

    return NextResponse.json({ ok: true, page, limit, rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


