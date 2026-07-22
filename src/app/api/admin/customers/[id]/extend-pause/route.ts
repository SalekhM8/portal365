import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

const MAX_TOTAL_PAUSE_DAYS = 92 // ~3 months from the original pause start

// POST { newEndDate: 'YYYY-MM-DD', reason } — extend an active pause window.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id: customerId } = await context.params
    const body = await request.json().catch(() => ({}))
    const reason: string = (body?.reason || '').toString().trim()
    const newEnd = body?.newEndDate ? new Date(body.newEndDate + 'T00:00:00.000Z') : null
    if (!newEnd || isNaN(newEnd.getTime())) return NextResponse.json({ error: 'newEndDate (YYYY-MM-DD) required' }, { status: 400 })
    if (!reason || reason.length < 3) return NextResponse.json({ error: 'Reason required' }, { status: 400 })

    // Find the PAUSED subscription + its active window
    const sub = await prisma.subscription.findFirst({ where: { userId: customerId, status: 'PAUSED' } })
    if (!sub) return NextResponse.json({ error: 'No paused subscription for this customer' }, { status: 404 })
    const window = await prisma.subscriptionPauseWindow.findFirst({
      where: { subscriptionId: sub.id, status: { in: ['ACTIVE', 'SCHEDULED'] }, closedAt: null, endDate: { not: null } },
      orderBy: { createdAt: 'desc' },
    })
    if (!window || !window.startDate || !window.endDate) return NextResponse.json({ error: 'No active pause window found' }, { status: 404 })

    // Guards: extend only forwards; cap total pause length
    if (newEnd <= window.endDate) {
      return NextResponse.json({ error: `New end date must be after the current end (${window.endDate.toISOString().slice(0, 10)}). To end a pause early, use Resume.` }, { status: 400 })
    }
    const totalDays = Math.ceil((newEnd.getTime() - window.startDate.getTime()) / 86_400_000) + 1
    if (totalDays > MAX_TOTAL_PAUSE_DAYS) {
      return NextResponse.json({ error: `That would make the pause ${totalDays} days total — the cap is ${MAX_TOTAL_PAUSE_DAYS} days (~3 months) from the original start (${window.startDate.toISOString().slice(0, 10)}).` }, { status: 400 })
    }

    // 1. Stripe: push resumes_at (same convention the pause cron uses: resume on endDate so the next 1st bills)
    if (sub.stripeSubscriptionId?.startsWith('sub_')) {
      const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
      await stripe.subscriptions.update(sub.stripeSubscriptionId, {
        pause_collection: { behavior: (window.pauseBehavior as any) || 'void', resumes_at: Math.floor(newEnd.getTime() / 1000) },
      })
    }

    // 2. Window + display date
    const pausedDays = totalDays
    const nextBilling = new Date(newEnd.getTime() + 86_400_000)
    await prisma.$transaction([
      prisma.subscriptionPauseWindow.update({ where: { id: window.id }, data: { endDate: newEnd, pausedDays } }),
      prisma.subscription.update({ where: { id: sub.id }, data: { nextBillingDate: nextBilling } }),
    ])

    // 3. Audit
    await prisma.subscriptionAuditLog.create({
      data: {
        subscriptionId: sub.id,
        action: 'PAUSE_EXTENDED',
        performedBy: admin.id,
        performedByName: `${admin.firstName} ${admin.lastName}`,
        reason,
        operationId: `extend_pause_${window.id}_${Date.now()}`,
        metadata: JSON.stringify({ pauseWindowId: window.id, oldEndDate: window.endDate.toISOString().slice(0, 10), newEndDate: newEnd.toISOString().slice(0, 10) }),
      },
    }).catch(() => {})

    return NextResponse.json({
      success: true,
      message: `Pause extended to ${newEnd.toISOString().slice(0, 10)}. Billing resumes then; first charge on ${nextBilling.toISOString().slice(0, 10)}.`,
      window: { id: window.id, startDate: window.startDate.toISOString().slice(0, 10), endDate: newEnd.toISOString().slice(0, 10) },
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Extend pause failed' }, { status: 500 })
  }
}
