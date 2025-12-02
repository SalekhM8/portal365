import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTH_LOOKBACK = Number(process.env.STRIPE_METRICS_MONTHS ?? 12)

type MonthWindow = { key: string; startUnix: number; endUnix: number }
type Bucket = { netMinor: number; chargesMinor: number; refundsMinor: number }

function startOfMonthUTC(date: Date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1, 0, 0, 0))
}

function formatMonthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

function buildMonthWindows(count: number): MonthWindow[] {
  const now = new Date()
  const anchor = startOfMonthUTC(now)
  const windows: MonthWindow[] = []
  for (let i = count - 1; i >= 0; i--) {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - i, 1, 0, 0, 0))
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1, 0, 0, 0))
    windows.push({
      key: formatMonthKey(start),
      startUnix: Math.floor(start.getTime() / 1000),
      endUnix: Math.floor(end.getTime() / 1000)
    })
  }
  return windows
}

function mergeBuckets(a?: Bucket, b?: Bucket): Bucket {
  return {
    netMinor: (a?.netMinor ?? 0) + (b?.netMinor ?? 0),
    chargesMinor: (a?.chargesMinor ?? 0) + (b?.chargesMinor ?? 0),
    refundsMinor: (a?.refundsMinor ?? 0) + (b?.refundsMinor ?? 0)
  }
}

const monthlyMetricDelegate = (client: any) => client.monthlyStripeMetric as any

function decimalFromMinor(valueMinor: number) {
  return new Prisma.Decimal((valueMinor / 100).toFixed(2))
}

function bucketToDecimal(bucket?: Bucket) {
  const data = bucket ?? { netMinor: 0, chargesMinor: 0, refundsMinor: 0 }
  return {
    totalNet: decimalFromMinor(data.netMinor),
    charges: decimalFromMinor(data.chargesMinor),
    refunds: decimalFromMinor(data.refundsMinor)
  }
}

