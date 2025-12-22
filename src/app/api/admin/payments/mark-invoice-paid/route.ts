import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import type Stripe from 'stripe'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

type MarkPaidBody = {
  invoiceId?: string
}

const STRIPE_ACCOUNTS: StripeAccountKey[] = ['SU', 'IQ', 'AURA']

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role as any)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as MarkPaidBody
    const invoiceId = body.invoiceId?.trim()
    if (!invoiceId) return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })

    const invoiceRecord = await prisma.invoice.findFirst({
      where: { stripeInvoiceId: invoiceId },
      include: { subscription: true }
    })

    const preferredAccount = invoiceRecord?.subscription?.stripeAccountKey as StripeAccountKey | undefined
    const accountsToTry = preferredAccount
      ? [preferredAccount, ...STRIPE_ACCOUNTS.filter((acct) => acct !== preferredAccount)]
      : STRIPE_ACCOUNTS

    let stripeInvoice: Stripe.Invoice | null = null
    let stripeAccount: StripeAccountKey | null = null

    for (const account of accountsToTry) {
      const client = getStripeClient(account)
      try {
        const retrieved = await client.invoices.retrieve(invoiceId)
        stripeInvoice = retrieved
        stripeAccount = account
        break
      } catch (err: any) {
        if (err?.raw?.code === 'resource_missing') continue
        throw err
      }
    }

    if (!stripeInvoice || !stripeAccount) {
      return NextResponse.json({ error: `Invoice ${invoiceId} not found on any Stripe account` }, { status: 404 })
    }

    if (stripeInvoice.status !== 'open') {
      return NextResponse.json({ error: `Invoice ${invoiceId} is ${stripeInvoice.status} and cannot be marked paid` }, { status: 400 })
    }

    const client = getStripeClient(stripeAccount)
    const paidInvoice = await client.invoices.pay(invoiceId, { paid_out_of_band: true })

    const payeeSubscriptionId = (paidInvoice as any)?.subscription as string | undefined
    let subscription = null
    if (payeeSubscriptionId) {
      subscription = await prisma.subscription.findFirst({
        where: { stripeSubscriptionId: payeeSubscriptionId },
        include: { user: true }
      })
    }

    // Mirror Stripe invoice locally when we can safely reference the subscription
    let invoiceRow = invoiceRecord
    if (invoiceRow) {
      invoiceRow = await prisma.invoice.update({
        where: { id: invoiceRow.id },
        data: { status: 'paid', paidAt: new Date() },
        include: { subscription: true }
      })
    } else if (subscription?.id) {
      invoiceRow = await prisma.invoice.create({
        data: {
          subscriptionId: subscription.id,
          stripeInvoiceId: invoiceId,
          amount: Number(paidInvoice.amount_due || 0) / 100,
          currency: paidInvoice.currency.toUpperCase(),
          status: 'paid',
          billingPeriodStart: new Date(paidInvoice.lines.data[0]?.period?.start * 1000 || paidInvoice.period_start * 1000),
          billingPeriodEnd: new Date(paidInvoice.lines.data[0]?.period?.end * 1000 || paidInvoice.period_end * 1000),
          dueDate: new Date(),
          paidAt: new Date()
        },
        include: { subscription: true }
      })
    }

    // Write payment row if missing
    if (subscription) {
      const existingPayment = await prisma.payment.findFirst({ where: { stripeInvoiceId: invoiceId } })
      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            userId: subscription.userId,
            amount: invoiceRow?.amount ?? Number(paidInvoice.amount_due || 0) / 100,
            currency: invoiceRow?.currency ?? paidInvoice.currency.toUpperCase(),
            status: 'CONFIRMED',
            description: `Manual payment recorded [inv:${invoiceId}] [member:${subscription.userId}] [sub:${subscription.id}]`,
            routedEntityId: subscription.routedEntityId,
            processedAt: new Date(),
            stripeInvoiceId: invoiceId
          }
        })
      }
      await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'ACTIVE' } })
      await prisma.subscription.updateMany({ where: { id: subscription.id }, data: { status: 'ACTIVE' } })
    }

    // Remove To-Do entry (supports legacy rows that only have the [inv:...] tag)
    await prisma.payment.updateMany({
      where: {
        status: 'FAILED',
        OR: [
          { stripeInvoiceId: invoiceId },
          { description: { contains: `[inv:${invoiceId}]` } }
        ]
      },
      data: { status: 'VOIDED', failureReason: 'MANUAL_PAY' }
    })

    return NextResponse.json({ success: true, invoice: { id: invoiceId, status: paidInvoice.status }, stripeAccount })
  } catch (error: any) {
    console.error('Mark invoice paid failed', error)
    return NextResponse.json({ error: error?.message || 'Failed to mark invoice paid' }, { status: 500 })
  }
}


