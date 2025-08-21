import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * VOID LATEST OPEN INVOICE
 * - Admin action to void the latest open invoice (prevent accidental collection)
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

    // SUPER_ADMIN preferred, allow ADMIN per business needs
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

    const openInvoices = await stripe.invoices.list({
      customer: subscription.stripeCustomerId,
      status: 'open',
      limit: 1
    })
    const invoice = openInvoices.data[0]
    if (!invoice) {
      return NextResponse.json({ error: 'No open invoice to void' }, { status: 400 })
    }

    const voided = await stripe.invoices.voidInvoice(invoice.id as string)

    // Audit log
    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: subscription.id,
          action: 'VOID_INVOICE',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason: 'Admin-voided open invoice',
          operationId: `void_${invoice.id}_${Date.now()}`,
          metadata: JSON.stringify({ invoiceId: invoice.id, status: voided.status })
        }
      })
    } catch {}

    return NextResponse.json({ success: true, invoice: { id: voided.id, status: voided.status } })

  } catch (error: any) {
    return NextResponse.json({ error: error.message || 'Void failed' }, { status: 500 })
  }
}


