import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 🧹 FIX FAKE PAYMENT RECORDS
 * 
 * This endpoint specifically targets and fixes fake payment records
 * that were created by the SetupIntent bug
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

    // When maintenance mode is enabled, allow ADMINs as well
    if (!adminUser || !(['SUPER_ADMIN', 'ADMIN'].includes(adminUser.role))) {
      return NextResponse.json({ 
        success: false, 
        error: 'Insufficient permissions - Admin access required',
        code: 'FORBIDDEN'
      }, { status: 403 })
    }

    console.log('🧹 Starting fake payment cleanup...')

    // Find payments for users who have INCOMPLETE/PENDING subscriptions (smart targeting)
    const usersWithIncompleteSubscriptions = await prisma.user.findMany({
      where: {
        subscriptions: {
          some: {
            status: { in: ['INCOMPLETE', 'PENDING_PAYMENT'] }
          }
        }
      },
      include: {
        payments: {
          where: { status: 'CONFIRMED' }
        }
      }
    })

    // Extract just the payments from incomplete users
    const suspiciousPayments = usersWithIncompleteSubscriptions.flatMap(user => 
      user.payments.map(payment => ({
        ...payment,
        user: { email: user.email, firstName: user.firstName, lastName: user.lastName }
      }))
    )

    console.log(`🔍 Found ${suspiciousPayments.length} suspicious CONFIRMED payments`)

    const results = []
    let fixedCount = 0

    for (const payment of suspiciousPayments) {
      try {
        // Mark as FAILED with clear reason
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'FAILED',
            failureReason: 'Fake payment record created by SetupIntent bug - no actual money collected',
            failedAt: new Date()
          }
        })

        results.push({
          userEmail: payment.user.email,
          amount: payment.amount,
          description: payment.description,
          status: 'FIXED - Marked as FAILED'
        })

        fixedCount++
        console.log(`✅ Fixed fake payment: ${payment.user.email} £${payment.amount}`)

      } catch (error: any) {
        results.push({
          userEmail: payment.user.email,
          amount: payment.amount,
          description: payment.description,
          status: 'ERROR',
          error: error.message
        })
        console.error(`❌ Error fixing payment for ${payment.user.email}:`, error)
      }
    }

    console.log(`✅ Fake payment cleanup completed: ${fixedCount} payments fixed`)

    return NextResponse.json({
      success: true,
      message: `Fixed ${fixedCount} fake payment records`,
      summary: {
        totalSuspicious: suspiciousPayments.length,
        fixedCount,
        errorCount: suspiciousPayments.length - fixedCount
      },
      results,
      fixedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error during fake payment cleanup:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to fix fake payments',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
