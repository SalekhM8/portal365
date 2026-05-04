import { NextRequest, NextResponse } from 'next/server'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { recoverCanceledPiInvoice, type RecoveryResult } from '@/lib/canceled-pi-recovery'

/**
 * DAILY CRON: Recover open invoices whose PaymentIntent was canceled by Stripe Smart Retries.
 *
 * Stripe Smart Retries hard-caps at 4 attempts (~3 days for IQ tuning). After the 4th
 * attempt fails, Stripe asynchronously cancels the PaymentIntent and stops retrying. The
 * invoice stays open at amount_remaining > 0 with no live PI — the member would otherwise
 * sit stuck until an admin manually re-charged them.
 *
 * This cron sweeps any open invoice with attempt_count >= 4 across all configured Stripe
 * accounts, creates a fresh off-session PI against the customer's default card, and marks
 * the invoice paid_out_of_band on success. Runs daily for up to ~14 days per invoice (we
 * cap by invoice age — anything older than 14 days requires manual intervention).
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
 *   ?max_age_days=N — only consider invoices created within N days (default: 14)
 */

const ALL_ACCOUNTS: StripeAccountKey[] = ['SU', 'IQ', 'AURA', 'AURAUP']

function getAuthSecret(request: NextRequest): string | null {
  const authHeader = request.headers.get('authorization')
  if (authHeader?.startsWith('Bearer ')) return authHeader.slice(7)
  return request.headers.get('x-cron-secret')
}

type PerInvoiceResult = {
  account: StripeAccountKey
  invoiceId: string
  customerId: string | null
  amountGBP: number
  attemptCount: number
  outcome: RecoveryResult['kind']
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
  const maxAgeDays = Math.max(1, Number(searchParams.get('max_age_days') || '14'))
  const maxAgeSeconds = maxAgeDays * 24 * 60 * 60
  const sinceUnix = Math.floor(Date.now() / 1000) - maxAgeSeconds

  const perInvoice: PerInvoiceResult[] = []
  const summary: Record<string, number> = {
    scanned: 0,
    eligible: 0,
    success: 0,
    declined: 0,
    requires_action: 0,
    no_pm: 0,
    no_subscription: 0,
    error: 0,
    skipped: 0
  }

  for (const account of ALL_ACCOUNTS) {
    let stripe
    try {
      stripe = getStripeClient(account)
    } catch {
      // Account not configured in this environment — skip silently
      continue
    }

    // Stripe API doesn't filter by attempt_count, so list all open invoices in window
    // and filter client-side. Page through with auto_paging via list-with-cursor.
    let startingAfter: string | undefined = undefined
    while (true) {
      let page
      try {
        page = await stripe.invoices.list({
          status: 'open',
          created: { gte: sinceUnix },
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {})
        })
      } catch (err: any) {
        console.error(`[recover-pi-cron] Failed to list ${account} invoices:`, err?.message || err)
        break
      }

      for (const inv of page.data) {
        summary.scanned += 1
        const attemptCount = Number(inv.attempt_count || 0)
        const amountRemaining = Number(inv.amount_remaining || 0)
        const customerId = typeof inv.customer === 'string' ? inv.customer : inv.customer?.id || null

        // Only invoices Stripe has fully given up on
        if (attemptCount < 4 || amountRemaining <= 0) continue

        summary.eligible += 1

        if (dryRun) {
          perInvoice.push({
            account,
            invoiceId: inv.id!,
            customerId,
            amountGBP: amountRemaining / 100,
            attemptCount,
            outcome: 'success' as RecoveryResult['kind'],
            detail: 'DRY RUN — would attempt fresh PI'
          })
          summary.skipped += 1
          continue
        }

        try {
          const result = await recoverCanceledPiInvoice({
            stripe,
            account,
            invoiceId: inv.id!,
            trigger: 'cron'
          })
          summary[result.kind] = (summary[result.kind] || 0) + 1
          perInvoice.push({
            account,
            invoiceId: inv.id!,
            customerId,
            amountGBP: amountRemaining / 100,
            attemptCount,
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
            invoiceId: inv.id!,
            customerId,
            amountGBP: amountRemaining / 100,
            attemptCount,
            outcome: 'error',
            detail: err?.message || String(err)
          })
        }
      }

      if (!page.has_more) break
      startingAfter = page.data[page.data.length - 1]?.id
      if (!startingAfter) break
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    maxAgeDays,
    durationMs: Date.now() - startTime,
    summary,
    invoices: perInvoice
  })
}
