import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { recoverCanceledPiInvoice, type RecoveryResult } from '@/lib/canceled-pi-recovery'
import { getToDoListFailedPayments } from '@/lib/admin-todo-list'

/**
 * DAILY CRON: Recover invoices in the admin "Payments to-do" list whose PaymentIntent
 * was canceled by Stripe Smart Retries.
 *
 * SCOPE: This cron is intentionally locked to the admin to-do list — i.e. the same set
 * of failed payments the dashboard surfaces as outstanding actions. It will NEVER touch
 * an invoice that has been admin-dismissed, voided, or already resolved by a later
 * confirmed payment. Source of truth: getToDoListFailedPayments() in src/lib/admin-todo-list.ts.
 *
 * For each to-do row we resolve the customer's subscription (to find the right Stripe
 * account), pick the underlying Stripe invoice id (from the Payment row column or the
 * [inv:xxx] description marker), and call recoverCanceledPiInvoice — which only acts if
 * the invoice is still open with amount_remaining > 0 and the existing PI is dead.
 *
 * Schedule: daily 09:00 UTC (Vercel Cron — see vercel.json)
 * Endpoint: GET /api/admin/cron/recover-canceled-pi-invoices
 *
 * Auth:
 *   - Authorization: Bearer <CRON_SECRET>  (Vercel Cron)
 *   - x-cron-secret: <CRON_SECRET>          (manual trigger)
 *
 * Query params:
 *   ?dry_run=true   — preview without creating PIs (default: false / live)
 */

function getAuthSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return request.headers.get('x-cron-secret')
}

type PerInvoiceResult = {
  account: StripeAccountKey | null
  paymentRowId: string
  userId: string
  invoiceId: string | null
  amountGBP: number
  outcome: RecoveryResult['kind'] | 'skipped'
  detail: string
}

export async function GET(request: NextRequest) {
  const startTime = Date.now()

  // Auth
  const secret = getAuthSecret(request)
  if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(request.url)
  const dryRun = searchParams.get('dry_run') === 'true'

  const perInvoice: PerInvoiceResult[] = []
  const summary: Record<string, number> = {
    todoRows: 0,
    eligible: 0,
    success: 0,
    declined: 0,
    requires_action: 0,
    no_pm: 0,
    no_subscription: 0,
    invoice_not_open: 0,
    error: 0,
    skipped: 0
  }

  // Source of truth: the admin to-do list. Same query the dashboard uses.
  const todo = await getToDoListFailedPayments()
  summary.todoRows = todo.length

  for (const row of todo) {
    const invoiceId = row.stripeInvoiceId || row.parsedInvoiceId
    if (!invoiceId) {
      summary.skipped += 1
      perInvoice.push({
        account: null,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId: null,
        amountGBP: row.amount,
        outcome: 'skipped',
        detail: 'No stripeInvoiceId or [inv:xxx] marker — cannot map to Stripe invoice'
      })
      continue
    }

    // Resolve which Stripe account this user's subscription lives on
    const sub = await prisma.subscription.findFirst({
      where: { userId: row.userId, status: { notIn: ['CANCELLED'] } },
      orderBy: { updatedAt: 'desc' },
      select: { stripeAccountKey: true, stripeCustomerId: true, id: true }
    })
    if (!sub) {
      summary.no_subscription += 1
      perInvoice.push({
        account: null,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId,
        amountGBP: row.amount,
        outcome: 'no_subscription',
        detail: 'No active subscription found for user'
      })
      continue
    }

    const account = (sub.stripeAccountKey as StripeAccountKey) || 'SU'
    let stripe
    try {
      stripe = getStripeClient(account)
    } catch (err: any) {
      summary.error += 1
      perInvoice.push({
        account,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId,
        amountGBP: row.amount,
        outcome: 'error',
        detail: `Stripe client unavailable for account ${account}: ${err?.message || err}`
      })
      continue
    }

    summary.eligible += 1

    if (dryRun) {
      summary.skipped += 1
      perInvoice.push({
        account,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId,
        amountGBP: row.amount,
        outcome: 'skipped',
        detail: 'DRY RUN — would attempt fresh PI'
      })
      continue
    }

    try {
      const result = await recoverCanceledPiInvoice({
        stripe,
        account,
        invoiceId,
        trigger: 'cron'
      })
      summary[result.kind] = (summary[result.kind] || 0) + 1
      perInvoice.push({
        account,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId,
        amountGBP: row.amount,
        outcome: result.kind,
        detail:
          result.kind === 'success'
            ? `new PI ${result.newPiId} → £${result.amount.toFixed(2)} settled`
            : 'message' in result
              ? result.message
              : JSON.stringify(result)
      })
    } catch (err: any) {
      summary.error += 1
      perInvoice.push({
        account,
        paymentRowId: row.paymentId,
        userId: row.userId,
        invoiceId,
        amountGBP: row.amount,
        outcome: 'error',
        detail: err?.message || String(err)
      })
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    durationMs: Date.now() - startTime,
    summary,
    invoices: perInvoice
  })
}
