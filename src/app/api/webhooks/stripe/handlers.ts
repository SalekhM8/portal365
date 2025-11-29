import { prisma } from '@/lib/prisma'
import { sendDunningAttemptSms, sendSuspendedSms, sendSuccessSms, sendActionRequiredSms } from '@/lib/notify'
import { sendDunningAttemptEmail, sendSuspendedEmail, sendSuccessEmail, sendActionRequiredEmail } from '@/lib/email'
import { isAutoSuspendEnabled, isPauseCollectionEnabled } from '@/lib/flags'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

function resolveNotificationEmail(user?: { email?: string | null; communicationPrefs?: string | null }): string | null {
  if (!user) return null
  const email = user.email || null
  if (!email) return null
  const isPlaceholder = /(@member\.local|@local)$/i.test(email)
  if (!isPlaceholder) return email
  if (!user.communicationPrefs) return email
  try {
    const prefs = JSON.parse(user.communicationPrefs)
    return prefs?.guardianEmail || email
  } catch {
    return email
  }
}

export async function handlePaymentSucceeded(invoice: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
  const invoiceId = invoice.id
  const operationId = `webhook_payment_${invoiceId}_${Date.now()}`
  
  try {
    console.log(`🔄 [${operationId}] Processing invoice payment: ${invoiceId}`)
    
    // Be tolerant to payload shapes: pull subscription id from multiple locations
    const subscriptionId = invoice.subscription
      || (invoice?.lines?.data?.[0]?.subscription as string | undefined)
      || (invoice?.lines?.data?.[0]?.parent?.subscription_details?.subscription as string | undefined)
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

    // Normalize metadata from invoice or first line item
    const line0 = Array.isArray(invoice?.lines?.data) ? invoice.lines.data[0] : undefined
    const meta = {
      ...(invoice?.metadata || {}),
      ...(line0?.metadata || {})
    } as Record<string, any>

    // STEP 1: Strongest signal: our DB subscription id embedded in invoice/line metadata
    let subscription = null
    let mappingMethod = 'UNKNOWN'
    if (meta?.dbSubscriptionId) {
      subscription = await prisma.subscription.findUnique({ 
        where: { id: meta.dbSubscriptionId }, 
        include: { user: true } 
      })
      
      if (subscription) {
        mappingMethod = 'METADATA_SUBSCRIPTION_ID'
        console.log(`✅ [${operationId}] Found subscription via metadata: ${subscription.id}`)
      }
    }

    // STEP 2: Direct Stripe subscription id if present
    if (!subscription) {
      if (subscriptionId) {
        const byStripe = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
        if (byStripe) {
          subscription = byStripe
          mappingMethod = 'STRIPE_SUBSCRIPTION_ID'
          console.log(`✅ [${operationId}] Found subscription via Stripe ID: ${subscription.id}`)
        } else {
          console.log(`⚠️ [${operationId}] No subscription found with stripeSubscriptionId: ${subscriptionId}`)
        }
      } else {
        console.log(`⚠️ [${operationId}] No subscription ID on invoice`)
      }
    }

    // STEP 3: Member user id embedded in invoice metadata (child attribution) – prefer before customer fallback
    if (!subscription && meta?.memberUserId) {
      const memberUserId = meta.memberUserId as string
      const subForMember = await prisma.subscription.findFirst({
        where: { userId: memberUserId },
        orderBy: { createdAt: 'desc' },
        include: { user: true }
      })
      if (subForMember) {
        subscription = subForMember
        mappingMethod = 'INVOICE_METADATA_MEMBER_USER_ID'
        console.log(`✅ [${operationId}] Found subscription via memberUserId: ${subscription.id}`)
      }
    }
    // STEP 3b: Fallback for family flows – accept childUserId as memberUserId
    if (!subscription && meta?.childUserId) {
      const childUserId = meta.childUserId as string
      const subForChild = await prisma.subscription.findFirst({
        where: { userId: childUserId },
        orderBy: { createdAt: 'desc' },
        include: { user: true }
      })
      if (subForChild) {
        subscription = subForChild
        mappingMethod = 'INVOICE_METADATA_CHILD_USER_ID'
        console.log(`✅ [${operationId}] Found subscription via childUserId: ${subscription.id}`)
      }
    }
    
    // STEP 4: CUSTOMER FALLBACK - last resort; only if nothing else mapped
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

    // STEP 5: Final validation
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

    // STEP 6: Check for duplicate processing (idempotency)
    const existingInvoice = await prisma.invoice.findUnique({ where: { stripeInvoiceId: invoice.id } })
    if (existingInvoice) {
      // Invoice already recorded – ensure a CONFIRMED payment exists for this invoice id regardless of user attribution
      const existingPaymentAnyUser = await prisma.payment.findFirst({
        where: {
          status: 'CONFIRMED',
          description: { contains: `[inv:${invoice.id}]` }
        }
      })
      if (existingPaymentAnyUser) {
        // Optional attribution correction: if metadata has memberUserId and differs, reattribute
        try {
          const preferredUserId = (meta?.memberUserId as string | undefined) || subscription.userId
          if (preferredUserId && existingPaymentAnyUser.userId !== preferredUserId) {
            await prisma.payment.update({ where: { id: existingPaymentAnyUser.id }, data: { userId: preferredUserId } })
            console.log(`♻️ [${operationId}] Reattributed existing payment ${existingPaymentAnyUser.id} to user ${preferredUserId}`)
          }
        } catch {}
        console.log(`ℹ️ [${operationId}] Invoice already processed with payment ${existingPaymentAnyUser.id}, skipping`)
        return
      }
      // Backfill missing payment for already-recorded invoice
      const userIdForBackfill = (meta?.memberUserId as string | undefined) || (meta?.childUserId as string | undefined) || subscription.userId
      const paymentDescriptionBackfill = invoice.billing_reason === 'subscription_create' 
        ? 'Initial subscription payment (prorated)'
        : 'Monthly membership payment'
      const taggedBackfill = `${paymentDescriptionBackfill} [inv:${invoice.id}]${invoice.payment_intent ? ` [pi:${invoice.payment_intent}]` : ''} [member:${userIdForBackfill}] [sub:${subscription.id}]`
      // Final guard before creating
      const dupGuard = await prisma.payment.findFirst({ where: { status: 'CONFIRMED', description: { contains: `[inv:${invoice.id}]` } } })
      if (dupGuard) {
        console.log(`ℹ️ [${operationId}] Detected duplicate just before backfill, skipping`)
        return
      }
      const created = await prisma.payment.create({
        data: {
          userId: userIdForBackfill,
          amount: amountPaid,
          currency: invoice.currency.toUpperCase(),
          status: 'CONFIRMED',
          description: taggedBackfill,
          routedEntityId: subscription.routedEntityId,
          processedAt: new Date()
        }
      })
      console.log(`✅ [${operationId}] Backfilled missing payment ${created.id} for existing invoice ${existingInvoice.id}`)
      return
    }

    // STEP 7: Create invoice record
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

    // STEP 8: Update subscription status and billing periods
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
    
    // STEP 9: Update membership status
    const updatedMemberships = await prisma.membership.updateMany({ 
      where: { userId: subscription.userId }, 
      data: { status: 'ACTIVE' } 
    })
    
    console.log(`✅ [${operationId}] Updated ${updatedMemberships.count} memberships to ACTIVE`)
    
    // STEP 10: Create payment record with explicit member tag to aid admin/customer UI
    const paymentDescription = invoice.billing_reason === 'subscription_create' 
      ? 'Initial subscription payment (prorated)' 
      : 'Monthly membership payment'
      
    // Decide the correct member to attribute this payment to
    const userIdForPayment = (invoice.metadata && ((invoice.metadata as any).memberUserId || (invoice.metadata as any).childUserId)) || subscription.userId

    // Tag description with identifiers including member id for precise attribution display
    const taggedDescription = `${paymentDescription} [inv:${invoice.id}]${invoice.payment_intent ? ` [pi:${invoice.payment_intent}]` : ''} [member:${userIdForPayment}] [sub:${subscription.id}]`

    // Idempotency guard (invoice-scoped) before creating normal payment
    const alreadyByInvoice = await prisma.payment.findFirst({
      where: { status: 'CONFIRMED', description: { contains: `[inv:${invoice.id}]` } }
    })
    if (alreadyByInvoice) {
      // Optional attribution correction
      try {
        if (alreadyByInvoice.userId !== userIdForPayment) {
          await prisma.payment.update({ where: { id: alreadyByInvoice.id }, data: { userId: userIdForPayment } })
          console.log(`♻️ [${operationId}] Reattributed existing payment ${alreadyByInvoice.id} to user ${userIdForPayment}`)
        }
      } catch {}
      console.log(`ℹ️ [${operationId}] Payment already exists for invoice ${invoice.id}, skipping create`)
      return
    }

    const paymentRecord = await prisma.payment.create({ 
      data: { 
        userId: userIdForPayment, 
        amount: amountPaid, 
        currency: invoice.currency.toUpperCase(), 
        status: 'CONFIRMED', 
        description: taggedDescription, 
        routedEntityId: subscription.routedEntityId, 
        processedAt: new Date()
      } 
    })
    
    console.log(`✅ [${operationId}] Created payment record: ${paymentRecord.id} for £${amountPaid}`)

    // Dunning success notifications if user was previously suspended
    try {
      const userPhone = subscription.user?.phone || null
      const userEmail = resolveNotificationEmail(subscription.user)
      await sendSuccessSms({ userPhone })
      await sendSuccessEmail({ to: userEmail })
      try { await prisma.systemSetting.delete({ where: { key: `dunning:suspended:${subscription.id}` } }) } catch {}
    } catch {}
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

export async function handlePaymentFailed(invoice: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
  const invoiceId = invoice.id
  const operationId = `webhook_failed_${invoiceId}_${Date.now()}`
  
  try {
    console.log(`🔄 [${operationId}] Processing failed payment: ${invoiceId}`)
    
    // Be tolerant to payload shapes where the subscription id is not at the top level
    const subscriptionIdTop = invoice.subscription
    const subscriptionIdFromLines = invoice?.lines?.data?.[0]?.parent?.subscription_details?.subscription
    const subscriptionIdFromParent = invoice?.parent?.subscription_details?.subscription
    const subscriptionId = subscriptionIdTop || subscriptionIdFromLines || subscriptionIdFromParent
    const amountDue = invoice.amount_due / 100
    const attempt: number = Number(invoice.attempt_count ?? 1)
    const nextAttemptAtISO = invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000).toISOString() : null
    
    // Use same robust mapping as handlePaymentSucceeded
    let subscription = null
    if (subscriptionId) {
      subscription = await prisma.subscription.findUnique({ 
        where: { stripeSubscriptionId: subscriptionId }, 
        include: { user: true } 
      })
    }
    
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
    
    // Dunning notifications and conditional suspension after 3rd attempt
    try {
      const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_BASE_URL || process.env.NEXTAUTH_URL || ''
      const manageUrl = `${baseUrl || ''}/dashboard/payment-methods`
      const userPhone = subscription.user?.phone || null
      const userEmail = subscription.user?.email || null
      const hosted = (invoice as any)?.hosted_invoice_url || null

      if (attempt >= 3) {
        if (isAutoSuspendEnabled()) {
          await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
          await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'SUSPENDED' } })
          // mark a dunning-suspended flag for webhook subscription.updated logic
          try { await prisma.systemSetting.create({ data: { key: `dunning:suspended:${subscription.id}`, value: '1', category: 'dunning' } }) } catch {}
          if (isPauseCollectionEnabled()) {
            try { await stripe.subscriptions.update(subscription.stripeSubscriptionId, { pause_collection: { behavior: 'void' } }) } catch {}
          }
        }
        await sendSuspendedSms({ userPhone, managePaymentUrl: manageUrl, invoiceId })
        await sendSuspendedEmail({ to: userEmail, manageUrl: manageUrl, invoiceId })
      } else {
        await sendDunningAttemptSms({ userPhone, attempt, totalAttempts: 3, nextRetryDateISO: nextAttemptAtISO, managePaymentUrl: manageUrl, invoiceId })
        // Include hosted invoice link (if present) so member can resolve without logging in
        await sendDunningAttemptEmail({ to: userEmail, attempt, total: 3, nextRetryISO: nextAttemptAtISO, manageUrl: manageUrl, hostedUrl: hosted, invoiceId })
      }
    } catch (e) {
      console.warn('Dunning notification failed (non-fatal)', e)
    }

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

    const failedDescription = `Failed monthly membership payment [inv:${invoice.id}]${invoice.payment_intent ? ` [pi:${invoice.payment_intent}]` : ''} [sub:${subscription.id}]`

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

