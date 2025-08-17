import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 🧹 CLEAR TEST DATA
 * 
 * Safely clears all test data while preserving:
 * - Business entities
 * - Admin users
 * - Essential configuration
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

    console.log('🧹 Starting test data cleanup...')

    const deletionResults: any = {}

    // 1. Delete subscription audit logs (if they exist)
    try {
      const auditLogsResult = await prisma.subscriptionAuditLog.deleteMany({})
      deletionResults.auditLogs = auditLogsResult.count
      console.log(`✅ Deleted ${auditLogsResult.count} audit log entries`)
    } catch (error) {
      console.log('⚠️ Audit logs table does not exist - skipping')
      deletionResults.auditLogs = 'N/A (table does not exist)'
    }

    // 2. Delete payments and related data
    const routingResult = await prisma.paymentRouting.deleteMany({})
    deletionResults.paymentRouting = routingResult.count
    console.log(`✅ Deleted ${routingResult.count} payment routing entries`)

    const vatResult = await prisma.vATCalculation.deleteMany({})
    deletionResults.vatCalculations = vatResult.count
    console.log(`✅ Deleted ${vatResult.count} VAT calculations`)

    const paymentsResult = await prisma.payment.deleteMany({})
    deletionResults.payments = paymentsResult.count
    console.log(`✅ Deleted ${paymentsResult.count} payments`)

    // 3. Delete subscription routing
    const subRoutingResult = await prisma.subscriptionRouting.deleteMany({})
    deletionResults.subscriptionRouting = subRoutingResult.count
    console.log(`✅ Deleted ${subRoutingResult.count} subscription routings`)

    // 4. Delete subscriptions
    const subscriptionsResult = await prisma.subscription.deleteMany({})
    deletionResults.subscriptions = subscriptionsResult.count
    console.log(`✅ Deleted ${subscriptionsResult.count} subscriptions`)

    // 5. Delete memberships
    const membershipsResult = await prisma.membership.deleteMany({})
    deletionResults.memberships = membershipsResult.count
    console.log(`✅ Deleted ${membershipsResult.count} memberships`)

    // 6. Delete invoices
    const invoicesResult = await prisma.invoice.deleteMany({})
    deletionResults.invoices = invoicesResult.count
    console.log(`✅ Deleted ${invoicesResult.count} invoices`)

    // 7. Delete classes
    const classesResult = await prisma.class.deleteMany({})
    deletionResults.classes = classesResult.count
    console.log(`✅ Deleted ${classesResult.count} classes`)

    // 8. Delete services
    const servicesResult = await prisma.service.deleteMany({})
    deletionResults.services = servicesResult.count
    console.log(`✅ Deleted ${servicesResult.count} services`)

    // 9. Delete non-admin users
    const usersResult = await prisma.user.deleteMany({
      where: {
        role: {
          notIn: ['ADMIN', 'SUPER_ADMIN']
        }
      }
    })
    deletionResults.customerUsers = usersResult.count
    console.log(`✅ Deleted ${usersResult.count} customer users`)

    // 10. Reset revenue counters
    await prisma.businessEntity.updateMany({
      data: { currentRevenue: 0 }
    })
    console.log('✅ Reset all revenue counters to £0')

    // Get final counts
    const finalCounts = {
      adminUsers: await prisma.user.count({
        where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
      }),
      businessEntities: await prisma.businessEntity.count(),
      customerUsers: await prisma.user.count({
        where: { role: { notIn: ['ADMIN', 'SUPER_ADMIN'] } }
      }),
      memberships: await prisma.membership.count(),
      subscriptions: await prisma.subscription.count()
    }

    return NextResponse.json({
      success: true,
      message: 'Test data cleared successfully',
      deletionResults,
      finalCounts,
      clearedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error clearing test data:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to clear test data',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
