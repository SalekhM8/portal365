import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

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

    const { searchParams } = new URL(request.url)
    const account = (searchParams.get('account') || 'SU').toUpperCase() as StripeAccountKey
    const stripe = getStripeClient(account)
    console.log(`🔄 Starting Stripe subscription sync for ${account}...`)

    // Get all subscriptions from database
    const localSubscriptions = await prisma.subscription.findMany({
      include: { user: true }
    })
    
    console.log(`📊 Found ${localSubscriptions.length} subscriptions to check`)
    
    // Also check all current payments to see what we're working with
    const allPayments = await prisma.payment.findMany({
      where: { status: 'CONFIRMED' },
      include: { user: { select: { email: true } } }
    })
    console.log(`📊 Found ${allPayments.length} CONFIRMED payments currently in database`)

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
        const stripeSub = await stripe.subscriptions.retrieve(localSub.stripeSubscriptionId) as any
        
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
        // Compute the membership status we expect given Stripe
        const expectedMembershipStatus =
          correctStatus === 'PAUSED' ? 'SUSPENDED' :
          correctStatus === 'PAST_DUE' ? 'SUSPENDED' :
          correctStatus === 'INCOMPLETE' ? 'PENDING_PAYMENT' :
          correctStatus === 'INCOMPLETE_EXPIRED' ? 'PENDING_PAYMENT' :
          correctStatus === 'CANCELLED' ? 'CANCELLED' :
          'ACTIVE'

        if (localSub.status !== correctStatus) {
          // Update local database to match Stripe
          await prisma.subscription.update({
            where: { id: localSub.id },
            data: { 
              status: correctStatus,
              cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
              currentPeriodStart: stripeSub.current_period_start ? new Date(stripeSub.current_period_start * 1000) : localSub.currentPeriodStart,
              currentPeriodEnd: stripeSub.current_period_end ? new Date(stripeSub.current_period_end * 1000) : localSub.currentPeriodEnd
            }
          })

          // Update membership status to match
          await prisma.membership.updateMany({
            where: { userId: localSub.userId },
            data: { status: expectedMembershipStatus }
          })

          // 🚨 CRITICAL: Remove fake payment records for incomplete subscriptions
          if (correctStatus === 'INCOMPLETE' || stripeSub.status === 'incomplete') {
            console.log(`🔍 Checking for fake payments for user ${localSub.user.email}`)
            
            // Look for fake payment records (broader search)
            const fakePayments = await prisma.payment.findMany({
              where: {
                userId: localSub.userId,
                status: 'CONFIRMED',
                OR: [
                  { description: { contains: 'Prorated first month payment' } },
                  { description: { contains: 'prorated' } },
                  { description: { contains: 'Initial subscription payment' } }
                ]
              }
            })
            
            console.log(`🔍 Found ${fakePayments.length} potential fake payments for ${localSub.user.email}`)
            
            if (fakePayments.length > 0) {
              // Mark as FAILED instead of deleting (better audit trail)
              await prisma.payment.updateMany({
                where: {
                  id: { in: fakePayments.map(p => p.id) }
                },
                data: {
                  status: 'FAILED',
                  failureReason: 'Payment incomplete in Stripe - marked as failed during sync',
                  failedAt: new Date()
                }
              })
              console.log(`🔄 Marked ${fakePayments.length} fake payments as FAILED for ${localSub.user.email}`)
            }
          }

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
          // Even if subscription status matches, fix membership if it's wrong
          await prisma.membership.updateMany({
            where: { userId: localSub.userId, NOT: { status: expectedMembershipStatus } },
            data: { status: expectedMembershipStatus }
          })
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
