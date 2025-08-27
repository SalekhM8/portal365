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

    // Get total revenue all time
    const totalRevenue = await prisma.payment.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { amount: true }
    })

    // Calculate Customer Lifetime Value by membership type
    const membershipAnalytics = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: {
        memberships: {
          where: { status: { in: ['ACTIVE', 'PENDING_PAYMENT'] } },
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        payments: {
          where: { status: 'CONFIRMED' }
        }
      }
    })

    const membershipStats = membershipAnalytics.reduce((acc: any, customer) => {
      const membershipType = customer.memberships[0]?.membershipType || 'NO_MEMBERSHIP'
      const totalPaid = customer.payments.reduce((sum, payment) => sum + Number(payment.amount), 0)
      const monthsActive = customer.memberships[0] 
        ? Math.max(1, Math.ceil((Date.now() - customer.memberships[0].startDate.getTime()) / (1000 * 60 * 60 * 24 * 30)))
        : 0
      
      if (!acc[membershipType]) {
        acc[membershipType] = { totalRevenue: 0, customerCount: 0, totalMonths: 0 }
      }
      
      acc[membershipType].totalRevenue += totalPaid
      acc[membershipType].customerCount += 1
      acc[membershipType].totalMonths += monthsActive
      
      return acc
    }, {})

    // Calculate CLV for each membership type
    const membershipCLV = Object.entries(membershipStats).reduce((acc: any, [type, stats]: [string, any]) => {
      acc[type] = stats.customerCount > 0 ? Math.round(stats.totalRevenue / stats.customerCount) : 0
      return acc
    }, {})

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

    // 🚀 COMPREHENSIVE ACTIVITY TRACKING
    const last24Hours = new Date(Date.now() - 24 * 60 * 60 * 1000)
    const last7Days = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)

    // Get recent payments (successes and failures)
    const recentPayments = await prisma.payment.findMany({
      take: 10,
      where: { createdAt: { gte: last7Days } },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        routedEntity: { select: { displayName: true } }
      }
    })

    // Get recent signups
    const recentSignups = await prisma.user.findMany({
      take: 10,
      where: { 
        role: 'CUSTOMER',
        createdAt: { gte: last7Days }
      },
      orderBy: { createdAt: 'desc' },
      select: {
        firstName: true,
        lastName: true,
        email: true,
        createdAt: true,
        memberships: {
          take: 1,
          select: { membershipType: true }
        }
      }
    })

    // Get recent membership changes (upgrades/downgrades)
    const recentMembershipChanges = await prisma.membership.findMany({
      take: 10,
      where: { 
        updatedAt: { gte: last7Days },
        status: 'ACTIVE'
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } }
      }
    })

    // Get recent subscription changes (cancellations, reactivations)
    const recentSubscriptionChanges = await prisma.subscription.findMany({
      take: 10,
      where: { 
        updatedAt: { gte: last7Days },
        status: { in: ['CANCELLED', 'ACTIVE', 'SUSPENDED'] }
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        user: { select: { firstName: true, lastName: true, email: true } }
      }
    })

    // 🚀 COMBINE ALL ACTIVITIES WITH PROPER TYPING AND ICONS
    const activities = [
      ...recentPayments.map((payment: any) => ({
        type: 'payment',
        icon: payment.status === 'CONFIRMED' ? 'CreditCard' : 'AlertCircle',
        color: payment.status === 'CONFIRMED' ? 'text-green-600' : 'text-red-600',
        message: payment.status === 'CONFIRMED' 
          ? `${payment.user?.firstName} ${payment.user?.lastName} paid £${payment.amount}`
          : `Payment failed for ${payment.user?.firstName} ${payment.user?.lastName} (£${payment.amount})`,
        detail: `${payment.routedEntity?.displayName} • ${new Date(payment.createdAt).toLocaleString()}`,
        timestamp: payment.createdAt,
        amount: `£${payment.amount}`,
        status: payment.status
      })),
      ...recentSignups.map((user: any) => ({
        type: 'signup',
        icon: 'UserPlus',
        color: 'text-blue-600',
        message: `${user.firstName} ${user.lastName} signed up`,
        detail: `${user.memberships[0]?.membershipType || 'No membership'} • ${new Date(user.createdAt).toLocaleString()}`,
        timestamp: user.createdAt,
        amount: null,
        status: 'NEW'
      })),
      ...recentMembershipChanges.map((membership: any) => ({
        type: 'membership_change',
        icon: 'TrendingUp',
        color: 'text-purple-600',
        message: `${membership.user?.firstName} ${membership.user?.lastName} changed membership`,
        detail: `Now: ${membership.membershipType} (£${membership.monthlyPrice}) • ${new Date(membership.updatedAt).toLocaleString()}`,
        timestamp: membership.updatedAt,
        amount: `£${membership.monthlyPrice}`,
        status: 'UPDATED'
      })),
      ...recentSubscriptionChanges.map((subscription: any) => ({
        type: 'subscription_change',
        icon: subscription.status === 'CANCELLED' ? 'X' : subscription.status === 'ACTIVE' ? 'CheckCircle' : 'AlertTriangle',
        color: subscription.status === 'CANCELLED' ? 'text-red-600' 
              : subscription.status === 'ACTIVE' ? 'text-green-600' : 'text-yellow-600',
        message: `${subscription.user?.firstName} ${subscription.user?.lastName} subscription ${subscription.status.toLowerCase()}`,
        detail: `${subscription.membershipType} • ${new Date(subscription.updatedAt).toLocaleString()}`,
        timestamp: subscription.updatedAt,
        amount: null,
        status: subscription.status
      }))
    ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()).slice(0, 15)

    // Calculate payment success rate
    const totalPaymentsLast30Days = await prisma.payment.count({
      where: { createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } }
    })
    
    const successfulPaymentsLast30Days = await prisma.payment.count({
      where: { 
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
        status: 'CONFIRMED'
      }
    })

    const paymentSuccessRate = totalPaymentsLast30Days > 0 
      ? (successfulPaymentsLast30Days / totalPaymentsLast30Days) * 100 
      : 100

    // Calculate detailed routing metrics
    const totalPayments = await prisma.payment.count()
    const routedPayments = await prisma.payment.count({
      where: { 
        routedEntityId: { 
          not: "" 
        } 
      }
    })
    const actualRoutingEfficiency = totalPayments > 0 ? (routedPayments / totalPayments) * 100 : 100

    // Calculate average decision time
    const routingDecisions = await prisma.paymentRouting.aggregate({
      _avg: { decisionTimeMs: true }
    })

    // Get VAT positions for current state
    const vatPositions = await VATCalculationEngine.calculateVATPositions()

    // Get detailed customer data with payments and routing info
    const customers = await prisma.user.findMany({
      where: { role: 'CUSTOMER' },
      include: {
        memberships: {
          orderBy: { createdAt: 'desc' },
          take: 1
        },
        subscriptions: {
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

    // Identify incomplete signups (proration now, but initial payment not completed)
    // Criteria: subscription status in PENDING_PAYMENT/INCOMPLETE/INCOMPLETE_EXPIRED
    // and latest invoice not paid; no confirmed payments since subscription creation
    const rawIncompleteSubs = await prisma.subscription.findMany({
      where: { status: { in: ['PENDING_PAYMENT', 'INCOMPLETE', 'INCOMPLETE_EXPIRED'] } },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: {
        user: { select: { id: true, firstName: true, lastName: true, email: true } },
        routedEntity: { select: { displayName: true } },
        invoices: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })

    const incompleteToDos = [] as Array<{
      id: string
      customerName: string
      customerId: string
      amount: number
      routedToEntity: string
      routingReason: string
      timestamp: string
      status: string
      goCardlessId: string | null
      retryCount: number
      processingTime: number
      confidence: string
      membershipType: string
    }>

    for (const sub of rawIncompleteSubs) {
      const invoice = sub.invoices[0]
      // Include when there is no invoice yet OR invoice is not paid/void
      if (invoice && ['paid', 'void'].includes(invoice.status)) continue

      // Ensure no confirmed payment since subscription was created
      const hasConfirmed = await prisma.payment.count({
        where: {
          userId: sub.userId,
          status: 'CONFIRMED',
          createdAt: { gte: sub.createdAt }
        }
      })
      if (hasConfirmed > 0) continue

      incompleteToDos.push({
        id: `INC_${invoice.id}`,
        customerName: `${sub.user.firstName} ${sub.user.lastName}`,
        customerId: sub.userId,
        amount: Number(invoice.amount),
        routedToEntity: sub.routedEntity?.displayName || 'Not Routed',
        routingReason: 'Prorated signup: initial payment not completed',
        timestamp: invoice.createdAt.toISOString(),
        status: 'INCOMPLETE_SIGNUP',
        goCardlessId: null,
        retryCount: 0,
        processingTime: 0,
        confidence: 'MEDIUM',
        membershipType: sub.membershipType
      })
    }

    // Format the data for frontend
    const formattedCustomers = customers.map((customer: any) => {
      const membership = customer.memberships[0]
      const subscription = customer.subscriptions[0]
      const confirmedPaymentsCount = customer.payments.filter((p: any) => p.status === 'CONFIRMED').length
      const nextBillingIso = membership?.nextBillingDate ? membership.nextBillingDate.toISOString().split('T')[0] : 'N/A'

      // Derive clear status with distinctions
      let derivedStatus = 'INACTIVE'
      if (subscription) {
        // Normalize TRIALING → ACTIVE for access
        derivedStatus = subscription.status === 'TRIALING' ? 'ACTIVE' : subscription.status || 'ACTIVE'
      } else if (membership && membership.status === 'PENDING_PAYMENT' && confirmedPaymentsCount === 0) {
        derivedStatus = 'PENDING_PAYMENT'
      } else if (membership) {
        derivedStatus = membership.status
      }

      // Detect DD migration trials (no upfront payment, starts next billing)
      const startsOn = subscription && confirmedPaymentsCount === 0 && membership?.nextBillingDate && membership.nextBillingDate > new Date()
        ? membership.nextBillingDate.toISOString().split('T')[0]
        : null

      return {
        id: customer.id,
        name: `${customer.firstName} ${customer.lastName}`,
        email: customer.email,
        phone: customer.phone || 'N/A',
        membershipType: membership?.membershipType || 'None',
        status: derivedStatus,
        subscriptionStatus: subscription?.status || 'NO_SUBSCRIPTION',
        membershipStatus: membership?.status || 'NO_MEMBERSHIP',
        cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd || false,
        joinDate: customer.createdAt.toISOString().split('T')[0],
        lastPayment: customer.payments[0]?.createdAt.toISOString().split('T')[0] || 'N/A',
        totalPaid: customer.payments.reduce((sum: number, payment: any) => sum + Number(payment.amount), 0),
        routedEntity: customer.payments[0]?.routedEntity?.displayName || 'N/A',
        nextBilling: nextBillingIso,
        startsOn,
        emergencyContact: customer.emergencyContact ? JSON.parse(customer.emergencyContact) : { name: '', phone: '', relationship: '' },
        accessHistory: {
          lastAccess: 'N/A',
          totalVisits: 0,
          avgWeeklyVisits: 0
        }
      }
    })

    // Build incomplete signup todos for users with a pending membership but no subscription yet
    const membershipIncompleteToDos = [] as Array<{
      id: string
      customerName: string
      customerId: string
      amount: number
      routedToEntity: string
      routingReason: string
      timestamp: string
      status: string
      goCardlessId: string | null
      retryCount: number
      processingTime: number
      confidence: string
      membershipType: string
    }>

    for (const c of customers) {
      const membership = c.memberships[0]
      const subscription = c.subscriptions[0]
      if (!membership) continue
      if (membership.status !== 'PENDING_PAYMENT') continue
      // Only include if there is no subscription record yet
      if (subscription) continue
      // Ensure no confirmed payments (any time)
      const confirmedCount = await prisma.payment.count({ where: { userId: c.id, status: 'CONFIRMED' } })
      if (confirmedCount > 0) continue

      membershipIncompleteToDos.push({
        id: `INC_MEM_${membership.id}`,
        customerName: `${c.firstName} ${c.lastName}`,
        customerId: c.id,
        amount: Number(membership.monthlyPrice || 0),
        routedToEntity: 'Not Routed',
        routingReason: 'Prorated signup: no payment started',
        timestamp: membership.createdAt.toISOString(),
        status: 'INCOMPLETE_SIGNUP',
        goCardlessId: null,
        retryCount: 0,
        processingTime: 0,
        confidence: 'MEDIUM',
        membershipType: membership.membershipType
      })
    }

    const formattedPayments = [
      ...payments.map((payment: any) => ({
      id: payment.id,
      customerName: `${payment.user.firstName} ${payment.user.lastName}`,
      customerId: payment.userId,
      amount: Number(payment.amount),
      routedToEntity: payment.routedEntity?.displayName || 'Not Routed',
      routingReason: payment.routing?.routingReason || 'Standard routing',
      timestamp: payment.createdAt.toISOString(),
      status: payment.status,
      goCardlessId: payment.goCardlessPaymentId || 'N/A',
      retryCount: payment.retryCount,
      processingTime: payment.routing?.decisionTimeMs || 0,
      confidence: payment.routing?.confidence || 'MEDIUM',
      membershipType: formattedCustomers.find(c => c.id === payment.userId)?.membershipType || 'Unknown'
    })),
      ...incompleteToDos,
      ...membershipIncompleteToDos
    ]

    return NextResponse.json({
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: Number(monthlyRevenue._sum.amount) || 0,
      churnRate: Math.round(churnRate * 100) / 100,
      acquisitionRate: Math.round(acquisitionRate * 100) / 100,
      routingEfficiency: Math.round(actualRoutingEfficiency * 100) / 100,
      recentActivity: activities,
      vatStatus: vatPositions,
      customers: formattedCustomers,
      payments: formattedPayments,
      metrics: {
        totalRevenue: Number(totalRevenue._sum.amount) || 0,
        monthlyRecurring: Number(monthlyRevenue._sum.amount) || 0,
        churnRate: Math.round(churnRate * 100) / 100,
        acquisitionRate: Math.round(acquisitionRate * 100) / 100,
        avgLifetimeValue: totalCustomers > 0 ? Math.round((Number(totalRevenue._sum.amount) || 0) / totalCustomers) : 0,
        paymentSuccessRate: Math.round(paymentSuccessRate * 100) / 100,
        routingEfficiency: Math.round(actualRoutingEfficiency * 100) / 100
      },
      // 🚀 NEW: Real business analytics by membership type
      analytics: {
        membershipCLV,
        membershipStats,
        acquisitionDetails: {
          thisMonth: thisMonthCustomers,
          lastMonth: lastMonthCustomers,
          growthRate: acquisitionRate
        },
        operationalMetrics: {
          autoRoutingRate: Math.round(actualRoutingEfficiency * 100) / 100,
          manualOverrideRate: Math.round((100 - actualRoutingEfficiency) * 100) / 100,
          avgDecisionTime: routingDecisions._avg.decisionTimeMs ? Math.round(routingDecisions._avg.decisionTimeMs / 1000 * 10) / 10 : 1.2
        }
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