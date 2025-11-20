import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

function getHeaderSecret(request: NextRequest): string | null {
  return request.headers.get('x-cron-secret')
}

function currentMonthUTC(now = new Date()): { year: number; month: number } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  return { year: y, month: m }
}

function prevMonthUTC(now = new Date()): { year: number; month: number } {
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth() + 1
  const pm = m === 1 ? 12 : m - 1
  const py = m === 1 ? y - 1 : y
  return { year: py, month: pm }
}

export async function POST(request: NextRequest) {
  try {
    const secret = getHeaderSecret(request)
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const now = new Date()
    const { year: curYear, month: curMonth } = currentMonthUTC(now)
    const { year: prevYear, month: prevMonth } = prevMonthUTC(now)

    let voided = 0

    // For subscriptions intended to be paused this month, ensure no open invoice exists
    const pausedThisMonth = await prisma.subscriptionPauseWindow.findMany({
      where: { year: curYear, month: curMonth },
      include: { subscription: true }
    })
    for (const w of pausedThisMonth) {
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        if (w.pauseBehavior === 'void') {
          const invoices = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 5 })
          for (const inv of invoices.data) {
            if (inv.status === 'open') {
              await stripe.invoices.voidInvoice(inv.id as string)
              voided++
            }
          }
        }
      } catch {}
    }

    // For subs that were paused last month but not paused this month, ensure they are unpaused
    const lastMonthWindows = await prisma.subscriptionPauseWindow.findMany({
      where: { year: prevYear, month: prevMonth },
      include: { subscription: true }
    })
    for (const w of lastMonthWindows) {
      const hasCurrent = await prisma.subscriptionPauseWindow.findUnique({
        where: { subscriptionId_year_month: { subscriptionId: w.subscriptionId, year: curYear, month: curMonth } }
      })
      if (hasCurrent) continue
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
        if ((s as any)?.pause_collection) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            pause_collection: null,
            proration_behavior: 'none'
          })
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE' } })
          await prisma.subscriptionPauseWindow.update({ where: { id: w.id }, data: { appliedResumeAt: new Date() } })
        }
      } catch {}
    }

    return NextResponse.json({ success: true, voidedOpenInvoices: voided })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'backstop failed' }, { status: 500 })
  }
}


