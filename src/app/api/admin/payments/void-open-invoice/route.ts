import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import type Stripe from 'stripe'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

type VoidRequestBody = {
  invoiceId?: string
  customerId?: string
}

const STRIPE_ACCOUNTS: StripeAccountKey[] = ['SU', 'IQ']

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role as any)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const body = (await request.json().catch(() => ({}))) as VoidRequestBody
    const invoiceId = body.invoiceId?.trim()
    const customerId = body.customerId?.trim()

    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    // Attempt to infer the Stripe account from local data first
    const invoiceRecord = await prisma.invoice.findFirst({
      where: { stripeInvoiceId: invoiceId },
      include: { subscription: true }
    })

    let preferredAccount = invoiceRecord?.subscription?.stripeAccountKey as StripeAccountKey | undefined
    let stripeAccount: StripeAccountKey | null = preferredAccount || null
    let stripeInvoice: Stripe.Invoice | null = null

    const accountsToTry: StripeAccountKey[] = preferredAccount
      ? [preferredAccount, ...STRIPE_ACCOUNTS.filter((a) => a !== preferredAccount)]
      : STRIPE_ACCOUNTS

    for (const account of accountsToTry) {
      const client = getStripeClient(account)
      try {
        const retrieved = await client.invoices.retrieve(invoiceId)
        stripeInvoice = retrieved
        stripeAccount = account
        break
      } catch (err: any) {
        if (err?.raw?.code === 'resource_missing') {
          continue
        }
        throw err
      }
    }

    if (!stripeInvoice || !stripeAccount) {
      return NextResponse.json({ error: `Invoice ${invoiceId} not found on any Stripe account` }, { status: 404 })
    }

    if (stripeInvoice.status !== 'open') {
      return NextResponse.json({ error: `Invoice ${invoiceId} is ${stripeInvoice.status} and cannot be voided` }, { status: 400 })
    }

    const client = getStripeClient(stripeAccount)
    const voided = await client.invoices.voidInvoice(invoiceId)

    // Mark related payment rows as voided (handles both new + legacy rows)
    const paymentUpdates = await prisma.payment.updateMany({
      where: {
        status: 'FAILED',
        OR: [
          { stripeInvoiceId: invoiceId },
          { description: { contains: `[inv:${invoiceId}]` } }
        ]
      },
      data: { status: 'VOIDED', failureReason: 'VOIDED_INVOICE' }
    })

    // Update local invoice record if present
    await prisma.invoice.updateMany({
      where: { stripeInvoiceId: invoiceId },
      data: { status: 'void' }
    })

    // Ensure subscription + membership return to ACTIVE
    const subscriptionField = (stripeInvoice as any)?.subscription as string | undefined
    if (subscriptionField) {
      await prisma.subscription.updateMany({
        where: { stripeSubscriptionId: subscriptionField },
        data: { status: 'ACTIVE' }
      })
    }
    if (customerId) {
      await prisma.membership.updateMany({
        where: { userId: customerId },
        data: { status: 'ACTIVE' }
      })
    }

    return NextResponse.json({
      success: true,
      invoice: { id: invoiceId, status: voided.status },
      stripeAccount,
      updatedPayments: paymentUpdates.count
    })
  } catch (error: any) {
    console.error('Void open invoice failed', error)
    return NextResponse.json({ error: error?.message || 'Failed to void invoice' }, { status: 500 })
  }
}

