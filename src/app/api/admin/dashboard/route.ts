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
        businessEntity: { select: { displayName: true } }
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
        description: `${payment.user?.firstName} ${payment.user?.lastName} paid £${payment.amount} via ${payment.businessEntity?.displayName}`,
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

    return NextResponse.json({
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: monthlyRevenue._sum.amount || 0,
      churnRate: Math.round(churnRate * 100) / 100,
      acquisitionRate: Math.round(acquisitionRate * 100) / 100,
      routingEfficiency: Math.round(routingEfficiency * 100) / 100,
      recentActivity: activities,
      vatPositions
    })

  } catch (error) {
    console.error('Dashboard API error:', error)
    return NextResponse.json(
      { error: 'Failed to fetch dashboard data' },
      { status: 500 }
    )
  }
} 