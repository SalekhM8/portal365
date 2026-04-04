import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

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

    // 🚀 RESUME STRIPE SUBSCRIPTION
    // Flow: charge proration FIRST, then unpause. If proration fails, subscription stays paused.
    let stripeOperationSuccess = false
    let prorationCharged = 0
    // Use correct Stripe account for this subscription (available to try and rollback scopes)
    const stripeClient = getStripeClient((pausedSubscription as any).stripeAccountKey || 'SU')
    try {
      // STEP 1: Retrieve subscription to get current period dates
      const currentSub = await stripeClient.subscriptions.retrieve(pausedSubscription.stripeSubscriptionId)
      const customerId = (currentSub as any).customer as string

      // STEP 2: Calculate and collect proration BEFORE resuming
      const now = new Date()
      const periodEnd = new Date((currentSub as any).current_period_end * 1000)
      const periodStart = new Date((currentSub as any).current_period_start * 1000)
      const totalDaysInPeriod = Math.ceil((periodEnd.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24))
      const remainingDays = Math.ceil((periodEnd.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      const monthlyPrice = Number(pausedSubscription.monthlyPrice) || 0

      console.log(`📊 [${operationId}] Proration calc: start=${periodStart.toISOString()}, end=${periodEnd.toISOString()}, totalDays=${totalDaysInPeriod}, remaining=${remainingDays}, price=${monthlyPrice}`)

      // Check if proration was already paid (retry safety)
      const recentInvoices = await stripeClient.invoices.list({ customer: customerId, limit: 5 })
      const alreadyPaid = recentInvoices.data.find((inv: any) =>
        inv.metadata?.reason === 'resume_proration' && inv.status === 'paid'
        && inv.metadata?.subscriptionPeriod === String((currentSub as any).current_period_start)
      )

      if (alreadyPaid) {
        prorationCharged = (alreadyPaid.amount_paid || 0) / 100
        console.log(`✅ [${operationId}] Proration already paid (retry): £${prorationCharged.toFixed(2)}`)
      } else if (remainingDays > 0 && remainingDays <= totalDaysInPeriod && monthlyPrice > 0) {
        const dailyRate = monthlyPrice / totalDaysInPeriod
        const prorationAmount = Math.round(dailyRate * remainingDays * 100) // pence

        if (prorationAmount > 0) {
          console.log(`💰 [${operationId}] Charging proration: ${remainingDays} days at £${(prorationAmount / 100).toFixed(2)}`)

          // Create invoice item — fails here = resume aborted, subscription stays paused
          await stripeClient.invoiceItems.create({
            customer: customerId,
            amount: prorationAmount,
            currency: 'gbp',
            description: `Resume proration: ${remainingDays} days (${now.toLocaleDateString('en-GB')} - ${periodEnd.toLocaleDateString('en-GB')})`,
            metadata: { reason: 'resume_proration', remainingDays: String(remainingDays), operationId }
          })

          // Create invoice — fails here = resume aborted
          const invoice = await stripeClient.invoices.create({
            customer: customerId,
            collection_method: 'charge_automatically',
            auto_advance: true,
            pending_invoice_items_behavior: 'include',
            metadata: { reason: 'resume_proration', operationId, subscriptionPeriod: String((currentSub as any).current_period_start) }
          })

          // Finalize and pay — fails here = resume aborted
          const finalizedInvoice = await stripeClient.invoices.finalizeInvoice(invoice.id!)
          if (finalizedInvoice.amount_due > 0) {
            await stripeClient.invoices.pay(finalizedInvoice.id!)
          }
          prorationCharged = prorationAmount / 100
          console.log(`✅ [${operationId}] Proration paid: £${prorationCharged.toFixed(2)}`)
        }
      } else {
        console.log(`⚠️ [${operationId}] Proration skipped: remainingDays=${remainingDays}, totalDays=${totalDaysInPeriod}, price=${monthlyPrice}`)
      }

      // STEP 3: Proration collected — NOW unpause the subscription
      await stripeClient.subscriptions.update(
        pausedSubscription.stripeSubscriptionId,
        { pause_collection: null }
      )

      // Attempt to pay any open invoice created while paused
      try {
        const invoices = await stripeClient.invoices.list({ customer: customerId, limit: 5 })
        const openInv = invoices.data.find((i: any) => i.status === 'open')
        if (openInv && openInv.id) {
          await stripeClient.invoices.pay(openInv.id as string)
        }
      } catch {}

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
