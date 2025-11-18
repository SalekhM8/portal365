import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { MEMBERSHIP_PLANS, type MembershipKey } from '@/config/memberships'

function firstOfNextMonthUTC(): Date {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['ADMIN','SUPER_ADMIN','STAFF'].includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { parentEmail, childFirstName, childLastName, planKey, account } = await request.json()
    if (!parentEmail || !childFirstName || !planKey || !account) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const acct = (account as string).toUpperCase() as StripeAccountKey
    const plan = MEMBERSHIP_PLANS[(planKey as MembershipKey)]
    if (!plan) return NextResponse.json({ error: 'Unknown plan' }, { status: 400 })
    const stripe = getStripeClient(acct)

    // Find parent user and their Stripe customer in this account
    const parent = await prisma.user.findUnique({ where: { email: parentEmail } })
    if (!parent) return NextResponse.json({ error: 'Parent not found in Portal' }, { status: 404 })

    // Prefer Portal subscription record for this account
    const parentSub = await prisma.subscription.findFirst({ where: { userId: parent.id, stripeAccountKey: acct }, orderBy: { createdAt: 'desc' } })
    let stripeCustomerId = parentSub?.stripeCustomerId
    if (!stripeCustomerId) {
      // Fallback: search Stripe by email
      const found = await stripe.customers.list({ email: parentEmail, limit: 1 })
      if (!found.data.length) return NextResponse.json({ error: 'Stripe customer not found for parent in this account' }, { status: 404 })
      stripeCustomerId = found.data[0].id
    }

    // Ensure parent has a PM set or at least one attached card
    const cust = await stripe.customers.retrieve(stripeCustomerId)
    // @ts-ignore
    const hasDefault = !!(cust as any)?.invoice_settings?.default_payment_method
    if (!hasDefault) {
      const pms = await stripe.paymentMethods.list({ customer: stripeCustomerId, type: 'card' })
      if (!pms.data.length) return NextResponse.json({ error: 'Parent has no card on file; add card first' }, { status: 400 })
      // Set first card as default for subscriptions
      await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: pms.data[0].id } })
    }

    // Create child user (shadow) with synthetic email (no login)
    const syntheticEmail = `${childFirstName.toLowerCase()}.${Date.now()}+child@member.local`
    const child = await prisma.user.create({ data: { email: syntheticEmail, firstName: childFirstName, lastName: childLastName || '', role: 'CUSTOMER', status: 'ACTIVE' } })

    // Create membership row
    const next1st = firstOfNextMonthUTC()
    await prisma.membership.create({
      data: {
        userId: child.id,
        membershipType: planKey,
        status: 'PENDING_PAYMENT',
        startDate: new Date(),
        monthlyPrice: plan.monthlyPrice,
        setupFee: 0,
        accessPermissions: JSON.stringify({}),
        scheduleAccess: JSON.stringify({}),
        ageCategory: planKey.includes('KIDS') ? 'YOUTH' : 'ADULT',
        billingDay: 1,
        nextBillingDate: next1st,
        familyGroupId: parent.id,
        isPrimaryMember: false
      }
    })

    // Ensure BusinessEntity exists for SU/IQ
    const entity = await prisma.businessEntity.upsert({
      where: { name: acct },
      update: {},
      create: { name: acct, displayName: acct === 'IQ' ? 'IQ Learning Centre' : 'Sporting U', description: `${acct} entity`, vatYearStart: new Date(new Date().getFullYear(), 3, 1), vatYearEnd: new Date(new Date().getFullYear()+1, 2, 31) }
    })

    // Price
    const { getOrCreatePrice } = await import('@/app/api/confirm-payment/handlers') as any
    const priceId = await getOrCreatePrice({ monthlyPrice: plan.monthlyPrice, name: plan.name }, acct)

    // Charge prorated amount now (if any) using parent's default PM)
    const now = new Date()
    const daysInMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth()+1, 0)).getUTCDate()
    const remaining = daysInMonth - now.getUTCDate() + 1
    const proratedMinor = Math.max(0, Math.round((plan.monthlyPrice * 100) * (remaining / daysInMonth)))
    if (proratedMinor > 0) {
      await stripe.invoiceItems.create({
        customer: stripeCustomerId,
        amount: proratedMinor,
        currency: 'gbp',
        description: `Prorated ${plan.name} for ${now.toISOString().slice(0,10)} → ${next1st.toISOString().slice(0,10)}`,
        metadata: { childUserId: child.id, memberUserId: child.id, reason: 'family_prorated_first_period' }
      })
      const inv = await stripe.invoices.create({
        customer: stripeCustomerId,
        auto_advance: true,
        metadata: { childUserId: child.id, memberUserId: child.id, reason: 'family_prorated_first_period' }
      })
      // optional: best-effort pay (guard type)
      const invId = (inv as any)?.id as string | undefined
      if (invId) {
        try { await stripe.invoices.pay(invId) } catch {}
      }
    }

    // Create child subscription under parent's customer, billing starts at next 1st
    const trialEndSec = Math.floor(next1st.getTime()/1000)
    const sub = await stripe.subscriptions.create({
      customer: stripeCustomerId,
      items: [{ price: priceId }],
      collection_method: 'charge_automatically',
      trial_end: trialEndSec,
      proration_behavior: 'none',
      metadata: { userId: child.id, membershipType: planKey, routedEntityId: entity.id, payer: parent.id, account: acct, family: 'true' }
    }, { idempotencyKey: `family:${stripeCustomerId}:${priceId}:${trialEndSec}:${child.id}` })

    // Portal subscription row
    await prisma.subscription.create({
      data: {
        userId: child.id,
        stripeSubscriptionId: sub.id,
        stripeCustomerId,
        stripeAccountKey: acct,
        routedEntityId: entity.id,
        membershipType: planKey,
        monthlyPrice: plan.monthlyPrice,
        status: 'ACTIVE',
        currentPeriodStart: new Date(),
        currentPeriodEnd: next1st,
        nextBillingDate: next1st
      }
    })

    return NextResponse.json({ success: true, childUserId: child.id, stripeSubscriptionId: sub.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create family member' }, { status: 500 })
  }
}


