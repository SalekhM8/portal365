import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const revalidate = 0

function startOfMonthUTC(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0))
}

async function sumChargesMinusRefunds(account: StripeAccountKey, created?: { gte?: number; lt?: number }) {
  const stripe = getStripeClient(account)
  let hasMore = true
  let startingAfter: string | undefined
  let grossMinor = 0
  let refundedMinor = 0
  while (hasMore) {
    const batch: any = await stripe.charges.list({ limit: 100, starting_after: startingAfter, ...(created ? { created } : {}) })
    for (const ch of batch.data) {
      const succeeded = (ch as any).status === 'succeeded' || (ch as any).paid === true
      if (!succeeded) continue
      grossMinor += Number(ch.amount || 0)
      refundedMinor += Number((ch as any).amount_refunded || 0)
    }
    hasMore = batch.has_more
    startingAfter = batch.data[batch.data.length - 1]?.id
  }
  return (grossMinor - refundedMinor) / 100
}

export async function GET(_req: NextRequest) {
  try {
    // Optional: secure behind admin session if triggered manually
    const session = await getServerSession(authOptions) as any
    if (session?.user?.email) {
      const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
      if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const now = new Date()
    const thisStart = startOfMonthUTC(now)
    const lastStart = startOfMonthUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)))

    // Compute per-account and combined totals
    const [suAll, suLast, suMtd] = await Promise.all([
      sumChargesMinusRefunds('SU'),
      sumChargesMinusRefunds('SU', { gte: Math.floor(lastStart.getTime()/1000), lt: Math.floor(thisStart.getTime()/1000) }),
      sumChargesMinusRefunds('SU', { gte: Math.floor(thisStart.getTime()/1000) })
    ])
    const [iqAll, iqLast, iqMtd] = await Promise.all([
      sumChargesMinusRefunds('IQ'),
      sumChargesMinusRefunds('IQ', { gte: Math.floor(lastStart.getTime()/1000), lt: Math.floor(thisStart.getTime()/1000) }),
      sumChargesMinusRefunds('IQ', { gte: Math.floor(thisStart.getTime()/1000) })
    ])
    const allTime = suAll + iqAll
    const lastMonth = suLast + iqLast
    const mtd = suMtd + iqMtd

    const payloadTotal = JSON.stringify({ amount: allTime, fetchedAt: new Date().toISOString() })
    const payloadLast = JSON.stringify({ amount: lastMonth, fetchedAt: new Date().toISOString() })
    const payloadThis = JSON.stringify({ amount: mtd, fetchedAt: new Date().toISOString() })

    // Persist ALL, SU, IQ
    await Promise.all([
      // Combined
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime' }, update: { value: payloadTotal }, create: { key: 'metrics:ledger:totalNetAllTime', value: payloadTotal, category: 'metrics', description: 'Stripe net all time (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet' }, update: { value: payloadLast }, create: { key: 'metrics:ledger:lastMonthNet', value: payloadLast, category: 'metrics', description: 'Stripe net last month (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet' }, update: { value: payloadThis }, create: { key: 'metrics:ledger:thisMonthNet', value: payloadThis, category: 'metrics', description: 'Stripe net this month (ALL, MTD)' } }),
      // SU
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime:SU' }, update: { value: JSON.stringify({ amount: suAll, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:totalNetAllTime:SU', value: JSON.stringify({ amount: suAll, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net all time (SU)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet:SU' }, update: { value: JSON.stringify({ amount: suLast, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:lastMonthNet:SU', value: JSON.stringify({ amount: suLast, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net last month (SU)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet:SU' }, update: { value: JSON.stringify({ amount: suMtd, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:thisMonthNet:SU', value: JSON.stringify({ amount: suMtd, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net this month (SU, MTD)' } }),
      // IQ
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime:IQ' }, update: { value: JSON.stringify({ amount: iqAll, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:totalNetAllTime:IQ', value: JSON.stringify({ amount: iqAll, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net all time (IQ)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet:IQ' }, update: { value: JSON.stringify({ amount: iqLast, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:lastMonthNet:IQ', value: JSON.stringify({ amount: iqLast, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net last month (IQ)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet:IQ' }, update: { value: JSON.stringify({ amount: iqMtd, fetchedAt: new Date().toISOString() }) }, create: { key: 'metrics:ledger:thisMonthNet:IQ', value: JSON.stringify({ amount: iqMtd, fetchedAt: new Date().toISOString() }), category: 'metrics', description: 'Stripe net this month (IQ, MTD)' } })
    ])

    return NextResponse.json({ ok: true, totals: { allTime, lastMonth, mtd }, su: { allTime: suAll, lastMonth: suLast, mtd: suMtd }, iq: { allTime: iqAll, lastMonth: iqLast, mtd: iqMtd } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}


