import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { Prisma } from '@prisma/client'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey, ALL_STRIPE_ACCOUNTS } from '@/lib/stripe'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const MONTH_LOOKBACK = Number(process.env.STRIPE_METRICS_MONTHS ?? 12)

type MonthWindow = { key: string; startUnix: number; endUnix: number }
type Bucket = { netMinor: number; chargesMinor: number; refundsMinor: number; payoutsMinor: number; feesMinor: number }

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
    refundsMinor: (a?.refundsMinor ?? 0) + (b?.refundsMinor ?? 0),
    payoutsMinor: (a?.payoutsMinor ?? 0) + (b?.payoutsMinor ?? 0),
    feesMinor: (a?.feesMinor ?? 0) + (b?.feesMinor ?? 0)
  }
}

const monthlyMetricDelegate = (client: any) => client.monthlyStripeMetric as any

function decimalFromMinor(valueMinor: number) {
  return new Prisma.Decimal((valueMinor / 100).toFixed(2))
}

function bucketToDecimal(bucket?: Bucket) {
  const data = bucket ?? { netMinor: 0, chargesMinor: 0, refundsMinor: 0, payoutsMinor: 0, feesMinor: 0 }
  return {
    totalNet: decimalFromMinor(data.netMinor),
    charges: decimalFromMinor(data.chargesMinor),
    refunds: decimalFromMinor(data.refundsMinor),
    payouts: decimalFromMinor(data.payoutsMinor),
    stripeFees: decimalFromMinor(data.feesMinor)
  }
}

