import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlan, MEMBERSHIP_PLANS } from '@/config/memberships'

// Helper to get plan from DB first, then fallback to config
async function getPlanDetails(key: string): Promise<{ name: string; displayName: string; monthlyPrice: number } | null> {
  // Try database first
  const dbPlan = await prisma.membershipPlan.findUnique({ where: { key } })
  if (dbPlan) {
    return {
      name: dbPlan.name,
      displayName: dbPlan.displayName,
      monthlyPrice: Number(dbPlan.monthlyPrice)
    }
  }
  // Fallback to static config
  const staticPlan = MEMBERSHIP_PLANS[key as keyof typeof MEMBERSHIP_PLANS]
  if (staticPlan) {
    return {
      name: staticPlan.name,
      displayName: staticPlan.displayName,
      monthlyPrice: staticPlan.monthlyPrice
    }
  }
  return null
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params = await context.params
    const userId = params.id
    const body = await request.json()
    const { newMembershipType, effective, settlement } = body || {}
    if (!newMembershipType || !['now','period_end'].includes(effective)) {
      return NextResponse.json({ error: 'newMembershipType and effective required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { id: userId } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
    if (!sub) return NextResponse.json({ error: 'No subscription' }, { status: 404 })

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((sub as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
    const stripeStatus = (stripeSub as any).status as string
    const item = (stripeSub as any).items?.data?.[0]
    const currentMonthly = ((item?.price?.unit_amount || 0) / 100)
    const plan = await getPlanDetails(newMembershipType)
    if (!plan) {
      return NextResponse.json({ error: `Unknown membership plan: ${newMembershipType}` }, { status: 400 })
    }
    const newMonthly = plan.monthlyPrice

    // Ensure price exists
    const prices = await stripe.prices.list({ limit: 100, active: true, type: 'recurring', currency: 'gbp' })
    let newPrice = prices.data.find(p => p.unit_amount === newMonthly * 100 && p.recurring?.interval === 'month')
    if (!newPrice) {
      const product = await stripe.products.create({ name: `${plan.name} Membership`, description: `Monthly membership for ${plan.name}` })
      newPrice = await stripe.prices.create({ unit_amount: newMonthly * 100, currency: 'gbp', recurring: { interval: 'month' }, product: product.id })
    }

    const nextBillingDate = new Date(((stripeSub as any).current_period_end || (stripeSub as any).trial_end) * 1000)

    // Helper: compute delta for trial using calendar month proration
    const computeTrialDelta = () => {
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const nextFirst = new Date(Date.UTC(year, month + 1, 1))
      const remainingDays = Math.max(0, Math.ceil((nextFirst.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const fraction = Math.min(1, remainingDays / daysInMonth)
      const delta = Math.round((newMonthly - currentMonthly) * fraction * 100)
      return delta // pence
    }

    if (effective === 'period_end') {
      // Price change effective at next billing; no proration now
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, price: (newPrice as any).id }],
        proration_behavior: 'none',
        metadata: {
          ...(stripeSub as any).metadata,
          pending_plan: newMembershipType,
          pending_apply_ts: String(Math.floor(nextBillingDate.getTime() / 1000))
        }
      })

      // Keep access as-is; flip on rollover via webhook
      await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
      return NextResponse.json({ success: true, applied: 'period_end', nextBillingDate: nextBillingDate.toISOString().split('T')[0] })
    }

    // effective === 'now'
    if (stripeStatus === 'trialing') {
      const deltaPence = computeTrialDelta()
      const customerId = (stripeSub as any).customer as string
      let chargeResult = { charged: false, invoiceId: '', error: '' }
      
      console.log(`📊 Trial plan change: current £${currentMonthly} → new £${newMonthly}, delta: £${(deltaPence/100).toFixed(2)}, settlement: ${settlement}`)

      if (settlement === 'charge_now') {
        // CHARGE NOW: Update Stripe, charge delta, update Portal immediately
        await stripe.subscriptions.update(stripeSub.id, {
          items: [{ id: item.id, price: (newPrice as any).id }],
          proration_behavior: 'none'
        })

        if (deltaPence > 0) {
          try {
            await stripe.invoiceItems.create({
              customer: customerId,
              amount: deltaPence,
              currency: 'gbp',
              description: `Upgrade proration: ${plan.name} (${newMembershipType})`,
              metadata: { dbSubscriptionId: sub.id, reason: 'trial_upgrade_proration' }
            })
            
            const inv = await stripe.invoices.create({
              customer: customerId,
              auto_advance: false,
              pending_invoice_items_behavior: 'include',
              metadata: { dbSubscriptionId: sub.id, reason: 'trial_upgrade_proration' }
            })
            
            if (inv.id) {
              await stripe.invoices.finalizeInvoice(inv.id)
              const paidInvoice = await stripe.invoices.pay(inv.id)
              chargeResult = { 
                charged: paidInvoice.status === 'paid', 
                invoiceId: inv.id, 
                error: paidInvoice.status !== 'paid' ? `Invoice status: ${paidInvoice.status}` : '' 
              }
              console.log(`✅ Trial upgrade charged: £${(deltaPence/100).toFixed(2)} - Invoice ${inv.id}`)
            }
          } catch (e: any) {
            chargeResult = { charged: false, invoiceId: '', error: e.message || 'Payment failed' }
            console.error('❌ Trial upgrade charge failed:', e.message)
          }
        } else if (deltaPence < 0) {
          // Downgrade credit
          await stripe.invoiceItems.create({
            customer: customerId,
            amount: deltaPence,
            currency: 'gbp',
            description: `Downgrade credit: ${plan.name} (${newMembershipType})`,
            metadata: { dbSubscriptionId: sub.id, reason: 'trial_downgrade_credit' }
          })
        }

        // Update Portal immediately - they paid
        await prisma.membership.updateMany({ where: { userId }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
        await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
        
        return NextResponse.json({ 
          success: true, 
          applied: 'now', 
          deltaPounds: deltaPence / 100,
          settlement: 'charge_now',
          chargeResult
        })
      } else {
        // DEFER: Update Stripe price, add proration to next invoice, DON'T update Portal access yet
        await stripe.subscriptions.update(stripeSub.id, {
          items: [{ id: item.id, price: (newPrice as any).id }],
          proration_behavior: 'none',
          metadata: {
            ...(stripeSub as any).metadata,
            pending_plan: newMembershipType,
            pending_from_plan: sub.membershipType
          }
        })

        // Add proration delta to next invoice
        if (deltaPence !== 0) {
          await stripe.invoiceItems.create({
            customer: customerId,
            amount: deltaPence,
            currency: 'gbp',
            description: deltaPence > 0 
              ? `Upgrade proration: ${plan.name} (${newMembershipType})` 
              : `Downgrade credit: ${plan.name} (${newMembershipType})`,
            metadata: { 
              dbSubscriptionId: sub.id, 
              reason: 'plan_change_proration_deferred',
              pendingPlan: newMembershipType
            }
          })
          console.log(`📋 Proration £${(deltaPence/100).toFixed(2)} added to next invoice`)
        }

        // DON'T update Portal membership - they keep current access until they pay
        console.log(`⏳ Plan change deferred: user keeps ${sub.membershipType} access until next payment`)
        
        return NextResponse.json({ 
          success: true, 
          applied: 'deferred', 
          message: `Plan change scheduled. User keeps ${sub.membershipType} access until Feb 1. New plan ${newMembershipType} activates when invoice is paid.`,
          deltaPounds: deltaPence / 100,
          settlement: 'defer'
        })
      }
    }

    // ACTIVE subscription: use Stripe proration
    if (settlement === 'charge_now') {
      // Charge now with immediate proration invoice
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, price: (newPrice as any).id }],
        proration_behavior: 'always_invoice'
      })

      // Find and pay the proration invoice
      try {
        const invoices = await stripe.invoices.list({
          customer: (stripeSub as any).customer as string,
          subscription: stripeSub.id,
          limit: 5
        })
        const prorationInvoice = invoices.data.find(i => i.status === 'open')
        
        if (prorationInvoice?.id && prorationInvoice.amount_due > 0) {
          await stripe.invoices.pay(prorationInvoice.id)
          console.log(`✅ Active upgrade charged: £${(prorationInvoice.amount_due / 100).toFixed(2)}`)
        }
      } catch (e: any) {
        console.error('Charge now payment failed:', e?.message)
      }

      // Update Portal immediately - they paid
      await prisma.membership.updateMany({ where: { userId }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })
      await prisma.subscription.update({ where: { id: sub.id }, data: { membershipType: newMembershipType, monthlyPrice: newMonthly } })

      return NextResponse.json({ success: true, applied: 'now', settlement: 'charge_now' })
    } else {
      // DEFER: proration added to next invoice, DON'T change access yet
      await stripe.subscriptions.update(stripeSub.id, {
        items: [{ id: item.id, price: (newPrice as any).id }],
        proration_behavior: 'create_prorations',
        metadata: {
          ...(stripeSub as any).metadata,
          pending_plan: newMembershipType,
          pending_from_plan: sub.membershipType
        }
      })

      // DON'T update Portal - webhook will handle it when invoice is paid
      console.log(`⏳ Active plan change deferred: user keeps ${sub.membershipType} access until next payment`)

      return NextResponse.json({ 
        success: true, 
        applied: 'deferred', 
        message: `Plan change scheduled. User keeps ${sub.membershipType} access until next billing. New plan ${newMembershipType} activates when invoice is paid.`,
        settlement: 'defer' 
      })
    }

  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Change plan failed' }, { status: 500 })
  }
}


