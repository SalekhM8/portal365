import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

export async function handlePaymentSucceeded(invoice: any) {
  const invoiceId = invoice.id
  const operationId = `webhook_payment_${invoiceId}_${Date.now()}`
  
  try {
    console.log(`🔄 [${operationId}] Processing invoice payment: ${invoiceId}`)
    
    const subscriptionId = invoice.subscription
    const amountPaid = Number(invoice.amount_paid || 0) / 100
    
    console.log(`📊 [${operationId}] Invoice details:`, {
      id: invoiceId,
      subscription: subscriptionId,
      customer: invoice.customer,
      amount: amountPaid,
      billing_reason: invoice.billing_reason
    })

    // QUICK GUARD: ignore zero-amount invoices (trials/void/fully-discounted)
    if (!amountPaid || amountPaid <= 0) {
      console.log(`ℹ️ [${operationId}] Skipping zero-amount invoice ${invoiceId} (amount_paid=${invoice.amount_paid})`)
      return
    }

    // STEP 1: Try to find subscription by Stripe subscription ID
    let subscription = null
    let mappingMethod = 'UNKNOWN'
    
    if (subscriptionId) {
      subscription = await prisma.subscription.findUnique({ 
        where: { stripeSubscriptionId: subscriptionId }, 
        include: { user: true } 
      })
      
      if (subscription) {
        mappingMethod = 'STRIPE_SUBSCRIPTION_ID'
        console.log(`✅ [${operationId}] Found subscription via Stripe ID: ${subscription.id}`)
      } else {
        console.log(`⚠️ [${operationId}] No subscription found with stripeSubscriptionId: ${subscriptionId}`)
      }
    } else {
      console.log(`⚠️ [${operationId}] No subscription ID on invoice`)
    }
    
    // STEP 2: Try metadata fallback
    if (!subscription && invoice.metadata?.dbSubscriptionId) {
      subscription = await prisma.subscription.findUnique({ 
        where: { id: invoice.metadata.dbSubscriptionId }, 
        include: { user: true } 
      })
      
      if (subscription) {
        mappingMethod = 'METADATA_SUBSCRIPTION_ID'
        console.log(`✅ [${operationId}] Found subscription via metadata: ${subscription.id}`)
      }
    }
    
    // STEP 3: CUSTOMER FALLBACK - The critical fix
    if (!subscription && invoice.customer) {
      console.log(`🔄 [${operationId}] Trying customer metadata fallback...`)
      
      try {
        const stripeCustomer = await stripe.customers.retrieve(invoice.customer as string)
        const userId = (stripeCustomer as any).metadata?.userId
        
        if (userId) {
          console.log(`🔍 [${operationId}] Found userId in customer metadata: ${userId}`)
          
          subscription = await prisma.subscription.findFirst({
            where: { 
              userId, 
              status: { in: ['ACTIVE', 'TRIALING', 'PAUSED'] } 
            },
            include: { user: true },
            orderBy: { createdAt: 'desc' }
          })
          
          if (subscription) {
            mappingMethod = 'CUSTOMER_METADATA_FALLBACK'
            console.log(`✅ [${operationId}] Found subscription via customer fallback: ${subscription.id}`)
          } else {
            console.log(`❌ [${operationId}] No active subscription found for userId: ${userId}`)
          }
        } else {
          console.log(`❌ [${operationId}] No userId in customer metadata`)
        }
      } catch (customerError) {
        console.error(`❌ [${operationId}] Customer retrieval failed:`, customerError)
      }
    }
    
    // STEP 4: Final validation
    if (!subscription) {
      console.error(`❌ [${operationId}] CRITICAL: Cannot map invoice to subscription after all attempts`)
      console.error(`❌ [${operationId}] Invoice details:`, {
        id: invoiceId,
        subscription: subscriptionId,
        customer: invoice.customer,
        hasMetadata: !!invoice.metadata,
        metadataKeys: invoice.metadata ? Object.keys(invoice.metadata) : []
      })
      throw new Error(`Cannot map invoice ${invoiceId} to subscription - manual intervention required`)
    }
    
    console.log(`✅ [${operationId}] Subscription mapped via: ${mappingMethod}`)

    // STEP 5: Check for duplicate processing (idempotency)
    const existingInvoice = await prisma.invoice.findUnique({ where: { stripeInvoiceId: invoice.id } })
    if (existingInvoice) {
      console.log(`ℹ️ [${operationId}] Invoice already processed, skipping: ${existingInvoice.id}`)
      return
    }

    // STEP 6: Create invoice record
    const invoiceRecord = await prisma.invoice.create({
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
    
    console.log(`✅ [${operationId}] Created invoice record: ${invoiceRecord.id}`)

    // STEP 7: Update subscription status and billing periods
    const updatedSubscription = await prisma.subscription.update({ 
      where: { id: subscription.id }, 
      data: { 
        status: 'ACTIVE', 
        currentPeriodStart: new Date(invoice.period_start * 1000), 
        currentPeriodEnd: new Date(invoice.period_end * 1000), 
        nextBillingDate: new Date(invoice.period_end * 1000) 
      } 
    })
    
    console.log(`✅ [${operationId}] Updated subscription status: ${updatedSubscription.status}`)
    
    // STEP 8: Update membership status
    const updatedMemberships = await prisma.membership.updateMany({ 
      where: { userId: subscription.userId }, 
      data: { status: 'ACTIVE' } 
    })
    
    console.log(`✅ [${operationId}] Updated ${updatedMemberships.count} memberships to ACTIVE`)
    
    // STEP 9: Create payment record (the critical missing piece)
    const paymentDescription = invoice.billing_reason === 'subscription_create' 
      ? 'Initial subscription payment (prorated)' 
      : 'Monthly membership payment'
      
    // Tag description with Stripe identifiers so future admin refunds can reference them without schema changes
    const taggedDescription = `${paymentDescription} [inv:${invoice.id}]${invoice.payment_intent ? ` [pi:${invoice.payment_intent}]` : ''}`

    const paymentRecord = await prisma.payment.create({ 
      data: { 
        userId: subscription.userId, 
        amount: amountPaid, 
        currency: invoice.currency.toUpperCase(), 
        status: 'CONFIRMED', 
        description: taggedDescription, 
        routedEntityId: subscription.routedEntityId, 
        processedAt: new Date()
      } 
    })
    
    console.log(`✅ [${operationId}] Created payment record: ${paymentRecord.id} for £${amountPaid}`)
    console.log(`✅ [${operationId}] Payment processing completed successfully via ${mappingMethod}`)

  } catch (error) {
    console.error(`❌ [${operationId || 'unknown'}] Webhook payment processing failed:`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      invoiceId: invoice?.id,
      subscription: invoice?.subscription,
      customer: invoice?.customer
    })
    
    // Re-throw so webhook returns 500 and Stripe retries
    throw new Error(`Payment webhook processing failed for invoice ${invoice?.id}: ${error instanceof Error ? error.message : String(error)}`)
  }
}

export async function handlePaymentFailed(invoice: any) {
  const invoiceId = invoice.id
  const operationId = `webhook_failed_${invoiceId}_${Date.now()}`
  
  try {
    console.log(`🔄 [${operationId}] Processing failed payment: ${invoiceId}`)
    
    const subscriptionId = invoice.subscription
    const amountDue = invoice.amount_due / 100
    
    // Use same robust mapping as handlePaymentSucceeded
    let subscription = await prisma.subscription.findUnique({ 
      where: { stripeSubscriptionId: subscriptionId }, 
      include: { user: true } 
    })
    
    // Customer fallback for failed payments too
    if (!subscription && invoice.customer) {
      try {
        const stripeCustomer = await stripe.customers.retrieve(invoice.customer as string)
        const userId = (stripeCustomer as any).metadata?.userId
        
        if (userId) {
          subscription = await prisma.subscription.findFirst({
            where: { 
              userId, 
              status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'] } 
            },
            include: { user: true },
            orderBy: { createdAt: 'desc' }
          })
        }
      } catch (customerError) {
        console.error(`❌ [${operationId}] Customer fallback failed:`, customerError)
      }
    }
    
    if (!subscription) {
      console.error(`❌ [${operationId}] Cannot map failed invoice to subscription`)
      throw new Error(`Cannot map failed invoice ${invoiceId} to subscription`)
    }
    
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'SUSPENDED' } })

    // Try to enrich failure reason using the charge decline_code (more precise than generic messages)
    let failureReason = 'Payment declined'
    try {
      if (invoice.payment_intent) {
        const pi = await stripe.paymentIntents.retrieve(invoice.payment_intent as string)
        const latestChargeId = (pi as any)?.latest_charge as string | undefined
        let declineCode: string | undefined
        let failureMessage: string | undefined
        if (latestChargeId) {
          const charge = await stripe.charges.retrieve(latestChargeId)
          // Some gateways set decline_code directly on charge; also check outcome.reason
          declineCode = (charge as any)?.decline_code || (charge as any)?.outcome?.reason || (charge as any)?.failure_code
          failureMessage = (charge as any)?.failure_message || (charge as any)?.outcome?.seller_message
        }
        const err = (pi as any)?.last_payment_error
        const piCode = err?.decline_code || err?.code
        const piMsg = err?.message as string | undefined
        const code = (declineCode || piCode || '').toString()
        const codeMap: Record<string, string> = {
          'insufficient_funds': 'Insufficient funds',
          'card_declined': 'Card declined',
          'expired_card': 'Card expired',
          'incorrect_cvc': 'Incorrect CVC',
          'incorrect_number': 'Incorrect card number',
          'authentication_required': 'Authentication required',
          'do_not_honor': 'Card issuer declined'
        }
        failureReason = codeMap[code] || failureMessage || piMsg || failureReason
      }
    } catch {}

    const failedDescription = `Failed monthly membership payment [inv:${invoice.id}]${invoice.payment_intent ? ` [pi:${invoice.payment_intent}]` : ''}`

    await prisma.payment.create({ 
      data: { 
        userId: subscription.userId, 
        amount: amountDue, 
        currency: invoice.currency.toUpperCase(), 
        status: 'FAILED', 
        description: failedDescription, 
        routedEntityId: subscription.routedEntityId, 
        failureReason, 
        processedAt: new Date() 
      } 
    })
    
    console.log(`✅ [${operationId}] Processed failed payment for ${subscription.user.email}`)
    
  } catch (error) {
    console.error(`❌ [${operationId || 'unknown'}] Failed payment webhook processing failed:`, error)
    throw error
  }
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
    
    // Update membership status to mirror Stripe lifecycle accurately
    // ACTIVE (incl. TRIALING) -> ACTIVE access
    // PAST_DUE -> SUSPENDED access
    // INCOMPLETE/INCOMPLETE_EXPIRED -> PENDING_PAYMENT (never granted access)
    // PAUSED -> SUSPENDED access
    // CANCELLED -> CANCELLED
    const membershipStatus =
      subscriptionStatus === 'PAUSED' ? 'SUSPENDED' :
      subscriptionStatus === 'PAST_DUE' ? 'SUSPENDED' :
      subscriptionStatus === 'INCOMPLETE' ? 'PENDING_PAYMENT' :
      subscriptionStatus === 'INCOMPLETE_EXPIRED' ? 'PENDING_PAYMENT' :
      subscriptionStatus === 'CANCELLED' ? 'CANCELLED' :
      'ACTIVE'
    
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
  const operationId = `webhook_cancelled_${stripeSubscription.id}_${Date.now()}`
  
  try {
    console.log(`🔄 [${operationId}] Processing subscription cancellation: ${stripeSubscription.id}`)
    
    const subscription = await prisma.subscription.findUnique({ 
      where: { stripeSubscriptionId: stripeSubscription.id }, 
      include: { user: true } 
    })
    
    if (!subscription) {
      console.error(`❌ [${operationId}] Subscription not found for cancellation`)
      throw new Error(`Subscription not found: ${stripeSubscription.id}`)
    }
    
    await prisma.subscription.update({ 
      where: { id: subscription.id }, 
      data: { status: 'CANCELLED' } 
    })
    
    await prisma.membership.updateMany({ 
      where: { userId: subscription.userId }, 
      data: { status: 'CANCELLED' } 
    })
    
    console.log(`✅ [${operationId}] Cancelled subscription for ${subscription.user.email}`)
    
  } catch (error) {
    console.error(`❌ [${operationId || 'unknown'}] Subscription cancellation webhook failed:`, error)
    throw error
  }
} 

