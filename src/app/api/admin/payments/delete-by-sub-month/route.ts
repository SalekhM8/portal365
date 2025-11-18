import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * ADMIN: Bulk delete Payment rows for a subscription within a specific year-month bucket.
 * - Does NOT touch Stripe (no refund/cancel).
 * - Intended to clear all local failures for a given SUBMON group (sub:YYYY-MM).
 *
 * Body:
 *   {
 *     subId: string,      // Portal subscription id (from [sub:...] tag in description)
 *     yearMonth: string   // 'YYYY-MM' (UTC)
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role as any)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const subId: string | undefined = body?.subId
    const yearMonth: string | undefined = body?.yearMonth
    if (!subId || !yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
      return NextResponse.json({ error: 'Provide subId and yearMonth=YYYY-MM' }, { status: 400 })
    }

    // Compute month window in UTC
    const [yearStr, monthStr] = yearMonth.split('-')
    const year = Number(yearStr)
    const month = Number(monthStr) - 1
    const start = new Date(Date.UTC(year, month, 1, 0, 0, 0, 0))
    const end = new Date(Date.UTC(year, month + 1, 1, 0, 0, 0, 0))

    const whereClause: any = {
      description: { contains: `[sub:${subId}]` },
      createdAt: { gte: start, lt: end }
    }

    const candidates = await prisma.payment.findMany({ where: whereClause, select: { id: true } })
    if (candidates.length === 0) {
      return NextResponse.json({ success: true, deleted: [], note: 'No matching payments found' })
    }

    const del = await prisma.payment.deleteMany({ where: whereClause })
    return NextResponse.json({ success: true, deletedCount: del.count, deletedIds: candidates.map(c => c.id) })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
}


