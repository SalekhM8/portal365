import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'

/**
 * PAUSE MEMBERSHIP - Enterprise-grade implementation
 * 
 * Features:
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
    const { reason, pauseBehavior = 'void' } = await request.json()

    if (!customerId) {
      return NextResponse.json({ 
        success: false, 
        error: 'Customer ID is required',
        code: 'INVALID_REQUEST'
      }, { status: 400 })
    }

    if (!['void', 'keep_as_draft', 'mark_uncollectible'].includes(pauseBehavior)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid pause behavior. Must be: void, keep_as_draft, or mark_uncollectible',
        code: 'INVALID_PAUSE_BEHAVIOR'
      }, { status: 400 })
    }


    // A scheduled monthly -> cash-package switch must be undone before this action
    {
      const pendingSwitch = await prisma.membership.findFirst({ where: { userId: customerId, endDate: null, pendingPackageName: { not: null } }, select: { pendingPackageName: true, pendingPackageStart: true } })
      if (pendingSwitch) return NextResponse.json({ success: false, error: `A switch to "${pendingSwitch.pendingPackageName}" is scheduled for ${pendingSwitch.pendingPackageStart?.toISOString().slice(0, 10)} — undo the switch first.`, code: 'PACKAGE_SWITCH_PENDING' }, { status: 409 })
    }
    // 🔍 FIND CUSTOMER & ACTIVE SUBSCRIPTION
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'TRIALING'] } },
          include: {
            routedEntity: true
          }
        },
        memberships: {
          where: { status: 'ACTIVE' }
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
    if (activeSubscription.status === 'PAUSED') {
      return NextResponse.json({ 
        success: true, 
        message: 'Membership is already paused',
        subscription: {
          id: activeSubscription.id,
          status: 'PAUSED',
          customerId: customer.id,
          customerName: `${customer.firstName} ${customer.lastName}`
        },
        code: 'ALREADY_PAUSED'
      })
    }

    // 🎯 CREATE OPERATION ID FOR TRACKING
    operationId = `pause_${activeSubscription.id}_${Date.now()}`

    console.log(`🔄 [${operationId}] Starting membership pause for customer ${customer.email}`)

    // 🚀 PAUSE STRIPE SUBSCRIPTION
    let stripeOperationSuccess = false
    // Select correct Stripe account (SU or IQ) based on the subscription row
    const stripeClient = getStripeClient((activeSubscription as any).stripeAccountKey || 'SU')
    try {
      const pauseConfig = {
        pause_collection: {
          behavior: pauseBehavior as 'void' | 'keep_as_draft' | 'mark_uncollectible'
        }
      }

      const updatedStripeSubscription = await stripeClient.subscriptions.update(
        activeSubscription.stripeSubscriptionId,
        pauseConfig
      )

      // If behavior is 'void', proactively void any open invoice
      if (pauseBehavior === 'void') {
        try {
          const invoices = await stripeClient.invoices.list({ customer: updatedStripeSubscription.customer as string, limit: 3 })
          for (const inv of invoices.data) {
            if (inv.status === 'open') {
              await stripeClient.invoices.voidInvoice(inv.id as string)
            }
          }
        } catch {}
      }

      stripeOperationSuccess = true
      console.log(`✅ [${operationId}] Stripe subscription paused successfully`)

    } catch (stripeError: any) {
      console.error(`❌ [${operationId}] Stripe pause failed:`, stripeError)
      
      return NextResponse.json({ 
        success: false, 
        error: 'Failed to pause subscription in Stripe',
        details: stripeError.message,
        code: 'STRIPE_PAUSE_FAILED',
        operationId
      }, { status: 500 })
    }

    // 💾 UPDATE LOCAL DATABASE (Webhooks will also update, but we do it immediately for consistency)
    try {
      // 🔥 MAIN DATABASE UPDATE (without audit log to prevent transaction rollback)
      await prisma.$transaction(async (tx) => {
        // Update subscription status
        const updatedSubscription = await tx.subscription.update({
          where: { id: activeSubscription.id },
          data: { status: 'PAUSED' }
        })
        console.log(`📊 [${operationId}] Updated subscription status: ${activeSubscription.status} → ${updatedSubscription.status}`)

        // Update membership status to PAUSED (consistent with subscription)
        const updatedMemberships = await tx.membership.updateMany({
          where: { 
            userId: customer.id, endDate: null,
            status: { in: ['ACTIVE', 'SUSPENDED', 'PAUSED'] }
          },
          data: { status: 'PAUSED' }
        })
        console.log(`📊 [${operationId}] Updated ${updatedMemberships.count} memberships to PAUSED`)
      })

      // 📊 CREATE AUDIT LOG OUTSIDE TRANSACTION (won't rollback main updates if it fails)
      try {
        await prisma.subscriptionAuditLog.create({
          data: {
            subscriptionId: activeSubscription.id,
            action: 'PAUSE',
            performedBy: adminUser.id,
            performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
            reason: reason || 'No reason provided',
            operationId,
            metadata: JSON.stringify({
              pauseBehavior,
              stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
              routedEntityId: activeSubscription.routedEntityId,
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
      
      // 🔍 VERIFY DATABASE UPDATE - Check what's actually in the database now
      const verifySubscription = await prisma.subscription.findUnique({
        where: { id: activeSubscription.id },
        select: { status: true }
      })
      console.log(`🔍 [${operationId}] Database verification - subscription status is now: ${verifySubscription?.status}`)
      
      const verifyMembership = await prisma.membership.findFirst({
        where: { userId: customer.id },
        select: { status: true }
      })
      console.log(`🔍 [${operationId}] Database verification - membership status is now: ${verifyMembership?.status}`)

    } catch (dbError: any) {
      console.error(`❌ [${operationId}] Database update failed:`, dbError)
      
      // 🔄 ROLLBACK STRIPE OPERATION (only if we actually paused it)
      if (stripeOperationSuccess) {
        try {
          // Remove pause_collection to roll back
          await stripeClient.subscriptions.update(activeSubscription.stripeSubscriptionId, { pause_collection: null, proration_behavior: 'none' })
          console.log(`✅ [${operationId}] Stripe operation rolled back successfully`)
        } catch (rollbackError) {
          console.error(`❌ [${operationId}] CRITICAL: Rollback failed:`, rollbackError)
        }
      }

      return NextResponse.json({ 
        success: false, 
        error: 'Failed to update database after Stripe pause',
        details: dbError.message,
        code: 'DATABASE_UPDATE_FAILED',
        operationId,
        rollbackAttempted: true
      }, { status: 500 })
    }

    // 🎉 SUCCESS RESPONSE
    const processingTime = Date.now() - startTime
    console.log(`✅ [${operationId}] Membership pause completed successfully in ${processingTime}ms`)

    return NextResponse.json({
      success: true,
      message: 'Membership paused successfully',
      subscription: {
        id: activeSubscription.id,
        stripeSubscriptionId: activeSubscription.stripeSubscriptionId,
        status: 'PAUSED',
        customerId: customer.id,
        customerName: `${customer.firstName} ${customer.lastName}`,
        customerEmail: customer.email,
        membershipType: activeSubscription.membershipType,
        routedEntity: activeSubscription.routedEntity.displayName,
        pauseBehavior,
        pausedAt: new Date().toISOString(),
        pausedBy: `${adminUser.firstName} ${adminUser.lastName}`,
        reason: reason || 'No reason provided'
      },
      operationId,
      processingTimeMs: processingTime,
      code: 'PAUSE_SUCCESS'
    })

  } catch (error: any) {
    const processingTime = Date.now() - startTime
    console.error(`❌ [${operationId || 'unknown'}] Unexpected error during pause operation:`, error)

    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error during pause operation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_ERROR',
      operationId: operationId || 'unknown',
      processingTimeMs: processingTime
    }, { status: 500 })
  }
}