// Activate placeholder subscription from a succeeded PaymentIntent (e.g., Klarna)
export async function activateFromPaymentIntent(pi: any) {
  const dbSubId = (pi?.metadata && (pi.metadata as any).dbSubscriptionId) || undefined
  const userId = (pi?.metadata && (pi.metadata as any).userId) || undefined
  if (!dbSubId && !userId) return

  let dbSub = null as any
  if (dbSubId) {
    dbSub = await prisma.subscription.findUnique({ where: { id: dbSubId } })
  }
  if (!dbSub && userId) {
    dbSub = await prisma.subscription.findFirst({ where: { userId, status: 'PENDING_PAYMENT' }, orderBy: { createdAt: 'desc' } })
  }
  if (!dbSub) return

  // Idempotency: if already has a real Stripe sub, skip
  if (dbSub.stripeSubscriptionId && (dbSub.stripeSubscriptionId as string).startsWith('sub_')) return

  // Build price and create Stripe subscription starting next billing
  const membershipType = dbSub.membershipType
  const nextBilling = new Date(dbSub.nextBillingDate)
  const trialEndTimestamp = Math.floor(nextBilling.getTime() / 1000)

  // Get price via lightweight helper from confirm-payment handler
  const { getOrCreatePrice } = await import('@/app/api/confirm-payment/handlers') as any
  const priceId = await getOrCreatePrice({ monthlyPrice: Number(dbSub.monthlyPrice), name: membershipType })

  const stripeSubscription = await stripe.subscriptions.create({
    customer: pi.customer as string,
    items: [{ price: priceId }],
    collection_method: 'charge_automatically',
    trial_end: trialEndTimestamp,
    proration_behavior: 'none',
    payment_behavior: 'default_incomplete',
    metadata: { userId: dbSub.userId, membershipType: dbSub.membershipType, routedEntityId: dbSub.routedEntityId, dbSubscriptionId: dbSub.id }
  }, { idempotencyKey: `start-sub:${dbSub.id}:${trialEndTimestamp}` })

  await prisma.subscription.update({ where: { id: dbSub.id }, data: { stripeSubscriptionId: stripeSubscription.id, status: 'ACTIVE' } })
  await prisma.membership.updateMany({ where: { userId: dbSub.userId }, data: { status: 'ACTIVE' } })

  // Write initial prorated payment row if missing (idempotent)
  try {
    const amountReceived = (pi?.amount_received ?? pi?.amount ?? 0) as number
    const currency = ((pi?.currency as string) || 'gbp').toUpperCase()
    const amountPounds = amountReceived / 100

    if (amountPounds > 0) {
      const existingPayment = await prisma.payment.findFirst({
        where: {
          userId: dbSub.userId,
          status: 'CONFIRMED',
          amount: amountPounds,
          currency,
          description: { contains: 'Initial subscription payment (prorated)' }
        },
        orderBy: { createdAt: 'desc' }
      })

      if (!existingPayment) {
        await prisma.payment.create({
          data: {
            userId: dbSub.userId,
            amount: amountPounds,
            currency,
            status: 'CONFIRMED',
            description: `Initial subscription payment (prorated) [pi:${pi?.id}]`,
            routedEntityId: dbSub.routedEntityId,
            processedAt: new Date()
          }
        })
      }
    }
  } catch (e) {
    console.warn('activateFromPaymentIntent: unable to write prorated payment row', e)
  }
}