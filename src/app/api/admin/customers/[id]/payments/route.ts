import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * GET /api/admin/customers/[id]/payments
 * 
 * Fetches ALL payments for a specific customer (no limit).
 * Used by Member Summary Modal to show complete payment history.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    // Auth check
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true }
    })

    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const params = await context.params
    const customerId = params.id

    if (!customerId) {
      return NextResponse.json({ error: 'Customer ID required' }, { status: 400 })
    }

    // Fetch ALL payments for this customer (no limit!)
    const payments = await prisma.payment.findMany({
      where: { 
        userId: customerId,
        amount: { gt: 0 }
      },
      orderBy: [
        { processedAt: 'desc' },
        { createdAt: 'desc' }
      ],
      include: {
        routedEntity: { select: { displayName: true } }
      }
    })

    // Format for frontend
    const formattedPayments = payments.map(payment => ({
      id: payment.id,
      amount: Number(payment.amount),
      currency: payment.currency,
      status: payment.status,
      description: payment.description,
      failureReason: payment.failureReason,
      stripeInvoiceId: payment.stripeInvoiceId,
      createdAt: payment.createdAt.toISOString(),
      processedAt: payment.processedAt?.toISOString() || null,
      routedEntity: payment.routedEntity?.displayName || 'N/A'
    }))

    return NextResponse.json({
      success: true,
      payments: formattedPayments,
      total: formattedPayments.length
    })

  } catch (error: any) {
    console.error('Error fetching customer payments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch payments', details: error.message },
      { status: 500 }
    )
  }
}

