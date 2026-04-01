import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { 
  calculateProratedCredit, 
  decimalToNumber, 
  formatShortDate,
  daysBetweenInclusive 
} from '@/lib/pause-credits'

/**
 * DAILY CRON JOB: Pause Management
 * 
 * Runs daily at 10pm to:
 * 
 * PART 1 - START PAUSES:
 * 1. Find pause windows with startDate <= today and status = SCHEDULED
 * 2. Apply pause_collection in Stripe
 * 3. Update status to ACTIVE
 * 
 * PART 2 - END PAUSES & APPLY CREDITS:
 * 1. Find pause windows with endDate <= today and status = ACTIVE or SCHEDULED
 * 2. Calculate settlement (only partial months)
 * 3. Create negative InvoiceItem in Stripe for settlement
 * 4. Resume billing in Stripe (remove pause_collection)
 * 5. Update status to CREDIT_APPLIED
 * 
 * Schedule: Run daily via Vercel Cron at 22:00 UTC
 * Endpoint: GET /api/admin/cron/apply-pause-credits
 */

function getAuthSecret(request: NextRequest): string | null {
  // Vercel Cron uses Authorization: Bearer <secret>
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7)
  }
  // Also support x-cron-secret for manual testing
  return request.headers.get('x-cron-secret')
}

