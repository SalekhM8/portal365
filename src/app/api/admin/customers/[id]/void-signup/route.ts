import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Safely clean up an abandoned signup (no money collected)
// Preconditions:
// - Latest subscription for the user is PENDING_PAYMENT | INCOMPLETE | INCOMPLETE_EXPIRED
// - No CONFIRMED payments for the user since subscription creation
// - No PAID invoices for that subscription
// Actions:
// - Delete routing/invoices(not paid)/pending+failed payments/logs linked to that subscription
// - Delete the subscription
// - Delete pending membership if no other subs
// - Optionally mark user INACTIVE if they have no active artefacts left

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

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
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
      }
    })
    if (!customer) {
      return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    }

    const subscription = customer.subscriptions[0]
    if (!subscription) {
      return NextResponse.json({ error: 'No subscription found to void' }, { status: 404 })
    }

    const voidableStatuses = ['PENDING_PAYMENT', 'INCOMPLETE', 'INCOMPLETE_EXPIRED']
    if (!voidableStatuses.includes(subscription.status)) {
      return NextResponse.json({ error: `Subscription is ${subscription.status} and cannot be voided via cleanup` }, { status: 400 })
    }

    // Any PAID invoices? If yes, do not allow cleanup
    const paidInvoice = await prisma.invoice.findFirst({
      where: { subscriptionId: subscription.id, status: 'paid' }
    })
    if (paidInvoice) {
      return NextResponse.json({ error: 'Subscription has a paid invoice and cannot be voided. Use refunds/standard flows.' }, { status: 400 })
    }

    // Any confirmed payments since subscription creation? If yes, block cleanup
    const confirmedPayment = await prisma.payment.findFirst({
      where: {
        userId: customer.id,
        status: 'CONFIRMED',
        createdAt: { gte: subscription.createdAt }
      }
    })
    if (confirmedPayment) {
      return NextResponse.json({ error: 'Customer has confirmed payments; cannot void signup.' }, { status: 400 })
    }

    const result = await prisma.$transaction(async (tx) => {
      // Delete non-paid invoices for this subscription
      const deletedInvoices = await tx.invoice.deleteMany({
        where: {
          subscriptionId: subscription.id,
          status: { in: ['open', 'void', 'uncollectible', 'draft'] }
        }
      })

      // Gather pending/failed payments for the user since sub creation
      const orphanPayments = await tx.payment.findMany({
        where: {
          userId: customer.id,
          status: { in: ['PENDING', 'FAILED'] },
          createdAt: { gte: subscription.createdAt }
        },
        select: { id: true }
      })
      const orphanPaymentIds = orphanPayments.map(p => p.id)

      if (orphanPaymentIds.length > 0) {
        // Delete payment routing tied to those payments
        await tx.paymentRouting.deleteMany({ where: { paymentId: { in: orphanPaymentIds } } })
        await tx.payment.deleteMany({ where: { id: { in: orphanPaymentIds } } })
      }

      // Delete routing & audit logs for the subscription
      await tx.subscriptionRouting.deleteMany({ where: { subscriptionId: subscription.id } })
      await tx.subscriptionAuditLog.deleteMany({ where: { subscriptionId: subscription.id } })

      // Delete the subscription itself
      await tx.subscription.delete({ where: { id: subscription.id } })

      // Remove pending membership if present and no other active subs
      const activeOrTrialSubs = await tx.subscription.count({
        where: { userId: customer.id, status: { in: ['ACTIVE', 'TRIALING', 'PAUSED'] } }
      })

      let deletedMemberships = 0
      if (activeOrTrialSubs === 0) {
        const del = await tx.membership.deleteMany({
          where: { userId: customer.id, status: 'PENDING_PAYMENT' }
        })
        deletedMemberships = del.count
      }

      // If the user has nothing left, mark as INACTIVE
      const remaining = await Promise.all([
        tx.membership.count({ where: { userId: customer.id } }),
        tx.subscription.count({ where: { userId: customer.id } }),
        tx.payment.count({ where: { userId: customer.id, status: 'CONFIRMED' } })
      ])
      const [remMembers, remSubs, remConfirmed] = remaining
      let userStatusChanged = false
      if (remMembers === 0 && remSubs === 0 && remConfirmed === 0) {
        await tx.user.update({ where: { id: customer.id }, data: { status: 'INACTIVE' } })
        userStatusChanged = true
      }

      // Note: We do not write a SubscriptionAuditLog here because the subscription
      // has been deleted. The audit log table enforces a foreign key to an
      // existing subscription, so writing after delete would violate the FK.
      // If audit is required, we can add a separate system log not tied by FK.

      return { deletedInvoices: deletedInvoices.count, deletedPayments: orphanPaymentIds.length, deletedMemberships, userStatusChanged }
    })

    return NextResponse.json({ success: true, message: 'Abandoned signup voided and cleaned up', result })

  } catch (error: any) {
    console.error('Void signup cleanup error:', error)
    return NextResponse.json({ error: error?.message || 'Failed to void signup' }, { status: 500 })
  }
}


