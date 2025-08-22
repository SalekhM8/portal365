import { prisma } from '@/lib/prisma'

export async function handlePaymentSucceeded(invoice: any) {
  try {
    const subscriptionId = invoice.subscription
    const amountPaid = invoice.amount_paid / 100

    // First try to link by stripe subscription id, if missing (prorated before sub), use our metadata
    let subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
    if (!subscription && invoice.metadata?.dbSubscriptionId) {
      subscription = await prisma.subscription.findUnique({ where: { id: invoice.metadata.dbSubscriptionId }, include: { user: true } })
    }
    if (!subscription) return

    const existingInvoice = await prisma.invoice.findUnique({ where: { stripeInvoiceId: invoice.id } })
    if (existingInvoice) return

    await prisma.invoice.create({
      data: {
        subscriptionId: subscription.id,
        stripeInvoiceId: invoice.id,
        amount: amountPaid,
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        billingPeriodStart: new Date(invoice.lines.data[0]?.period?.start * 1000 || invoice.period_start * 1000),
        billingPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || invoice.period_end * 1000),
        dueDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
        paidAt: new Date()
      }
    })

    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', currentPeriodStart: new Date(invoice.period_start * 1000), currentPeriodEnd: new Date(invoice.period_end * 1000), nextBillingDate: new Date(invoice.period_end * 1000) } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'ACTIVE' } })
    await prisma.payment.create({ data: { userId: subscription.userId, amount: amountPaid, currency: invoice.currency.toUpperCase(), status: 'CONFIRMED', description: invoice.billing_reason === 'subscription_create' ? 'Initial subscription payment (prorated)' : 'Monthly membership payment', routedEntityId: subscription.routedEntityId, processedAt: new Date() } })
  } catch {}
}

export async function handlePaymentFailed(invoice: any) {
  try {
    const subscriptionId = invoice.subscription
    const amountDue = invoice.amount_due / 100
    const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
    if (!subscription) return
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'SUSPENDED' } })
    await prisma.payment.create({ data: { userId: subscription.userId, amount: amountDue, currency: invoice.currency.toUpperCase(), status: 'FAILED', description: 'Failed monthly membership payment', routedEntityId: subscription.routedEntityId, failureReason: 'Payment declined', processedAt: new Date() } })
  } catch {}
}

export async function handleSubscriptionUpdated(stripeSubscription: any) {
  try {
    console.log(`🔄 [WEBHOOK] Processing subscription update for ${stripeSubscription.id}`)
    
    // 🚀 Handle pause collection properly
    let subscriptionStatus = stripeSubscription.status.toUpperCase()
    const originalStatus = subscriptionStatus
    
    // Map TRIALING to ACTIVE since trialing customers have full access
    if (subscriptionStatus === 'TRIALING') {
      subscriptionStatus = 'ACTIVE'
    }
    
    // If collection is paused, override status to PAUSED
    if (stripeSubscription.pause_collection?.behavior === 'void') {
      subscriptionStatus = 'PAUSED'
    }
    
    console.log(`📊 [WEBHOOK] Status mapping: Stripe ${originalStatus} + pause_collection: ${!!stripeSubscription.pause_collection} → Local ${subscriptionStatus}`)
    
    let subscription = await prisma.subscription.findUnique({ 
      where: { stripeSubscriptionId: stripeSubscription.id }, 
      include: { user: true } 
    })
    if (!subscription) {
      // Fallback: race condition where we created the sub and set metadata but DB row wasn't updated yet
      const dbSubId = (stripeSubscription.metadata && (stripeSubscription.metadata as any).dbSubscriptionId) || undefined
      if (dbSubId) {
        const byDbId = await prisma.subscription.findUnique({ where: { id: dbSubId }, include: { user: true } })
        if (byDbId) {
          // Link the Stripe subscription ID retroactively
          if (!byDbId.stripeSubscriptionId || byDbId.stripeSubscriptionId.startsWith('setup_placeholder_')) {
            await prisma.subscription.update({ where: { id: byDbId.id }, data: { stripeSubscriptionId: stripeSubscription.id } })
          }
          subscription = byDbId
        }
      }
      if (!subscription) {
        console.log(`❌ [WEBHOOK] Subscription not found in database: ${stripeSubscription.id}`)
        return
      }
    }

    const previousStatus = subscription.status
    const updatedSubscription = await prisma.subscription.update({ 
      where: { id: subscription.id }, 
      data: { 
        status: subscriptionStatus,
        currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000), 
        currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000), 
        nextBillingDate: new Date(stripeSubscription.current_period_end * 1000), 
        cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end 
      } 
    })
    
    console.log(`✅ [WEBHOOK] Updated subscription: ${previousStatus} → ${updatedSubscription.status}`)
    
    // Update membership status to match
    const membershipStatus = subscriptionStatus === 'PAUSED' ? 'SUSPENDED' : 
                            subscriptionStatus === 'CANCELLED' ? 'CANCELLED' : 'ACTIVE'
    
    const updatedMemberships = await prisma.membership.updateMany({ 
      where: { userId: subscription.userId }, 
      data: { status: membershipStatus } 
    })
    
    console.log(`✅ [WEBHOOK] Updated ${updatedMemberships.count} memberships to ${membershipStatus}`)
  } catch (error) {
    console.error(`❌ [WEBHOOK] Failed to handle subscription update:`, error)
  }
}

export async function handleSubscriptionCancelled(stripeSubscription: any) {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: stripeSubscription.id }, include: { user: true } })
    if (!subscription) return
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'CANCELLED' } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'CANCELLED' } })
  } catch {}
} 