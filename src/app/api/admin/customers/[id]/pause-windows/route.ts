import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { 
  calculatePauseCredit, 
  calculateSettlementBreakdown,
  validatePauseWindow,
  decimalToNumber 
} from '@/lib/pause-credits'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * PAUSE WINDOWS API - Date-based pause scheduling with credit-forward billing
 * 
 * GET: List all pause windows for a subscription
 * POST: Create a new pause window
 * DELETE: Cancel a scheduled pause window
 */

// GET - List pause windows for a customer's subscription
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
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

    const params = await context.params
    const customerId = params.id

    // Find customer's subscription
    const subscription = await prisma.subscription.findFirst({
      where: { 
        userId: customerId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'] }
      },
      select: { id: true, monthlyPrice: true, membershipType: true }
    })

    if (!subscription) {
      return NextResponse.json({ 
        error: 'No active subscription found',
        pauseWindows: [] 
      }, { status: 404 })
    }

    // Get all pause windows (only those with dates set - migrated format)
    const pauseWindows = await (prisma as any).subscriptionPauseWindow.findMany({
      where: { 
        subscriptionId: subscription.id,
        startDate: { not: null },
        endDate: { not: null }
      },
      orderBy: { startDate: 'desc' }
    })

    // Calculate credit preview for each window
    const windowsWithCredits = pauseWindows
      .filter((window: any) => window.startDate && window.endDate)
      .map((window: any) => {
        const credit = calculatePauseCredit({
          startDate: new Date(window.startDate),
          endDate: new Date(window.endDate),
          monthlyPrice: decimalToNumber(subscription.monthlyPrice)
        })

        return {
          id: window.id,
          startDate: window.startDate,
          endDate: window.endDate,
          pausedDays: window.pausedDays ?? credit.pausedDays,
          creditAmount: window.creditAmount ? decimalToNumber(window.creditAmount) : credit.creditAmount,
          creditAppliedAt: window.creditAppliedAt,
          stripeInvoiceItemId: window.stripeInvoiceItemId,
          status: window.status,
          reason: window.reason,
          createdBy: window.createdBy,
          createdAt: window.createdAt
        }
      })

    return NextResponse.json({
      success: true,
      subscriptionId: subscription.id,
      membershipType: subscription.membershipType,
      monthlyPrice: decimalToNumber(subscription.monthlyPrice),
      pauseWindows: windowsWithCredits
    })

  } catch (error: any) {
    console.error('Error fetching pause windows:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to fetch pause windows' 
    }, { status: 500 })
  }
}

