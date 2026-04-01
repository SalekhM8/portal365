import { NextRequest, NextResponse } from 'next/server'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * ONE-TIME RECOVERY: Recoup incorrectly applied pause credits
 *
 * Bug: pause_collection with 'void' behavior already skips charging the paused month's invoice.
 * The cron job ALSO created negative invoice items (credits) on the next month's invoice.
 * This double-compensated customers. Total lost: £1,672.92 across 32 pause windows.
 *
 * Recovery: Create POSITIVE invoice items to reverse each incorrect credit.
 * These will be collected on the customer's next invoice.
 *
 * Endpoint: POST /api/admin/recoup-pause-credits
 * Requires: x-cron-secret header or Authorization: Bearer <secret>
 * Query params: ?dry_run=true (default) to preview without creating items
 */

type AffectedWindow = {
  name: string
  stripeCustomerId: string
  account: StripeAccountKey
  creditPence: number
  pauseWindow: string
  group: 'PRE_MARCH' | 'MARCH'
}

const AFFECTED_WINDOWS: AffectedWindow[] = [
  // ═══════════════════════════════════════════════════════════════
  // PRE-MARCH GROUP: 7 windows, £415.00
  // ═══════════════════════════════════════════════════════════════
  { name: 'mohammed alam', stripeCustomerId: 'cus_TRPWu3CPKhDrMf', account: 'SU', creditPence: 7500, pauseWindow: '2025-12-01 to 2025-12-31', group: 'PRE_MARCH' },
  { name: 'Kassim Chaudhry (Dec)', stripeCustomerId: 'cus_TEruybN5zyFTTo', account: 'SU', creditPence: 5500, pauseWindow: '2025-12-01 to 2025-12-31', group: 'PRE_MARCH' },
  { name: 'Kassim Chaudhry (Jan)', stripeCustomerId: 'cus_TEruybN5zyFTTo', account: 'SU', creditPence: 5500, pauseWindow: '2026-01-01 to 2026-01-31', group: 'PRE_MARCH' },
  { name: 'Mohammed Zulkifl', stripeCustomerId: 'cus_T7of9FjpNP9w01', account: 'SU', creditPence: 7500, pauseWindow: '2026-02-01 to 2026-02-28', group: 'PRE_MARCH' },
  { name: 'Haaris Syed (Feb)', stripeCustomerId: 'cus_SE0hx6jeyFZN0N', account: 'IQ', creditPence: 7500, pauseWindow: '2026-02-01 to 2026-02-28', group: 'PRE_MARCH' },
  { name: 'Muhammad Hashim', stripeCustomerId: 'cus_SkNjurlTacf8FR', account: 'IQ', creditPence: 4000, pauseWindow: '2026-02-01 to 2026-02-28', group: 'PRE_MARCH' },
  { name: 'Muhammad1 Aayan', stripeCustomerId: 'cus_SkNptWuGxi5go0', account: 'IQ', creditPence: 4000, pauseWindow: '2026-02-01 to 2026-02-28', group: 'PRE_MARCH' },

  // ═══════════════════════════════════════════════════════════════
  // MARCH GROUP: 25 windows, £1,257.92
  // ═══════════════════════════════════════════════════════════════
  { name: 'Shifaa Ishaaq', stripeCustomerId: 'cus_TDAHygGvsgn0c7', account: 'SU', creditPence: 2419, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Hussain Shahzad', stripeCustomerId: 'cus_TtqcDyjuYgEJVv', account: 'AURA', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Hassan Qamar', stripeCustomerId: 'cus_TWfWKZ0kIZel42', account: 'SU', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Abu-Bakr Ibn Aftab', stripeCustomerId: 'cus_SQmQbktcF52TaY', account: 'IQ', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Umar Ibn Aftab', stripeCustomerId: 'cus_SQmTOWIbglzkaD', account: 'IQ', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Sumayyah Isaan', stripeCustomerId: 'cus_RbZsA8zY7z3iWR', account: 'IQ', creditPence: 2419, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Nusaybah Isaan', stripeCustomerId: 'cus_Rba62tM2gkWlLt', account: 'IQ', creditPence: 2419, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Hameed Ahmad', stripeCustomerId: 'cus_Sj21pkGljbXYyJ', account: 'IQ', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'eoin Tracey', stripeCustomerId: 'cus_TXQil64hb7jHCC', account: 'IQ', creditPence: 7258, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Aisha Mohamed', stripeCustomerId: 'cus_S4hwZivSw5KzQR', account: 'IQ', creditPence: 2419, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Elijah Thompson', stripeCustomerId: 'cus_ThwEK2XK3688hH', account: 'AURA', creditPence: 7258, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Rehaan Nadim', stripeCustomerId: 'cus_RcCEZ2yUmhuj0a', account: 'IQ', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Ibrahim Nadim', stripeCustomerId: 'cus_SETFtalz1xeIsv', account: 'IQ', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Haadi Irfan', stripeCustomerId: 'cus_TMDpZeMaZxbrHb', account: 'SU', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Haani Irfan', stripeCustomerId: 'cus_TMDpZeMaZxbrHb', account: 'SU', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Ibaad Naeem', stripeCustomerId: 'cus_Tm3viEBobUjle0', account: 'AURA', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Francesco Brasoveanu', stripeCustomerId: 'cus_RhTN0BwoAPwbej', account: 'IQ', creditPence: 7258, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Abdul-Hayy Abdul-Qayyum', stripeCustomerId: 'cus_TIlEG0Jg7rkZrz', account: 'SU', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Christopher Lines Wells Richardson', stripeCustomerId: 'cus_SpEzpwYnWXtllf', account: 'IQ', creditPence: 7258, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Bilal Pronine', stripeCustomerId: 'cus_T2IcPWD9Aoy9BZ', account: 'SU', creditPence: 5323, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Haaris Syed (Mar)', stripeCustomerId: 'cus_SE0hx6jeyFZN0N', account: 'IQ', creditPence: 7258, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Maryam Osman', stripeCustomerId: 'cus_Tfgl2SuxCJZDqR', account: 'AURA', creditPence: 2419, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Muhammad Qasim', stripeCustomerId: 'cus_TYovQTiXlhy0p4', account: 'IQ', creditPence: 3871, pauseWindow: '2026-03-01 to 2026-03-30', group: 'MARCH' },
  { name: 'Sarah Kamaluddin', stripeCustomerId: 'cus_Tidd0TuNVuiKaO', account: 'AURA', creditPence: 4830, pauseWindow: '2026-02-02 to 2026-03-30', group: 'MARCH' },
  { name: 'Rumaysa Kamaluddin', stripeCustomerId: 'cus_Tidd0TuNVuiKaO', account: 'AURA', creditPence: 4830, pauseWindow: '2026-02-02 to 2026-03-30', group: 'MARCH' },
]

export async function POST(request: NextRequest) {
  try {
    // Authenticate
    const authHeader = request.headers.get('authorization')
    const secret = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : request.headers.get('x-cron-secret')
    if (!process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const dryRun = searchParams.get('dry_run') !== 'false' // default: true (safe)

    const results: Array<{
      name: string
      customer: string
      account: string
      amountGBP: string
      status: 'created' | 'skipped' | 'failed'
      invoiceItemId?: string
      error?: string
    }> = []

    let totalRecouped = 0

    for (const w of AFFECTED_WINDOWS) {
      const amountGBP = (w.creditPence / 100).toFixed(2)

      if (dryRun) {
        results.push({
          name: w.name,
          customer: w.stripeCustomerId,
          account: w.account,
          amountGBP: `£${amountGBP}`,
          status: 'skipped',
          error: 'DRY RUN - no action taken'
        })
        totalRecouped += w.creditPence
        continue
      }

      try {
        const stripe = getStripeClient(w.account)

        // Create POSITIVE invoice item to reverse the incorrect credit
        const invoiceItem = await stripe.invoiceItems.create({
          customer: w.stripeCustomerId,
          amount: w.creditPence, // POSITIVE amount to charge
          currency: 'gbp',
          description: `Billing correction: reverse pause credit (${w.pauseWindow})`,
          metadata: {
            reason: 'recoup_double_dip_pause_credit',
            originalPauseWindow: w.pauseWindow,
            customerName: w.name,
            group: w.group,
            recoveryDate: new Date().toISOString()
          }
        })

        results.push({
          name: w.name,
          customer: w.stripeCustomerId,
          account: w.account,
          amountGBP: `£${amountGBP}`,
          status: 'created',
          invoiceItemId: invoiceItem.id
        })
        totalRecouped += w.creditPence

        console.log(`✅ ${w.name} (${w.stripeCustomerId}): +£${amountGBP} on ${w.account} → ${invoiceItem.id}`)

      } catch (err: any) {
        results.push({
          name: w.name,
          customer: w.stripeCustomerId,
          account: w.account,
          amountGBP: `£${amountGBP}`,
          status: 'failed',
          error: err.message
        })
        console.error(`❌ ${w.name} (${w.stripeCustomerId}): ${err.message}`)
      }
    }

    const created = results.filter(r => r.status === 'created').length
    const failed = results.filter(r => r.status === 'failed').length

    return NextResponse.json({
      success: true,
      dryRun,
      summary: {
        total: AFFECTED_WINDOWS.length,
        created,
        failed,
        totalRecoupedGBP: `£${(totalRecouped / 100).toFixed(2)}`
      },
      results
    })

  } catch (error: any) {
    console.error('Recovery script error:', error)
    return NextResponse.json({ success: false, error: error.message }, { status: 500 })
  }
}
