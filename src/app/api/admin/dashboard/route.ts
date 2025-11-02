// Force dynamic, no caching – ensure fresh values and env flags on each call
export const dynamic = 'force-dynamic'
export const revalidate = 0
export const fetchCache = 'force-no-store'
export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { VATCalculationEngine } from '@/lib/vat-routing'
import { stripe } from '@/lib/stripe'

export async function GET(request: NextRequest) {
  try {
    const url = request?.url ? new URL(request.url) : null
    const isLite = url?.searchParams?.get('lite') === '1'
    // ✅ REUSE your existing auth pattern
    const session = await getServerSession(authOptions) as any
    
    if (!session || !session.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get total customers
    const totalCustomers = await prisma.user.count({ where: { role: 'CUSTOMER' } })

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

    // Get total revenue this month (month-to-date)
    const monthlyRevenue = await prisma.payment.aggregate({
      where: {
        status: 'CONFIRMED',
        createdAt: { gte: thisMonthStart }
      },
      _sum: { amount: true }
    })

    // Calculate last calendar month boundaries in UTC for precise month windows
    const nowUtc = new Date()
    const thisMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1))
    const lastMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1))
    const prevMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 2, 1))

    // Last calendar month revenue using processedAt to reflect when a payment actually completed
    const lastMonthRevenue = await prisma.payment.aggregate({
      where: {
        status: 'CONFIRMED',
        processedAt: {
          gte: lastMonthStartUtc,
          lt: thisMonthStartUtc
        }
      },
      _sum: { amount: true }
    })

    // Previous calendar month revenue for month-over-month comparisons
    const prevMonthRevenue = await prisma.payment.aggregate({
      where: {
        status: 'CONFIRMED',
        processedAt: {
          gte: prevMonthStartUtc,
          lt: lastMonthStartUtc
        }
      },
      _sum: { amount: true }
    })

    // Get total revenue all time (DB) – kept as fallback
    const totalRevenue = await prisma.payment.aggregate({
      where: { status: 'CONFIRMED' },
      _sum: { amount: true }
    })

    // Strict Stripe-ledger parity mode for metrics (feature-flagged)
    const useStripeLedger = process.env.STRIPE_LEDGER_MODE === 'true'

    // Stripe-aligned metrics via charges minus refunds (Stripe dashboard Net volume), cached 10 minutes
    let ledgerTotalNetAllTime: number | null = null
    let ledgerLastMonthNet: number | null = null
    let ledgerThisMonthNet: number | null = null
    try {
      const now = new Date()
      const thisMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const lastMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))

      const CACHE_KEY_TOTAL = 'metrics:ledger:totalNetAllTime'
      const CACHE_KEY_LAST = 'metrics:ledger:lastMonthNet'
      const CACHE_KEY_THIS = 'metrics:ledger:thisMonthNet'
      const CACHE_TTL_MS = 10 * 60 * 1000
      const settingTotal = await prisma.systemSetting.findUnique({ where: { key: CACHE_KEY_TOTAL } })
      const settingLast = await prisma.systemSetting.findUnique({ where: { key: CACHE_KEY_LAST } })
      const settingThis = await prisma.systemSetting.findUnique({ where: { key: CACHE_KEY_THIS } })
      const nowMs = Date.now()
      if (settingTotal && !useStripeLedger) {
        try {
          const parsed = JSON.parse(settingTotal.value || '{}') as { amount?: number; fetchedAt?: string }
          const fetchedAtMs = parsed?.fetchedAt ? Date.parse(parsed.fetchedAt) : 0
          if (parsed?.amount != null && fetchedAtMs && nowMs - fetchedAtMs < CACHE_TTL_MS) {
            ledgerTotalNetAllTime = Number(parsed.amount)
          }
        } catch {}
      }
      if (settingLast && !useStripeLedger) {
        try {
          const parsed = JSON.parse(settingLast.value || '{}') as { amount?: number; fetchedAt?: string }
          const fetchedAtMs = parsed?.fetchedAt ? Date.parse(parsed.fetchedAt) : 0
          if (parsed?.amount != null && fetchedAtMs && nowMs - fetchedAtMs < CACHE_TTL_MS) {
            ledgerLastMonthNet = Number(parsed.amount)
          }
        } catch {}
      }
      if (settingThis && !useStripeLedger) {
        try {
          const parsed = JSON.parse(settingThis.value || '{}') as { amount?: number; fetchedAt?: string }
          const fetchedAtMs = parsed?.fetchedAt ? Date.parse(parsed.fetchedAt) : 0
          if (parsed?.amount != null && fetchedAtMs && nowMs - fetchedAtMs < CACHE_TTL_MS) {
            ledgerThisMonthNet = Number(parsed.amount)
          }
        } catch {}
      }

      async function sumChargesMinusRefunds(created?: { gte?: number; lt?: number }) {
        let hasMore = true
        let startingAfter: string | undefined = undefined
        let grossMinor = 0
        let refundedMinor = 0
        while (hasMore) {
          const batch: any = await stripe.charges.list({
            limit: 100,
            starting_after: startingAfter,
            ...(created ? { created } : {})
          })
          for (const ch of batch.data) {
            const succeeded = (ch as any).status === 'succeeded' || (ch as any).paid === true
            if (!succeeded) continue
            grossMinor += Number(ch.amount || 0)
            refundedMinor += Number((ch as any).amount_refunded || 0)
          }
          hasMore = batch.has_more
          startingAfter = batch.data[batch.data.length - 1]?.id
        }
        return (grossMinor - refundedMinor) / 100
      }

      if (ledgerTotalNetAllTime == null || useStripeLedger) {
        ledgerTotalNetAllTime = await sumChargesMinusRefunds()
        const payload = JSON.stringify({ amount: ledgerTotalNetAllTime, fetchedAt: new Date().toISOString() })
        if (settingTotal) await prisma.systemSetting.update({ where: { key: CACHE_KEY_TOTAL }, data: { value: payload } })
        else await prisma.systemSetting.create({ data: { key: CACHE_KEY_TOTAL, value: payload, description: 'Cached Stripe ledger total net (all time)', category: 'metrics' } })
      }
      if (ledgerLastMonthNet == null || useStripeLedger) {
        ledgerLastMonthNet = await sumChargesMinusRefunds({ gte: Math.floor(lastMonthStart.getTime()/1000), lt: Math.floor(thisMonthStart.getTime()/1000) })
        const payload = JSON.stringify({ amount: ledgerLastMonthNet, fetchedAt: new Date().toISOString() })
        if (settingLast) await prisma.systemSetting.update({ where: { key: CACHE_KEY_LAST }, data: { value: payload } })
        else await prisma.systemSetting.create({ data: { key: CACHE_KEY_LAST, value: payload, description: 'Cached Stripe ledger last month net', category: 'metrics' } })
      }
      if (ledgerThisMonthNet == null || useStripeLedger) {
        ledgerThisMonthNet = await sumChargesMinusRefunds({ gte: Math.floor(thisMonthStart.getTime()/1000) })
        const payload = JSON.stringify({ amount: ledgerThisMonthNet, fetchedAt: new Date().toISOString() })
        if (settingThis) await prisma.systemSetting.update({ where: { key: CACHE_KEY_THIS }, data: { value: payload } })
        else await prisma.systemSetting.create({ data: { key: CACHE_KEY_THIS, value: payload, description: 'Cached Stripe ledger this month net (MTD)', category: 'metrics' } })
      }
    } catch (e) {
      ledgerTotalNetAllTime = null
      ledgerLastMonthNet = null
      ledgerThisMonthNet = null
    }

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
        // For now, always show Sporting U as the routed entity label in activity
        detail: `Sporting U • ${new Date(payment.createdAt).toLocaleString()}`,
        timestamp: payment.createdAt,
        amount: `£${payment.amount}`,
        status: payment.status,
        userId: payment.userId
      })),
      ...recentSignups.map((user: any) => ({
        type: 'signup',
        icon: 'UserPlus',
        color: 'text-blue-600',
        message: `${user.firstName} ${user.lastName} signed up`,
        detail: `${user.memberships[0]?.membershipType || 'No membership'} • ${new Date(user.createdAt).toLocaleString()}`,
        timestamp: user.createdAt,
        amount: null,
        status: 'NEW',
        userId: user.id
      })),
      ...recentMembershipChanges.map((membership: any) => ({
        type: 'membership_change',
        icon: 'TrendingUp',
        color: 'text-purple-600',
        message: `${membership.user?.firstName} ${membership.user?.lastName} changed membership`,
        detail: `Now: ${membership.membershipType} (£${membership.monthlyPrice}) • ${new Date(membership.updatedAt).toLocaleString()}`,
        timestamp: membership.updatedAt,
        amount: `£${membership.monthlyPrice}`,
        status: 'UPDATED',
        userId: membership.userId
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
        status: subscription.status,
        userId: subscription.userId
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
    const customers = isLite ? [] : await prisma.user.findMany({
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
          where: { amount: { gt: 0 } },
          orderBy: [
            { processedAt: 'desc' },
            { createdAt: 'desc' }
          ],
          take: 5,
          include: {
            routedEntity: { select: { displayName: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: 500
    })

    // Lifetime total paid per customer (all confirmed payments)
    const totals = await prisma.payment.groupBy({
      by: ['userId'],
      where: { status: 'CONFIRMED' },
      _sum: { amount: true }
    })
    const totalPaidByUser: Record<string, number> = {}
    for (const t of totals) {
      totalPaidByUser[t.userId] = Number(t._sum.amount || 0)
    }

    // Get recent payments with detailed info
    const payments = isLite ? [] : await prisma.payment.findMany({
      where: { amount: { gt: 0 } },
      orderBy: [
        { processedAt: 'desc' },
        { createdAt: 'desc' }
      ],
      take: 500,
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

    // Best-effort enrichment of failure reasons for recent failed payments lacking a reason
    const enrichedFailureReasonById: Record<string, string> = {}
    const failedNeedingReason = payments.filter((p: any) => p.status === 'FAILED' && !p.failureReason).slice(0, 10)
    for (const p of failedNeedingReason) {
      try {
        const desc: string = p.description || ''
        const piMatch = desc.match(/\[pi:([^\]]+)\]/)
        const invMatch = desc.match(/\[inv:([^\]]+)\]/)
        let paymentIntentId: string | null = piMatch?.[1] || null
        if (!paymentIntentId && invMatch?.[1]) {
          const inv = await stripe.invoices.retrieve(invMatch[1])
          paymentIntentId = (inv as any)?.payment_intent || null
        }
        if (!paymentIntentId) {
          // Fallback via Stripe customer: try to find a matching invoice around the payment time
          const sub = await prisma.subscription.findFirst({ where: { userId: p.userId }, orderBy: { createdAt: 'desc' } })
          if (sub?.stripeCustomerId) {
            const list = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 5 })
            const candidate = list.data.find(i => (i.amount_due || 0) === Math.round(Number(p.amount) * 100))
            if (candidate) paymentIntentId = (candidate as any)?.payment_intent || null
          }
        }
        if (paymentIntentId) {
          const pi = await stripe.paymentIntents.retrieve(paymentIntentId)
          const latestChargeId = (pi as any)?.latest_charge as string | undefined
          let declineCode: string | undefined
          let failureMessage: string | undefined
          if (latestChargeId) {
            const charge = await stripe.charges.retrieve(latestChargeId)
            declineCode = (charge as any)?.decline_code || (charge as any)?.outcome?.reason || (charge as any)?.failure_code
            failureMessage = (charge as any)?.failure_message || (charge as any)?.outcome?.seller_message
          }
          const err = (pi as any)?.last_payment_error
          const piCode = err?.decline_code || err?.code
          const piMsg = err?.message as string | undefined
          const code = (declineCode || piCode || '').toString()
          const codeMap: Record<string, string> = {
            'insufficient_funds': 'Insufficient funds',
            'card_declined': 'Card declined',
            'expired_card': 'Card expired',
            'incorrect_cvc': 'Incorrect CVC',
            'incorrect_number': 'Incorrect card number',
            'authentication_required': 'Authentication required',
            'do_not_honor': 'Card issuer declined'
          }
          const reason = codeMap[code] || failureMessage || piMsg
          if (reason) enrichedFailureReasonById[p.id] = reason
        }
      } catch {}
    }

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

      const incId = invoice ? `INC_${invoice.id}` : `INC_SUB_${sub.id}`
      const amount = invoice ? Number(invoice.amount) : Number(sub.monthlyPrice || 0)
      const timestampIso = (invoice?.createdAt || sub.createdAt).toISOString()

      incompleteToDos.push({
        id: incId,
        customerName: `${sub.user.firstName} ${sub.user.lastName}`,
        customerId: sub.userId,
        amount,
        routedToEntity: sub.routedEntity?.displayName || 'Not Routed',
        routingReason: 'Prorated signup: initial payment not completed',
        timestamp: timestampIso,
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

      // Determine last paid amount (most recent CONFIRMED payment)
      const lastConfirmedPayment = customer.payments.find((p: any) => p.status === 'CONFIRMED')
      const lastPaidAmount = lastConfirmedPayment ? Number(lastConfirmedPayment.amount) : null

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
        lastPayment: lastPaidAmount,
        totalPaid: totalPaidByUser[customer.id] ?? 0,
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

    // Build payment items with a stable key per billing artifact to dedupe and auto-hide on success
    const paymentItemsRaw = payments.map((payment: any) => {
      const desc: string = payment.description || ''
      const invMatch = desc.match(/\[inv:([^\]]+)\]/)
      const key = invMatch?.[1] || `${payment.userId}:${payment.createdAt.toISOString().slice(0,7)}` // fallback: user-month
      return {
        id: payment.id,
        customerName: `${payment.user.firstName} ${payment.user.lastName}`,
        customerId: payment.userId,
        amount: Number(payment.amount),
        routedToEntity: payment.routedEntity?.displayName || 'Not Routed',
        routingReason: payment.routing?.routingReason || 'Standard routing',
        timestamp: payment.createdAt.toISOString(),
        status: payment.status,
        failureReason: payment.failureReason || enrichedFailureReasonById[payment.id],
        goCardlessId: payment.goCardlessPaymentId || 'N/A',
        retryCount: payment.retryCount,
        processingTime: payment.routing?.decisionTimeMs || 0,
        confidence: payment.routing?.confidence || 'MEDIUM',
        membershipType: formattedCustomers.find(c => c.id === payment.userId)?.membershipType || 'Unknown',
        _key: key,
        _ts: payment.createdAt.getTime()
      }
    })

    // Group by key (newest first)
    const grouped: Record<string, Array<typeof paymentItemsRaw[number]>> = {}
    for (const it of paymentItemsRaw.sort((a,b) => b._ts - a._ts)) {
      grouped[it._key] = grouped[it._key] || []
      grouped[it._key].push(it)
    }

    // For each key: if any CONFIRMED exists, hide entire key; else take first FAILED that isn't dismissed
    const picked: Array<typeof paymentItemsRaw[number]> = []
    for (const key of Object.keys(grouped)) {
      const list = grouped[key]
      const hasConfirmed = list.some(i => i.status === 'CONFIRMED')
      if (hasConfirmed) continue
      const candidate = list.find(i => i.status === 'FAILED' && i.failureReason !== 'DISMISSED_ADMIN')
      if (candidate) picked.push(candidate)
    }

    const paymentTodos = picked.map(({ _key, _ts, ...rest }) => rest)

    const payments_full = payments.map((payment: any) => ({
      id: payment.id,
      customerName: `${payment.user.firstName} ${payment.user.lastName}`,
      customerId: payment.userId,
      amount: Number(payment.amount),
      routedToEntity: payment.routedEntity?.displayName || 'Not Routed',
      routingReason: payment.routing?.routingReason || 'Standard routing',
      timestamp: payment.createdAt.toISOString(),
      status: payment.status,
      failureReason: payment.failureReason || enrichedFailureReasonById[payment.id],
      goCardlessId: payment.goCardlessPaymentId || 'N/A',
      retryCount: payment.retryCount,
      processingTime: payment.routing?.decisionTimeMs || 0,
      confidence: payment.routing?.confidence || 'MEDIUM',
      membershipType: formattedCustomers.find(c => c.id === payment.userId)?.membershipType || 'Unknown'
    }))

    const payments_todo = [
      ...paymentTodos,
      ...incompleteToDos,
      ...membershipIncompleteToDos
    ]

    // Fetch Stripe payouts (last paid and next/pending)
    let lastPayout: any = null
    let nextPayout: any = null
    try {
      const paidPayouts = await stripe.payouts.list({ status: 'paid', limit: 1 })
      if (paidPayouts.data[0]) {
        lastPayout = {
          amount: Number(paidPayouts.data[0].amount) / 100,
          currency: paidPayouts.data[0].currency.toUpperCase(),
          arrivalDate: new Date(paidPayouts.data[0].arrival_date * 1000).toISOString().split('T')[0]
        }
      }
      const pendingPayouts = await stripe.payouts.list({ status: 'pending', limit: 1 })
      if (pendingPayouts.data[0]) {
        nextPayout = {
          amount: Number(pendingPayouts.data[0].amount) / 100,
          currency: pendingPayouts.data[0].currency.toUpperCase(),
          arrivalDate: new Date(pendingPayouts.data[0].arrival_date * 1000).toISOString().split('T')[0]
        }
      } else {
        try {
          const bal = await stripe.balance.retrieve()
          const pendingTotal = (bal.pending || []).reduce((sum: number, b: any) => sum + Number(b.amount || 0), 0)
          nextPayout = {
            amount: pendingTotal / 100,
            currency: (bal.pending?.[0]?.currency || 'gbp').toUpperCase(),
            arrivalDate: null
          }
        } catch {}
      }
    } catch (e) {
      // Non-fatal; payouts not available
    }

    return NextResponse.json({
      parityMode: useStripeLedger ? 'stripe_ledger' : 'db',
      build: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0,7) || null,
      totalCustomers,
      activeSubscriptions,
      monthlyRevenue: Number(monthlyRevenue._sum.amount) || 0,
      churnRate: Math.round(churnRate * 100) / 100,
      acquisitionRate: Math.round(acquisitionRate * 100) / 100,
      routingEfficiency: Math.round(actualRoutingEfficiency * 100) / 100,
      recentActivity: activities,
      vatStatus: vatPositions,
      customers: isLite ? [] : formattedCustomers,
      payments: isLite ? [] : payments_full,
      counts: {
        customers: totalCustomers,
        payments: await prisma.payment.count()
      },
      payments_todo,
      metrics: {
        // Strict Stripe-ledger parity when enabled
        totalRevenue: useStripeLedger ? (ledgerTotalNetAllTime || 0) : ((ledgerTotalNetAllTime ?? Number(totalRevenue._sum.amount)) || 0),
        monthlyRecurring: useStripeLedger ? (ledgerThisMonthNet || 0) : (Number(monthlyRevenue._sum.amount) || 0),
        monthlyRecurringLastMonth: useStripeLedger ? (ledgerLastMonthNet || 0) : (Number(lastMonthRevenue._sum.amount) || 0),
        monthlyRecurringPrevMonth: Number(prevMonthRevenue._sum.amount) || 0,
        churnRate: Math.round(churnRate * 100) / 100,
        acquisitionRate: Math.round(acquisitionRate * 100) / 100,
        avgLifetimeValue: totalCustomers > 0 ? Math.round((Number(totalRevenue._sum.amount) || 0) / totalCustomers) : 0,
        paymentSuccessRate: Math.round(paymentSuccessRate * 100) / 100,
        routingEfficiency: Math.round(actualRoutingEfficiency * 100) / 100,
        totalMembers: activeSubscriptions,
        payouts: {
          last: lastPayout,
          upcoming: nextPayout
        }
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