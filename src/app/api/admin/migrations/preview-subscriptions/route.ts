import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'
import { inferPlanKeyFromDescription as inferFromDesc, normalizePlanKey as normalizeClientKey } from '@/app/admin/iq-migration/planMap'

export const dynamic = 'force-dynamic'
export const revalidate = 0

type PreviewItem = {
  email?: string
  customerId?: string
  planHint?: MembershipKey
  trialEndISO?: string
  paymentMethodId?: string
}

type PreviewOut = {
  email?: string | null
  stripeCustomerId?: string | null
  customerName?: string | null
  defaultPaymentMethod?: { id: string; brand?: string | null; last4?: string | null } | null
  lastCharge?: { id?: string; amount?: number | null; currency?: string | null; createdISO?: string | null; description?: string | null; paymentMethodId?: string | null }
  inferredPlanKey?: MembershipKey | null
  monthlyPriceMinor?: number | null
  trialEndISO?: string
  membershipProjection?: {
    membershipType?: string
    monthlyPrice?: number | null
    status?: string
    billingDay?: number
    nextBillingDate?: string
    accessPermissions?: any
    scheduleAccess?: string
    ageCategory?: string
  }
  ok: boolean
  warnings?: string[]
  error?: string
}

function nextFirstOfMonthISO(at: Date = new Date()): string {
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth() + 1, 1, 0, 0, 0))
  return d.toISOString()
}

function defaultAccessProfile(plan: Exclude<MembershipKey, never>, desc?: string | null) {
  const lower = (desc || '').toLowerCase()
  const isChild = /(\bunder\s*1[0-9]\b|\bages?\s*5.*11|\b5[-–]11\b)/.test(lower)
  const profiles: Record<MembershipKey, { access: any; schedule: string; age: string }> = {
    FULL_ADULT:               { access: { martialArts: true, womensClasses: false, personalTraining: false, wellness: false, kids_classes: false },       schedule: 'FULL_WEEK',       age: 'ADULT' },
    WEEKEND_ADULT:            { access: { martialArts: true, womensClasses: false, personalTraining: false, wellness: false, kids_classes: false },       schedule: 'WEEKEND_ONLY',   age: 'ADULT' },
    KIDS_WEEKEND_UNDER14:     { access: { martialArts: false, womensClasses: false, personalTraining: false, wellness: false, kids_classes: true },       schedule: 'KIDS_WEEKEND',   age: 'UNDER_14' },
    KIDS_UNLIMITED_UNDER14:   { access: { martialArts: false, womensClasses: false, personalTraining: false, wellness: false, kids_classes: true },       schedule: 'KIDS_WEEKLY',    age: 'UNDER_14' },
    WOMENS_CLASSES:           { access: { martialArts: false, womensClasses: true,  personalTraining: false, wellness: false, kids_classes: false },      schedule: isNaN(0) ? 'WOMENS_WEEKLY' : 'WOMENS_WEEKLY', age: isChild ? 'UNDER_12' : 'ADULT' },
    MASTERS:                  { access: { martialArts: true, womensClasses: false, personalTraining: false, wellness: false, kids_classes: false },       schedule: 'MASTERS_ONLY',   age: 'ADULT' },
    PERSONAL_TRAINING:        { access: { martialArts: false, womensClasses: false, personalTraining: true,  wellness: false, kids_classes: false },      schedule: 'PT_MONTHLY',     age: 'ADULT' },
    WELLNESS_PACKAGE:         { access: { martialArts: false, womensClasses: false, personalTraining: false, wellness: true,  kids_classes: false },      schedule: 'WELLNESS',       age: 'ADULT' }
  }
  return profiles[plan]
}

async function resolveCustomer(stripe: any, email?: string, customerId?: string): Promise<{ customer?: any, error?: string }> {
  if (customerId) {
    try {
      const c = await stripe.customers.retrieve(customerId)
      if (!c || (c as any).deleted) return { error: 'customer_not_found' }
      return { customer: c }
    } catch (e:any) { return { error: `customer_lookup_failed: ${e?.message || 'unknown'}` } }
  }
  if (!email) return { error: 'no_email_or_customerId' }
  try {
    // Prefer search API for exact email match
    const res = await (stripe.customers.search?.({ query: `email:'${email}'`, limit: 5 }).catch(() => null))
    if (res?.data?.length) return { customer: res.data[0] }
  } catch {}
  // Fallback to list
  const list = await stripe.customers.list({ email, limit: 5 })
  if (list.data.length > 0) return { customer: list.data[0] }
  return { error: 'customer_not_found' }
}

