import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

/**
 * Admin: Preview or import existing Stripe customers/subscriptions into local DB
 *
 * GET ?account=SU|IQ&limit=50 → preview list of active subs and customer emails
 * POST body { account: 'SU'|'IQ', mode: 'import'|'preview', defaultPlanKey?: string }
 *   - preview: returns what would be created
 *   - import: creates missing users (no password), membership (PENDING_PAYMENT by default), and subscription rows
 */

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
  if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { searchParams } = new URL(req.url)
  const accountParam = (searchParams.get('account') || 'SU').toUpperCase() as StripeAccountKey
  const limit = Math.min(Number(searchParams.get('limit') || '50'), 200)
  const debugCustomerId = searchParams.get('customerId')

  const stripe = getStripeClient(accountParam)
  const subs = await stripe.subscriptions.list({ status: 'all', limit })

  // If there are subscriptions, return subscription-centric preview
  if (subs.data.length > 0) {
    const rows = await Promise.all(subs.data.map(async (s) => {
      let email: string | null = null
      let hasDefaultPm: boolean | null = null
      try {
        const cust = await stripe.customers.retrieve(s.customer as string)
        if (!('deleted' in cust)) {
          email = (cust.email as string | null) || null
          hasDefaultPm = !!cust.invoice_settings?.default_payment_method
        }
      } catch {}
      return {
        mode: 'subscriptions',
        stripeSubscriptionId: s.id,
        stripeCustomerId: s.customer as string,
        status: (s as any).status,
        current_period_end: (s as any)?.current_period_end || null,
        email,
        hasDefaultPm,
        items: s.items?.data?.map(i => ({ price: i.price?.unit_amount, currency: i.price?.currency })) || []
      }
    }))
    return NextResponse.json({ success: true, account: accountParam, rows })
  }

  // Optional deep debug for a single customer
  if (debugCustomerId) {
    try {
      const cust = await stripe.customers.retrieve(debugCustomerId)
      const pms = await stripe.paymentMethods.list({ customer: debugCustomerId, type: 'card' })
      const charges = await stripe.charges.list({ customer: debugCustomerId, limit: 10, expand: ['data.payment_method'] })
      // PaymentIntents can reveal pm when charge is legacy
      const intents = await stripe.paymentIntents.list({ customer: debugCustomerId, limit: 10 })
      return NextResponse.json({
        success: true,
        account: accountParam,
        debug: {
          customer: cust,
          paymentMethodsCount: pms.data.length,
          latestPaymentMethod: pms.data[0] || null,
          chargesCount: charges.data.length,
          latestCharge: charges.data[0] || null,
          intentsCount: intents.data.length,
          latestIntent: intents.data[0] || null
        }
      })
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message || 'Debug fetch failed' }, { status: 500 })
    }
  }

  // Fallback: charges-only preview for accounts managed by external cron (TeamUp)
  const customers = await stripe.customers.list({ limit })
  const rows = await Promise.all(customers.data.map(async (c) => {
    // Retrieve latest successful charge
    let lastChargeAmount: number | null = null
    let lastChargeAt: number | null = null
    let currency: string | null = null
    let lastPaymentMethodId: string | null = null
    let lastPmBrand: string | null = null
    let lastPmLast4: string | null = null
    let lastChargeDescription: string | null = null
    try {
      const charges = await stripe.charges.list({ customer: c.id, limit: 5, expand: ['data.payment_method'] })
      const paid = charges.data.find(ch => ch.paid && !ch.refunded && ch.amount > 0)
      if (paid) {
        lastChargeAmount = paid.amount
        lastChargeAt = paid.created
        currency = paid.currency
        // prefer balance transaction description or charge description
        lastChargeDescription = (paid.description as string | null) || null
        // capture pm info if available
        // direct payment_method on charge?
        const pmid = (paid.payment_method as string | undefined) || null
        if (pmid) {
          lastPaymentMethodId = pmid
          try {
            const det = (paid as any)?.payment_method_details
            if (det?.card) {
              lastPmBrand = det.card.brand || null
              lastPmLast4 = det.card.last4 || null
            }
          } catch {}
        } else {
          // if not, try via payment_intent on the charge
          const piId = (paid.payment_intent as string | undefined) || null
          if (piId) {
            try {
              const pi = await stripe.paymentIntents.retrieve(piId)
              const pmFromPi = (pi.payment_method as string | undefined) || null
              if (pmFromPi) {
                lastPaymentMethodId = pmFromPi
                try {
                  const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                  // @ts-ignore
                  lastPmBrand = (pmObj as any)?.card?.brand || null
                  // @ts-ignore
                  lastPmLast4 = (pmObj as any)?.card?.last4 || null
                } catch {}
              }
            } catch {}
          }
        }
      }
    } catch {}

    // Determine default PM presence
    let hasInvoiceDefault: boolean = false
    let hasAnyPm: boolean = false
    let defaultSource: any = null
    let suggestedPmId: string | null = null
    let suggestedPmBrand: string | null = null
    let suggestedPmLast4: string | null = null
    try {
      hasInvoiceDefault = !!c.invoice_settings?.default_payment_method
      // Legacy source (older APIs)
      // @ts-ignore
      defaultSource = (c as any)?.default_source || null
      // Any attached card payment methods
      const pms = await stripe.paymentMethods.list({ customer: c.id, type: 'card' })
      hasAnyPm = hasInvoiceDefault || !!defaultSource || pms.data.length > 0 || !!lastPaymentMethodId
      // choose suggested pm: prefer last charge pm; else first attached
      if (lastPaymentMethodId) {
        suggestedPmId = lastPaymentMethodId
        suggestedPmBrand = lastPmBrand
        suggestedPmLast4 = lastPmLast4
      } else if (pms.data.length > 0) {
        suggestedPmId = pms.data[0].id
        suggestedPmBrand = pms.data[0].card?.brand || null
        suggestedPmLast4 = pms.data[0].card?.last4 || null
      } else if (c.invoice_settings?.default_payment_method) {
        // last fallback: default on customer (retrieve details)
        const dpm = c.invoice_settings?.default_payment_method as any
        const dpmId = typeof dpm === 'string' ? dpm : dpm?.id
        if (dpmId) {
          suggestedPmId = dpmId
          try {
            const pmObj = await stripe.paymentMethods.retrieve(dpmId)
            // @ts-ignore
            suggestedPmBrand = (pmObj as any)?.card?.brand || null
            // @ts-ignore
            suggestedPmLast4 = (pmObj as any)?.card?.last4 || null
          } catch {}
        }
      }
    } catch {}

    // Infer next billing date: next 1st of month based on last charge
    let inferredNextBillISO: string | null = null
    if (lastChargeAt) {
      const d = new Date(lastChargeAt * 1000)
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
      inferredNextBillISO = next.toISOString()
    }

    return {
      mode: 'charges_fallback',
      stripeCustomerId: c.id,
      email: (c.email as string | null) || null,
      hasInvoiceDefault,
      hasAnyPm,
      suggestedPmId,
      suggestedPmBrand,
      suggestedPmLast4,
      lastChargeAmount,
      lastChargeAt,
      currency,
      lastChargeDescription,
      inferredNextBillISO
    }
  }))

  // Prioritize customers that are ready (have PM or recent paid charge)
  const sorted = rows.sort((a: any, b: any) => {
    const readyA = (a.hasAnyPm ? 1 : 0)
    const readyB = (b.hasAnyPm ? 1 : 0)
    if (readyA !== readyB) return readyB - readyA
    const atA = a.lastChargeAt || 0
    const atB = b.lastChargeAt || 0
    return atB - atA
  })

  return NextResponse.json({ success: true, account: accountParam, rows: sorted })
}