// Use GET for Vercel Cron compatibility
export async function GET(request: NextRequest) {
  const startTime = Date.now()
  const results = {
    pausesStarted: 0,
    pausesEnded: 0,
    creditsApplied: 0,
    failed: 0,
    skipped: 0,
    errors: [] as string[]
  }

  try {
    // Authenticate
    const secret = getAuthSecret(request)
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Support test date override in development
    const { searchParams } = new URL(request.url)
    const testDate = searchParams.get('testDate')
    
    const today = testDate && process.env.NODE_ENV !== 'production'
      ? new Date(testDate)
      : new Date()
    
    today.setUTCHours(0, 0, 0, 0)
    
    console.log(`🕐 [pause-cron] Running for date: ${today.toISOString().split('T')[0]}`)

    // ═══════════════════════════════════════════════════════════════
    // PART 1: START SCHEDULED PAUSES THAT BEGIN TODAY
    // ═══════════════════════════════════════════════════════════════
    
    const pausesToStart = await (prisma as any).subscriptionPauseWindow.findMany({
      where: {
        startDate: { lte: today },
        endDate: { gt: today }, // End date is still in future
        status: 'SCHEDULED'
      },
      include: {
        subscription: {
          include: { user: true }
        }
      }
    })

    console.log(`\n📋 PART 1: Found ${pausesToStart.length} pauses to START`)

    for (const window of pausesToStart) {
      const sub = window.subscription
      const windowId = window.id

      try {
        if (sub.status === 'CANCELLED' || !sub.stripeSubscriptionId) {
          console.log(`⏭️ Skipping start for ${windowId} - subscription cancelled or no Stripe ID`)
          results.skipped++
          continue
        }

        const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
        
        // Calculate resume date (day after end date)
        const resumeDate = new Date(window.endDate)
        resumeDate.setUTCDate(resumeDate.getUTCDate() + 1)
        const resumeTimestamp = Math.floor(resumeDate.getTime() / 1000)

        // Apply pause_collection
        await stripe.subscriptions.update(sub.stripeSubscriptionId, {
          pause_collection: {
            behavior: 'void',
            resumes_at: resumeTimestamp
          }
        })

        console.log(`✅ Started pause for ${sub.user.email}: ${sub.stripeSubscriptionId}`)

        // Update window status
        await (prisma as any).subscriptionPauseWindow.update({
          where: { id: windowId },
          data: { status: 'ACTIVE' }
        })

        // Update subscription status
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'PAUSED' }
        })

        // Update membership status
        await prisma.membership.updateMany({
          where: { userId: sub.userId },
          data: { status: 'PAUSED' }
        })

        // Audit log
        try {
          await prisma.subscriptionAuditLog.create({
            data: {
              subscriptionId: sub.id,
              action: 'PAUSE_STARTED',
              performedBy: 'SYSTEM',
              performedByName: 'System Cron',
              reason: `Scheduled pause started: ${formatShortDate(new Date(window.startDate))} - ${formatShortDate(new Date(window.endDate))}`,
              operationId: `pause_start_${windowId}_${Date.now()}`,
              metadata: JSON.stringify({ pauseWindowId: windowId, startDate: window.startDate, endDate: window.endDate })
            }
          })
        } catch (e) {}

        results.pausesStarted++

      } catch (error: any) {
        console.error(`❌ Failed to start pause ${windowId}:`, error)
        results.failed++
        results.errors.push(`Start ${windowId}: ${error.message}`)
      }
    }

    // ═══════════════════════════════════════════════════════════════
    // PART 2: END PAUSES AND APPLY SETTLEMENT CREDITS
    // ═══════════════════════════════════════════════════════════════

    const endedWindows = await (prisma as any).subscriptionPauseWindow.findMany({
      where: {
        endDate: { lte: today },
        startDate: { not: null },
        status: { in: ['SCHEDULED', 'ACTIVE'] },
        creditAppliedAt: null
      },
      include: {
        subscription: {
          include: { user: true }
        }
      }
    })

    console.log(`\n📋 PART 2: Found ${endedWindows.length} pauses to END`)

    for (const window of endedWindows) {
      const sub = window.subscription
      const windowId = window.id

      try {
        // Skip if subscription is cancelled
        if (sub.status === 'CANCELLED') {
          console.log(`⏭️ Skipping window ${windowId} - subscription cancelled`)
          results.skipped++
          continue
        }

        const stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')

        // Resume billing in Stripe first (remove pause_collection)
        if (sub.stripeSubscriptionId) {
          try {
            await stripe.subscriptions.update(sub.stripeSubscriptionId, {
              pause_collection: null // This resumes billing
            })
            console.log(`▶️ Resumed billing for ${sub.user.email}`)
          } catch (resumeErr: any) {
            // Might already be resumed, that's OK
            console.log(`ℹ️ Resume billing note: ${resumeErr.message}`)
          }
        }

        // Update subscription status back to ACTIVE
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { status: 'ACTIVE' }
        })
        await prisma.membership.updateMany({
          where: { userId: sub.userId },
          data: { status: 'ACTIVE' }
        })

        // ═══════════════════════════════════════════════════════════════
        // CALCULATE CREDIT - accounts for prorated first-month payments!
        // ═══════════════════════════════════════════════════════════════
        
        // Get subscription start date and first billing date from Stripe
        let subscriptionStart = new Date(sub.createdAt)
        let firstBillingDate = new Date(sub.createdAt)
        firstBillingDate.setUTCMonth(firstBillingDate.getUTCMonth() + 1)
        firstBillingDate.setUTCDate(1) // 1st of next month
        
        // Look up actual prorated payment (first CONFIRMED payment for this user)
        const firstPayment = await prisma.payment.findFirst({
          where: { 
            userId: sub.userId,
            status: 'CONFIRMED'
          },
          orderBy: { createdAt: 'asc' }
        })
        
        const proratedAmount = firstPayment ? decimalToNumber(firstPayment.amount) : null
        const monthlyPrice = decimalToNumber(sub.monthlyPrice)
        
        console.log(`📊 Window ${windowId}:`)
        console.log(`   Subscription started: ${subscriptionStart.toISOString().split('T')[0]}`)
        console.log(`   First billing: ${firstBillingDate.toISOString().split('T')[0]}`)
        console.log(`   Prorated payment: £${proratedAmount ?? 'N/A'}`)
        console.log(`   Monthly price: £${monthlyPrice}`)

        // Calculate credit using the prorated-aware function
        const credit = calculateProratedCredit({
          pauseStart: new Date(window.startDate),
          pauseEnd: new Date(window.endDate),
          subscriptionStart,
          firstBillingDate,
          proratedAmount,
          monthlyPrice
        })

        console.log(`   Total days: ${credit.totalDays}`)
        console.log(`   Total credit: £${credit.totalCredit}`)
        for (const b of credit.breakdown) {
          console.log(`     - ${b.period}: ${b.daysPaused}/${b.daysInPeriod} days @ £${b.dailyRate}/day = £${b.credit}`)
        }

        // Only create invoice item if there's credit to apply
        if (credit.totalCredit > 0) {
          // Build description
          const description = credit.breakdown
            .map(b => `${b.period}: ${b.daysPaused} days`)
            .join(', ')

          // Create negative invoice item (CREDIT)
          const invoiceItem = await stripe.invoiceItems.create({
            customer: sub.stripeCustomerId,
            amount: -credit.totalCreditPence, // NEGATIVE for credit
            currency: 'gbp',
            description: `Pause credit: ${description}`,
            metadata: {
              pauseWindowId: window.id,
              subscriptionId: sub.id,
              totalPausedDays: String(credit.totalDays),
              proratedPayment: String(proratedAmount ?? 'N/A'),
              startDate: formatShortDate(new Date(window.startDate)),
              endDate: formatShortDate(new Date(window.endDate)),
              reason: 'pause_credit',
              appliedAt: new Date().toISOString()
            }
          })

          console.log(`✅ Created credit ${invoiceItem.id}: -£${credit.totalCredit}`)
          results.creditsApplied++

          // Update the pause window
          await (prisma as any).subscriptionPauseWindow.update({
            where: { id: window.id },
            data: {
              pausedDays: credit.totalDays,
              creditAmount: credit.totalCredit,
              creditAppliedAt: new Date(),
              stripeInvoiceItemId: invoiceItem.id,
              status: 'CREDIT_APPLIED'
            }
          })

          // Create audit log
          try {
            await prisma.subscriptionAuditLog.create({
              data: {
                subscriptionId: sub.id,
                action: 'PAUSE_ENDED',
                performedBy: 'SYSTEM',
                performedByName: 'System Cron',
                reason: `Pause ended, credit applied: £${credit.totalCredit}`,
                operationId: `pause_end_${window.id}_${Date.now()}`,
                metadata: JSON.stringify({
                  pauseWindowId: window.id,
                  stripeInvoiceItemId: invoiceItem.id,
                  totalDays: credit.totalDays,
                  totalCredit: credit.totalCredit,
                  proratedPayment: proratedAmount,
                  breakdown: credit.breakdown
                })
              }
            })
          } catch (auditErr) {
            console.warn(`⚠️ Failed to create audit log for window ${windowId}:`, auditErr)
          }

        } else {
          // No credit needed - just mark as completed
          console.log(`ℹ️ Window ${windowId}: No credit to apply`)
          
          await (prisma as any).subscriptionPauseWindow.update({
            where: { id: window.id },
            data: {
              pausedDays: credit.totalDays,
              creditAmount: 0,
              creditAppliedAt: new Date(),
              status: 'CREDIT_APPLIED'
            }
          })

          // Create audit log
          try {
            await prisma.subscriptionAuditLog.create({
              data: {
                subscriptionId: sub.id,
                action: 'PAUSE_COMPLETED',
                performedBy: 'SYSTEM',
                performedByName: 'System Cron',
                reason: `Pause completed - ${credit.totalDays} days, no credit to apply`,
                operationId: `pause_complete_${window.id}_${Date.now()}`,
                metadata: JSON.stringify({
                  pauseWindowId: window.id,
                  totalDays: credit.totalDays,
                  creditAmount: 0
                })
              }
            })
          } catch (auditErr) {
            console.warn(`⚠️ Failed to create audit log for window ${windowId}:`, auditErr)
          }
        }

        results.pausesEnded++

      } catch (error: any) {
        console.error(`❌ Failed to end pause ${windowId}:`, error)
        results.failed++
        results.errors.push(`End ${windowId}: ${error.message}`)
      }
    }

    const duration = Date.now() - startTime

    console.log(`\n🏁 [pause-cron] Completed in ${duration}ms`)
    console.log(`   Started: ${results.pausesStarted}, Ended: ${results.pausesEnded}, Credits: ${results.creditsApplied}`)
    console.log(`   Failed: ${results.failed}, Skipped: ${results.skipped}`)

    return NextResponse.json({
      success: true,
      date: today.toISOString().split('T')[0],
      pausesStarted: results.pausesStarted,
      pausesEnded: results.pausesEnded,
      creditsApplied: results.creditsApplied,
      failed: results.failed,
      skipped: results.skipped,
      errors: results.errors.length > 0 ? results.errors : undefined,
      durationMs: duration
    })

  } catch (error: any) {
    console.error('❌ [pause-cron] Critical error:', error)
    
    return NextResponse.json({
      success: false,
      error: error.message || 'Cron job failed',
      durationMs: Date.now() - startTime
    }, { status: 500 })
  }
}

// Also support POST for manual triggering
export async function POST(request: NextRequest) {
  return GET(request)
}

