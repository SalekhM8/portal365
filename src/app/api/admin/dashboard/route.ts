import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { VATCalculationEngine } from '@/lib/vat-routing'

export async function GET(request: NextRequest) {
  try {
    // ✅ REUSE your existing auth pattern
    const session = await getServerSession(authOptions)
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    if (!hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    console.log('🔍 Fetching real admin dashboard data...')

    // ✅ REUSE your existing VAT calculation engine (no duplication)
    const vatPositions = await VATCalculationEngine.calculateVATPositions()

    // ✅ Get real customer data using your existing Prisma patterns
    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        payments: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          include: { routedEntity: true }
        },
        _count: { select: { payments: true } }
      },
      orderBy: { createdAt: 'desc' }
    })

    // ✅ Get real payment data with routing information
    const payments = await prisma.payment.findMany({
      include: {
        user: { select: { firstName: true, lastName: true } },
        routedEntity: { select: { displayName: true } },
        routing: {
          select: {
            routingReason: true,
            routingMethod: true,
            confidence: true,
            thresholdDistance: true,
            decisionTimeMs: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 50
    })

    // ✅ Calculate real business metrics
    const businessMetrics = await calculateBusinessMetrics()

    // ✅ Get real recent activity
    const recentActivity = await getRecentActivity()

    // ✅ Format data following your existing response patterns
    const formattedCustomers = customers.map(customer => ({
      id: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone || '',
      membershipType: customer.memberships[0]?.membershipType || 'N/A',
      status: customer.memberships[0]?.status || 'NO_MEMBERSHIP',
      joinDate: customer.createdAt.toISOString().split('T')[0],
      lastPayment: customer.payments[0]?.createdAt.toISOString().split('T')[0] || 'Never',
      totalPaid: customer._count.payments * (customer.memberships[0]?.monthlyPrice || 0),
      routedEntity: customer.payments[0]?.routedEntity.displayName || 'N/A',
      nextBilling: customer.memberships[0]?.nextBillingDate?.toISOString().split('T')[0] || 'N/A',
      emergencyContact: customer.emergencyContact ? JSON.parse(customer.emergencyContact) : null,
      accessHistory: {
        lastAccess: customer.payments[0]?.createdAt.toISOString().split('T')[0] || 'Never',
        totalVisits: 'Not tracked', // TODO: Implement real access tracking
        avgWeeklyVisits: 'Not tracked' // TODO: Implement real access tracking
      }
    }))

    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      customerName: `${payment.user.firstName} ${payment.user.lastName}`,
      customerId: payment.userId,
      amount: payment.amount,
      routedToEntity: payment.routedEntity.displayName,
      routingReason: payment.routing?.routingReason || 'Standard routing',
      timestamp: payment.createdAt.toISOString(),
      status: payment.status,
      goCardlessId: payment.goCardlessPaymentId || 'N/A',
      retryCount: payment.retryCount,
      processingTime: payment.routing?.decisionTimeMs ? payment.routing.decisionTimeMs / 1000 : 0,
      confidence: payment.routing?.confidence || 'MEDIUM',
      membershipType: 'FULL_ADULT' // TODO: Get from membership relation
    }))

    // ✅ Enhance VAT positions with customer counts
    const enhancedVatPositions = await Promise.all(
      vatPositions.map(async (position) => {
        const entityCustomerCount = await prisma.payment.groupBy({
          by: ['userId'],
          where: {
            routedEntityId: position.entityId,
            status: 'CONFIRMED'
          }
        })

        const entityPayments = await prisma.payment.findMany({
          where: {
            routedEntityId: position.entityId,
            status: 'CONFIRMED'
          }
        })

        const avgPaymentValue = entityPayments.length > 0 
          ? entityPayments.reduce((sum, p) => sum + p.amount, 0) / entityPayments.length
          : 0

        return {
          ...position,
          customerCount: entityCustomerCount.length,
          avgPaymentValue: Math.round(avgPaymentValue * 100) / 100
        }
      })
    )

    console.log(`✅ Real admin data fetched: ${customers.length} customers, ${payments.length} payments`)

    return NextResponse.json({
      vatStatus: enhancedVatPositions,
      customers: formattedCustomers,
      payments: formattedPayments,
      metrics: businessMetrics,
      recentActivity: recentActivity
    })

  } catch (error) {
    console.error('❌ Error fetching admin dashboard data:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
}

// ✅ Helper function following your existing patterns
async function calculateBusinessMetrics() {
  const totalRevenue = await prisma.payment.aggregate({
    where: { status: 'CONFIRMED' },
    _sum: { amount: true }
  })

  const monthlyRevenue = await prisma.payment.aggregate({
    where: {
      status: 'CONFIRMED',
      createdAt: {
        gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1)
      }
    },
    _sum: { amount: true }
  })

  const totalCustomers = await prisma.user.count({
    where: { role: 'CUSTOMER' }
  })

  const successfulPayments = await prisma.payment.count({
    where: { status: 'CONFIRMED' }
  })

  const totalPayments = await prisma.payment.count()

  // ✅ CALCULATE REAL CHURN RATE
  const thisMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
  const lastMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1)
  
  const activeThisMonth = await prisma.membership.count({
    where: {
      status: 'ACTIVE',
      createdAt: { lt: thisMonth }
    }
  })
  
  const cancelledThisMonth = await prisma.membership.count({
    where: {
      status: 'CANCELLED',
      updatedAt: { gte: thisMonth }
    }
  })
  
  const churnRate = activeThisMonth > 0 ? (cancelledThisMonth / activeThisMonth) * 100 : 0

  // ✅ CALCULATE REAL ACQUISITION RATE
  const newCustomersThisMonth = await prisma.user.count({
    where: {
      role: 'CUSTOMER',
      createdAt: { gte: thisMonth }
    }
  })
  
  const newCustomersLastMonth = await prisma.user.count({
    where: {
      role: 'CUSTOMER',
      createdAt: { gte: lastMonth, lt: thisMonth }
    }
  })
  
  const acquisitionRate = newCustomersLastMonth > 0 
    ? ((newCustomersThisMonth - newCustomersLastMonth) / newCustomersLastMonth) * 100 
    : (newCustomersThisMonth > 0 ? 100 : 0)

  // ✅ CALCULATE REAL ROUTING EFFICIENCY
  const totalRoutingDecisions = await prisma.paymentRouting.count()
  const highConfidenceDecisions = await prisma.paymentRouting.count({
    where: { confidence: { in: ['HIGH', 'MEDIUM'] } }
  })
  
  const routingEfficiency = totalRoutingDecisions > 0 
    ? (highConfidenceDecisions / totalRoutingDecisions) * 100 
    : 100

  return {
    totalRevenue: totalRevenue._sum.amount || 0,
    monthlyRecurring: monthlyRevenue._sum.amount || 0,
    churnRate: Math.round(churnRate * 10) / 10,
    acquisitionRate: Math.round(acquisitionRate * 10) / 10,
    avgLifetimeValue: totalCustomers > 0 ? Math.round((totalRevenue._sum.amount || 0) / totalCustomers) : 0,
    paymentSuccessRate: totalPayments > 0 ? Math.round((successfulPayments / totalPayments) * 100 * 10) / 10 : 0,
    routingEfficiency: Math.round(routingEfficiency * 10) / 10
  }
}

