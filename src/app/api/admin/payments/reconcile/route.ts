import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { persistSuccessfulPayment } from '@/app/api/webhooks/stripe/handlers'

type Mode = 'preview' | 'check' | 'apply'

export async function GET(request: NextRequest) {
  return handleRequest(request, 'GET')
}

export async function POST(request: NextRequest) {
  return handleRequest(request, 'POST')
}

async function handleRequest(request: NextRequest, method: 'GET' | 'POST') {
  const session = await getServerSession(authOptions) as any
  if (!session?.user || !hasPermission(session.user.role, 'ADMIN')) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const url = new URL(request.url)
  const mode = (url.searchParams.get('mode') as Mode) || 'preview'
  const sinceParam = url.searchParams.get('since')

  if (!sinceParam) {
    return NextResponse.json({ error: 'Missing since parameter (YYYY-MM-DD)' }, { status: 400 })
  }

  const since = new Date(sinceParam)
  if (Number.isNaN(since.getTime())) {
    return NextResponse.json({ error: 'Invalid since parameter' }, { status: 400 })
  }

  if (mode === 'apply' && method !== 'POST') {
    return NextResponse.json({ error: 'Use POST for apply mode' }, { status: 405 })
  }

  try {
    if (mode === 'preview') {
      const snapshot = await fetchFailedPaymentsSince(since)
      return NextResponse.json({
        since: since.toISOString(),
        total: snapshot.length,
        data: snapshot.map(formatPreview)
      })
    }

    const paidInvoices = await detectPaidInvoices(since)

    if (mode === 'check') {
      return NextResponse.json({
        since: since.toISOString(),
        totalFailed: paidInvoices.allFailedCount,
        paidCount: paidInvoices.paid.length,
        entries: paidInvoices.paid.map(formatPaidPreview)
      })
    }

    // apply mode
    const applied = []
    for (const entry of paidInvoices.paid) {
      const operationId = `admin_reconcile_${entry.payment.stripeInvoiceId}_${Date.now()}`
      await persistSuccessfulPayment({
        invoiceId: entry.payment.stripeInvoiceId!,
        userIdForPayment: entry.payment.userId,
        amountPaid: entry.invoice.amount_paid / 100,
        currency: entry.invoice.currency.toUpperCase(),
        description: buildSuccessDescription(entry),
        routedEntityId: entry.payment.routedEntityId,
        operationId
      })
      applied.push({
        paymentId: entry.payment.id,
        invoiceId: entry.payment.stripeInvoiceId,
        member: entry.payment.user?.email,
        amount: entry.invoice.amount_paid / 100
      })
    }

    return NextResponse.json({
      since: since.toISOString(),
      updated: applied.length,
      entries: applied
    })
  } catch (error) {
    console.error('Admin reconcile error', error)
    return NextResponse.json({ error: (error as Error).message }, { status: 500 })
  }
}

function formatPreview(payment: Awaited<ReturnType<typeof fetchFailedPaymentsSince>>[number]) {
  return {
    paymentId: payment.id,
    invoiceId: payment.stripeInvoiceId,
    amount: payment.amount,
    retryCount: payment.retryCount,
    processedAt: payment.processedAt,
    member: {
      id: payment.userId,
      name: `${payment.user?.firstName || ''} ${payment.user?.lastName || ''}`.trim(),
      email: payment.user?.email
    }
  }
}

function formatPaidPreview(entry: PaidInvoiceEntry) {
  return {
    paymentId: entry.payment.id,
    invoiceId: entry.payment.stripeInvoiceId,
    member: {
      id: entry.payment.userId,
      name: `${entry.payment.user?.firstName || ''} ${entry.payment.user?.lastName || ''}`.trim(),
      email: entry.payment.user?.email
    },
    stripeStatus: entry.invoice.status,
    amountPaid: entry.invoice.amount_paid / 100,
    lastStripeUpdate: entry.invoice.status_transitions?.paid_at
      ? new Date(entry.invoice.status_transitions.paid_at * 1000).toISOString()
      : null
  }
}

function buildSuccessDescription(entry: PaidInvoiceEntry) {
  const paymentIntentId = (entry.invoice as any)?.payment_intent as string | undefined
  const memberTag = `[member:${entry.payment.userId}]`
  const subTag = entry.subscriptionId ? `[sub:${entry.subscriptionId}]` : ''
  return `Monthly membership payment [inv:${entry.invoice.id}]${paymentIntentId ? ` [pi:${paymentIntentId}]` : ''} ${memberTag} ${subTag}`.trim()
}

async function fetchFailedPaymentsSince(since: Date) {
  return prisma.payment.findMany({
    where: {
      status: 'FAILED',
      stripeInvoiceId: { not: null },
      OR: [
        { processedAt: { gte: since } },
        { processedAt: null, createdAt: { gte: since } }
      ]
    },
    orderBy: { processedAt: 'desc' },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } }
    }
  })
}

type PaidInvoiceEntry = {
  payment: Awaited<ReturnType<typeof fetchFailedPaymentsSince>>[number]
  invoice: any
  subscriptionId: string | null
}

async function detectPaidInvoices(since: Date) {
  const failed = await fetchFailedPaymentsSince(since)
  const paidEntries: PaidInvoiceEntry[] = []

  for (const payment of failed) {
    const invoiceId = payment.stripeInvoiceId
    if (!invoiceId) continue

    const { stripeAccountKey, subscriptionId } = await inferStripeAccount(payment)
    const stripe = getStripeClient(stripeAccountKey)
    try {
      const invoice = await stripe.invoices.retrieve(invoiceId)
      if (invoice.status === 'paid') {
        paidEntries.push({ payment, invoice, subscriptionId })
      }
    } catch (error) {
      console.warn(`Unable to retrieve invoice ${invoiceId}:`, error)
    }
  }

  return { paid: paidEntries, allFailedCount: failed.length }
}

async function inferStripeAccount(payment: Awaited<ReturnType<typeof fetchFailedPaymentsSince>>[number]) {
  let subscriptionId: string | null = null
  const match = payment.description?.match(/\[sub:([^\]]+)\]/)
  if (match) {
    subscriptionId = match[1]
  }

  if (subscriptionId) {
    const subscription = await prisma.subscription.findUnique({
      where: { id: subscriptionId },
      select: { stripeAccountKey: true }
    })
    if (subscription?.stripeAccountKey) {
      return { stripeAccountKey: subscription.stripeAccountKey as StripeAccountKey, subscriptionId }
    }
  }

  return { stripeAccountKey: 'SU' as StripeAccountKey, subscriptionId }
}