// POST - Create a new pause window
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const params = await context.params
    const customerId = params.id
    const body = await request.json()

    const { startDate, endDate, reason } = body

    if (!startDate || !endDate) {
      return NextResponse.json({ 
        error: 'startDate and endDate are required' 
      }, { status: 400 })
    }

    // Parse dates
    const start = new Date(startDate)
    const end = new Date(endDate)

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return NextResponse.json({ 
        error: 'Invalid date format' 
      }, { status: 400 })
    }

    // Find customer's subscription
    const subscription = await prisma.subscription.findFirst({
      where: { 
        userId: customerId,
        status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'] }
      },
      include: { user: true }
    })

    if (!subscription) {
      return NextResponse.json({ 
        error: 'No active subscription found for this customer' 
      }, { status: 404 })
    }

    // Get existing pause windows for overlap check (only with dates)
    const existingWindows = await (prisma as any).subscriptionPauseWindow.findMany({
      where: { 
        subscriptionId: subscription.id,
        status: { not: 'CANCELLED' },
        startDate: { not: null },
        endDate: { not: null }
      }
    })

    // Validate the pause window
    const validation = validatePauseWindow(start, end, existingWindows.filter((w: any) => w.startDate && w.endDate))
    if (!validation.valid) {
      return NextResponse.json({ 
        error: validation.error 
      }, { status: 400 })
    }

    // Calculate settlement breakdown (only partial months need credits)
    const settlement = calculateSettlementBreakdown({
      startDate: start,
      endDate: end,
      monthlyPrice: decimalToNumber(subscription.monthlyPrice)
    })

    // Check if pause should start IMMEDIATELY (today or past)
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const startNormalized = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
    const shouldStartImmediately = startNormalized <= today

    // Create the pause window
    const pauseWindow = await (prisma as any).subscriptionPauseWindow.create({
      data: {
        subscriptionId: subscription.id,
        startDate: start,
        endDate: end,
        pausedDays: settlement.totalDays,
        creditAmount: settlement.totalSettlementAmount,
        status: shouldStartImmediately ? 'ACTIVE' : 'SCHEDULED',
        reason: reason || null,
        createdBy: `${adminUser.firstName} ${adminUser.lastName}`
      }
    })

    let stripePaused = false
    let stripeError: string | null = null

    // If pause starts today or earlier, apply pause_collection to Stripe IMMEDIATELY
    if (shouldStartImmediately && subscription.stripeSubscriptionId) {
      try {
        const stripe = getStripeClient((subscription.stripeAccountKey as StripeAccountKey) || 'SU')
        
        // Calculate resume date (day after end date)
        const resumeDate = new Date(end)
        resumeDate.setUTCDate(resumeDate.getUTCDate() + 1)
        const resumeTimestamp = Math.floor(resumeDate.getTime() / 1000)

        // Apply pause_collection with automatic resume
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          pause_collection: {
            behavior: 'void',
            resumes_at: resumeTimestamp
          }
        })

        stripePaused = true
        console.log(`✅ Applied pause_collection to Stripe subscription ${subscription.stripeSubscriptionId}, resumes at ${resumeDate.toISOString()}`)

        // Update local subscription status
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'PAUSED' }
        })

        // Also update membership status
        await prisma.membership.updateMany({
          where: { userId: subscription.userId },
          data: { status: 'PAUSED' }
        })

      } catch (stripeErr: any) {
        console.error('❌ Failed to apply pause_collection in Stripe:', stripeErr)
        stripeError = stripeErr.message
        // Don't fail the whole request - the pause window is still created
      }
    }

    // Create audit log
    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: subscription.id,
          action: shouldStartImmediately ? 'PAUSE_STARTED' : 'PAUSE_WINDOW_CREATED',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: reason || (shouldStartImmediately ? 'Pause started immediately' : 'Scheduled pause window'),
          operationId: `pause_window_${pauseWindow.id}`,
          metadata: JSON.stringify({
            pauseWindowId: pauseWindow.id,
            startDate: start.toISOString(),
            endDate: end.toISOString(),
            totalDays: settlement.totalDays,
            fullMonthsSkipped: settlement.fullMonthsSkipped,
            partialMonths: settlement.partialMonths,
            settlementAmount: settlement.totalSettlementAmount,
            startedImmediately: shouldStartImmediately,
            stripePaused
          })
        }
      })
    } catch (auditError) {
      console.warn('Failed to create audit log:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: shouldStartImmediately 
        ? `Pause started! ${stripePaused ? 'Stripe billing paused.' : ''} ${settlement.description}`
        : settlement.description,
      pauseWindow: {
        id: pauseWindow.id,
        startDate: pauseWindow.startDate,
        endDate: pauseWindow.endDate,
        totalDays: settlement.totalDays,
        fullMonthsSkipped: settlement.fullMonthsSkipped,
        partialMonths: settlement.partialMonths,
        settlementAmount: settlement.totalSettlementAmount,
        status: shouldStartImmediately ? 'ACTIVE' : 'SCHEDULED',
        startedImmediately: shouldStartImmediately,
        stripePaused,
        stripeError,
        customerName: `${subscription.user.firstName} ${subscription.user.lastName}`,
        customerEmail: subscription.user.email
      }
    })

  } catch (error: any) {
    console.error('Error creating pause window:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to create pause window' 
    }, { status: 500 })
  }
}