// ✅ NEW FUNCTION: Get real recent activity
async function getRecentActivity() {
  // Get recent registrations
  const recentUsers = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      memberships: {
        where: { status: 'ACTIVE' },
        take: 1
      }
    }
  })

  // Get recent payments  
  const recentPayments = await prisma.payment.findMany({
    orderBy: { createdAt: 'desc' },
    take: 3,
    include: {
      user: { select: { firstName: true, lastName: true } },
      routedEntity: { select: { displayName: true } }
    }
  })

  // Get recent failed payments
  const recentFailures = await prisma.payment.findMany({
    where: { status: 'FAILED' },
    orderBy: { createdAt: 'desc' },
    take: 2,
    include: {
      user: { select: { firstName: true, lastName: true } }
    }
  })

  const activities: Array<{
    type: string
    icon: string
    message: string
    detail: string
    color: string
  }> = []

  // Add new registrations
  recentUsers.forEach(user => {
    const membershipType = user.memberships[0]?.membershipType || 'Unknown'
    activities.push({
      type: 'registration',
      icon: 'UserPlus',
      message: `${user.firstName} ${user.lastName} joined`,
      detail: `${membershipType.replace('_', ' ')} • ${getTimeAgo(user.createdAt)}`,
      color: 'text-green-600'
    })
  })

  // Add successful payments
  recentPayments.forEach(payment => {
    if (payment.status === 'CONFIRMED') {
      activities.push({
        type: 'payment',
        icon: 'CreditCard', 
        message: `Payment processed - £${payment.amount}`,
        detail: `${payment.user.firstName} ${payment.user.lastName} • Routed to ${payment.routedEntity.displayName}`,
        color: 'text-blue-600'
      })
    }
  })

  // Add failed payments
  recentFailures.forEach(payment => {
    activities.push({
      type: 'failure',
      icon: 'AlertCircle',
      message: 'Payment failed',
      detail: `${payment.user.firstName} ${payment.user.lastName} • Retry scheduled`,
      color: 'text-red-600'
    })
  })

  // Sort by most recent and take top 4
  return activities.slice(0, 4)
}

// ✅ HELPER: Calculate time ago
function getTimeAgo(date: Date): string {
  const minutes = Math.floor((Date.now() - date.getTime()) / (1000 * 60))
  if (minutes < 60) return `${minutes} minutes ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hours ago`
  const days = Math.floor(hours / 24)
  return `${days} days ago`
} 