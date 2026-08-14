import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'
import { chargeProration, prorateRemainderOfMonth } from '@/lib/proration'
import { calculateSettlementBreakdown } from '@/lib/pause-credits'

/**
 * RESUME MEMBERSHIP - Enterprise-grade implementation
 * 
 * Features:
 * - Idempotent operations (safe to retry)
 * - Comprehensive error handling
 * - Audit trail logging
 * - Rollback capability
 * - Billing cycle preservation
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  let operationId = ''
  
  try {
    // 🔐 AUTHENTICATION & AUTHORIZATION
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ 
        success: false, 
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      }, { status: 401 })
    }

    // Verify admin permissions
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })

    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Insufficient permissions - Admin access required',
        code: 'FORBIDDEN'
      }, { status: 403 })
    }

    // 📝 VALIDATE REQUEST
    const params = await context.params
    const customerId = params.id
    const { reason, resumeImmediately = true } = await request.json()

    if (!customerId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Customer ID is required',
        code: 'INVALID_REQUEST'
      }, { status: 400 })
    }

    // 🔍 FIND CUSTOMER & PAUSED SUBSCRIPTION
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: 'PAUSED' },
          include: {
            routedEntity: true
          }
        },
        memberships: {
          where: { status: 'SUSPENDED' }
        }
      }
    })

    if (!customer) {
      return NextResponse.json({ 
        success: false, 
        error: 'Customer not found',
        code: 'CUSTOMER_NOT_FOUND'
      }, { status: 404 })
    }

    const pausedSubscription = customer.subscriptions[0]
    if (!pausedSubscription) {
      return NextResponse.json({ 
        success: false, 
        error: 'No paused subscription found for this customer',
        code: 'NO_PAUSED_SUBSCRIPTION'
      }, { status: 404 })
    }

    // ✅ IDEMPOTENCY CHECK
    const activeSubscription = await prisma.subscription.findFirst({
      where: { 
        userId: customer.id,
        status: 'ACTIVE'
      }
    })

    if (activeSubscription) {
      return NextResponse.json({ 
        success: true, 
        message: 'Membership is already active',
        subscription: {
          id: activeSubscription.id,
          status: 'ACTIVE',
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`
        },
        code: 'ALREADY_ACTIVE'
      })
    }

    // 🎯 CREATE OPERATION ID FOR TRACKING
    operationId = `resume_${pausedSubscription.id}_${Date.now()}`

    console.log(`🔄 [${operationId}] Starting membership resume for customer ${customer.email}`)

    // 📅 SCHEDULED PAUSE WINDOWS (early return): if this pause came from a date-based
    // window, resuming early must settle and CANCEL the window here — otherwise the
    // pause cron re-settles it when the original end date arrives and double-charges.
    const openWindows = await prisma.subscriptionPauseWindow.findMany({
      where: {
        subscriptionId: pausedSubscription.id,
        startDate: { not: null },
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        creditAppliedAt: null
      }
    })
    const now = new Date()
    const firstOfThisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    // If the pause began mid-month IN the current month, this month's invoice was
    // billed in full before pause_collection took effect — the member has already
    // paid for today onwards, so the remainder-of-month charge must be skipped
    // (they're owed a credit for the paused days instead, applied below).
    const paidCurrentMonth = openWindows.some(w =>
      w.startDate! <= now && w.startDate! > firstOfThisMonth
    )

    // 🚀 RESUME STRIPE SUBSCRIPTION
    // Flow: charge proration FIRST, then unpause. If proration fails, subscription stays paused.
    let stripeOperationSuccess = false
    let prorationCharged = 0
    // Use correct Stripe account for this subscription (available to try and rollback scopes)
    const stripeClient = getStripeClient((pausedSubscription as any).stripeAccountKey || 'SU')
    try {
      const account = ((pausedSubscription as any).stripeAccountKey || 'SU')
      const customerId = (pausedSubscription as any).stripeCustomerId as string

      // STEP 2: charge the prorated remainder of THIS month BEFORE resuming.
      // The gym bills on the 1st, so resuming mid-month owes for the days left
      // until the 1st of next month. (Previously this read current_period_end off
      // the subscription object, which is undefined in stripe@18 → NaN → the
      // charge was silently skipped and members resumed for free.)
      const monthlyPrice = Number(pausedSubscription.monthlyPrice) || 0
      const { amountPence, remainingDays, daysInMonth } = prorateRemainderOfMonth(monthlyPrice)
      console.log(`📊 [${operationId}] Resume proration: ${remainingDays}/${daysInMonth} days @ £${monthlyPrice} => £${(amountPence / 100).toFixed(2)}`)

      if (paidCurrentMonth) {
        console.log(`ℹ️ [${operationId}] Pause started mid-month this month — member already paid this month in full, skipping remainder-of-month charge`)
      }
      if (amountPence > 0 && !paidCurrentMonth) {
        // Idempotency key makes this safe to retry — never double-charges.
        const result = await chargeProration({
          account,
          customerId,
          amountPence,
          description: `Resume proration: ${remainingDays} days`,
          metadata: { reason: 'resume_proration', operationId, dbSubscriptionId: pausedSubscription.id },
          idempotencyKey: `resume-proration:${pausedSubscription.id}:${amountPence}`,
        })
        if (!result.paid) {
          // Do NOT unpause for free. Stay paused and surface the failure.
          return NextResponse.json({
            success: false,
            error: `Could not collect the £${(amountPence / 100).toFixed(2)} resume charge (${result.error || 'card declined'}). Member stays paused — ask them to update their card and retry.`,
            code: 'RESUME_PRORATION_FAILED',
            operationId,
          }, { status: 402 })
        }
        prorationCharged = result.amountPaidPence / 100
        console.log(`✅ [${operationId}] Resume proration paid: £${prorationCharged.toFixed(2)} (invoice ${result.invoiceId})`)
      }

      // STEP 3: proration collected (or £0 genuinely owed) — NOW unpause.
      // We do NOT auto-pay any other open invoice here: the resume charge above is
      // the only money owed for resuming; normal Stripe billing handles the rest.
      // (The old "pay any open invoice" sweep could overcharge on top of this.)
      await stripeClient.subscriptions.update(
        pausedSubscription.stripeSubscriptionId,
        { pause_collection: null }
      )

      stripeOperationSuccess = true
      console.log(`✅ [${operationId}] Subscription resumed${prorationCharged > 0 ? ` with £${prorationCharged.toFixed(2)} proration` : ''}`)

    } catch (stripeError: any) {
      console.error(`❌ [${operationId}] Stripe resume failed:`, stripeError)
      
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to resume subscription in Stripe',
        details: stripeError.message,
        code: 'STRIPE_RESUME_FAILED',
        operationId
      }, { status: 500 })
    }

    // 💾 UPDATE LOCAL DATABASE (Webhooks will also update, but we do it immediately for consistency)
    try {
      // 🔥 MAIN DATABASE UPDATE (without audit log to prevent transaction rollback)
      await prisma.$transaction(async (tx) => {
        // Update subscription status 
        const updatedSubscription = await tx.subscription.update({
          where: { id: pausedSubscription.id },
          data: { status: 'ACTIVE' }
        })
        console.log(`📊 [${operationId}] Updated subscription status: ${pausedSubscription.status} → ${updatedSubscription.status}`)

        // Update membership status (for ALL suspended memberships)
        const updatedMemberships = await tx.membership.updateMany({
          where: { 
            userId: customer.id,
            status: { in: ['SUSPENDED', 'PAUSED', 'ACTIVE'] } // Update SUSPENDED, PAUSED, and already ACTIVE
          },
          data: { status: 'ACTIVE' }
        })
        console.log(`📊 [${operationId}] Updated ${updatedMemberships.count} memberships to ACTIVE`)
      })

      // 📊 CREATE AUDIT LOG OUTSIDE TRANSACTION (won't rollback main updates if it fails)
      try {
        await prisma.subscriptionAuditLog.create({
          data: {
            subscriptionId: pausedSubscription.id,
            action: 'RESUME',
            performedBy: adminUser.id,
            performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
            reason: reason || 'No reason provided',
            operationId,
            metadata: JSON.stringify({
              resumeImmediately,
              stripeSubscriptionId: pausedSubscription.stripeSubscriptionId,
              routedEntityId: pausedSubscription.routedEntityId,
              customerEmail: customer.email,
              timestamp: new Date().toISOString(),
              processingTimeMs: Date.now() - startTime
            })
          }
        })
        console.log(`✅ [${operationId}] Audit log created successfully`)
      } catch (auditError) {
        console.warn(`⚠️ [${operationId}] Audit log failed (table may not exist):`, auditError)
        // Continue without audit log - operation still succeeded
      }

      console.log(`✅ [${operationId}] Database updated successfully`)

      // 🔍 VERIFY UPDATE - Check the updated status
      const updatedSubscription = await prisma.subscription.findUnique({
        where: { id: pausedSubscription.id },
        include: { user: true }
      })
      console.log(`🔍 [${operationId}] Updated subscription status: ${updatedSubscription?.status}`)

      // Close any open-ended pause masters so future months do not auto-pause
      try {
        await prisma.subscriptionPauseWindow.updateMany({
          where: { subscriptionId: pausedSubscription.id, openEnded: true, closedAt: null },
          data: { closedAt: new Date() }
        })
      } catch {}

      // 📅 SETTLE + CANCEL scheduled windows (early return). The remainder-of-month
      // charge above covers the used days of the current month; the only settlement
      // still owed is a CREDIT for months the member paid in full before the pause
      // took effect (pause started after the 1st). Applied as a negative invoice
      // item riding the next renewal. Windows are then CANCELLED so the pause cron
      // can never settle them again when the original end date passes.
      for (const window of openWindows) {
        try {
          const yesterday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1))
          if (window.startDate && window.startDate <= yesterday) {
            const settlement = calculateSettlementBreakdown({
              startDate: new Date(window.startDate),
              endDate: yesterday, // actual paused period, not the original window
              monthlyPrice: Number(pausedSubscription.monthlyPrice) || 0
            })
            if (settlement.totalSettlementAmount > 0) {
              const creditDesc = settlement.partialMonths
                .filter(p => p.creditable)
                .map(p => `${p.month}: ${p.pausedDays} days`)
                .join(', ')
              await stripeClient.invoiceItems.create({
                customer: (pausedSubscription as any).stripeCustomerId,
                amount: -settlement.totalSettlementPence,
                currency: 'gbp',
                description: `Pause credit (early resume): ${creditDesc}`,
                metadata: { pauseWindowId: window.id, subscriptionId: pausedSubscription.id, reason: 'pause_early_resume_credit', operationId }
              }, { idempotencyKey: `early-resume-credit:${window.id}` })
              console.log(`✅ [${operationId}] Early-resume credit -£${settlement.totalSettlementAmount} for window ${window.id}`)
            }
          }
          await prisma.subscriptionPauseWindow.update({
            where: { id: window.id },
            data: { status: 'CANCELLED', closedAt: new Date(), appliedResumeAt: new Date(), reason: `${window.reason ? window.reason + ' — ' : ''}resumed early by admin (${operationId})` }
          })
          console.log(`✅ [${operationId}] Cancelled scheduled pause window ${window.id} (was ${window.startDate?.toISOString().slice(0,10)} → ${window.endDate?.toISOString().slice(0,10)})`)
        } catch (windowErr: any) {
          console.error(`❌ [${operationId}] Failed to settle/cancel pause window ${window.id}:`, windowErr.message)
        }
      }

    } catch (dbError: any) {
      console.error(`❌ [${operationId}] Database update failed:`, dbError)
      
      // 🔄 ROLLBACK STRIPE OPERATION (only if we actually resumed it)
      if (stripeOperationSuccess) {
        try {
          await stripeClient.subscriptions.update(pausedSubscription.stripeSubscriptionId, {
            pause_collection: { behavior: 'void' }
          })
          console.log(`✅ [${operationId}] Stripe operation rolled back successfully`)
        } catch (rollbackError) {
          console.error(`❌ [${operationId}] CRITICAL: Rollback failed:`, rollbackError)
        }
      }

      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update database after Stripe resume',
        details: dbError.message,
        code: 'DATABASE_UPDATE_FAILED',
        operationId,
        rollbackAttempted: true
      }, { status: 500 })
    }

    // 🎉 SUCCESS RESPONSE
    const processingTime = Date.now() - startTime
    console.log(`✅ [${operationId}] Membership resume completed successfully in ${processingTime}ms`)

    return NextResponse.json({
      success: true,
      message: prorationCharged > 0 
        ? `Membership resumed successfully. Charged £${prorationCharged.toFixed(2)} for remaining days.`
        : 'Membership resumed successfully',
      subscription: {
        id: pausedSubscription.id,
        stripeSubscriptionId: pausedSubscription.stripeSubscriptionId,
        status: 'ACTIVE',
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        membershipType: pausedSubscription.membershipType,
        routedEntity: pausedSubscription.routedEntity.displayName,
        resumedAt: new Date().toISOString(),
        resumedBy: `${adminUser.firstName} ${adminUser.lastName}`,
        reason: reason || 'No reason provided',
        billingResumed: resumeImmediately,
        prorationCharged: prorationCharged > 0 ? prorationCharged : undefined
      },
      operationId,
      processingTimeMs: processingTime,
      code: 'RESUME_SUCCESS'
    })

  } catch (error: any) {
    const processingTime = Date.now() - startTime
    console.error(`❌ [${operationId || 'unknown'}] Unexpected error during resume operation:`, error)

    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error during resume operation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_ERROR',
      operationId: operationId || 'unknown',
      processingTimeMs: processingTime
    }, { status: 500 })
  }
}
