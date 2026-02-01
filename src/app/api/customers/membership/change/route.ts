import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { getPlan } from '@/config/memberships'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { newMembershipType, settlement } = await request.json()
    // settlement: 'charge_now' | 'defer' (default: 'defer')

    if (!newMembershipType) {
      return NextResponse.json({ error: 'Invalid membership type' }, { status: 400 })
    }

    const newDetails = getPlan(newMembershipType)

    // Get user and current subscription
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      include: {
        memberships: {
          where: { status: 'ACTIVE' },
          take: 1
        },
        subscriptions: {
          where: { status: 'ACTIVE' },
          take: 1
        }
      }
    })

    if (!user || !user.subscriptions[0]) {
      return NextResponse.json({ error: 'No active subscription found' }, { status: 404 })
    }

    const currentMembership = user.memberships[0]
    const subscription = user.subscriptions[0]

    if (currentMembership.membershipType === newMembershipType) {
      return NextResponse.json({ error: 'You are already on this plan' }, { status: 400 })
    }

    // Use the correct Stripe account for this subscription
    const stripeAccount = ((subscription as any).stripeAccountKey as StripeAccountKey) || 'SU'
    const stripe = getStripeClient(stripeAccount)

    // Update Stripe subscription
    const stripeSubscription = await stripe.subscriptions.retrieve(subscription.stripeSubscriptionId)
    const stripeStatus = (stripeSubscription as any).status as string
    const item = stripeSubscription.items.data[0]
    const currentMonthly = ((item?.price?.unit_amount || 0) / 100)
    const newMonthly = newDetails.monthlyPrice
    
    // Get or create the new price in Stripe
    const newPriceId = await getOrCreatePrice({ monthlyPrice: newDetails.monthlyPrice, name: newDetails.name }, stripe)
    
    // Helper: compute delta for trial using calendar month proration
    const computeTrialDelta = () => {
      const now = new Date()
      const year = now.getUTCFullYear()
      const month = now.getUTCMonth()
      const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
      const nextFirst = new Date(Date.UTC(year, month + 1, 1))
      const remainingDays = Math.max(0, Math.ceil((nextFirst.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)))
      const fraction = Math.min(1, remainingDays / daysInMonth)
      return Math.round((newMonthly - currentMonthly) * fraction * 100) // pence
    }

    // Handle TRIALING subscriptions differently - Stripe won't prorate trials
    if (stripeStatus === 'trialing') {
      const deltaPence = computeTrialDelta()
      const customerId = subscription.stripeCustomerId
      console.log(`📊 Trial plan change: ${currentMembership.membershipType} → ${newMembershipType}, delta: £${(deltaPence/100).toFixed(2)}, settlement: ${settlement}`)

      if (settlement === 'charge_now') {
        // CHARGE NOW: Update Stripe price, charge delta, update Portal immediately
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{ id: item.id, price: newPriceId }],
          proration_behavior: 'none'
        })

        if (deltaPence > 0) {
          // Upgrade with immediate charge
          try {
            await stripe.invoiceItems.create({
              customer: customerId,
              amount: deltaPence,
              currency: 'gbp',
              description: `Upgrade proration: ${newDetails.name}`,
              metadata: { reason: 'trial_upgrade_proration' }
            })
            
            const inv = await stripe.invoices.create({
              customer: customerId,
              auto_advance: false,
              pending_invoice_items_behavior: 'include',
              metadata: { reason: 'trial_upgrade_proration' }
            })
            
            if (inv.id) {
              await stripe.invoices.finalizeInvoice(inv.id)
              await stripe.invoices.pay(inv.id)
              console.log(`✅ Trial upgrade charged: £${(deltaPence/100).toFixed(2)}`)
            }
          } catch (e: any) {
            console.error('❌ Trial upgrade charge failed:', e.message)
          }
        } else if (deltaPence < 0) {
          // Downgrade: apply credit to next invoice
          await stripe.invoiceItems.create({
            customer: customerId,
            amount: deltaPence,
            currency: 'gbp',
            description: `Downgrade credit: ${newDetails.name}`,
            metadata: { reason: 'trial_downgrade_credit' }
          })
        }

        // Update Portal immediately - they paid, they get access
    await prisma.membership.updateMany({
          where: { userId: user.id, status: 'ACTIVE' },
          data: { membershipType: newMembershipType, monthlyPrice: newDetails.monthlyPrice }
        })
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { membershipType: newMembershipType, monthlyPrice: newDetails.monthlyPrice }
        })
      } else {
        // DEFER: DON'T update Portal yet - keep current access, change takes effect on next billing
        // Update Stripe price (so next invoice has new price)
        await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
          items: [{ id: item.id, price: newPriceId }],
          proration_behavior: 'none',
          metadata: {
            pending_plan: newMembershipType,
            pending_from: currentMembership.membershipType
          }
        })

        // Add proration delta to next invoice
        if (deltaPence !== 0) {
          await stripe.invoiceItems.create({
            customer: customerId,
            amount: deltaPence,
            currency: 'gbp',
            description: deltaPence > 0 
              ? `Upgrade proration: ${newDetails.name}` 
              : `Downgrade credit: ${newDetails.name}`,
            metadata: { 
              reason: 'plan_change_proration_deferred',
              pendingPlan: newMembershipType,
              fromPlan: currentMembership.membershipType
            }
          })
          console.log(`📋 Proration £${(deltaPence/100).toFixed(2)} added to next invoice for ${newMembershipType}`)
        }

        // DON'T update Portal membership - they keep current access until they pay
        // The webhook will update the membership when invoice.payment_succeeded fires
        console.log(`⏳ Plan change deferred: keeping ${currentMembership.membershipType} until Feb 1 payment`)
      }

      return NextResponse.json({
        success: true,
        message: settlement === 'charge_now' 
          ? `Successfully upgraded to ${newDetails.name}! Payment processed.`
          : `Plan change scheduled! You'll keep your current ${currentMembership.membershipType} access until your next billing date. Your new ${newDetails.name} plan starts when your next invoice is paid.`,
        newMembership: {
          type: settlement === 'charge_now' ? newMembershipType : currentMembership.membershipType,
          scheduledType: settlement === 'charge_now' ? null : newMembershipType,
          price: newDetails.monthlyPrice,
          name: newDetails.name
        },
        settlement: settlement || 'defer'
      })
    }
    
    // ACTIVE subscription: use Stripe's built-in proration
    if (settlement === 'charge_now') {
      // Charge now with immediate proration invoice
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: 'always_invoice',
      })

      // Find and pay the proration invoice
      try {
        const invoices = await stripe.invoices.list({
          customer: subscription.stripeCustomerId,
          subscription: subscription.stripeSubscriptionId,
          limit: 5
        })
        const prorationInvoice = invoices.data.find((i: any) => i.status === 'open')
        
        if (prorationInvoice?.id && prorationInvoice.amount_due > 0) {
          await stripe.invoices.pay(prorationInvoice.id)
        }
      } catch (e: any) {
        console.error('Charge now payment failed:', e?.message)
      }

      // Update Portal immediately
      await prisma.membership.updateMany({
        where: { userId: user.id, status: 'ACTIVE' },
        data: { membershipType: newMembershipType, monthlyPrice: newDetails.monthlyPrice }
      })
    await prisma.subscription.update({
      where: { id: subscription.id },
        data: { membershipType: newMembershipType, monthlyPrice: newDetails.monthlyPrice }
      })
    } else {
      // Defer: proration added to next invoice, DON'T change access yet
      await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
        items: [{ id: item.id, price: newPriceId }],
        proration_behavior: 'create_prorations',
        metadata: {
          pending_plan: newMembershipType,
          pending_from: currentMembership.membershipType
      }
    })

      // DON'T update Portal - webhook will handle it when invoice is paid
      console.log(`⏳ Active plan change deferred: keeping ${currentMembership.membershipType} until next payment`)
    }

    console.log(`✅ Membership changed from ${currentMembership.membershipType} to ${newMembershipType} for user ${user.email} (settlement: ${settlement || 'defer'})`)

    return NextResponse.json({
      success: true,
      message: settlement === 'charge_now' 
        ? `Successfully upgraded to ${newDetails.name}! Payment processed.`
        : `Plan change scheduled! You'll keep your current access until your next billing date. Your new ${newDetails.name} plan starts when your next invoice is paid.`,
      newMembership: {
        type: settlement === 'charge_now' ? newMembershipType : currentMembership.membershipType,
        scheduledType: settlement === 'charge_now' ? null : newMembershipType,
        price: newDetails.monthlyPrice,
        name: newDetails.name
      },
      settlement: settlement || 'defer'
    })

  } catch (error) {
    console.error('❌ Error changing membership:', error)
    return NextResponse.json(
      { error: 'Failed to change membership plan' },
      { status: 500 }
    )
  }
}

async function getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }, stripe: ReturnType<typeof getStripeClient>): Promise<string> {
  // Reuse existing prices
  const existingPrices = await stripe.prices.list({
    limit: 100,
    active: true,
    type: 'recurring',
    currency: 'gbp'
  })

  const existingPrice = existingPrices.data.find(price => 
    price.unit_amount === membershipDetails.monthlyPrice * 100 &&
    price.recurring?.interval === 'month'
  )

  if (existingPrice) {
    return existingPrice.id
  }

  // Create new product and price
  const product = await stripe.products.create({
    name: `${membershipDetails.name} Membership`,
    description: `Monthly membership for ${membershipDetails.name}`,
  })

  const recurringPrice = await stripe.prices.create({
    unit_amount: membershipDetails.monthlyPrice * 100,
    currency: 'gbp',
    recurring: { interval: 'month' },
    product: product.id,
  })

  return recurringPrice.id
} 