async function collectMonthlyBuckets(account: StripeAccountKey, windows: MonthWindow[]) {
  const stripe = getStripeClient(account)
  const buckets = new Map<string, Bucket>()
  const rangeStart = windows[0].startUnix
  const rangeEnd = windows[windows.length - 1].endUnix

  const emptyBucket = (): Bucket => ({ netMinor: 0, chargesMinor: 0, refundsMinor: 0, payoutsMinor: 0, feesMinor: 0 })

  // 1. Collect charges (existing logic)
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
      const bucket = buckets.get(key) ?? emptyBucket()
      bucket.chargesMinor += amountMinor
      bucket.refundsMinor += refundMinor
      bucket.netMinor += amountMinor - refundMinor
      buckets.set(key, bucket)
    }

    hasMore = batch.has_more
    startingAfter = batch.data[batch.data.length - 1]?.id
  }

  // 2. Collect payouts (grouped by arrival date — what actually hit the bank)
  hasMore = true
  startingAfter = undefined
  while (hasMore) {
    const batch: any = await stripe.payouts.list({
      limit: 100,
      starting_after: startingAfter,
      arrival_date: { gte: rangeStart, lt: rangeEnd },
      status: 'paid'
    })
    for (const po of batch.data) {
      const arrivalTs = Number((po as any).arrival_date || 0)
      if (!arrivalTs || arrivalTs < rangeStart || arrivalTs >= rangeEnd) continue
      const key = formatMonthKey(new Date(arrivalTs * 1000))
      const bucket = buckets.get(key) ?? emptyBucket()
      bucket.payoutsMinor += Number(po.amount || 0)
      buckets.set(key, bucket)
    }
    hasMore = batch.has_more
    startingAfter = batch.data[batch.data.length - 1]?.id
  }

  // 3. Collect Stripe fees from balance transactions
  hasMore = true
  startingAfter = undefined
  while (hasMore) {
    const batch: any = await stripe.balanceTransactions.list({
      limit: 100,
      starting_after: startingAfter,
      created: { gte: rangeStart, lt: rangeEnd },
      type: 'charge'
    })
    for (const bt of batch.data) {
      const createdTs = Number((bt as any).created || 0)
      if (!createdTs || createdTs < rangeStart || createdTs >= rangeEnd) continue
      const key = formatMonthKey(new Date(createdTs * 1000))
      const bucket = buckets.get(key) ?? emptyBucket()
      bucket.feesMinor += Number(bt.fee || 0)
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
    // Collect monthly buckets across all configured Stripe accounts in parallel
    const bucketsByAccount = new Map<StripeAccountKey, Map<string, Bucket>>()
    await Promise.all(ALL_STRIPE_ACCOUNTS.map(async (acct) => {
      const buckets = await collectMonthlyBuckets(acct, windows)
      bucketsByAccount.set(acct, buckets)
    }))

    const now = new Date()
    await prisma.$transaction(async (tx) => {
      const monthlyMetrics = monthlyMetricDelegate(tx)
      for (const window of windows) {
        const key = window.key
        let merged: Bucket | undefined
        for (const acct of ALL_STRIPE_ACCOUNTS) {
          const bucket = bucketsByAccount.get(acct)?.get(key)
          const vals = bucketToDecimal(bucket)
          await monthlyMetrics.upsert({
            where: { account_month: { account: acct, month: key } },
            update: { ...vals, lastUpdatedAt: now },
            create: { account: acct, month: key, ...vals, lastUpdatedAt: now }
          })
          merged = mergeBuckets(merged, bucket)
        }
        const allVals = bucketToDecimal(merged)
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
    const lastMonthRange = { gte: Math.floor(previousMonthStart.getTime() / 1000), lt: Math.floor(currentMonthStart.getTime() / 1000) }
    const mtdRange = { gte: Math.floor(currentMonthStart.getTime() / 1000) }

    type AccountTotals = { allTime: number; lastMonth: number; mtd: number }
    const totalsByAccount = new Map<StripeAccountKey, AccountTotals>()
    await Promise.all(ALL_STRIPE_ACCOUNTS.map(async (acct) => {
      const [allTime, lastMonth, mtd] = await Promise.all([
        sumChargesMinusRefunds(acct),
        sumChargesMinusRefunds(acct, lastMonthRange),
        sumChargesMinusRefunds(acct, mtdRange)
      ])
      totalsByAccount.set(acct, { allTime, lastMonth, mtd })
    }))

    let allTime = 0, lastMonth = 0, mtd = 0
    for (const acct of ALL_STRIPE_ACCOUNTS) {
      const t = totalsByAccount.get(acct)!
      allTime += t.allTime
      lastMonth += t.lastMonth
      mtd += t.mtd
    }

    const fetchedAt = now.toISOString()
    const settingUpserts = [
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:totalNetAllTime' }, update: { value: JSON.stringify({ amount: allTime, fetchedAt }) }, create: { key: 'metrics:ledger:totalNetAllTime', value: JSON.stringify({ amount: allTime, fetchedAt }), category: 'metrics', description: 'Stripe net all time (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:lastMonthNet' }, update: { value: JSON.stringify({ amount: lastMonth, fetchedAt }) }, create: { key: 'metrics:ledger:lastMonthNet', value: JSON.stringify({ amount: lastMonth, fetchedAt }), category: 'metrics', description: 'Stripe net last month (ALL)' } }),
      prisma.systemSetting.upsert({ where: { key: 'metrics:ledger:thisMonthNet' }, update: { value: JSON.stringify({ amount: mtd, fetchedAt }) }, create: { key: 'metrics:ledger:thisMonthNet', value: JSON.stringify({ amount: mtd, fetchedAt }), category: 'metrics', description: 'Stripe net this month (ALL, MTD)' } })
    ]
    for (const acct of ALL_STRIPE_ACCOUNTS) {
      const t = totalsByAccount.get(acct)!
      settingUpserts.push(
        prisma.systemSetting.upsert({ where: { key: `metrics:ledger:totalNetAllTime:${acct}` }, update: { value: JSON.stringify({ amount: t.allTime, fetchedAt }) }, create: { key: `metrics:ledger:totalNetAllTime:${acct}`, value: JSON.stringify({ amount: t.allTime, fetchedAt }), category: 'metrics', description: `Stripe net all time (${acct})` } }),
        prisma.systemSetting.upsert({ where: { key: `metrics:ledger:lastMonthNet:${acct}` }, update: { value: JSON.stringify({ amount: t.lastMonth, fetchedAt }) }, create: { key: `metrics:ledger:lastMonthNet:${acct}`, value: JSON.stringify({ amount: t.lastMonth, fetchedAt }), category: 'metrics', description: `Stripe net last month (${acct})` } }),
        prisma.systemSetting.upsert({ where: { key: `metrics:ledger:thisMonthNet:${acct}` }, update: { value: JSON.stringify({ amount: t.mtd, fetchedAt }) }, create: { key: `metrics:ledger:thisMonthNet:${acct}`, value: JSON.stringify({ amount: t.mtd, fetchedAt }), category: 'metrics', description: `Stripe net this month (${acct}, MTD)` } })
      )
    }
    await Promise.all(settingUpserts)

    const perAccount: Record<string, AccountTotals> = {}
    for (const acct of ALL_STRIPE_ACCOUNTS) perAccount[acct] = totalsByAccount.get(acct)!
    return NextResponse.json({ ok: true, totals: { allTime, lastMonth, mtd }, perAccount })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'failed' }, { status: 500 })
  }
}

