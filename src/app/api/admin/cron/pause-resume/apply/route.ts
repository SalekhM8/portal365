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

    let paused = 0
    let resumed = 0

    // Delegates (TS-safe)
    const pw = (prisma as any).subscriptionPauseWindow

    // Apply PAUSE for next month windows (both explicit and open-ended masters)
    const pauseWindows = await pw.findMany({
      where: { year: nextYear, month: nextMonth, appliedPauseAt: null },
      include: { subscription: true }
    })

    for (const w of pauseWindows) {
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          pause_collection: { behavior: (w.pauseBehavior as any) || 'void' }
        })

        if (w.pauseBehavior === 'void') {
          try {
            const invoices = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 3 })
            for (const inv of invoices.data) {
              if (inv.status === 'open') {
                await stripe.invoices.voidInvoice(inv.id as string)
              }
            }
          } catch {}
        }

        await prisma.$transaction(async (tx) => {
          const tPW = (tx as any).subscriptionPauseWindow
          const tAudit = (tx as any).subscriptionAuditLog
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: 'PAUSED' }
          })
          await tx.membership.updateMany({
            where: { userId: sub.userId, status: { in: ['ACTIVE','SUSPENDED'] } },
            data: { status: 'SUSPENDED' }
          })
          await tPW.update({
            where: { id: w.id },
            data: { appliedPauseAt: new Date() }
          })
          try {
            await tAudit.create({
              data: {
                subscriptionId: sub.id,
                action: 'PAUSE_AUTO_APPLY',
                performedBy: 'SYSTEM',
                performedByName: 'System Cron',
                reason: 'Scheduled pause window',
                operationId: `pause_auto_${sub.id}_${Date.now()}`,
                metadata: JSON.stringify({ window: { year: w.year, month: w.month }, pauseBehavior: w.pauseBehavior })
              }
            })
          } catch {}
        })
        paused++
      } catch (e) {
        // continue; will be retried in verify
      }
    }

    // Open-ended: ensure a concrete row exists for nextMonth and apply pause
    const openEndedMasters = await pw.findMany({
      where: {
        openEnded: true,
        closedAt: null,
        OR: [
          { year: { lt: nextYear } },
          { year: nextYear, month: { lte: nextMonth } }
        ]
      },
      include: { subscription: true }
    })
    for (const master of openEndedMasters) {
      // If master is for an earlier month than nextMonth, ensure a concrete window exists for nextMonth
      const isMasterThisNext =
        master.year === nextYear && master.month === nextMonth
      if (isMasterThisNext) continue
      try {
        const existingConcrete = await pw.findUnique({
          where: {
            subscriptionId_year_month: {
              subscriptionId: master.subscriptionId,
              year: nextYear,
              month: nextMonth
            }
          }
        })
        if (!existingConcrete) {
          await pw.create({
            data: {
              subscriptionId: master.subscriptionId,
              year: nextYear,
              month: nextMonth,
              pauseBehavior: master.pauseBehavior,
              openEnded: false
            }
          })
        }
      } catch {}
    }

    // Apply RESUME for next month when previous month was a pause window
    const prevWindows = await pw.findMany({
      where: { year: prevYear, month: prevMonth, appliedPauseAt: { not: null }, appliedResumeAt: null },
      include: { subscription: true }
    })
    for (const w of prevWindows) {
      // Only resume if there is no window for next month (i.e., pause ends)
      const hasNextPaused = await pw.findUnique({
        where: { subscriptionId_year_month: { subscriptionId: w.subscriptionId, year: nextYear, month: nextMonth } }
      })
      // Also consider open-ended masters still open as "has next paused"
      const hasOpenEnded = await pw.findFirst({
        where: {
          subscriptionId: w.subscriptionId,
          openEnded: true,
          closedAt: null,
          OR: [
            { year: { lt: nextYear } },
            { year: nextYear, month: { lte: nextMonth } }
          ]
        }
      })
      if (hasNextPaused || hasOpenEnded) continue
      const sub = w.subscription as any
      try {
        const stripe = getStripeClient((sub?.stripeAccountKey as any) || 'SU')
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          pause_collection: null,
          proration_behavior: 'none'
        })
        try {
          const invoices = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 1 })
          const open = invoices.data.find(i => i.status === 'open')
          if (open && open.id) await stripe.invoices.pay(open.id as string)
        } catch {}

        await prisma.$transaction(async (tx) => {
          const tPW = (tx as any).subscriptionPauseWindow
          const tAudit = (tx as any).subscriptionAuditLog
          await tx.subscription.update({
            where: { id: sub.id },
            data: { status: 'ACTIVE' }
          })
          await tx.membership.updateMany({
            where: { userId: sub.userId, status: { in: ['SUSPENDED','ACTIVE'] } },
            data: { status: 'ACTIVE' }
          })
          await tPW.update({
            where: { id: w.id },
            data: { appliedResumeAt: new Date() }
          })
          try {
            await tAudit.create({
              data: {
                subscriptionId: sub.id,
                action: 'RESUME_AUTO_APPLY',
                performedBy: 'SYSTEM',
                performedByName: 'System Cron',
                reason: 'Scheduled pause window ended',
                operationId: `resume_auto_${sub.id}_${Date.now()}`,
                metadata: JSON.stringify({ prevWindow: { year: w.year, month: w.month } })
              }
            })
          } catch {}
        })
        resumed++
      } catch (e) {
        // continue; will be retried in verify
      }
    }

    return NextResponse.json({ success: true, paused, resumed, next: { year: nextYear, month: nextMonth } })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'apply failed' }, { status: 500 })
  }
}


