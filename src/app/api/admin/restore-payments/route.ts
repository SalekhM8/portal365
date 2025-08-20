import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 🔄 RESTORE PAYMENTS
 * 
 * Emergency endpoint to restore payments that were incorrectly marked as FAILED
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

    console.log('🔄 Starting payment restoration...')

    // Find all payments that were marked as FAILED by the cleanup
    const failedPayments = await prisma.payment.findMany({
      where: {
        status: 'FAILED',
        failureReason: { contains: 'SetupIntent bug' }
      },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } }
      }
    })

    console.log(`🔍 Found ${failedPayments.length} payments marked as failed by cleanup`)

    const results = []
    let restoredCount = 0

    for (const payment of failedPayments) {
      try {
        // Restore to CONFIRMED status
        await prisma.payment.update({
          where: { id: payment.id },
          data: {
            status: 'CONFIRMED',
            failureReason: null,
            failedAt: null
          }
        })

        results.push({
          userEmail: payment.user.email,
          amount: payment.amount,
          description: payment.description,
          status: 'RESTORED'
        })

        restoredCount++
        console.log(`✅ Restored payment: ${payment.user.email} £${payment.amount}`)

      } catch (error: any) {
        results.push({
          userEmail: payment.user.email,
          amount: payment.amount,
          description: payment.description,
          status: 'ERROR',
          error: error.message
        })
        console.error(`❌ Error restoring payment for ${payment.user.email}:`, error)
      }
    }

    console.log(`✅ Payment restoration completed: ${restoredCount} payments restored`)

    return NextResponse.json({
      success: true,
      message: `Restored ${restoredCount} payment records`,
      summary: {
        totalFound: failedPayments.length,
        restoredCount,
        errorCount: failedPayments.length - restoredCount
      },
      results,
      restoredBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error during payment restoration:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to restore payments',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
