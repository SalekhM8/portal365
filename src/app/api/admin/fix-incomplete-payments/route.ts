import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 🎯 SURGICAL FIX: Only target users with INCOMPLETE/PENDING status
 * 
 * This endpoint ONLY fixes payments for users who show as 
 * INCOMPLETE or PENDING_PAYMENT in the Customers tab
 */
export async function POST(request: NextRequest) {
  try {
    // Environment guard to prevent accidental production use
    if (process.env.ALLOW_MAINTENANCE !== 'true') {
      return NextResponse.json({ success: false, error: 'Maintenance operations disabled', code: 'MAINTENANCE_DISABLED' }, { status: 403 })
    }
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

    if (!adminUser || !(['SUPER_ADMIN', 'ADMIN'].includes(adminUser.role))) {
      return NextResponse.json({ 
        success: false, 
        error: 'Insufficient permissions - Admin access required',
        code: 'FORBIDDEN'
      }, { status: 403 })
    }

    console.log('🎯 Starting surgical payment fix for incomplete users only...')

    // 🎯 SURGICAL: Only get users with INCOMPLETE/PENDING/EXPIRED subscriptions
    const incompleteUsers = await prisma.user.findMany({
      where: {
        subscriptions: {
          some: {
            status: { in: ['INCOMPLETE', 'PENDING_PAYMENT', 'INCOMPLETE_EXPIRED'] }
          }
        }
      },
      include: {
        subscriptions: {
          where: {
            status: { in: ['INCOMPLETE', 'PENDING_PAYMENT', 'INCOMPLETE_EXPIRED'] }
          }
        },
        payments: {
          where: { status: 'CONFIRMED' }
        }
      }
    })

    console.log(`🔍 Found ${incompleteUsers.length} users with incomplete/pending subscriptions`)

    const results = []
    let fixedPayments = 0
    let totalUsers = 0

    for (const user of incompleteUsers) {
      totalUsers++
      console.log(`🔍 Processing ${user.email} - ${user.payments.length} CONFIRMED payments`)

      if (user.payments.length > 0) {
        // Mark their payments as FAILED (they shouldn't have CONFIRMED payments if subscription is incomplete)
        const updatedPayments = await prisma.payment.updateMany({
          where: {
            userId: user.id,
            status: 'CONFIRMED'
          },
          data: {
            status: 'FAILED',
            failureReason: 'Subscription incomplete in Stripe - payment not actually collected',
            failedAt: new Date()
          }
        })

        fixedPayments += updatedPayments.count
        
        results.push({
          userEmail: user.email,
          subscriptionStatus: user.subscriptions[0]?.status,
          paymentsFixed: updatedPayments.count,
          status: 'FIXED'
        })

        console.log(`✅ Fixed ${updatedPayments.count} fake payments for ${user.email} (subscription: ${user.subscriptions[0]?.status})`)
      } else {
        results.push({
          userEmail: user.email,
          subscriptionStatus: user.subscriptions[0]?.status,
          paymentsFixed: 0,
          status: 'NO_PAYMENTS_TO_FIX'
        })
      }
    }

    console.log(`✅ Surgical fix completed: ${fixedPayments} payments fixed for ${totalUsers} incomplete users`)

    return NextResponse.json({
      success: true,
      message: `Fixed ${fixedPayments} fake payments for ${totalUsers} incomplete users`,
      summary: {
        incompleteUsers: totalUsers,
        paymentsFixed: fixedPayments
      },
      results,
      fixedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error during surgical payment fix:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to fix incomplete user payments',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