export async function handlePaymentActionRequired(invoice: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
  const invoiceId = invoice.id
  const operationId = `webhook_action_required_${invoiceId}_${Date.now()}`
  try {
    const attempt: number = Number(invoice.attempt_count ?? 1)
    const subscriptionId = invoice.subscription
    let subscription = null
    if (subscriptionId) {
      subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
    }
    if (!subscription && invoice.customer) {
      try {
        const stripeCustomer = await stripe.customers.retrieve(invoice.customer as string)
        const userId = (stripeCustomer as any).metadata?.userId
        if (userId) {
          subscription = await prisma.subscription.findFirst({ where: { userId, status: { in: ['ACTIVE','TRIALING','PAUSED','PAST_DUE'] } }, orderBy: { createdAt: 'desc' }, include: { user: true } })
        }
      } catch {}
    }
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || process.env.FRONTEND_BASE_URL || process.env.NEXTAUTH_URL || ''
    const manageUrl = `${baseUrl || ''}/dashboard/payment-methods`
    const userPhone = subscription?.user?.phone || null
    const userEmail = resolveNotificationEmail(subscription?.user)
    const hosted = (invoice as any)?.hosted_invoice_url || null
    await sendActionRequiredSms({ userPhone, hostedInvoiceUrl: hosted, managePaymentUrl: manageUrl, invoiceId, attempt, totalAttempts: 3 })
    await sendActionRequiredEmail({ to: userEmail, hostedUrl: hosted, manageUrl, invoiceId, attempt })
  } catch (e) {
    console.error(`❌ [${operationId}] action_required handling failed:`, e)
    throw e
  }
}

