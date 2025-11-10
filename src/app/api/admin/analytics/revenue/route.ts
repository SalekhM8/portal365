import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

// Force fresh for accuracy; the caller (dashboard) can cache as needed
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'

function monthBoundsUTC(year: number, month0: number) {
  const start = new Date(Date.UTC(year, month0, 1, 0, 0, 0))
  const end = new Date(Date.UTC(year, month0 + 1, 1, 0, 0, 0))
  return { start, end }
}

async function sumChargesMinusRefunds(account: StripeAccountKey, created?: { gte?: number; lt?: number }) {
  const stripe = getStripeClient(account)
  let hasMore = true
  let startingAfter: string | undefined
  let grossMinor = 0
  let refundedMinor = 0
  let charges = 0
  let refunds = 0
  while (hasMore) {
    const page: any = await stripe.charges.list({ limit: 100, starting_after: startingAfter, ...(created ? { created } : {}) })
    for (const ch of page.data) {
      const succeeded = (ch as any).status === 'succeeded' || (ch as any).paid === true
      if (!succeeded) continue
      const amt = Number(ch.amount || 0)
      const ref = Number((ch as any).amount_refunded || 0)
      grossMinor += amt
      refundedMinor += ref
      if (amt) charges += amt / 100
      if (ref) refunds += ref / 100
    }
    hasMore = page.has_more
    startingAfter = page.data[page.data.length - 1]?.id
  }
  return { totalNet: (grossMinor - refundedMinor) / 100, charges, refunds }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const search = req.nextUrl.searchParams
    const monthsParam = Number(search.get('months') || 12)
    const accountParam = (search.get('account') || 'SU').toUpperCase() as StripeAccountKey | 'ALL'
    const fromParam = search.get('from') // YYYY-MM
    const toParam = search.get('to') // YYYY-MM

    let range: Array<{ y: number; m0: number }> = []
    if (fromParam && toParam) {
      const [fy, fm] = fromParam.split('-').map(Number)
      const [ty, tm] = toParam.split('-').map(Number)
      const start = new Date(Date.UTC(fy, fm - 1, 1))
      const end = new Date(Date.UTC(ty, tm - 1, 1))
      const cursor = new Date(start)
      while (cursor <= end) {
        range.push({ y: cursor.getUTCFullYear(), m0: cursor.getUTCMonth() })
        cursor.setUTCMonth(cursor.getUTCMonth() + 1)
      }
    } else {
      const now = new Date()
      for (let i = monthsParam - 1; i >= 0; i--) {
        const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1))
        range.push({ y: d.getUTCFullYear(), m0: d.getUTCMonth() })
      }
    }

    const out: Array<{ month: string; totalNet: number; charges: number; refunds: number }> = []
    for (const r of range) {
      const { start, end } = monthBoundsUTC(r.y, r.m0)
      const window = { gte: Math.floor(start.getTime()/1000), lt: Math.floor(end.getTime()/1000) }
      if (accountParam === 'ALL') {
        const su = await sumChargesMinusRefunds('SU', window)
        const iq = await sumChargesMinusRefunds('IQ', window)
        out.push({ month: `${r.y}-${String(r.m0+1).padStart(2,'0')}`, totalNet: su.totalNet + iq.totalNet, charges: su.charges + iq.charges, refunds: su.refunds + iq.refunds })
      } else {
        const { totalNet, charges, refunds } = await sumChargesMinusRefunds(accountParam as StripeAccountKey, window)
        out.push({ month: `${r.y}-${String(r.m0+1).padStart(2,'0')}`, totalNet, charges, refunds })
      }
    }

    return NextResponse.json({ ok: true, months: out })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


