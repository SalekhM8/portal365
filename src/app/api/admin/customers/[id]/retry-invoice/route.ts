import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { recoverCanceledPiInvoice } from '@/lib/canceled-pi-recovery'

/**
 * RETRY LATEST INVOICE PAYMENT
 * - Admin action to attempt payment on the latest open invoice
 * - If the invoice still has a live PaymentIntent (not canceled / not exhausted),
 *   we call invoices.pay() to retry through Stripe's normal flow.
 * - If Smart Retries has already canceled the PI (the "This invoice can no longer
 *   be paid" case), we create a fresh off-session PI against the customer's default
 *   card and mark the invoice paid_out_of_band on success.
 * - Creates a SubscriptionAuditLog entry either way.
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

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((subscription as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

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

    // Detect "Smart Retries gave up" state — invoice is open but its PI has been
    // canceled (or there's no live PI), so invoices.pay() would throw
    // "This invoice can no longer be paid". In that case, take the fresh-PI path.
    const piId = (invoice as any).payment_intent as string | null | undefined
    let piIsDead = !piId
    if (piId) {
      try {
        const pi = await stripe.paymentIntents.retrieve(piId)
        piIsDead = pi.status === 'canceled'
      } catch {
        piIsDead = true
      }
    }

    if (piIsDead) {
      const result = await recoverCanceledPiInvoice({
        stripe,
        account: stripeAccount,
        invoiceId: invoice.id as string,
        trigger: 'admin_retry'
      })

      try {
        await prisma.subscriptionAuditLog.create({
          data: {
            subscriptionId: subscription.id,
            action: 'RETRY_INVOICE_RECOVERY',
            performedBy: adminUser.id,
            performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
            reason: 'Admin-triggered retry — original PI canceled by Smart Retries, fresh PI path',
            operationId: `retry_recovery_${invoice.id}_${Date.now()}`,
            metadata: JSON.stringify({ invoiceId: invoice.id, result })
          }
        })
      } catch {}

      if (result.kind === 'success') {
        return NextResponse.json({
          success: true,
          recovered: true,
          invoice: { id: invoice.id, status: 'paid' },
          newPaymentIntentId: result.newPiId,
          amount: result.amount
        })
      }

      const message =
        result.kind === 'declined'
          ? `Card declined: ${result.message}${result.declineCode ? ` (${result.declineCode})` : ''}`
          : result.kind === 'requires_action'
            ? 'Card requires authentication (3DS) — customer must complete the action via the hosted invoice or payment page'
            : result.kind === 'no_pm'
              ? 'No card on file for this customer'
              : result.kind === 'no_subscription'
                ? 'Could not match invoice to a subscription'
                : result.kind === 'invoice_not_open'
                  ? `Invoice no longer open (status=${result.status})`
                  : ('message' in result ? result.message : 'Recovery failed')
      return NextResponse.json({ error: message, recoveryKind: result.kind }, { status: 400 })
    }

    // Normal path — PI still alive, ask Stripe to retry it
    const paid = await stripe.invoices.pay(invoice.id as string)

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


