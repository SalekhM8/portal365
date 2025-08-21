import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * RETRY LATEST INVOICE PAYMENT
 * - Admin action to attempt payment on the latest open invoice
 * - Creates a SubscriptionAuditLog entry
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    // ADMIN or SUPER_ADMIN only
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role as any)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const params = await context.params
    const customerId = params.id

    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: { in: ['ACTIVE', 'PAUSED', 'TRIALING', 'PAST_DUE'] } },
          orderBy: { updatedAt: 'desc' },
          take: 1
        }
      }
    })
    if (!customer || customer.subscriptions.length === 0) {
      return NextResponse.json({ error: 'No subscription found' }, { status: 404 })
    }

    const subscription = customer.subscriptions[0]

    // Get latest open invoice for this Stripe customer
    const openInvoices = await stripe.invoices.list({
      customer: subscription.stripeCustomerId,
      status: 'open',
      limit: 1
    })

    const invoice = openInvoices.data[0]
    if (!invoice) {
      return NextResponse.json({ error: 'No open invoice available to retry' }, { status: 400 })
    }

    // Attempt to pay the invoice (charge_automatically will use default payment method)
    const paid = await stripe.invoices.pay(invoice.id)

    // Audit log
    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'RETRY_INVOICE',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: 'Admin-triggered retry of latest open invoice',
          operationId: `retry_${invoice.id}_${Date.now()}`,
          metadata: JSON.stringify({ invoiceId: invoice.id, status: paid.status })
        }
      })
    } catch {}

    return NextResponse.json({ success: true, invoice: { id: paid.id, status: paid.status } })

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Retry failed' }, { status: 500 })
  }
}


