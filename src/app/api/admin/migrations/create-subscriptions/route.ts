import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'

// Create Stripe subscriptions in IQ for migrated customers and write shadow users/subscriptions in DB.
// POST body: { items: Array<{ stripeCustomerId: string; email: string | null; planKey: MembershipKey; trialEndISO: string; suggestedPmId?: string | null }> }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['ADMIN', 'SUPER_ADMIN', 'STAFF'].includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { items } = await request.json()
    if (!Array.isArray(items) || items.length === 0) return NextResponse.json({ error: 'No items' }, { status: 400 })

    const account: StripeAccountKey = 'IQ'
    const stripe = getStripeClient(account)

    // Ensure BusinessEntity exists for IQ
    const iqEntity = await prisma.businessEntity.upsert({
      where: { name: 'IQ' },
      update: {},
      create: { name: 'IQ', displayName: 'IQ Learning Centre', description: 'IQ entity', vatYearStart: new Date(new Date().getFullYear(), 3, 1), vatYearEnd: new Date(new Date().getFullYear()+1, 2, 31) }
    })

    const results: any[] = []

    // Helper: infer plan from Stripe charge history (description first, then amount)
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
            // take most recent non-refunded positive amount
            paid = search.data.find((c: any) => c.paid && !c.refunded && c.amount > 0) || search.data[0]
          }
        } catch {}
        if (!paid) {
          const list = await stripe.charges.list({ customer: custId, limit: 5 })
          paid = list.data.find(c => c.paid && !c.refunded && c.amount > 0) || null
        }
        if (!paid && email) {
          try {
            // @ts-ignore – email fallback if customer id search yields nothing (TeamUp style)
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
            const priceMap: Array<{ minor: number; key: MembershipKey }> = Object.values(MEMBERSHIP_PLANS).map(p => ({
              // monthlyPrice is number in your config
              // @ts-ignore
              minor: (p.monthlyPrice as number) * 100,
              // @ts-ignore
              key: p.key as unknown as MembershipKey
            }))
            const m = priceMap.find(x => x.minor === amt)
            if (m) {
              key = m.key
            }
          }
          if (key) return { planKey: key, lastAmountMinor: amt, lastDesc: desc }
        }
      } catch {}
      return {}
    }

    for (const it of items) {
      try {
        // Determine plan: prefer inference from Stripe history, fall back to provided key
        let chosenKey = (it?.planKey as unknown as MembershipKey) as MembershipKey | undefined
        const inferred = await inferPlanFromStripe(it.stripeCustomerId, it.email || undefined)
        if (inferred.planKey && (!chosenKey || chosenKey === 'FULL_ADULT' || chosenKey === 'WEEKEND_ADULT')) {
          chosenKey = inferred.planKey as MembershipKey
        }
        if (!chosenKey) throw new Error(`Unable to determine plan for ${it.email || it.stripeCustomerId}`)
        const plan = MEMBERSHIP_PLANS[chosenKey as MembershipKey]
        if (!plan) throw new Error(`Unknown plan ${String(chosenKey)}`)
        let trialEnd = Math.floor(new Date(it.trialEndISO).getTime() / 1000)
        const nowSec = Math.floor(Date.now() / 1000)
        // Clamp trial_end to the future. If inferred is past, use 1st of next month
        if (!trialEnd || trialEnd <= nowSec) {
          const now = new Date()
          const firstNextMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
          trialEnd = Math.floor(firstNextMonth.getTime() / 1000)
        }

        // Ensure suggested PM is attached and set as default if provided
        if (it.suggestedPmId) {
          try {
            try { await stripe.paymentMethods.attach(it.suggestedPmId, { customer: it.stripeCustomerId }) } catch {}
            try { await stripe.customers.update(it.stripeCustomerId, { invoice_settings: { default_payment_method: it.suggestedPmId } }) } catch {}
          } catch {}
        }

        // Get or create price in IQ
        const { getOrCreatePrice } = await import('@/app/api/confirm-payment/handlers') as any
        const priceId = await getOrCreatePrice({ monthlyPrice: plan.monthlyPrice, name: plan.name }, account)

        // Idempotency: check if a similar trialing subscription already exists
        let existing: any = null
        try {
          const subsList = await stripe.subscriptions.list({ customer: it.stripeCustomerId, status: 'all', limit: 20 })
          existing = subsList.data.find(s => s.status === 'trialing' && (s.items?.data?.[0]?.price?.id === priceId)) || null
        } catch {}

        // Create subscription in Stripe (IQ) if not existing
        const sub = existing || await stripe.subscriptions.create({
          customer: it.stripeCustomerId,
          items: [{ price: priceId }],
          collection_method: 'charge_automatically',
          trial_end: trialEnd,
          proration_behavior: 'none',
          metadata: { migrated_from: 'teamup', account }
        }, { idempotencyKey: `migrate:${it.stripeCustomerId}:${priceId}:${trialEnd}` })

        // Find or create shadow user by email (prefer Stripe customer's real name)
        let userId: string
        if (it.email) {
          const existing = await prisma.user.findUnique({ where: { email: it.email } })
          const localPart = it.email.split('@')[0]
          if (existing) {
            userId = existing.id
            // If existing has placeholder/empty names, try to backfill from Stripe
            const needsNameUpdate =
              !existing.firstName ||
              !existing.lastName ||
              existing.firstName.toLowerCase() === localPart.toLowerCase() ||
              existing.firstName.toLowerCase() === 'member'
            if (needsNameUpdate) {
              try {
                const cust = await stripe.customers.retrieve(it.stripeCustomerId)
                let fn = existing.firstName || localPart
                let ln = existing.lastName || ''
                if (!('deleted' in cust)) {
                  const rawName = (cust as any)?.name as string | undefined
                  if (rawName && rawName.trim().length > 0) {
                    const parts = rawName.trim().split(/\s+/)
                    if (parts.length > 1) {
                      fn = parts.slice(0, -1).join(' ')
                      ln = parts.slice(-1).join(' ')
                    } else {
                      fn = rawName.trim()
                    }
                  } else {
                    const dpm = (cust as any)?.invoice_settings?.default_payment_method
                    if (dpm) {
                      const pm = await stripe.paymentMethods.retrieve(dpm as string)
                      const n = (pm as any)?.billing_details?.name as string | undefined
                      if (n && n.trim().length > 0) {
                        const parts = n.trim().split(/\s+/)
                        if (parts.length > 1) {
                          fn = parts.slice(0, -1).join(' ')
                          ln = parts.slice(-1).join(' ')
                        } else {
                          fn = n.trim()
                        }
                      }
                    }
                  }
                }
                await prisma.user.update({
                  where: { id: userId },
                  data: { firstName: fn, lastName: ln }
                })
              } catch {
                // best-effort; keep existing names if update fails
              }
            }
          } else {
            // Try to read real name from Stripe
            let firstName = localPart
            let lastName = ''
            try {
              const cust = await stripe.customers.retrieve(it.stripeCustomerId)
              if (!('deleted' in cust)) {
                let rawName: string | undefined = (cust as any)?.name
                if (!rawName && (cust as any)?.invoice_settings?.default_payment_method) {
                  try {
                    const pm = await stripe.paymentMethods.retrieve((cust as any).invoice_settings.default_payment_method as string)
                    const n = (pm as any)?.billing_details?.name as string | undefined
                    if (n && n.trim().length > 0) {
                      rawName = n.trim()
                    }
                  } catch {}
                }
                if (rawName && rawName.trim().length > 0) {
                  const parts = rawName.trim().split(/\s+/)
                  if (parts.length > 1) {
                    firstName = parts.slice(0, -1).join(' ')
                    lastName = parts.slice(-1).join(' ')
                  } else {
                    firstName = rawName.trim()
                  }
                }
              }
            } catch {}
            const u = await prisma.user.create({
              data: {
                email: it.email,
                firstName,
                lastName,
                role: 'CUSTOMER',
                status: 'ACTIVE'
              }
            })
            userId = u.id
          }
        } else {
          // Fallback: create placeholder user
          const u = await prisma.user.create({ data: { email: `migrated_${Date.now()}_${Math.random().toString(36).slice(2)}@local`, firstName: 'Member', lastName: 'Migrated', role: 'CUSTOMER', status: 'ACTIVE' } })
          userId = u.id
        }

        // Write subscription in Portal365 DB (upsert by stripeSubscriptionId)
        await prisma.subscription.upsert({
          where: { stripeSubscriptionId: sub.id },
          create: {
            userId,
            stripeSubscriptionId: sub.id,
            stripeCustomerId: it.stripeCustomerId,
            stripeAccountKey: account,
            routedEntityId: iqEntity.id,
            membershipType: chosenKey as string,
            monthlyPrice: plan.monthlyPrice,
            status: 'ACTIVE',
            currentPeriodStart: new Date(),
            currentPeriodEnd: new Date(trialEnd * 1000),
            nextBillingDate: new Date(trialEnd * 1000)
          } as any,
          update: {
            userId,
            stripeCustomerId: it.stripeCustomerId,
            stripeAccountKey: account,
            routedEntityId: iqEntity.id,
            membershipType: chosenKey as string,
            monthlyPrice: plan.monthlyPrice,
            status: 'ACTIVE',
            currentPeriodEnd: new Date(trialEnd * 1000),
            nextBillingDate: new Date(trialEnd * 1000)
          } as any
        })

        // Ensure a membership row exists and reflects the plan for UI display
        const existingMembership = await prisma.membership.findFirst({
          where: { userId },
          orderBy: { createdAt: 'desc' }
        })
        const defaultAccess = JSON.stringify({})
        const defaultScheduleAccess = JSON.stringify({})
        const ageCategoryValue = String(chosenKey).toLowerCase().includes('kids') ? 'KID' : 'ADULT'
        const trialEndDate = new Date(trialEnd * 1000)
        if (!existingMembership) {
          await prisma.membership.create({
            data: {
              userId,
              membershipType: chosenKey as string,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              startDate: new Date(),
              nextBillingDate: trialEndDate,
              // required text fields
              accessPermissions: defaultAccess,
              scheduleAccess: defaultScheduleAccess,
              ageCategory: ageCategoryValue
            } as any
          })
        } else {
          await prisma.membership.update({
            where: { id: existingMembership.id },
            data: {
              membershipType: chosenKey as string,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              nextBillingDate: (existingMembership as any)?.nextBillingDate ?? trialEndDate,
              accessPermissions: (existingMembership as any)?.accessPermissions ?? defaultAccess,
              scheduleAccess: (existingMembership as any)?.scheduleAccess ?? defaultScheduleAccess,
              ageCategory: ageCategoryValue
            } as any
          })
        }

        results.push({ stripeCustomerId: it.stripeCustomerId, subscriptionId: sub.id })
      } catch (e: any) {
        results.push({ stripeCustomerId: it.stripeCustomerId, error: e?.message || 'failed' })
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Migration failed' }, { status: 500 })
  }
}