// DELETE - Cancel a scheduled pause window
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { searchParams } = new URL(request.url)
    const windowId = searchParams.get('windowId')

    if (!windowId) {
      return NextResponse.json({ 
        error: 'windowId query parameter is required' 
      }, { status: 400 })
    }

    // Find the pause window with subscription details
    const pauseWindow = await (prisma as any).subscriptionPauseWindow.findUnique({
      where: { id: windowId },
      include: { 
        subscription: {
          include: { user: true }
        }
      }
    })

    if (!pauseWindow) {
      return NextResponse.json({ 
        error: 'Pause window not found' 
      }, { status: 404 })
    }

    const sub = pauseWindow.subscription

    // Can cancel SCHEDULED or ACTIVE pauses (but not CREDIT_APPLIED or CANCELLED)
    if (!['SCHEDULED', 'ACTIVE'].includes(pauseWindow.status)) {
      return NextResponse.json({ 
        error: `Cannot cancel pause window with status: ${pauseWindow.status}. Only SCHEDULED or ACTIVE windows can be cancelled.` 
      }, { status: 400 })
    }

    const wasActive = pauseWindow.status === 'ACTIVE'
    let stripeResumed = false

    // If pause was ACTIVE, we need to resume billing in Stripe
    if (wasActive && sub.stripeSubscriptionId) {
      try {
        const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
        
        // Remove pause_collection to resume billing
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          pause_collection: null
        })
        
        stripeResumed = true
        console.log(`▶️ Resumed billing early for ${sub.user.email}`)

        // Update subscription status back to ACTIVE
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'ACTIVE' }
        })

        // Update membership status
        await prisma.membership.updateMany({
          where: { userId: sub.userId },
          data: { status: 'ACTIVE' }
        })

      } catch (stripeErr: any) {
        console.error('Failed to resume Stripe billing:', stripeErr)
        // Don't fail - still cancel the window
      }
    }

    // Calculate partial credit for days actually paused (if ACTIVE)
    let partialCredit = 0
    if (wasActive && pauseWindow.startDate) {
      const today = new Date()
      today.setUTCHours(0, 0, 0, 0)
      const startDate = new Date(pauseWindow.startDate)
      
      // Only calculate credit if pause actually started
      if (startDate <= today) {
        const actualEndDate = new Date(today)
        actualEndDate.setDate(actualEndDate.getDate() - 1) // Yesterday was last paused day
        
        if (actualEndDate >= startDate) {
          const { calculateSettlementBreakdown, decimalToNumber: toNum } = require('@/lib/pause-credits')
          const settlement = calculateSettlementBreakdown({
            startDate,
            endDate: actualEndDate,
            monthlyPrice: toNum(sub.monthlyPrice)
          })
          partialCredit = settlement.totalSettlementAmount
        }
      }
    }

    // Update to cancelled
    await (prisma as any).subscriptionPauseWindow.update({
      where: { id: windowId },
      data: { 
        status: 'CANCELLED',
        // Store actual end date if was active
        ...(wasActive && { 
          endDate: new Date(),
          creditAmount: partialCredit
        })
      }
    })

    // Create audit log
    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: pauseWindow.subscriptionId,
          action: wasActive ? 'PAUSE_RESUMED_EARLY' : 'PAUSE_WINDOW_CANCELLED',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: wasActive ? 'Pause ended early by admin' : 'Scheduled pause cancelled by admin',
          operationId: `pause_cancel_${windowId}`,
          metadata: JSON.stringify({
            pauseWindowId: windowId,
            wasActive,
            stripeResumed,
            partialCredit,
            originalStartDate: pauseWindow.startDate,
            originalEndDate: pauseWindow.endDate
          })
        }
      })
    } catch (auditError) {
      console.warn('Failed to create audit log:', auditError)
    }

    return NextResponse.json({
      success: true,
      message: wasActive 
        ? `Pause ended early. Billing resumed.${partialCredit > 0 ? ` Partial credit: £${partialCredit.toFixed(2)}` : ''}`
        : 'Scheduled pause cancelled successfully',
      windowId,
      wasActive,
      stripeResumed,
      partialCredit
    })

  } catch (error: any) {
    console.error('Error cancelling pause window:', error)
    return NextResponse.json({ 
      error: error.message || 'Failed to cancel pause window' 
    }, { status: 500 })
  }
}

