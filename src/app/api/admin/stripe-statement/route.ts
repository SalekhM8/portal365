import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

// Force fresh reads for proof/debug
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

function getMonthBounds(year: number, month0: number) {
  const start = new Date(Date.UTC(year, month0, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month0 + 1, 1, 0, 0, 0))
  return { start, end }
}

function startOfThisMonthUTC() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0))
}

async function sumBalanceSalesNet(created?: { gte?: number; lt?: number }) {
  let hasMore = true
  let startingAfter: string | undefined
  let totalMinor = 0
  let count = 0
  const firstIds: string[] = []
  const lastIds: string[] = []
  while (hasMore) {
    const page: any = await stripe.balanceTransactions.list({
      limit: 100,
      starting_after: startingAfter,
      ...(created ? { created } : {})
    })
    for (const t of page.data) {
      const type = (t as any).type
      if (type === 'charge' || type === 'refund' || type === 'dispute' || type === 'dispute_reversal') {
        totalMinor += Number((t as any).amount || 0) - Number((t as any).fee || 0) // net
        count++
        if (firstIds.length < 3) firstIds.push((t as any).id)
        lastIds[0] = (t as any).id
      }
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }
  return { amount: totalMinor / 100, count, firstIds, lastIds }
}

async function sumChargesMinusRefunds(created?: { gte?: number; lt?: number }) {
  let hasMore = true
  let startingAfter: string | undefined
  let grossMinor = 0
  let refundedMinor = 0
  let count = 0
  while (hasMore) {
    const page: any = await stripe.charges.list({ limit: 100, starting_after: startingAfter, ...(created ? { created } : {}) })
    for (const ch of page.data) {
      if ((ch as any).status === 'succeeded' || (ch as any).paid === true) {
        grossMinor += Number(ch.amount || 0)
        refundedMinor += Number((ch as any).amount_refunded || 0)
        count++
      }
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }
  return { amount: (grossMinor - refundedMinor) / 100, count }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    // Parse query: month=YYYY-MM, mtd=true, all=true
    const search = req.nextUrl.searchParams
    const monthStr = search.get('month') // e.g. 2025-10 for October
    const wantAll = search.get('all') === 'true'
    const wantMtd = search.get('mtd') === 'true'

    const now = new Date()
    const { start: lastMonthStart, end: thisMonthStart } = getMonthBounds(now.getUTCFullYear(), now.getUTCMonth() - 1)
    const thisMonthStartDate = startOfThisMonthUTC()

    // Windows
    const windows: Record<string, { gte?: number; lt?: number } | undefined> = {}
    if (wantAll) windows.allTime = undefined
    if (wantMtd) windows.mtd = { gte: Math.floor(thisMonthStartDate.getTime()/1000) }
    windows.lastMonth = { gte: Math.floor(lastMonthStart.getTime()/1000), lt: Math.floor(thisMonthStart.getTime()/1000) }
    if (monthStr) {
      const [y, m] = monthStr.split('-').map(Number)
      const { start, end } = getMonthBounds(y, (m - 1))
      windows.custom = { gte: Math.floor(start.getTime()/1000), lt: Math.floor(end.getTime()/1000) }
    }

    const results: Record<string, any> = {}
    for (const [key, created] of Object.entries(windows)) {
      const [salesNet, chargesMinusRefunds] = await Promise.all([
        sumBalanceSalesNet(created),
        sumChargesMinusRefunds(created)
      ])
      results[key] = { salesNet, chargesMinusRefunds }
    }

    // Payouts
    let lastPayout: any = null
    let nextPayout: any = null
    try {
      const paid = await stripe.payouts.list({ status: 'paid', limit: 1 })
      if (paid.data[0]) lastPayout = { amount: paid.data[0].amount / 100, currency: paid.data[0].currency, arrivalDate: new Date(paid.data[0].arrival_date * 1000).toISOString() }
      const pending = await stripe.payouts.list({ status: 'pending', limit: 1 })
      if (pending.data[0]) nextPayout = { amount: pending.data[0].amount / 100, currency: pending.data[0].currency, arrivalDate: new Date(pending.data[0].arrival_date * 1000).toISOString() }
    } catch {}

    return NextResponse.json({
      ok: true,
      mode: 'proof',
      windows: Object.keys(windows),
      results,
      payouts: { last: lastPayout, next: nextPayout }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


