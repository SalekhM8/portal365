import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * 🔄 SYNC STRIPE SUBSCRIPTIONS
 * 
 * This endpoint syncs all local subscriptions with their actual Stripe status
 * to fix any inconsistencies caused by the payment confirmation bug
 */
export async function POST(request: NextRequest) {
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

    console.log('🔄 Starting Stripe subscription sync...')

    // Get all subscriptions from database
    const localSubscriptions = await prisma.subscription.findMany({
      include: { user: true }
    })

    const syncResults = []
    let fixedCount = 0
    let errorCount = 0

    for (const localSub of localSubscriptions) {
      try {
        // Skip if no Stripe subscription ID
        if (!localSub.stripeSubscriptionId) {
          syncResults.push({
            localId: localSub.id,
            userEmail: localSub.user.email,
            status: 'SKIPPED',
            reason: 'No Stripe subscription ID'
          })
          continue
        }

        // Get actual Stripe subscription
        const stripeSub = await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId)
        
        // Determine correct status
        let correctStatus = stripeSub.status.toUpperCase()
        
        // Map Stripe statuses to our statuses
        if (correctStatus === 'TRIALING') {
          correctStatus = 'ACTIVE'
        }
        if (stripeSub.pause_collection?.behavior === 'void') {
          correctStatus = 'PAUSED'
        }
        
        // Check if sync is needed
        if (localSub.status !== correctStatus) {
          // Update local database to match Stripe
          await prisma.subscription.update({
            where: { id: localSub.id },
            data: { 
              status: correctStatus,
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end,
              currentPeriodStart: new Date(stripeSub.current_period_start * 1000),
              currentPeriodEnd: new Date(stripeSub.current_period_end * 1000)
            }
          })

          // Update membership status to match
          const membershipStatus = correctStatus === 'PAUSED' ? 'SUSPENDED' : 
                                  correctStatus === 'CANCELLED' ? 'CANCELLED' : 
                                  correctStatus === 'INCOMPLETE' ? 'PENDING_PAYMENT' : 'ACTIVE'
          
          await prisma.membership.updateMany({
            where: { userId: localSub.userId },
            data: { status: membershipStatus }
          })

          syncResults.push({
            localId: localSub.id,
            userEmail: localSub.user.email,
            status: 'FIXED',
            oldStatus: localSub.status,
            newStatus: correctStatus,
            stripeStatus: stripeSub.status
          })
          
          fixedCount++
          console.log(`✅ Fixed: ${localSub.user.email} ${localSub.status} → ${correctStatus}`)
        } else {
          syncResults.push({
            localId: localSub.id,
            userEmail: localSub.user.email,
            status: 'CORRECT',
            currentStatus: localSub.status
          })
        }

      } catch (error: any) {
        syncResults.push({
          localId: localSub.id,
          userEmail: localSub.user.email,
          status: 'ERROR',
          error: error.message
        })
        errorCount++
        console.error(`❌ Error syncing ${localSub.user.email}:`, error.message)
      }
    }

    console.log(`✅ Sync completed: ${fixedCount} fixed, ${errorCount} errors`)

    return NextResponse.json({
      success: true,
      message: `Stripe sync completed: ${fixedCount} subscriptions fixed`,
      summary: {
        totalSubscriptions: localSubscriptions.length,
        fixedCount,
        errorCount,
        correctCount: localSubscriptions.length - fixedCount - errorCount
      },
      syncResults,
      syncedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error during Stripe sync:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to sync with Stripe',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
