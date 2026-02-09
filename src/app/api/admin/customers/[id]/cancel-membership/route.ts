import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

/**
 * CANCEL MEMBERSHIP - Enterprise-grade implementation
 * 
 * Features:
 * - Immediate or end-of-period cancellation
 * - Idempotent operations (safe to retry)
 * - Comprehensive error handling
 * - Audit trail logging
 * - Rollback capability
 * - Industry-standard validation
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
    const { 
      reason, 
      cancelationType = 'end_of_period', // 'immediate' or 'end_of_period'
      prorate = true 
    } = await request.json()

    if (!customerId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Customer ID is required',
        code: 'INVALID_REQUEST'
      }, { status: 400 })
    }

    if (!['immediate', 'end_of_period'].includes(cancelationType)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid cancellation type. Must be: immediate or end_of_period',
        code: 'INVALID_CANCELLATION_TYPE'
      }, { status: 400 })
    }

    if (!reason || reason.trim().length < 5) {
      return NextResponse.json({ 
        success: false, 
        error: 'Cancellation reason is required (minimum 5 characters)',
        code: 'REASON_REQUIRED'
      }, { status: 400 })
    }

    // 🔍 FIND CUSTOMER & ACTIVE SUBSCRIPTION
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { 
            status: { in: ['ACTIVE', 'PAUSED', 'TRIALING', 'PAST_DUE', 'PENDING_PAYMENT'] }
          },
          include: {
            routedEntity: true
          }
        },
        memberships: {
          where: { 
            status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_PAYMENT'] }
          }
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

    const activeSubscription = customer.subscriptions[0]
    if (!activeSubscription) {
      return NextResponse.json({ 
        success: false, 
        error: 'No active subscription found for this customer',
        code: 'NO_ACTIVE_SUBSCRIPTION'
      }, { status: 404 })
    }

    // ✅ IDEMPOTENCY CHECK
    if (activeSubscription.status === 'CANCELLED') {
      return NextResponse.json({ 
        success: true, 
        message: 'Membership is already cancelled',
        subscription: {
          id: activeSubscription.id,
          status: 'CANCELLED',
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`
        },
        code: 'ALREADY_CANCELLED'
      })
    }

    // Check if already scheduled for cancellation
    if (cancelationType === 'end_of_period' && activeSubscription.cancelAtPeriodEnd) {
      return NextResponse.json({ 
        success: true, 
        message: 'Membership is already scheduled for cancellation at period end',
        subscription: {
          id: activeSubscription.id,
          status: activeSubscription.status,
          cancelAtPeriodEnd: true,
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`,
          periodEndDate: activeSubscription.currentPeriodEnd.toISOString()
        },
        code: 'ALREADY_SCHEDULED_CANCELLATION'
      })
    }

    // 🎯 CREATE OPERATION ID FOR TRACKING
    operationId = `cancel_${activeSubscription.id}_${Date.now()}`

    console.log(`🔄 [${operationId}] Starting membership cancellation (${cancelationType}) for customer ${customer.email}`)

    // 🚀 CANCEL STRIPE SUBSCRIPTION
    let stripeOperationSuccess = false
    let stripeResult: any = null
    const s = getStripeClient((activeSubscription as any)?.stripeAccountKey || 'SU')
    
    try {
      if (cancelationType === 'immediate') {
        // Immediate cancellation
        stripeResult = await s.subscriptions.cancel(
          activeSubscription.stripeSubscriptionId,
          {
            prorate: prorate
          }
        )
      } else {
        // Schedule cancellation at period end
        stripeResult = await s.subscriptions.update(
          activeSubscription.stripeSubscriptionId,
          {
            cancel_at_period_end: true
          }
        )
      }

      stripeOperationSuccess = true
      console.log(`✅ [${operationId}] Stripe subscription ${cancelationType} cancellation successful`)

    } catch (stripeError: any) {
      console.error(`❌ [${operationId}] Stripe cancellation failed:`, stripeError)
      
      return NextResponse.json({ 
        success: false, 
        error: `Failed to cancel subscription in Stripe (${cancelationType})`,
        details: stripeError.message,
        code: 'STRIPE_CANCELLATION_FAILED',
        operationId
      }, { status: 500 })
    }

    // 💾 UPDATE LOCAL DATABASE
    try {
      // 🔥 MAIN DATABASE UPDATE (without audit log to prevent transaction rollback)
      await prisma.$transaction(async (tx) => {
        if (cancelationType === 'immediate') {
          // Void any open invoice to avoid accidental collection
          try {
            const sub = await s.subscriptions.retrieve(activeSubscription.stripeSubscriptionId)
            const invoices = await s.invoices.list({ customer: sub.customer as string, limit: 3 })
            for (const inv of invoices.data) {
              if (inv.status === 'open') {
                await s.invoices.voidInvoice(inv.id as string)
              }
            }
          } catch {}
          // Immediate cancellation - update status immediately
          await tx.subscription.update({
            where: { id: activeSubscription.id },
            data: { 
              status: 'CANCELLED',
              cancelAtPeriodEnd: false
            }
          })

          // Update membership status immediately
          await tx.membership.updateMany({
            where: { 
              userId: customer.id,
              status: { in: ['ACTIVE', 'SUSPENDED', 'PENDING_PAYMENT'] }
            },
            data: { status: 'CANCELLED' }
          })

          // Mark any FAILED payments for this user as resolved so they clear from To-Do
          await tx.payment.updateMany({
            where: {
              userId: customer.id,
              status: 'FAILED',
              OR: [
                { failureReason: null },
                { failureReason: { notIn: ['DISMISSED_ADMIN', 'VOIDED_INVOICE'] } }
              ]
            },
            data: {
              failureReason: 'VOIDED_INVOICE'
            }
          })
        } else {
          // End of period cancellation - just set the flag
          await tx.subscription.update({
            where: { id: activeSubscription.id },
            data: { 
              cancelAtPeriodEnd: true
            }
          })
          // Membership stays active until period end
        }
      })

      // 📊 CREATE AUDIT LOG OUTSIDE TRANSACTION (won't rollback main updates if it fails)
      try {
        await prisma.subscriptionAuditLog.create({
          data: {
            subscriptionId: activeSubscription.id,
            action: cancelationType === 'immediate' ? 'CANCEL_IMMEDIATE' : 'CANCEL_SCHEDULED',
            performedBy: adminUser.id,
            performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
            reason: reason,
            operationId,
            metadata: JSON.stringify({
              cancelationType,
              prorate,
              stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
              routedEntityId: activeSubscription.routedEntityId,
              customerEmail: customer.email,
              currentPeriodEnd: activeSubscription.currentPeriodEnd.toISOString(),
              timestamp: new Date().toISOString(),
              processingTimeMs: Date.now() - startTime
            })
          }
        })
        console.log(`✅ [${operationId}] Audit log created successfully`)
      } catch (auditError) {
        console.warn(`⚠️ [${operationId}] Audit log failed (table may not exist):`, auditError)
        // Continue without audit log - don't fail the operation
      }

      console.log(`✅ [${operationId}] Database updated successfully`)

      // 🎉 SUCCESS RESPONSE
      const processingTime = Date.now() - startTime
      console.log(`✅ [${operationId}] Membership cancellation completed successfully in ${processingTime}ms`)

      const responseData: any = {
        success: true,
        message: cancelationType === 'immediate' 
          ? 'Membership cancelled immediately' 
          : 'Membership scheduled for cancellation at period end',
        subscription: {
          id: activeSubscription.id,
          stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
          status: cancelationType === 'immediate' ? 'CANCELLED' : activeSubscription.status,
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`,
          customerEmail: customer.email,
          membershipType: activeSubscription.membershipType,
          routedEntity: activeSubscription.routedEntity.displayName,
          cancelationType,
          cancelledAt: new Date().toISOString(),
          cancelledBy: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: reason
        },
        operationId,
        processingTimeMs: processingTime,
        code: cancelationType === 'immediate' ? 'IMMEDIATE_CANCELLATION_SUCCESS' : 'SCHEDULED_CANCELLATION_SUCCESS'
      }

      // Add period end info for scheduled cancellations
      if (cancelationType === 'end_of_period') {
        responseData.subscription.cancelAtPeriodEnd = true
        responseData.subscription.periodEndDate = activeSubscription.currentPeriodEnd.toISOString()
        responseData.subscription.accessUntil = activeSubscription.currentPeriodEnd.toISOString()
      }

      return NextResponse.json(responseData)

    } catch (dbError: any) {
      console.error(`❌ [${operationId}] Database update failed:`, dbError)
      
      // 🔄 ROLLBACK STRIPE OPERATION (only if we actually made changes)
      if (stripeOperationSuccess) {
        try {
          if (cancelationType === 'immediate') {
            // Can't easily rollback immediate cancellation, log critical error
            console.error(`❌ [${operationId}] CRITICAL: Cannot rollback immediate cancellation`)
          } else {
            // Rollback scheduled cancellation
            await s.subscriptions.update(activeSubscription.stripeSubscriptionId, {
              cancel_at_period_end: false
            })
            console.log(`✅ [${operationId}] Stripe scheduled cancellation rolled back successfully`)
          }
        } catch (rollbackError) {
          console.error(`❌ [${operationId}] CRITICAL: Rollback failed:`, rollbackError)
        }
      }

      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update database after Stripe cancellation',
        details: dbError.message,
        code: 'DATABASE_UPDATE_FAILED',
        operationId,
        rollbackAttempted: cancelationType !== 'immediate'
      }, { status: 500 })
    }

  } catch (error: any) {
    const processingTime = Date.now() - startTime
    console.error(`❌ [${operationId || 'unknown'}] Unexpected error during cancellation operation:`, error)

    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error during cancellation operation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_ERROR',
      operationId: operationId || 'unknown',
      processingTimeMs: processingTime
    }, { status: 500 })
  }
}
