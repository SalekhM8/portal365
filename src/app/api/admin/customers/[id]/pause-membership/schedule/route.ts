import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { Prisma } from '@prisma/client'

type Body = {
  reason?: string
  pauseBehavior?: 'void' | 'keep_as_draft' | 'mark_uncollectible'
  startMonth: string // 'YYYY-MM' (UTC)
  endMonth?: string   // 'YYYY-MM' (UTC, inclusive)
  openEnded?: boolean
}

function parseMonth(m: string): { year: number; month: number } {
  // Accept YYYY-MM
  const match = /^(\d{4})-(\d{2})$/.exec((m || '').trim())
  if (!match) throw new Error('Invalid month format, expected YYYY-MM')
  const year = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) throw new Error('Invalid month value')
  return { year, month }
}

function* monthsBetweenInclusive(start: { year: number; month: number }, end: { year: number; month: number }) {
  let y = start.year
  let m = start.month
  while (y < end.year || (y === end.year && m <= end.month)) {
    yield { year: y, month: m }
    m++
    if (m === 13) {
      m = 1
      y++
    }
  }
}

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Authentication required' }, { status: 401 })
    }
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN','SUPER_ADMIN'].includes(adminUser.role as any)) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions' }, { status: 403 })
    }

    const params = await context.params
    const customerId = params.id
    const body = (await request.json()) as Body
    const pauseBehavior = body.pauseBehavior || 'void'
    const openEnded = !!body.openEnded
    if (!['void','keep_as_draft','mark_uncollectible'].includes(pauseBehavior)) {
      return NextResponse.json({ success: false, error: 'Invalid pause behavior' }, { status: 400 })
    }
    if (!body.startMonth) {
      return NextResponse.json({ success: false, error: 'startMonth is required (YYYY-MM)' }, { status: 400 })
    }
    const start = parseMonth(body.startMonth)
    const end = body.endMonth ? parseMonth(body.endMonth) : start
    // Find a relevant subscription for the customer
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE','TRIALING','PAUSED','PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        }
      }
    })
    if (!customer || customer.subscriptions.length === 0) {
      return NextResponse.json({ success: false, error: 'No subscription found for this customer' }, { status: 404 })
    }
    const subscription = customer.subscriptions[0]

    // Create or upsert windows for each month
    const rows: Array<{ year: number; month: number }> = []
    if (openEnded) {
      rows.push(start)
    } else {
      for (const mm of monthsBetweenInclusive(start, end)) {
        rows.push(mm)
      }
      if (!rows.length) {
        return NextResponse.json({ success: false, error: 'No months in the specified range' }, { status: 400 })
      }
    }

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // Work around editor TS inference by grabbing delegates via any.
      const pauseWin = (tx as any).subscriptionPauseWindow
      const auditLog = (tx as any).subscriptionAuditLog
      for (const { year, month } of rows) {
        // Upsert window; leave applied markers intact if exists
        const existing = await pauseWin.findUnique({
          where: { subscriptionId_year_month: { subscriptionId: subscription.id, year, month } }
        })
        if (!existing) {
          await pauseWin.create({
            data: {
              subscriptionId: subscription.id,
              year,
              month,
              pauseBehavior,
              openEnded
            }
          })
        } else {
          // Update behavior only if not yet applied (optional)
          if (!existing.appliedPauseAt) {
            await pauseWin.update({
              where: { id: existing.id },
              data: { pauseBehavior, openEnded }
            })
          }
        }
      }

      // Optional: write audit log entry on the subscription
      try {
        await auditLog.create({
          data: {
            subscriptionId: subscription.id,
            action: 'PAUSE_SCHEDULE_CREATE',
            performedBy: adminUser.id,
            performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
            reason: body.reason || 'Scheduled pause',
            operationId: `pause_schedule_${subscription.id}_${Date.now()}`,
            metadata: JSON.stringify({
              months: rows,
              pauseBehavior,
              openEnded
            })
          }
        })
      } catch {}
    })

    return NextResponse.json({
      success: true,
      message: openEnded
        ? `Scheduled open-ended pause from ${body.startMonth}`
        : `Scheduled pause for ${rows.length} month(s)`,
      months: rows
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to schedule pause' }, { status: 500 })
  }
}


