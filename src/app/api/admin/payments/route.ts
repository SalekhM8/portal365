import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/admin/payments
 * 
 * Paginated payments endpoint.
 * Query params:
 *   - page: number (default 1)
 *   - limit: number (default 50, max 100)
 *   - customerId: string (optional, filter to specific customer)
 *   - status: string (optional, filter by status)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'))
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') || '50')))
    const customerId = searchParams.get('customerId') || undefined
    const status = searchParams.get('status') || undefined
    const skip = (page - 1) * limit

    // Build where clause
    const where: any = { amount: { gt: 0 } }
    if (customerId) {
      where.userId = customerId
    }
    if (status && status !== 'all') {
      where.status = status
    }

    // Get total count for pagination
    const totalCount = await prisma.payment.count({ where })

    // Get paginated payments
    const payments = await prisma.payment.findMany({
      where,
      orderBy: [
        { processedAt: 'desc' },
        { createdAt: 'desc' }
      ],
      skip,
      take: limit,
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

    // Format payments for frontend
    const formattedPayments = payments.map((payment: any) => ({
      id: payment.id,
      customerName: `${payment.user.firstName} ${payment.user.lastName}`,
      customerId: payment.userId,
      amount: Number(payment.amount),
      routedToEntity: payment.routedEntity?.displayName || 'Not Routed',
      routingReason: payment.routing?.routingReason || 'Standard routing',
      timestamp: payment.createdAt.toISOString(),
      status: payment.status,
      failureReason: payment.failureReason || '',
      goCardlessId: payment.goCardlessPaymentId || 'N/A',
      retryCount: payment.retryCount || 0,
      processingTime: payment.routing?.decisionTimeMs || 0,
      confidence: payment.routing?.confidence || 'MEDIUM',
      membershipType: 'Unknown'
    }))

    return NextResponse.json({
      success: true,
      payments: formattedPayments,
      pagination: {
        page,
        limit,
        totalCount,
        totalPages: Math.ceil(totalCount / limit),
        hasMore: page * limit < totalCount
      }
    })

  } catch (error: any) {
    console.error('Error fetching payments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payments', details: error.message },
      { status: 500 }
    )
  }
}