export async function handleSubscriptionUpdated(stripeSubscription: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
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
    const cpStartSec = Number(stripeSubscription.current_period_start)
    const cpEndSec = Number(stripeSubscription.current_period_end)
    const safeStart = !isNaN(cpStartSec) && cpStartSec > 0 ? new Date(cpStartSec * 1000) : subscription.currentPeriodStart
    const safeEnd = !isNaN(cpEndSec) && cpEndSec > 0 ? new Date(cpEndSec * 1000) : subscription.currentPeriodEnd
    const safeNext = safeEnd || subscription.nextBillingDate

    const updatedSubscription = await prisma.subscription.update({ 
      where: { id: subscription.id }, 
      data: { 
        status: subscriptionStatus,
        currentPeriodStart: safeStart, 
        currentPeriodEnd: safeEnd, 
        nextBillingDate: safeNext, 
        cancelAtPeriodEnd: !!stripeSubscription.cancel_at_period_end 
      } 
    })
    
    console.log(`✅ [WEBHOOK] Updated subscription: ${previousStatus} → ${updatedSubscription.status}`)
    
    // Update membership status to mirror Stripe lifecycle accurately
    // ACTIVE (incl. TRIALING) -> ACTIVE access
    // PAST_DUE -> SUSPENDED access
    // INCOMPLETE/INCOMPLETE_EXPIRED -> PENDING_PAYMENT (never granted access)
    // PAUSED -> SUSPENDED access
    // CANCELLED -> CANCELLED
    // Only suspend on PAST_DUE if we explicitly flagged a dunning suspension (3rd failure)
    let membershipStatus =
      subscriptionStatus === 'PAUSED' ? 'SUSPENDED' :
      subscriptionStatus === 'INCOMPLETE' ? 'PENDING_PAYMENT' :
      subscriptionStatus === 'INCOMPLETE_EXPIRED' ? 'PENDING_PAYMENT' :
      subscriptionStatus === 'CANCELLED' ? 'CANCELLED' :
      'ACTIVE'

    if (subscriptionStatus === 'PAST_DUE') {
      try {
        const flag = await prisma.systemSetting.findUnique({ where: { key: `dunning:suspended:${subscription.id}` } })
        if (flag) membershipStatus = 'SUSPENDED'
        else membershipStatus = 'ACTIVE'
      } catch {
        membershipStatus = 'ACTIVE'
      }
    }
    
    const updatedMemberships = await prisma.membership.updateMany({ 
      where: { userId: subscription.userId }, 
      data: { status: membershipStatus } 
    })
    
    console.log(`✅ [WEBHOOK] Updated ${updatedMemberships.count} memberships to ${membershipStatus}`)

    // Apply pending plan switch exactly at rollover when present
    try {
      const pendingPlan = (stripeSubscription.metadata && (stripeSubscription.metadata as any).pending_plan) || undefined
      const pendingTsStr = (stripeSubscription.metadata && (stripeSubscription.metadata as any).pending_apply_ts) || undefined
      if (pendingPlan && pendingTsStr) {
        const pendingTs = Number(pendingTsStr)
        const nowSec = Math.floor(Date.now() / 1000)
        // If we have crossed or are at the scheduled timestamp, flip membership to the pending plan
        if (!isNaN(pendingTs) && nowSec >= pendingTs) {
          await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { membershipType: pendingPlan } })
          // Clear metadata to avoid repeat
          try {
            await stripe.subscriptions.update(stripeSubscription.id, { metadata: { ...stripeSubscription.metadata, pending_plan: '', pending_apply_ts: '' } })
          } catch {}
          console.log(`✅ [WEBHOOK] Applied pending plan ${pendingPlan} for user ${subscription.userId}`)
        }
      }
    } catch (e) {
      console.warn('Pending plan apply failed', e)
    }
  } catch (error) {
    console.error(`❌ [WEBHOOK] Failed to handle subscription update:`, error)
  }
}

