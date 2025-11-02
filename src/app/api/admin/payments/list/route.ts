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

    const payments = await prisma.payment.findMany({
      where: { amount: { gt: 0 } },
      orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
      select: {
        id: true,
        amount: true,
        status: true,
        description: true,
        createdAt: true,
        processedAt: true,
        user: { select: { firstName: true, lastName: true, email: true } }
      }
    })

    const rows = payments.map(p => ({
      id: p.id,
      amount: Number(p.amount),
      status: p.status,
      timestamp: (p.processedAt || p.createdAt).toISOString(),
      customer: `${p.user?.firstName || ''} ${p.user?.lastName || ''}`.trim(),
      email: p.user?.email || '',
      description: p.description || ''
    }))

    return NextResponse.json({ ok: true, page, limit, rows })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


