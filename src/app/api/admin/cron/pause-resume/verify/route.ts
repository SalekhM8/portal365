import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

function getHeaderSecret(request: NextRequest): string | null {
  return request.headers.get('x-cron-secret')
}

function nextMonthUTC(now = new Date()): { year: number; month: number } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const nm = m === 12 ? 1 : m + 1
  const ny = m === 12 ? y + 1 : y
  return { year: ny, month: nm }
}

function prevMonthUTC(now = new Date()): { year: number; month: number } {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
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
    const { year: nextYear, month: nextMonth } = nextMonthUTC(now)
    const { year: prevYear, month: prevMonth } = prevMonthUTC(now)

    let fixes = 0

    // Re-apply missing pauses
    const intended = await prisma.subscriptionPauseWindow.findMany({
      where: { year: nextYear, month: nextMonth },
      include: { subscription: true }
    })
    for (const w of intended) {
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
        const isPaused = !!(s as any)?.pause_collection
        if (!isPaused) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            pause_collection: { behavior: (w.pauseBehavior as any) || 'void' }
          })
          if (w.pauseBehavior === 'void') {
            try {
              const invoices = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 3 })
              for (const inv of invoices.data) if (inv.status === 'open') await stripe.invoices.voidInvoice(inv.id as string)
            } catch {}
          }
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'PAUSED' } })
          fixes++
        }
      } catch {}
    }

    // Re-apply missing resumption for subs that should be active next month
    const prevs = await prisma.subscriptionPauseWindow.findMany({
      where: { year: prevYear, month: prevMonth, appliedPauseAt: { not: null } },
      include: { subscription: true }
    })
    for (const w of prevs) {
      const hasNext = await prisma.subscriptionPauseWindow.findUnique({
        where: { subscriptionId_year_month: { subscriptionId: w.subscriptionId, year: nextYear, month: nextMonth } }
      })
      if (hasNext) continue
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        const s = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
        const isPaused = !!(s as any)?.pause_collection
        if (isPaused) {
          await stripe.subscriptions.update(sub.stripeSubscriptionId, {
            pause_collection: null,
            proration_behavior: 'none'
          })
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE' } })
          await prisma.subscriptionPauseWindow.update({ where: { id: w.id }, data: { appliedResumeAt: new Date() } })
          fixes++
        }
      } catch {}
    }

    return NextResponse.json({ success: true, fixes })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'verify failed' }, { status: 500 })
  }
}


