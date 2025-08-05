import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { VATCalculationEngine } from '@/lib/vat-routing'

export async function GET() {
  try {
    // ✅ REUSE your existing auth pattern
    const session = await getServerSession(authOptions) as any
    
    if (!session || !session.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get total customers
    const totalCustomers = await prisma.user.count({
      where: { role: 'CUSTOMER' }
    })

    // Get customers from this month
    const thisMonthStart = new Date()
    thisMonthStart.setDate(1)
    thisMonthStart.setHours(0, 0, 0, 0)
    
    const thisMonthCustomers = await prisma.user.count({
      where: {
        role: 'CUSTOMER',
        createdAt: { gte: thisMonthStart }
      }
    })

    // Get last month customers for comparison
    const lastMonthStart = new Date(thisMonthStart)
    lastMonthStart.setMonth(lastMonthStart.getMonth() - 1)
    
    const lastMonthEnd = new Date(thisMonthStart)
    lastMonthEnd.setTime(lastMonthEnd.getTime() - 1) // End of last month
    
    const lastMonthCustomers = await prisma.user.count({
      where: {
        role: 'CUSTOMER',
        createdAt: { 
          gte: lastMonthStart,
          lt: thisMonthStart
        }
      }
    })

    // Calculate acquisition rate (month-over-month growth)
    const acquisitionRate = lastMonthCustomers > 0 
      ? ((thisMonthCustomers - lastMonthCustomers) / lastMonthCustomers) * 100
      : thisMonthCustomers > 0 ? 100 : 0

    // Get active subscriptions
    const activeSubscriptions = await prisma.subscription.count({
      where: { status: 'ACTIVE' }
    })

    // Get cancelled subscriptions this month for churn calculation
    const cancelledThisMonth = await prisma.subscription.count({
      where: {
        status: 'CANCELLED',
        updatedAt: { gte: thisMonthStart }
      }
    })

    // Calculate churn rate
    const totalActiveAtMonthStart = activeSubscriptions + cancelledThisMonth
    const churnRate = totalActiveAtMonthStart > 0 
      ? (cancelledThisMonth / totalActiveAtMonthStart) * 100 
      : 0

    // Get total revenue this month
    const monthlyRevenue = await prisma.payment.aggregate({
      where: {
        status: 'CONFIRMED',
        createdAt: { gte: thisMonthStart }
      },
      _sum: { amount: true }
    })

    // Get customers with their subscriptions for routing efficiency
    const customersWithSubs = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: {
        subscriptions: {
          where: { status: 'ACTIVE' },
          include: { routedEntity: true }
        }
      }
    })

    // Calculate routing efficiency (how well distributed across entities)
    const entityDistribution = customersWithSubs.reduce((acc: Record<string, number>, customer: any) => {
      customer.subscriptions.forEach((sub: any) => {
        if (sub.routedEntity) {
          acc[sub.routedEntity.name] = (acc[sub.routedEntity.name] || 0) + 1
        }
      })
      return acc
    }, {})

    const totalRouted = Object.values(entityDistribution).reduce((sum: number, count: any) => sum + Number(count), 0)
    const entityCount = Object.keys(entityDistribution).length
    const idealDistribution = totalRouted / Math.max(entityCount, 1)
    
    // Calculate how close we are to ideal distribution (0-100%)
    const routingEfficiency = entityCount > 0 ? 
      100 - (Object.values(entityDistribution).reduce((sum: number, count: any) => {
        return sum + Math.abs(Number(count) - idealDistribution)
      }, 0) / totalRouted * 100) : 100

    // Get recent activity (last 10 activities)
    const recentPayments = await prisma.payment.findMany({
      take: 5,
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        routedEntity: { select: { displayName: true } }
      }
    })

    const recentSignups = await prisma.user.findMany({
      take: 5,
      where: { role: 'CUSTOMER' },
      orderBy: { createdAt: 'desc' },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true
      }
    })

    // Combine and sort activities
    const activities = [
      ...recentPayments.map((payment: any) => ({
        type: 'payment',
        description: `${payment.user?.firstName} ${payment.user?.lastName} paid £${payment.amount} via ${payment.routedEntity?.displayName}`,
        timestamp: payment.createdAt,
        amount: `£${payment.amount}`
      })),
      ...recentSignups.map((user: any) => ({
        type: 'signup',
        description: `${user.firstName} ${user.lastName} signed up`,
        timestamp: user.createdAt,
        amount: null
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 10)

    // Get VAT positions for current state
    const vatPositions = await VATCalculationEngine.calculateVATPositions()

    // Get detailed customer data with payments and routing info
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
          take: 5,
          include: {
            routedEntity: { select: { displayName: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 100
    })

    // Get recent payments with detailed info
    const payments = await prisma.payment.findMany({
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        routedEntity: { select: { displayName: true } },
        routing: {
          select: {
            routingReason: true,
            confidence: true,
            routingMethod: true,
            thresholdDistance: true
          }
        }
      }
    })

    // Format the data for frontend
    const formattedCustomers = customers.map((customer: any) => ({
      id: customer.id,
      name: `${customer.firstName} ${customer.lastName}`,
      email: customer.email,
      phone: customer.phone || 'N/A',
      membershipType: customer.memberships[0]?.membershipType || 'None',
      status: customer.memberships[0]?.status || 'INACTIVE',
      joinDate: customer.createdAt.toISOString().split('T')[0],
      lastPayment: customer.payments[0]?.createdAt.toISOString().split('T')[0] || 'N/A',
      totalPaid: customer.payments.reduce((sum: number, payment: any) => sum + payment.amount, 0),
      routedEntity: customer.payments[0]?.routedEntity?.displayName || 'N/A',
      nextBilling: customer.memberships[0]?.nextBillingDate?.toISOString().split('T')[0] || 'N/A',
      emergencyContact: customer.emergencyContact ? JSON.parse(customer.emergencyContact) : { name: '', phone: '', relationship: '' },
      accessHistory: {
        lastAccess: 'N/A', // Would need AccessLog data
        totalVisits: 0,
        avgWeeklyVisits: 0
      }
    }))

    const formattedPayments = payments.map((payment: any) => ({
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
      processingTime: payment.routing?.decisionTimeMs || 0,
      confidence: payment.routing?.confidence || 'MEDIUM',
      membershipType: formattedCustomers.find(c => c.id === payment.userId)?.membershipType || 'Unknown'
    }))

    return NextResponse.json({
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      churnRate: Math.round(churnRate * 100) / 100,
      acquisitionRate: Math.round(acquisitionRate * 100) / 100,
      routingEfficiency: Math.round(routingEfficiency * 100) / 100,
      recentActivity: activities,
      vatStatus: vatPositions,
      customers: formattedCustomers,
      payments: formattedPayments,
      metrics: {
        totalRevenue: monthlyRevenue._sum.amount || 0,
        monthlyRecurring: monthlyRevenue._sum.amount || 0,
        churnRate: Math.round(churnRate * 100) / 100,
        acquisitionRate: Math.round(acquisitionRate * 100) / 100,
        avgLifetimeValue: totalCustomers > 0 ? (monthlyRevenue._sum.amount || 0) / totalCustomers * 12 : 0,
        paymentSuccessRate: payments.length > 0 ? (payments.filter(p => p.status === 'COMPLETED').length / payments.length) * 100 : 100,
        routingEfficiency: Math.round(routingEfficiency * 100) / 100
      }
    })

  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
} 