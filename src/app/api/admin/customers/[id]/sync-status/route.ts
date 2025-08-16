import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    // 🔐 AUTHENTICATION & AUTHORIZATION
    const session = await getServerSession(authOptions) as any
    
    if (!session || !session.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id: customerId } = await params
    const operationId = `sync_${customerId}_${Date.now()}`
    
    console.log(`🔄 [${operationId}] Starting status sync for customer: ${customerId}`)

    // Get customer with subscription
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAUSED', 'PAST_DUE'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
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

    const subscription = customer.subscriptions[0]
    if (!subscription) {
      return NextResponse.json({ 
        success: false, 
        error: 'No subscription found for this customer',
        code: 'NO_SUBSCRIPTION'
      }, { status: 404 })
    }

    // 🔄 Fetch current status from Stripe
    const stripeSubscription = await stripe.subscriptions.retrieve(
      subscription.stripeSubscriptionId
    )

    console.log(`📊 [${operationId}] Stripe status:`, {
      status: stripeSubscription.status,
      pauseCollection: stripeSubscription.pause_collection,
      cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
    })

    // Determine correct status
    let localStatus = stripeSubscription.status.toUpperCase()
    if (stripeSubscription.pause_collection?.behavior === 'void') {
      localStatus = 'PAUSED'
    }

    // Update local database to match Stripe
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({
        where: { id: subscription.id },
        data: { 
          status: localStatus,
          cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
        }
      })

      // Update membership status to match
      const membershipStatus = localStatus === 'PAUSED' ? 'SUSPENDED' : 
                              localStatus === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE'
      
      await tx.membership.updateMany({
        where: { userId: customer.id },
        data: { status: membershipStatus }
      })
    })

    console.log(`✅ [${operationId}] Status synced successfully - ${localStatus}`)

    return NextResponse.json({ 
      success: true, 
      message: 'Status synced with Stripe',
      operationId,
      previousStatus: subscription.status,
      newStatus: localStatus,
      stripeData: {
        status: stripeSubscription.status,
        pauseCollection: stripeSubscription.pause_collection,
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end
      }
    })

  } catch (error: any) {
    console.error(`❌ Status sync failed:`, error)
    
    return NextResponse.json({ 
      success: false, 
      error: 'Status sync failed',
      details: error.message
    }, { status: 500 })
  }
}
