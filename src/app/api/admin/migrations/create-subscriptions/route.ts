import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'

function shouldStoreGuardian(email?: string | null): boolean {
  if (!email) return false
  return /(@member\.local|@local)$/i.test(email)
}

async function upsertGuardianEmail(userId: string, guardianEmail?: string | null) {
  if (!guardianEmail) return
  const existing = await prisma.user.findUnique({ where: { id: userId }, select: { communicationPrefs: true } })
  try {
    const next = existing?.communicationPrefs ? JSON.parse(existing.communicationPrefs) : {}
    if (next.guardianEmail === guardianEmail) return
    next.guardianEmail = guardianEmail
    await prisma.user.update({ where: { id: userId }, data: { communicationPrefs: JSON.stringify(next) } })
  } catch {
    await prisma.user.update({ where: { id: userId }, data: { communicationPrefs: JSON.stringify({ guardianEmail }) } })
  }
}

function splitName(full?: string | null): { firstName: string; lastName: string } {
  const safe = (full || '').trim()
  if (!safe) return { firstName: 'Member', lastName: '' }
  const parts = safe.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')
  return { firstName, lastName }
}

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

    for (const it of items) {
      try {
        const plan = MEMBERSHIP_PLANS[it.planKey as MembershipKey]
        if (!plan) throw new Error(`Unknown plan ${it.planKey}`)

        let stripeCustomer: any = null
        try {
          stripeCustomer = await stripe.customers.retrieve(it.stripeCustomerId)
        } catch (err: any) {
          throw new Error(`Unable to retrieve Stripe customer ${it.stripeCustomerId}: ${err?.message || err}`)
        }
        if (!stripeCustomer || (stripeCustomer as any).deleted) {
          throw new Error(`Stripe customer ${it.stripeCustomerId} not found or deleted`)
        }
        const derivedName = splitName(stripeCustomer.name || (stripeCustomer.email ?? it.email ?? null))

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

        // Find or create shadow user by email
        let userId: string
        let userEmail = it.email || null
        const fallbackFirst = (it.email || '').split('@')[0]
        if (it.email) {
          const existing = await prisma.user.findUnique({ where: { email: it.email }, select: { id: true, firstName: true, lastName: true, email: true } })
          if (existing) {
            userId = existing.id
            const shouldUpdateName =
              !existing.firstName ||
              existing.firstName === 'Member' ||
              existing.firstName.toLowerCase() === fallbackFirst.toLowerCase() ||
              (!existing.lastName && !!derivedName.lastName)

            if (shouldUpdateName) {
              await prisma.user.update({
                where: { id: existing.id },
                data: { firstName: derivedName.firstName, lastName: derivedName.lastName }
              })
            }
          } else {
            const u = await prisma.user.create({
              data: {
                email: it.email,
                firstName: derivedName.firstName,
                lastName: derivedName.lastName,
                role: 'CUSTOMER',
                status: 'ACTIVE'
              }
            })
            userId = u.id
          }
        } else {
          // Fallback: create placeholder user
          const u = await prisma.user.create({
            data: {
              email: `migrated_${Date.now()}_${Math.random().toString(36).slice(2)}@local`,
              firstName: derivedName.firstName || 'Member',
              lastName: derivedName.lastName || 'Migrated',
              role: 'CUSTOMER',
              status: 'ACTIVE'
            }
          })
          userId = u.id
          userEmail = u.email
        }

        if (!it.email && stripeCustomer.email && !userEmail) {
          userEmail = stripeCustomer.email
        }

        if (shouldStoreGuardian(userEmail) && it.guardianEmail) {
          await upsertGuardianEmail(userId, it.guardianEmail)
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
            membershipType: it.planKey,
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
            membershipType: it.planKey,
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
        // Minimal membership profile (required non-null fields)
        const isKid = String(it.planKey || '').includes('KIDS')
        const access = isKid
          ? { kids_classes: true, martialArts: false, womensClasses: false, personalTraining: false, wellness: false }
          : {
              martialArts: it.planKey !== 'WOMENS_CLASSES' && it.planKey !== 'WELLNESS_PACKAGE' && it.planKey !== 'PERSONAL_TRAINING',
              womensClasses: it.planKey === 'WOMENS_CLASSES',
              personalTraining: it.planKey === 'PERSONAL_TRAINING',
              wellness: it.planKey === 'WELLNESS_PACKAGE',
              kids_classes: false
            }
        const schedule =
          isKid ? (String(it.planKey).includes('WEEKEND') ? 'KIDS_WEEKEND' : 'KIDS_WEEKLY')
                : (String(it.planKey).includes('WEEKEND') ? 'WEEKEND_ONLY' : 'FULL_WEEK')
        const ageCategory = isKid ? 'UNDER_14' : 'ADULT'

        if (!existingMembership) {
          await prisma.membership.create({
            data: {
              userId,
              membershipType: it.planKey,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              startDate: new Date(),
              billingDay: 1,
              nextBillingDate: new Date(trialEnd * 1000),
              accessPermissions: JSON.stringify(access),
              scheduleAccess: schedule,
              ageCategory
            } as any
          })
        } else {
          await prisma.membership.update({
            where: { id: existingMembership.id },
            data: {
              membershipType: it.planKey,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              billingDay: 1,
              nextBillingDate: new Date(trialEnd * 1000),
              // Keep existing values if already set; otherwise apply defaults
              accessPermissions: existingMembership.accessPermissions ? undefined : JSON.stringify(access),
              scheduleAccess: existingMembership.scheduleAccess ? undefined : schedule,
              ageCategory: (existingMembership as any).ageCategory ? undefined : ageCategory
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


