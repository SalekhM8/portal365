import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import {
  calculateSettlementBreakdown,
  decimalToNumber,
  formatShortDate
} from '@/lib/pause-credits'

/**
 * DAILY CRON JOB: Pause Management
 * 
 * Runs daily at 10pm to:
 * 
 * PART 1 - START PAUSES (applies void BEFORE billing):
 * 1. Find pause windows with startDate <= TOMORROW and status = SCHEDULED
 *    (picks up pauses the night before so void is active before ~3am billing)
 * 2. Apply pause_collection with behavior: 'void' in Stripe
 * 3. Update status to ACTIVE
 *
 * PART 2 - END PAUSES & APPLY SETTLEMENT:
 * 1. Find pause windows with endDate <= today and status = ACTIVE or SCHEDULED
 * 2. Calculate settlement: only PARTIAL months get credits
 *    (full months are handled by void - no charge means no credit needed)
 * 3. Create negative InvoiceItem in Stripe for partial month settlement only
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

    // Tomorrow's date - apply void BEFORE billing day (billing ~3am, cron runs 10pm)
    const tomorrow = new Date(today)
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1)

    console.log(`🕐 [pause-cron] Running for date: ${today.toISOString().split('T')[0]}, starting pauses with startDate <= ${tomorrow.toISOString().split('T')[0]}`)

    // ═══════════════════════════════════════════════════════════════
    // PART 1: START SCHEDULED PAUSES THAT BEGIN TODAY
    // ═══════════════════════════════════════════════════════════════
    
    const pausesToStart = await (prisma as any).subscriptionPauseWindow.findMany({
      where: {
        startDate: { lte: tomorrow }, // Pick up pauses starting tomorrow so void is applied BEFORE billing
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
        
        // Calculate resume date (end date itself — resumes before next billing on 1st)
        const resumeDate = new Date(window.endDate)
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
        // CALCULATE SETTLEMENT - only partial months need credits
        // Full months: void already prevented billing, no credit needed
        // Partial months: customer was charged full month, credit the paused days
        // ═══════════════════════════════════════════════════════════════

        const monthlyPrice = decimalToNumber(sub.monthlyPrice)

        const settlement = calculateSettlementBreakdown({
          startDate: new Date(window.startDate),
          endDate: new Date(window.endDate),
          monthlyPrice
        })

        console.log(`📊 Window ${windowId}:`)
        console.log(`   Monthly price: £${monthlyPrice}`)
        console.log(`   Total paused days: ${settlement.totalDays}`)
        console.log(`   Full months skipped (void handled): ${settlement.fullMonthsSkipped.join(', ') || 'none'}`)
        console.log(`   Creditable partial settlement: £${settlement.totalSettlementAmount}`)
        console.log(`   Post-resume charge: £${settlement.totalChargeAmount}`)
        for (const p of settlement.partialMonths) {
          if (p.creditable) {
            console.log(`     - ${p.month}: paused ${p.pausedDays}/${p.totalDaysInMonth} → credit £${p.creditAmount}`)
          } else {
            console.log(`     - ${p.month}: paused ${p.pausedDays}/${p.totalDaysInMonth}, used ${p.usedDays} after resume → charge £${p.chargeAmount}`)
          }
        }

        let creditInvoiceItemId: string | null = null
        let chargeInvoiceItemId: string | null = null

        // Creditable partial months (customer paid full month, refund paused days)
        if (settlement.totalSettlementAmount > 0) {
          const creditDesc = settlement.partialMonths
            .filter(p => p.creditable)
            .map(p => `${p.month}: ${p.pausedDays} days`)
            .join(', ')

          const creditItem = await stripe.invoiceItems.create({
            customer: sub.stripeCustomerId,
            amount: -settlement.totalSettlementPence, // NEGATIVE for credit
            currency: 'gbp',
            description: `Pause credit (partial month): ${creditDesc}`,
            metadata: {
              pauseWindowId: window.id,
              subscriptionId: sub.id,
              totalPausedDays: String(settlement.totalDays),
              fullMonthsSkipped: settlement.fullMonthsSkipped.join(', '),
              startDate: formatShortDate(new Date(window.startDate)),
              endDate: formatShortDate(new Date(window.endDate)),
              reason: 'pause_partial_month_settlement',
              appliedAt: new Date().toISOString()
            }
          })
          creditInvoiceItemId = creditItem.id
          console.log(`✅ Created credit ${creditItem.id}: -£${settlement.totalSettlementAmount}`)
          results.creditsApplied++
        }

        // Non-creditable partial months (customer wasn't billed, charge for days used after resume)
        if (settlement.totalChargeAmount > 0) {
          const chargeDesc = settlement.partialMonths
            .filter(p => !p.creditable && p.usedDays > 0)
            .map(p => `${p.month}: ${p.usedDays} days used after resume`)
            .join(', ')

          const chargeItem = await stripe.invoiceItems.create({
            customer: sub.stripeCustomerId,
            amount: settlement.totalChargePence, // POSITIVE for charge
            currency: 'gbp',
            description: `Pause settlement (post-resume): ${chargeDesc}`,
            metadata: {
              pauseWindowId: window.id,
              subscriptionId: sub.id,
              totalPausedDays: String(settlement.totalDays),
              fullMonthsSkipped: settlement.fullMonthsSkipped.join(', '),
              startDate: formatShortDate(new Date(window.startDate)),
              endDate: formatShortDate(new Date(window.endDate)),
              reason: 'pause_post_resume_charge',
              appliedAt: new Date().toISOString()
            }
          })
          chargeInvoiceItemId = chargeItem.id
          console.log(`✅ Created post-resume charge ${chargeItem.id}: +£${settlement.totalChargeAmount}`)
        }

        // Update the pause window
        await (prisma as any).subscriptionPauseWindow.update({
          where: { id: window.id },
          data: {
            pausedDays: settlement.totalDays,
            creditAmount: settlement.totalSettlementAmount,
            creditAppliedAt: new Date(),
            stripeInvoiceItemId: creditInvoiceItemId,
            status: 'CREDIT_APPLIED'
          }
        })

        // Audit log
        try {
          const action = creditInvoiceItemId || chargeInvoiceItemId ? 'PAUSE_ENDED' : 'PAUSE_COMPLETED'
          const reasonParts: string[] = []
          if (settlement.totalSettlementAmount > 0) reasonParts.push(`credit £${settlement.totalSettlementAmount}`)
          if (settlement.totalChargeAmount > 0) reasonParts.push(`post-resume charge £${settlement.totalChargeAmount}`)
          if (settlement.fullMonthsSkipped.length > 0) reasonParts.push(`${settlement.fullMonthsSkipped.length} full month(s) voided`)
          const reason = reasonParts.length > 0 ? `Pause ended: ${reasonParts.join(', ')}` : 'Pause completed - no settlement needed'

          await prisma.subscriptionAuditLog.create({
            data: {
              subscriptionId: sub.id,
              action,
              performedBy: 'SYSTEM',
              performedByName: 'System Cron',
              reason,
              operationId: `pause_end_${window.id}_${Date.now()}`,
              metadata: JSON.stringify({
                pauseWindowId: window.id,
                creditInvoiceItemId,
                chargeInvoiceItemId,
                totalDays: settlement.totalDays,
                settlementCredit: settlement.totalSettlementAmount,
                postResumeCharge: settlement.totalChargeAmount,
                fullMonthsSkipped: settlement.fullMonthsSkipped,
                partialMonths: settlement.partialMonths
              })
            }
          })
        } catch (auditErr) {
          console.warn(`⚠️ Failed to create audit log for window ${windowId}:`, auditErr)
        }

        if (!creditInvoiceItemId && !chargeInvoiceItemId) {
          console.log(`ℹ️ Window ${windowId}: No invoice items created (${settlement.fullMonthsSkipped.length} full month(s) handled by void)`)
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

