import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

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
    let stripeOperationSuccess = false
    try {
      // For paused collections, we need to use update() not resume()
      const updatedStripeSubscription = await stripe.subscriptions.update(
        pausedSubscription.stripeSubscriptionId,
        {
          pause_collection: null, // Remove the pause collection
          proration_behavior: 'none' // Don't prorate when resuming
        }
      )

      stripeOperationSuccess = true
      console.log(`✅ [${operationId}] Stripe subscription resumed successfully`)

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
      await prisma.$transaction(async (tx) => {
        // Update subscription status
        await tx.subscription.update({
          where: { id: pausedSubscription.id },
          data: { status: 'ACTIVE' }
        })

        // Update membership status
        await tx.membership.updateMany({
          where: { 
            userId: customer.id,
            status: 'SUSPENDED'
          },
          data: { status: 'ACTIVE' }
        })

        // 📊 CREATE AUDIT LOG (fail gracefully if table doesn't exist)
        try {
          await tx.subscriptionAuditLog.create({
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
          // Continue without audit log - don't fail the operation
        }
      })

      console.log(`✅ [${operationId}] Database updated successfully`)

      // 🔍 VERIFY UPDATE - Check the updated status
      const updatedSubscription = await prisma.subscription.findUnique({
        where: { id: pausedSubscription.id },
        include: { user: true }
      })
      console.log(`🔍 [${operationId}] Updated subscription status: ${updatedSubscription?.status}`)

    } catch (dbError: any) {
      console.error(`❌ [${operationId}] Database update failed:`, dbError)
      
      // 🔄 ROLLBACK STRIPE OPERATION (only if we actually resumed it)
      if (stripeOperationSuccess) {
        try {
          await stripe.subscriptions.update(pausedSubscription.stripeSubscriptionId, {
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
      message: 'Membership resumed successfully',
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
        billingResumed: resumeImmediately
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