async function collectMonthlyBuckets(account: StripeAccountKey, windows: MonthWindow[]) {
  const stripe = getStripeClient(account)
  const buckets = new Map<string, Bucket>()
  const rangeStart = windows[0].startUnix
  const rangeEnd = windows[windows.length - 1].endUnix

  let hasMore = true
  let startingAfter: string | undefined

  while (hasMore) {
    const batch: any = await stripe.charges.list({
      limit: 100,
      starting_after: startingAfter,
      created: { gte: rangeStart, lt: rangeEnd }
    })

    for (const ch of batch.data) {
      const succeeded = (ch as any).status === 'succeeded' || (ch as any).paid === true
      if (!succeeded) continue
      const createdTs = Number((ch as any).created || 0)
      if (!createdTs || createdTs < rangeStart || createdTs >= rangeEnd) continue
      const key = formatMonthKey(new Date(createdTs * 1000))
      const amountMinor = Number(ch.amount || 0)
      const refundMinor = Number((ch as any).amount_refunded || 0)
      const bucket = buckets.get(key) ?? { netMinor: 0, chargesMinor: 0, refundsMinor: 0 }
      bucket.chargesMinor += amountMinor
      bucket.refundsMinor += refundMinor
      bucket.netMinor += amountMinor - refundMinor
      buckets.set(key, bucket)
    }

    hasMore = batch.has_more
    startingAfter = batch.data[batch.data.length - 1]?.id
  }

  return buckets
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
    const session = await getServerSession(authOptions) as any
    if (session?.user?.email) {
      const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
      if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role as any))) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    const windows = buildMonthWindows(MONTH_LOOKBACK)
    const [suBuckets, iqBuckets] = await Promise.all([
      collectMonthlyBuckets('SU', windows),
      collectMonthlyBuckets('IQ', windows)
    ])

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      const monthlyMetrics = monthlyMetricDelegate(tx)
      for (const window of windows) {
        const key = window.key
        const suVals = bucketToDecimal(suBuckets.get(key))
        const iqVals = bucketToDecimal(iqBuckets.get(key))
        const allVals = bucketToDecimal(mergeBuckets(suBuckets.get(key), iqBuckets.get(key)))

        await monthlyMetrics.upsert({
          where: { account_month: { account: 'SU', month: key } },
          update: { ...suVals, lastUpdatedAt: now },
          create: { account: 'SU', month: key, ...suVals, lastUpdatedAt: now }
        })
        await monthlyMetrics.upsert({
          where: { account_month: { account: 'IQ', month: key } },
          update: { ...iqVals, lastUpdatedAt: now },
          create: { account: 'IQ', month: key, ...iqVals, lastUpdatedAt: now }
        })
        await monthlyMetrics.upsert({
          where: { account_month: { account: 'ALL', month: key } },
          update: { ...allVals, lastUpdatedAt: now },
          create: { account: 'ALL', month: key, ...allVals, lastUpdatedAt: now }
        })
      }
    })

    // Maintain summary metrics for the dashboard hero cards
    const currentMonthStart = startOfMonthUTC(new Date())
    const previousMonthStart = startOfMonthUTC(new Date(Date.UTC(currentMonthStart.getUTCFullYear(), currentMonthStart.getUTCMonth() - 1, 1)))
    const [suAll, suLast, suMtd] = await Promise.all([
      sumChargesMinusRefunds('SU'),
      sumChargesMinusRefunds('SU', { gte: Math.floor(previousMonthStart.getTime() / 1000), lt: Math.floor(currentMonthStart.getTime() / 1000) }),
      sumChargesMinusRefunds('SU', { gte: Math.floor(currentMonthStart.getTime() / 1000) })
    ])
    const [iqAll, iqLast, iqMtd] = await Promise.all([
      sumChargesMinusRefunds('IQ'),
      sumChargesMinusRefunds('IQ', { gte: Math.floor(previousMonthStart.getTime() / 1000), lt: Math.floor(currentMonthStart.getTime() / 1000) }),
      sumChargesMinusRefunds('IQ', { gte: Math.floor(currentMonthStart.getTime() / 1000) })
    ])

    const allTime = suAll + iqAll
    const lastMonth = suLast + iqLast
    const mtd = suMtd + iqMtd
    const payloadTotal = JSON.stringify({ amount: allTime, fetchedAt: now.toISOString() })
    const payloadLast = JSON.stringify({ amount: lastMonth, fetchedAt: now.toISOString() })
    const payloadThis = JSON.stringify({ amount: mtd, fetchedAt: now.toISOString() })

    await Promise.all([
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime' }, update: { value: payloadTotal }, create: { key: 'metrics:ledger:totalNetAllTime', value: payloadTotal, category: 'metrics', description: 'Stripe net all time (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet' }, update: { value: payloadLast }, create: { key: 'metrics:ledger:lastMonthNet', value: payloadLast, category: 'metrics', description: 'Stripe net last month (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet' }, update: { value: payloadThis }, create: { key: 'metrics:ledger:thisMonthNet', value: payloadThis, category: 'metrics', description: 'Stripe net this month (ALL, MTD)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime:SU' }, update: { value: JSON.stringify({ amount: suAll, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:totalNetAllTime:SU', value: JSON.stringify({ amount: suAll, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net all time (SU)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet:SU' }, update: { value: JSON.stringify({ amount: suLast, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:lastMonthNet:SU', value: JSON.stringify({ amount: suLast, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net last month (SU)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet:SU' }, update: { value: JSON.stringify({ amount: suMtd, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:thisMonthNet:SU', value: JSON.stringify({ amount: suMtd, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net this month (SU, MTD)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime:IQ' }, update: { value: JSON.stringify({ amount: iqAll, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:totalNetAllTime:IQ', value: JSON.stringify({ amount: iqAll, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net all time (IQ)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet:IQ' }, update: { value: JSON.stringify({ amount: iqLast, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:lastMonthNet:IQ', value: JSON.stringify({ amount: iqLast, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net last month (IQ)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet:IQ' }, update: { value: JSON.stringify({ amount: iqMtd, fetchedAt: now.toISOString() }) }, create: { key: 'metrics:ledger:thisMonthNet:IQ', value: JSON.stringify({ amount: iqMtd, fetchedAt: now.toISOString() }), category: 'metrics', description: 'Stripe net this month (IQ, MTD)' } })
    ])

    return NextResponse.json({ ok: true, totals: { allTime, lastMonth, mtd }, su: { allTime: suAll, lastMonth: suLast, mtd: suMtd }, iq: { allTime: iqAll, lastMonth: iqLast, mtd: iqMtd } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}

