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

    for (const it of items) {
      try {
        const plan = MEMBERSHIP_PLANS[it.planKey as MembershipKey]
        if (!plan) throw new Error(`Unknown plan ${it.planKey}`)
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
          if (existing) {
            userId = existing.id
          } else {
            // Try to read real name from Stripe
            let firstName = it.email.split('@')[0]
            let lastName = ''
            try {
              const cust = await stripe.customers.retrieve(it.stripeCustomerId)
              if (!('deleted' in cust) && (cust as any)?.name) {
                const full = ((cust as any).name as string).trim()
                const parts = full.split(/\s+/)
                if (parts.length > 1) {
                  firstName = parts.slice(0, -1).join(' ')
                  lastName = parts.slice(-1).join(' ')
                } else {
                  firstName = full
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
        const defaultAccess = JSON.stringify({})
        const defaultScheduleAccess = JSON.stringify({})
        const ageCategoryValue = (it.planKey && it.planKey.toLowerCase().includes('kids')) ? 'KID' : 'ADULT'
        if (!existingMembership) {
          await prisma.membership.create({
            data: {
              userId,
              membershipType: it.planKey,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              startDate: new Date(),
              // Some schemas require a non-null text/JSON field
              accessPermissions: defaultAccess,
              scheduleAccess: defaultScheduleAccess,
              ageCategory: ageCategoryValue
            } as any
          })
        } else {
          await prisma.membership.update({
            where: { id: existingMembership.id },
            data: {
              membershipType: it.planKey,
              monthlyPrice: plan.monthlyPrice,
              status: 'ACTIVE',
              accessPermissions: existingMembership as any && (existingMembership as any).accessPermissions != null
                ? (existingMembership as any).accessPermissions
                : defaultAccess,
              scheduleAccess: (existingMembership as any)?.scheduleAccess ?? defaultScheduleAccess,
              ageCategory: (existingMembership as any)?.ageCategory ?? ageCategoryValue
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