export async function handleSubscriptionCancelled(stripeSubscription: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
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
export async function activateFromPaymentIntent(pi: any, account?: StripeAccountKey) {
  const stripe = getStripeClient(account || 'SU')
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

  // Determine if a real Stripe subscription already exists (e.g., created via confirm-payment)
  const hasRealStripeSub = !!(dbSub.stripeSubscriptionId && (dbSub.stripeSubscriptionId as string).startsWith('sub_'))

  // If no real Stripe subscription yet, create it now (account-aware price fetch)
  if (!hasRealStripeSub) {
    // Build price and create Stripe subscription starting next billing
    const membershipType = dbSub.membershipType
    const nextBilling = new Date(dbSub.nextBillingDate)
    const trialEndTimestamp = Math.floor(nextBilling.getTime() / 1000)

    // Get price via lightweight helper from confirm-payment handler (must be account-aware)
    const { getOrCreatePrice } = await import('@/app/api/confirm-payment/handlers') as any
    const accountForPrice = (dbSub as any).stripeAccountKey || account || 'SU'
    const priceId = await getOrCreatePrice({ monthlyPrice: Number(dbSub.monthlyPrice), name: membershipType }, accountForPrice)

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
  }

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
            description: `Initial subscription payment (prorated) [pi:${pi?.id}] [sub:${dbSub.id}]`,
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