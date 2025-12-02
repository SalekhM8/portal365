import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

type AccountFilter = 'SU' | 'IQ' | 'ALL'
type MonthlyMetricRow = {
  month: string
  totalNet: Prisma.Decimal
  charges: Prisma.Decimal
  refunds: Prisma.Decimal
  lastUpdatedAt: Date
}

const monthlyMetricDelegate = (client: any) => client.monthlyStripeMetric as any

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const search = req.nextUrl.searchParams
    const monthsParam = Number(search.get('months') || 12)
    const accountParam = (search.get('account') || 'SU').toUpperCase() as AccountFilter
    const fromParam = search.get('from') || undefined
    const toParam = search.get('to') || undefined

    const where: any = { account: accountParam }
    if (fromParam && toParam) {
      where.month = { gte: fromParam, lte: toParam }
    }

    const rows = await (monthlyMetricDelegate(prisma).findMany({
      where,
      orderBy: { month: 'desc' },
      ...(fromParam && toParam ? {} : { take: monthsParam })
    }) as Promise<MonthlyMetricRow[]>)

    const months = rows
      .map((row) => ({
        month: row.month,
        totalNet: Number(row.totalNet),
        charges: Number(row.charges),
        refunds: Number(row.refunds)
      }))

    return NextResponse.json({
      ok: true,
      months,
      updatedAt: rows[0]?.lastUpdatedAt ?? null
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


