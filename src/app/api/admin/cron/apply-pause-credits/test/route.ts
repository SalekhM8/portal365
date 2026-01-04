import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePauseCredit, decimalToNumber } from '@/lib/pause-credits'

/**
 * TEST ENDPOINT: Preview and test pause credit calculations
 * 
 * This endpoint allows admins to:
 * 1. View all pending pause windows
 * 2. Preview what credits will be applied
 * 3. Manually trigger the cron job with a test date
 * 
 * GET /api/admin/cron/apply-pause-credits/test
 *   - Lists all pending pause windows with credit calculations
 * 
 * POST /api/admin/cron/apply-pause-credits/test
 *   - Triggers the cron job with optional testDate parameter
 */

export async function GET(request: NextRequest) {
  try {
    // Auth check
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)

    // Get all pause windows
    const allWindows = await (prisma as any).subscriptionPauseWindow.findMany({
      include: {
        subscription: {
          include: {
            user: {
              select: { id: true, email: true, firstName: true, lastName: true }
            }
          }
        }
      },
      orderBy: { startDate: 'desc' }
    })

    // Group by status
    const pending: any[] = []
    const creditApplied: any[] = []
    const completed: any[] = []
    const cancelled: any[] = []

    for (const window of allWindows) {
      const sub = window.subscription
      const credit = calculatePauseCredit({
        startDate: new Date(window.startDate),
        endDate: new Date(window.endDate),
        monthlyPrice: decimalToNumber(sub.monthlyPrice)
      })

      const windowData = {
        id: window.id,
        subscriptionId: window.subscriptionId,
        customer: {
          id: sub.user.id,
          name: `${sub.user.firstName} ${sub.user.lastName}`,
          email: sub.user.email
        },
        membershipType: sub.membershipType,
        monthlyPrice: decimalToNumber(sub.monthlyPrice),
        startDate: window.startDate,
        endDate: window.endDate,
        pausedDays: credit.pausedDays,
        creditAmount: credit.creditAmount,
        creditPence: credit.creditPence,
        creditDescription: credit.description,
        breakdown: credit.breakdown,
        stripeInvoiceItemId: window.stripeInvoiceItemId,
        creditAppliedAt: window.creditAppliedAt,
        reason: window.reason,
        createdBy: window.createdBy,
        createdAt: window.createdAt,
        endDatePassed: new Date(window.endDate) <= today
      }

      switch (window.status) {
        case 'SCHEDULED':
          pending.push(windowData)
          break
        case 'CREDIT_APPLIED':
          creditApplied.push(windowData)
          break
        case 'COMPLETED':
          completed.push(windowData)
          break
        case 'CANCELLED':
          cancelled.push(windowData)
          break
      }
    }

    // Find windows ready to process (ended and scheduled)
    const readyToProcess = pending.filter(w => w.endDatePassed)

    return NextResponse.json({
      success: true,
      today: today.toISOString().split('T')[0],
      summary: {
        totalPending: pending.length,
        readyToProcess: readyToProcess.length,
        creditApplied: creditApplied.length,
        completed: completed.length,
        cancelled: cancelled.length
      },
      readyToProcess,
      pending,
      creditApplied,
      completed,
      cancelled
    })

  } catch (error: any) {
    console.error('Test endpoint error:', error)
    return NextResponse.json({ 
      error: error.message || 'Test endpoint failed' 
    }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    // Auth check
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({}))
    const testDate = body.testDate

    // Build the cron URL with test date
    const baseUrl = process.env.NEXTAUTH_URL || 'http://localhost:3000'
    let cronUrl = `${baseUrl}/api/admin/cron/apply-pause-credits`
    if (testDate) {
      cronUrl += `?testDate=${testDate}`
    }

    // Call the cron endpoint
    const cronSecret = process.env.CRON_SECRET || 'test-secret'
    const response = await fetch(cronUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${cronSecret}`
      }
    })

    const result = await response.json()

    return NextResponse.json({
      success: true,
      message: 'Cron job triggered manually',
      testDate: testDate || 'today',
      cronResult: result
    })

  } catch (error: any) {
    console.error('Manual trigger error:', error)
    return NextResponse.json({ 
      error: error.message || 'Manual trigger failed' 
    }, { status: 500 })
  }
}

