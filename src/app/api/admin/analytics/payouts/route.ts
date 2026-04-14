import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

export const dynamic = 'force-dynamic'

// GET ?account=AURA&month=2026-03 → individual payouts for that month
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN', 'SUPER_ADMIN'].includes(admin.role as any))) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const search = req.nextUrl.searchParams
    const account = (search.get('account') || 'AURA').toUpperCase() as StripeAccountKey
    const month = search.get('month') // YYYY-MM

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month parameter required (YYYY-MM)' }, { status: 400 })
    }

    const [year, mon] = month.split('-').map(Number)
    const startDate = new Date(Date.UTC(year, mon - 1, 1))
    const endDate = new Date(Date.UTC(year, mon, 1))
    const startUnix = Math.floor(startDate.getTime() / 1000)
    const endUnix = Math.floor(endDate.getTime() / 1000)

    // For 'ALL' account, fetch from all 4 accounts
    const accounts: StripeAccountKey[] = account === 'ALL' as any
      ? ['SU', 'IQ', 'AURA', 'AURAUP']
      : [account]

    const allPayouts: Array<{ id: string; amount: number; date: string; account: string; status: string }> = []

    await Promise.all(accounts.map(async (acct) => {
      try {
        const stripe = getStripeClient(acct)
        let hasMore = true
        let startingAfter: string | undefined

        while (hasMore) {
          const batch: any = await stripe.payouts.list({
            limit: 100,
            starting_after: startingAfter,
            arrival_date: { gte: startUnix, lt: endUnix }
          })

          for (const po of batch.data) {
            allPayouts.push({
              id: po.id,
              amount: Number(po.amount) / 100,
              date: new Date(Number(po.arrival_date) * 1000).toISOString().split('T')[0],
              account: acct,
              status: po.status
            })
          }

          hasMore = batch.has_more
          startingAfter = batch.data[batch.data.length - 1]?.id
        }
      } catch (e) {
        console.error(`Failed to fetch payouts for ${acct}:`, e)
      }
    }))

    // Sort by date descending
    allPayouts.sort((a, b) => b.date.localeCompare(a.date))

    const totalPaid = allPayouts
      .filter(p => p.status === 'paid')
      .reduce((sum, p) => sum + p.amount, 0)

    return NextResponse.json({
      ok: true,
      month,
      account,
      payouts: allPayouts,
      totalPaid: Math.round(totalPaid * 100) / 100,
      count: allPayouts.length
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}
