import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'

export const dynamic = 'force-dynamic'
export const revalidate = 0

export async function POST(req: NextRequest) {
  try {
    const session: any = await getServerSession(authOptions as any)
    if (!session?.user?.email) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    if (!['ADMIN','SUPER_ADMIN','STAFF'].includes(session.user.role)) return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })

    const { customers, account = 'IQ' }: { customers: Array<{ stripeCustomerId?: string; email?: string }>, account?: StripeAccountKey } = await req.json()
    if (!Array.isArray(customers) || customers.length === 0) {
      return NextResponse.json({ success: false, error: 'No customers supplied' }, { status: 400 })
    }

    const stripe = getStripeClient((account as StripeAccountKey) || 'IQ')

    const inferPlanFromStripe = async (custId: string, email?: string): Promise<Partial<{ planKey: MembershipKey; lastAmountMinor: number; lastDesc: string }>> => {
      try {
        let paid: any | null = null
        try {
          // @ts-ignore
          const search = await (stripe.charges as any).search({
            query: `customer:'${custId}' AND status:'succeeded'`,
            limit: 5
          })
          if (search?.data?.length) {
            paid = search.data.find((c: any) => c.paid && !c.refunded && c.amount > 0) || search.data[0]
          }
        } catch {}
        if (!paid) {
          const list = await stripe.charges.list({ customer: custId, limit: 5 })
          paid = list.data.find(c => c.paid && !c.refunded && c.amount > 0) || null
        }
        if (!paid && email) {
          try {
            // @ts-ignore
            const byEmail = await (stripe.charges as any).search({
              query: `billing_details.email:'${email}' AND status:'succeeded'`,
              limit: 5
            })
            paid = byEmail?.data?.[0] || null
          } catch {}
        }
        if (paid) {
          const amt = Number(paid.amount || 0)
          const desc: string = (paid.description as string) || ''
          const d = desc.toLowerCase()
          let key: MembershipKey | undefined
          if (d.includes('female only')) key = 'WOMENS_CLASSES'
          else if (d.includes('kids') && d.includes('weekend')) key = 'KIDS_WEEKEND_UNDER14'
          else if (d.includes('kids') && (d.includes('unlimited') || d.includes('unlimited kids'))) key = 'KIDS_UNLIMITED_UNDER14'
          else if (d.includes('weekend') && !d.includes('kids')) key = 'WEEKEND_ADULT'
          else if (d.includes('full') || d.includes('unlimited adults')) key = 'FULL_ADULT'
          if (!key) {
            const map: Array<{ minor: number; key: MembershipKey }> = Object.values(MEMBERSHIP_PLANS).map((p: any) => ({
              minor: p.monthlyPrice * 100,
              key: p.key as MembershipKey
            }))
            const m = map.find(x => x.minor === amt)
            if (m) {
              if (m.key === 'WEEKEND_ADULT' || m.key === 'KIDS_UNLIMITED_UNDER14') {
                if (d.includes('kid')) key = 'KIDS_UNLIMITED_UNDER14'
                else key = 'WEEKEND_ADULT'
              } else {
                key = m.key
              }
            }
          }
          if (key) return { planKey: key, lastDesc: desc, lastAmountMinor: amt }
        }
      } catch {}
      return {}
    }

    const out: any[] = []

    for (const entry of customers) {
      try {
        // resolve customer id if only email is provided
        let custId = entry.stripeCustomerId || ''
        let email = entry.email
        if (!custId && email) {
          try {
            // @ts-ignore
            const found = await (stripe.customers as any).search({ query: `email:'${email}'`, limit: 1 })
            if (found?.data?.length) {
              custId = (found.data[0] as any).id
            }
          } catch {}
        }
        if (!custId) throw new Error('Missing stripeCustomerId and unable to resolve from email')

        const inferred = await inferPlanFromStripe(custId, email)
        const planKey = (inferred.planKey || undefined) as MembershipKey | undefined
        const plan = planKey ? (MEMBERSHIP_PLANS[planKey] as any) : undefined
        const priceId = plan ? (await (await import('@/app/api/confirm-payment/handlers')).getOrCreatePrice({ monthlyPrice: plan.monthlyPrice, name: plan.name }, (account as StripeAccountKey) || 'IQ')) : null

        // figure payment method to use
        let pmId: string | null = null
        let pmBrand: string | null = null
        let pmLast4: string | null = null
        try {
          const cust = await stripe.customers.retrieve(custId)
          if (!('deleted' in cust)) {
            const invDef = (cust as any)?.invoice_settings?.default_payment_method as string | undefined
            if (invDef) {
              pmId = invDef
              try {
                const pm = await stripe.paymentMethods.retrieve(invDef)
                pmBrand = (pm as any)?.card?.brand || null
                pmLast4 = (pm as any)?.card?.last4 || null
              } catch {}
            }
          }
        } catch {}
        if (!pmId) {
          // try last charge PM
          try {
            // we already looked up charges inside infer; do again minimally
            // @ts-ignore
            const search = await (stripe.charges as any).search({ query: `customer:'${custId}' AND status:'succeeded'`, limit: 5 })
            const ch = search?.data?.find((c: any) => c.paid && !c.refunded && c.amount > 0)
            const cid = ch ? (ch.payment_method as string | undefined) : undefined
            if (cid) {
              pmId = cid
              try {
                const pm = await stripe.paymentMethods.retrieve(cid)
                pmBrand = (pm as any)?.card?.brand || null
                pmLast4 = (pm as any)?.card?.last4 || null
              } catch {}
            }
          } catch {}
        }

        // check if a matching trialing sub already exists for that price
        let existingSubId: string | null = null
        if (priceId) {
          try {
            const subs = await stripe.subscriptions.list({ customer: custId, status: 'all', limit: 20 })
            const found = subs.data.find(s => s.status === 'trialing' && (s.items?.data?.[0]?.price?.id === priceId)) as any
            if (found) existingSubId = found.id
          } catch {}
        }

        out.push({
          email,
          stripeCustomerId: custId,
          inferredPlanKey: planKey || null,
          lastChargeAmountMinor: inferred.lastAmountMinor || null,
          lastChargeDescription: inferred.lastDesc || null,
          priceId,
          paymentMethod: pmId ? { id: pmId, brand: pmBrand, last4: pmLast4 } : null,
          willCreateSubscription: !!(priceId && !existingSubId),
          existingSubscriptionId: existingSubId
        })
      } catch (e: any) {
        out.push({ email: entry.email || null, stripeCustomerId: entry.stripeCustomerId || null, error: e?.message || 'preview_failed' })
      }
    }

    return NextResponse.json({ success: true, account, results: out })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'preview failed' }, { status: 500 })
  }
}