async function resolveLastCharge(stripe: any, customerId: string, email?: string) {
  // Try search by customer id first
  let ch: any | null = null
  try {
    const search = await (stripe.charges as any).search({
      query: `customer:'${customerId}' AND status:'succeeded'`,
      limit: 5
    })
    if (search?.data?.length) ch = search.data[0]
  } catch {}
  if (!ch) {
    const list = await stripe.charges.list({ customer: customerId, limit: 5 })
    ch = list.data.find((c: any) => c.paid && !c.refunded && c.amount > 0) || null
  }
  if (!ch && email) {
    try {
      const searchByEmail = await (stripe.charges as any).search({
        query: `billing_details.email:'${email}' AND status:'succeeded'`,
        limit: 5
      })
      if (searchByEmail?.data?.length) ch = searchByEmail.data[0]
    } catch {}
  }
  if (!ch) return null
  return {
    id: ch.id,
    amount: ch.amount ?? null,
    currency: ch.currency ?? null,
    createdISO: ch.created ? new Date(ch.created * 1000).toISOString() : null,
    description: (ch.description as string) || null,
    paymentMethodId: (ch.payment_method as string) || null
  }
}

function inferPlanFromSignals(desc: string | null | undefined, amountMinor?: number | null, hint?: MembershipKey | undefined): { plan?: MembershipKey, reason: string } {
  const d = desc || ''
  const f = inferFromDesc(d)
  if (hint) return { plan: hint, reason: 'hint' }
  if (f?.planKey) return { plan: normalizeClientKey(f.planKey) as MembershipKey, reason: 'description' }
  if (amountMinor) {
    const table: Array<{ minor: number, key: MembershipKey, tie?: (s: string)=>boolean }> = [
      { minor: Number(MEMBERSHIP_PLANS.FULL_ADULT.monthlyPrice) * 100, key: 'FULL_ADULT' },
      { minor: Number(MEMBERSHIP_PLANS.WOMENS_CLASSES.monthlyPrice) * 100, key: 'WOMENS_CLASSES' },
      { minor: Number(MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.monthlyPrice) * 100, key: 'KIDS_WEEKEND_UNDER14' },
      { minor: Number(MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.monthlyPrice) * 100, key: 'KIDS_UNLIMITED_UNDER14' },
      { minor: Number(MEMBERSHIP_PLANS.WEEKEND_ADULT.monthlyPrice) * 100, key: 'WEEKEND_ADULT' },
      { minor: Number(MEMBERSHIP_PLANS.MASTERS.monthlyPrice) * 100, key: 'MASTERS' },
      { minor: Number(MEMBERSHIP_PLANS.PERSONAL_TRAINING.monthlyPrice) * 100, key: 'PERSONAL_TRAINING' },
      { minor: Number(MEMBERSHIP_PLANS.WELLNESS_PACKAGE.monthlyPrice) * 100, key: 'WELLNESS_PACKAGE' }
    ]
    const match = table.find(t => t.minor === Number(amountMinor))
    if (match) return { plan: match.key, ...(match.key === 'WEEKEND_ADULT' || match.key === 'KIDS_UNLIMITED_UNDER14' ? { reason: 'amount_tiebreak' } : { reason: 'amount' }) }
  }
  return { plan: undefined, reason: 'no_signal' }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN','STAFF'].includes(admin.role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 })
    }

    const body = await req.json().catch(() => ({} as any))
    const account: StripeAccountKey = (body?.account || 'IQ').toUpperCase()
    const commit: boolean = !!body?.commit
    const items: PreviewItem[] = Array.isArray(body?.items) ? body.items : []
    if (!items.length) return NextResponse.json({ success: false, error: 'Provide items: [{email?, customerId?, planHint?, trialEndISO?, paymentMethodId?}]' }, { status: 400 })

    const stripe = getStripeClient(account)
    const outputs: PreviewOut[] = []
    const errors: any[] = []

    for (const it of items) {
      const out: PreviewOut = { ok: false }
      try {
        const { customer, error } = await resolveCustomer(stripe, it.email, it.customerId)
        if (error || !customer) {
          out.error = error || 'customer_not_found'
          outputs.push(out)
          continue
        }
        const customerId = (customer as any).id as string
        const customerName = (customer as any).name || null
        const email = (customer as any).email || it.email || null

        // default PM
        let defaultPmId: string | undefined
        let defaultPmBrand: string | undefined
        let defaultPmLast4: string | undefined
        const invDef = (customer as any).invoice_settings?.default_payment_method
        if (invDef) {
          defaultPmId = typeof invDef === 'string' ? invDef : invDef.id
        }
        if (!defaultPmId) {
          try {
            const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 5 })
            if (pms.data.length) {
              defaultPmId = pms.data[0].id
              defaultPmBrand = pms.data[0].card?.brand
              defaultPmLast4 = pms.data[0].card?.last4
            }
          } catch {}
        } else {
          try {
            const pmObj = await stripe.paymentMethods.retrieve(defaultPmId)
            defaultPmBrand = (pmObj as any)?.card?.brand
            defaultPmLast4 = (pmObj as any)?.card?.last4
          } catch {}
        }

        // last charge
        const lastCharge = await resolveLastCharge(stripe, customerId, email || undefined)

        // plan inference
        const { plan, reason } = inferPlanFromSignals(lastCharge?.description, lastCharge?.amount, it.planHint)
        let inferredPlanKey: MembershipKey | null = (plan ?? null)
        const warnings: string[] = []
        if (!inferredPlanKey) {
          warnings.push('Plan could not be inferred from history; will require explicit planKey')
        } else if ((reason === 'amount_tiebreak') && lastCharge?.description) {
          // we already attempted tie-break via description
        } else if (reason !== 'description') {
          warnings.push(`Plan inferred by ${reason}`)
        }

        const monthlyPriceMinor = inferredPlanKey ? Number(MEMBERSHIP_PLANS[inferredPlanKey].monthlyPrice) * 100 : null
        const trialEndISO = it.trialEndISO || nextFirstOfMonthISO()

        // membership projection
        let membershipProjection: PreviewOut['membershipProjection'] = {}
        if (inferredPlanKey) {
          const prof = defaultAccessProfile(inferredPlanKey, lastCharge?.description || undefined)
          membershipProjection = {
            membershipType: inferredPlanKey,
            monthlyPrice: monthlyPriceMinor ? monthlyPriceMinor / 100 : null,
            status: 'ACTIVE',
            billingDay: 1,
            nextBillingDate: trialEndISO,
            accessPermissions: prof?.access,
            scheduleAccess: prof?.schedule,
            ageCategory: prof?.age
          }
        }

        Object.assign(out, {
          email,
          stripeCustomerId: customerId,
          customerName,
          defaultPaymentMethod: defaultPmId ? { id: defaultPmId, brand: defaultPmBrand || null, last4: defaultPmLast4 || null } : null,
          lastCharge,
          inferredPlanKey,
          monthlyPriceMinor,
          trialEndISO,
          membershipProjection,
          ok: !!(customerId && (defaultPmId || it.paymentMethodId) && inferredPlanKey),
          warnings
        })

        // Commit path: create subscription + portal records using existing creation logic
        if (commit) {
          if (!out.ok) {
            out.error = out.error || 'missing_required_fields_for_commit'
          } else {
            const pmToUse = it.paymentMethodId || (defaultPmId as string)
            try {
              const { getOrCreatePrice } = await import('@/app/api/confirm-payment/handlers') as any
              const priceId = await getOrCreatePrice({ monthlyPrice: MEMBERSHIP_PLANS[inferredPlanKey!].monthlyPrice, name: MEMBERSHIP_PLANS[inferredPlanKey!].name }, account)
              // Ensure PM attached + set default
              try { await stripe.paymentMethods.attach(pmToUse, { customer: customerId }) } catch {}
              try { await stripe.customers.update(customerId, { invoice_settings: { default_payment_method: pmToUse } }) } catch {}
              const trialEndTs = Math.floor(new Date(out.trialEndISO!).getTime() / 1000)
              const sub = await stripe.subscriptions.create({
                customer: customerId,
                items: [{ price: priceId }],
                collection_method: 'charge_automatically',
                trial_end: trialEndTs,
                proration_behavior: 'none',
                metadata: { migrated_from: 'teamup', account, plan: inferredPlanKey, email }
              })
              // Upsert Portal subscription + membership
              const user = await prisma.user.upsert({
                where: { email: email! },
                create: {
                  email: email!,
                  firstName: (customerName || '').split(' ')[0] || 'Member',
                  lastName: (customerName || '').split(' ').slice(1).join(' ') || '',
                  status: 'ACTIVE'
                },
                update: {}
              })
              // Find or create IQ business entity
              const iqEntity = await prisma.businessEntity.upsert({
                where: { name: account },
                update: {},
                create: { name: account, displayName: account === 'IQ' ? 'IQ Learning Centre' : account === 'AURA' ? 'Aura MMA' : 'Sporting U', description: `${account} entity`, vatYearStart: new Date(new Date().getFullYear(), 3, 1), vatYearEnd: new Date(new Date().getFullYear()+1, 2, 31) }
              })
              const monthlyPrice = Number(MEMBERSHIP_PLANS[inferredPlanKey!].monthlyPrice)
              const nextBill = new Date(out.trialEndISO!)
              const dbSub = await prisma.subscription.upsert({
                where: { stripeSubscriptionId: sub.id },
                create: {
                  userId: user.id,
                  stripeSubscriptionId: sub.id,
                  stripeCustomerId: customerId,
                  // cast to any to bypass strict typing on generated Prisma types
                  // (field exists in schema as String @default("SU"))
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ...( { stripeAccountKey: account } as any ),
                  routedEntityId: iqEntity.id,
                  membershipType: inferredPlanKey!,
                  monthlyPrice,
                  status: 'ACTIVE',
                  currentPeriodStart: new Date(),
                  currentPeriodEnd: nextBill,
                  nextBillingDate: nextBill
                } as any,
                update: {
                  userId: user.id,
                  stripeCustomerId: customerId,
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  ...( { stripeAccountKey: account } as any ),
                  routedEntityId: iqEntity.id,
                  membershipType: inferredPlanKey!,
                  monthlyPrice,
                  status: 'ACTIVE',
                  currentPeriodEnd: nextBill,
                  nextBillingDate: nextBill
                } as any
              })
              // ensure membership row
              const existingMembership = await prisma.membership.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
              const profile = defaultAccessProfile(inferredPlanKey!)
              if (existingMembership) {
                await prisma.membership.update({
                  where: { id: existingMembership.id },
                  data: {
                    membershipType: inferredPlanKey!,
                    monthlyPrice,
                    status: 'ACTIVE',
                    nextBillingDate: nextBill,
                    billingDay: 1,
                    accessPermissions: JSON.stringify(profile?.access || {}),
                    scheduleAccess: profile?.schedule || 'STANDARD',
                    ageCategory: profile?.age || 'ADULT'
                  }
                })
              } else {
                await prisma.membership.create({
                  data: {
                    userId: user.id,
                    membershipType: inferredPlanKey!,
                    status: 'ACTIVE',
                    startDate: new Date(),
                    monthlyPrice,
                    accessPermissions: JSON.stringify(profile?.access || {}),
                    scheduleAccess: profile?.schedule || 'STANDARD',
                    ageCategory: profile?.age || 'ADULT',
                    billingDay: 1,
                    nextBillingDate: nextBill
                  }
                })
              }
              out.ok = true
            } catch (e:any) {
              out.error = `commit_failed: ${e?.message || 'unknown'}`
            }
          }
        }

        outputs.push(out)
      } catch (e:any) {
        outputs.push({ ok: false, email: it.email, error: e?.message || 'unexpected_error' })
      }
    }

    return NextResponse.json({ success: true, account, commit, items: outputs })
  } catch (e:any) {
    return NextResponse.json({ success: false, error: e?.message || 'failed' }, { status: 500 })
  }
}


