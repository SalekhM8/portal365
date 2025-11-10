import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'
import { inferPlanKeyFromDescription as inferFromDesc, normalizePlanKey as normalizeClientKey } from '@/app/admin/iq-migration/planMap'

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
  const filterCustomerId = searchParams.get('customerId')

  const stripe = getStripeClient(accountParam)
  
  // If a specific customerId is provided, return a single enriched row for that customer
  if (filterCustomerId) {
    try {
      // Try subscriptions for this customer first
      const subsForCustomer = await stripe.subscriptions.list({ customer: filterCustomerId, status: 'all', limit: 10 })
      const rows = await Promise.all((subsForCustomer.data.length ? subsForCustomer.data : [null]).map(async (s) => {
        const stripeCustomerId = filterCustomerId
        let email: string | null = null
        let hasInvoiceDefault = false
        let hasAnyPm = false
        let suggestedPmId: string | null = null
        let suggestedPmBrand: string | null = null
        let suggestedPmLast4: string | null = null
        let lastChargeAmount: number | null = null
        let lastChargeAt: number | null = null
        let currency: string | null = null
        let lastChargeDescription: string | null = null
        let inferredNextBillISO: string | null = null
        let inferredPlanKey: MembershipKey | null = null

        // Customer and default PM
        try {
          const cust = await stripe.customers.retrieve(stripeCustomerId)
          if (!('deleted' in cust)) {
            email = (cust.email as string | null) || null
            const invDef = cust.invoice_settings?.default_payment_method
            hasInvoiceDefault = !!invDef
            if (invDef) {
              const dpmId = typeof invDef === 'string' ? invDef : invDef.id
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

        // Attached PMs
        try {
          if (!suggestedPmId) {
            const pms = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card' })
            if (pms.data.length > 0) {
              suggestedPmId = pms.data[0].id
              suggestedPmBrand = pms.data[0].card?.brand || null
              suggestedPmLast4 = pms.data[0].card?.last4 || null
            }
          }
        } catch {}

        // Charges and PaymentIntent fallback
        try {
          // Prefer search by customer to include older data and ensure teamup charges are found
          let paid: any = null
          try {
            // @ts-ignore search endpoint
            const search = await (stripe.charges as any).search({
              query: `customer:'${stripeCustomerId}' AND status:'succeeded'`,
              limit: 10,
              expand: ['data.payment_method']
            })
            paid = search?.data?.[0] || null
          } catch {
            // fallback to list if search not available
          }
          const charges = paid ? { data: [paid] } : await stripe.charges.list({ customer: stripeCustomerId, limit: 10, expand: ['data.payment_method'] })
          paid = paid || charges.data.find(ch => ch.paid && !ch.refunded && ch.amount > 0)
          if (paid) {
            lastChargeAmount = paid.amount
            lastChargeAt = paid.created
            currency = paid.currency
            lastChargeDescription = (paid.description as string | null) || null
            const pmid = (paid.payment_method as string | undefined) || null
            if (pmid && !suggestedPmId) {
              suggestedPmId = pmid
              const det = (paid as any)?.payment_method_details
              if (det?.card) {
                suggestedPmBrand = det.card.brand || null
                suggestedPmLast4 = det.card.last4 || null
              }
            } else if (!pmid && (paid.payment_intent as string | undefined)) {
              try {
                const pi = await stripe.paymentIntents.retrieve(paid.payment_intent as string)
                const pmFromPi = (pi.payment_method as string | undefined) || null
                if (pmFromPi && !suggestedPmId) {
                  suggestedPmId = pmFromPi
                  const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                  // @ts-ignore
                  suggestedPmBrand = (pmObj as any)?.card?.brand || null
                  // @ts-ignore
                  suggestedPmLast4 = (pmObj as any)?.card?.last4 || null
                }
              } catch {}
            }
          } else {
            const pis = await stripe.paymentIntents.list({ customer: stripeCustomerId, limit: 10 })
            const succ = pis.data.find(pi => pi.status === 'succeeded')
            if (succ) {
              lastChargeAmount = succ.amount_received || succ.amount || null
              lastChargeAt = succ.created || null
              // @ts-ignore
              currency = (succ.currency as string | null) || null
              const pmFromPi = (succ.payment_method as string | undefined) || null
              if (pmFromPi && !suggestedPmId) {
                suggestedPmId = pmFromPi
                try {
                  const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                  // @ts-ignore
                  suggestedPmBrand = (pmObj as any)?.card?.brand || null
                  // @ts-ignore
                  suggestedPmLast4 = (pmObj as any)?.card?.last4 || null
                } catch {}
              }
            }
          }
        } catch {}

        hasAnyPm = !!(hasInvoiceDefault || suggestedPmId)

        // Next bill
        const cpe = (s as any)?.current_period_end || null
        if (cpe) {
          inferredNextBillISO = new Date(cpe * 1000).toISOString()
        } else if (lastChargeAt) {
          const d = new Date(lastChargeAt * 1000)
          const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
          inferredNextBillISO = next.toISOString()
        }

        // Fallback: if no charge data yet but we have email, search by email (TeamUp often charged off customer context)
        try {
          if ((!lastChargeAmount || !lastChargeAt) && email) {
            const q = `billing_details.email:'${email}' AND status:'succeeded'`
            // @ts-ignore Stripe search endpoint
            const search = await (stripe.charges as any).search({ query: q, limit: 10 })
            if (search?.data?.length) {
              const ch = search.data[0]
              lastChargeAmount = ch.amount || null
              lastChargeAt = ch.created || null
              currency = ch.currency || currency
              lastChargeDescription = (ch.description as string | null) || lastChargeDescription
              const pmid = (ch.payment_method as string | undefined) || null
              if (pmid && !suggestedPmId) {
                suggestedPmId = pmid
                try {
                  const pmObj = await stripe.paymentMethods.retrieve(pmid)
                  // @ts-ignore
                  suggestedPmBrand = (pmObj as any)?.card?.brand || suggestedPmBrand
                  // @ts-ignore
                  suggestedPmLast4 = (pmObj as any)?.card?.last4 || suggestedPmLast4
                } catch {}
              }
            } else {
              // fallback to PaymentIntent search by email if charges search empty
              const qPi = `customer_details.email:'${email}' AND status:'succeeded'`
              // @ts-ignore Stripe search endpoint
              const piSearch = await (stripe.paymentIntents as any).search({ query: qPi, limit: 10 })
              if (piSearch?.data?.length) {
                const pi = piSearch.data[0]
                lastChargeAmount = (pi.amount_received || pi.amount) || lastChargeAmount
                lastChargeAt = pi.created || lastChargeAt
                // @ts-ignore
                currency = (pi.currency as string | null) || currency
                const pmFromPi = (pi.payment_method as string | undefined) || null
                if (pmFromPi && !suggestedPmId) {
                  suggestedPmId = pmFromPi
                  try {
                    const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                    // @ts-ignore
                    suggestedPmBrand = (pmObj as any)?.card?.brand || suggestedPmBrand
                    // @ts-ignore
                    suggestedPmLast4 = (pmObj as any)?.card?.last4 || suggestedPmLast4
                  } catch {}
                }
              }
            }
          }
        } catch {}

        // Plan inference
        const fromDesc = inferFromDesc(lastChargeDescription || null)
        if (fromDesc?.planKey) {
          // @ts-ignore
          inferredPlanKey = normalizeClientKey(fromDesc.planKey) as MembershipKey
        } else {
          const amt = Number(lastChargeAmount || 0)
          const priceToKey: Array<{ minor: number; key: MembershipKey }> = [
            { minor: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice * 100, key: 'FULL_ADULT' },
            { minor: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice * 100, key: 'WOMENS_CLASSES' },
            { minor: MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.monthlyPrice * 100, key: 'KIDS_WEEKEND_UNDER14' },
            { minor: MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.monthlyPrice * 100, key: 'KIDS_UNLIMITED_UNDER14' },
            { minor: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice * 100, key: 'WEEKEND_ADULT' },
            { minor: MEMBERSHIP_PLANS.MASTERS.monthlyPrice * 100, key: 'MASTERS' },
            { minor: MEMBERSHIP_PLANS.PERSONAL_TRAINING.monthlyPrice * 100, key: 'PERSONAL_TRAINING' },
            { minor: MEMBERSHIP_PLANS.WELLNESS_PACKAGE.monthlyPrice * 100, key: 'WELLNESS_PACKAGE' }
          ]
          const match = priceToKey.find(p => p.minor === amt)
          if (match) {
            if (match.key === 'WEEKEND_ADULT' || match.key === 'KIDS_UNLIMITED_UNDER14') {
              const d = (lastChargeDescription || '').toLowerCase()
              if (d.includes('kid')) inferredPlanKey = 'KIDS_UNLIMITED_UNDER14'
              else inferredPlanKey = 'WEEKEND_ADULT'
            } else {
              inferredPlanKey = match.key
            }
          }
        }

        return {
          mode: s ? 'subscriptions' : 'charges_fallback',
          stripeSubscriptionId: s?.id || null,
          stripeCustomerId,
          status: (s as any)?.status || null,
          current_period_end: (s as any)?.current_period_end || null,
          email,
          hasInvoiceDefault,
          hasAnyPm,
          suggestedPmId,
          suggestedPmBrand,
          suggestedPmLast4,
          lastChargeAmount,
          lastChargeAt,
          currency,
          lastChargeDescription,
          inferredNextBillISO,
          inferredPlanKey,
          items: s?.items?.data?.map((i: any) => ({ price: i.price?.unit_amount, currency: i.price?.currency })) || []
        }
      }))
      return NextResponse.json({ success: true, account: accountParam, rows })
    } catch (e: any) {
      return NextResponse.json({ success: false, error: e?.message || 'Failed to load customer' }, { status: 500 })
    }
  }

  // General account preview (no specific customer)
  const subs = await stripe.subscriptions.list({ status: 'all', limit })

  // If there are subscriptions, return subscription-centric preview (but enrich with PM/charge info for UI parity)
  if (subs.data.length > 0) {
    const rows = await Promise.all(subs.data.map(async (s) => {
      const stripeCustomerId = s.customer as string
      let email: string | null = null
      let hasInvoiceDefault = false
      let hasAnyPm = false
      let suggestedPmId: string | null = null
      let suggestedPmBrand: string | null = null
      let suggestedPmLast4: string | null = null
      let lastChargeAmount: number | null = null
      let lastChargeAt: number | null = null
      let currency: string | null = null
      let lastChargeDescription: string | null = null
      let inferredNextBillISO: string | null = null
      let inferredPlanKey: MembershipKey | null = null

      try {
        // Customer + default PM
        const cust = await stripe.customers.retrieve(stripeCustomerId)
        if (!('deleted' in cust)) {
          email = (cust.email as string | null) || null
          const invDef = cust.invoice_settings?.default_payment_method
          hasInvoiceDefault = !!invDef
          if (invDef) {
            const dpmId = typeof invDef === 'string' ? invDef : invDef.id
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
        // Attached PMs
        const pms = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card' })
        if (!suggestedPmId && pms.data.length > 0) {
          suggestedPmId = pms.data[0].id
          suggestedPmBrand = pms.data[0].card?.brand || null
          suggestedPmLast4 = pms.data[0].card?.last4 || null
        }
        // Charges + PI fallback
        let paid: any = null
        try {
          // @ts-ignore
          const search = await (stripe.charges as any).search({
            query: `customer:'${stripeCustomerId}' AND status:'succeeded'`,
            limit: 5,
            expand: ['data.payment_method']
          })
          paid = search?.data?.[0] || null
        } catch {}
        const charges = paid ? { data: [paid] } : await stripe.charges.list({ customer: stripeCustomerId, limit: 5, expand: ['data.payment_method'] })
        paid = paid || charges.data.find(ch => ch.paid && !ch.refunded && ch.amount > 0)
        if (paid) {
          lastChargeAmount = paid.amount
          lastChargeAt = paid.created
          currency = paid.currency
          lastChargeDescription = (paid.description as string | null) || null
          const pmid = (paid.payment_method as string | undefined) || null
          if (pmid && !suggestedPmId) {
            suggestedPmId = pmid
            try {
              const det = (paid as any)?.payment_method_details
              if (det?.card) {
                suggestedPmBrand = det.card.brand || null
                suggestedPmLast4 = det.card.last4 || null
              }
            } catch {}
          } else if (!pmid && (paid.payment_intent as string | undefined)) {
            try {
              const pi = await stripe.paymentIntents.retrieve(paid.payment_intent as string)
              const pmFromPi = (pi.payment_method as string | undefined) || null
              if (pmFromPi && !suggestedPmId) {
                suggestedPmId = pmFromPi
                try {
                  const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                  // @ts-ignore
                  suggestedPmBrand = (pmObj as any)?.card?.brand || null
                  // @ts-ignore
                  suggestedPmLast4 = (pmObj as any)?.card?.last4 || null
                } catch {}
              }
            } catch {}
          }
        } else {
          try {
            const pis = await stripe.paymentIntents.list({ customer: stripeCustomerId, limit: 5 })
            const succ = pis.data.find(pi => pi.status === 'succeeded')
            if (succ) {
              lastChargeAmount = succ.amount_received || succ.amount || null
              lastChargeAt = succ.created || null
              // @ts-ignore
              currency = (succ.currency as string | null) || null
              const pmFromPi = (succ.payment_method as string | undefined) || null
              if (pmFromPi && !suggestedPmId) {
                suggestedPmId = pmFromPi
                try {
                  const pmObj = await stripe.paymentMethods.retrieve(pmFromPi)
                  // @ts-ignore
                  suggestedPmBrand = (pmObj as any)?.card?.brand || null
                  // @ts-ignore
                  suggestedPmLast4 = (pmObj as any)?.card?.last4 || null
                } catch {}
              }
            }
          } catch {}
        }
        hasAnyPm = !!(hasInvoiceDefault || suggestedPmId || (pms.data.length > 0))

        // Infer next bill date: current_period_end if active/trialing; else from last charge month
        const cpe = (s as any)?.current_period_end || null
        if (cpe) {
          inferredNextBillISO = new Date(cpe * 1000).toISOString()
        } else if (lastChargeAt) {
          const d = new Date(lastChargeAt * 1000)
          const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
          inferredNextBillISO = next.toISOString()
        }

        // Infer plan: prefer description mapping; then amount mapping
        const fromDesc = inferFromDesc(lastChargeDescription || null)
        if (fromDesc?.planKey) {
          // @ts-ignore normalize client alias
          const nk = normalizeClientKey(fromDesc.planKey)
          inferredPlanKey = nk as MembershipKey
        } else {
          const amt = Number(lastChargeAmount || 0)
          const priceToKey: Array<{ minor: number; key: MembershipKey }> = [
            { minor: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice * 100, key: 'FULL_ADULT' },
            { minor: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice * 100, key: 'WOMENS_CLASSES' },
            { minor: MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.monthlyPrice * 100, key: 'KIDS_WEEKEND_UNDER14' },
            { minor: MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.monthlyPrice * 100, key: 'KIDS_UNLIMITED_UNDER14' },
            { minor: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice * 100, key: 'WEEKEND_ADULT' },
            { minor: MEMBERSHIP_PLANS.MASTERS.monthlyPrice * 100, key: 'MASTERS' },
            { minor: MEMBERSHIP_PLANS.PERSONAL_TRAINING.monthlyPrice * 100, key: 'PERSONAL_TRAINING' },
            { minor: MEMBERSHIP_PLANS.WELLNESS_PACKAGE.monthlyPrice * 100, key: 'WELLNESS_PACKAGE' }
          ]
          const match = priceToKey.find(p => p.minor === amt)
          if (match) {
            // Resolve 55.00 ambiguity using description keywords where possible
            if (match.key === 'WEEKEND_ADULT' || match.key === 'KIDS_UNLIMITED_UNDER14') {
              const d = (lastChargeDescription || '').toLowerCase()
              if (d.includes('kid')) inferredPlanKey = 'KIDS_UNLIMITED_UNDER14'
              else inferredPlanKey = 'WEEKEND_ADULT'
            } else {
              inferredPlanKey = match.key
            }
          }
        }
      } catch {}

      return {
        mode: 'subscriptions',
        stripeSubscriptionId: s.id,
        stripeCustomerId,
        status: (s as any).status,
        current_period_end: (s as any)?.current_period_end || null,
        email,
        hasInvoiceDefault,
        hasAnyPm,
        suggestedPmId,
        suggestedPmBrand,
        suggestedPmLast4,
        lastChargeAmount,
        lastChargeAt,
        currency,
        lastChargeDescription,
        inferredNextBillISO,
        inferredPlanKey,
        items: s.items?.data?.map(i => ({ price: i.price?.unit_amount, currency: i.price?.currency })) || []
      }
    }))
    return NextResponse.json({ success: true, account: accountParam, rows })
  }

  // Optional deep debug (legacy) – kept for compatibility
  const debugCustomerId = searchParams.get('debugCustomerId')
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
      // If still nothing, fall back to latest succeeded PaymentIntent
      if (!lastChargeAmount || !lastChargeAt) {
        try {
          const pis = await stripe.paymentIntents.list({ customer: c.id, limit: 5 })
          const succ = pis.data.find(pi => pi.status === 'succeeded')
          if (succ) {
            lastChargeAmount = succ.amount_received || succ.amount || null
            lastChargeAt = succ.created || null
            // @ts-ignore
            currency = (succ.currency as string | null) || null
            const pmFromPi = (succ.payment_method as string | undefined) || null
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
          }
        } catch {}
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
      // Retrieve full customer to ensure invoice_settings is present
      const cust = await stripe.customers.retrieve(c.id)
      const invDef = !('deleted' in cust) ? cust.invoice_settings?.default_payment_method : null
      hasInvoiceDefault = !!invDef
      // Legacy source (older APIs)
      // @ts-ignore
      defaultSource = !('deleted' in cust) ? (cust as any)?.default_source || null : null
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
      } else if (invDef) {
        // last fallback: default on customer (retrieve details)
        const dpm = invDef as any
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
    let inferredPlanKey: MembershipKey | null = null
    if (lastChargeAt) {
      const d = new Date(lastChargeAt * 1000)
      const next = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0))
      inferredNextBillISO = next.toISOString()
    }
    // Infer plan (same logic as above)
    const fromDesc = inferFromDesc(lastChargeDescription || null)
    if (fromDesc?.planKey) {
      // @ts-ignore
      inferredPlanKey = normalizeClientKey(fromDesc.planKey) as MembershipKey
    } else {
      const amt = Number(lastChargeAmount || 0)
      const priceToKey: Array<{ minor: number; key: MembershipKey }> = [
        { minor: MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice * 100, key: 'FULL_ADULT' },
        { minor: MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice * 100, key: 'WOMENS_CLASSES' },
        { minor: MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.monthlyPrice * 100, key: 'KIDS_WEEKEND_UNDER14' },
        { minor: MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.monthlyPrice * 100, key: 'KIDS_UNLIMITED_UNDER14' },
        { minor: MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice * 100, key: 'WEEKEND_ADULT' },
        { minor: MEMBERSHIP_PLANS.MASTERS.monthlyPrice * 100, key: 'MASTERS' },
        { minor: MEMBERSHIP_PLANS.PERSONAL_TRAINING.monthlyPrice * 100, key: 'PERSONAL_TRAINING' },
        { minor: MEMBERSHIP_PLANS.WELLNESS_PACKAGE.monthlyPrice * 100, key: 'WELLNESS_PACKAGE' }
      ]
      const match = priceToKey.find(p => p.minor === amt)
      if (match) {
        if (match.key === 'WEEKEND_ADULT' || match.key === 'KIDS_UNLIMITED_UNDER14') {
          const d = (lastChargeDescription || '').toLowerCase()
          if (d.includes('kid')) inferredPlanKey = 'KIDS_UNLIMITED_UNDER14'
          else inferredPlanKey = 'WEEKEND_ADULT'
        } else {
          inferredPlanKey = match.key
        }
      }
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
      inferredNextBillISO,
      inferredPlanKey
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


