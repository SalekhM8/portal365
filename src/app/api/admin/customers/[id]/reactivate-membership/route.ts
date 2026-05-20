import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient } from '@/lib/stripe'
import { getOrCreatePrice } from '@/app/api/confirm-payment/handlers'

/**
 * REACTIVATE MEMBERSHIP — bring a CANCELLED subscription back to ACTIVE.
 *
 * Stripe's `canceled` subscription status is terminal, so we must:
 *   - Optionally collect prorate via a one-off invoice on the saved card
 *   - Create a brand-new Stripe subscription on the same customer (trial until next billing date)
 *   - Swap the new stripeSubscriptionId onto the existing Portal Subscription row
 *   - Flip Subscription + Membership rows back to ACTIVE
 *   - Write a REACTIVATE audit log
 *
 * Webhook mapping is preserved by stamping metadata.dbSubscriptionId on both
 * the optional prorate invoice and the new subscription.
 */
export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const startTime = Date.now()
  let operationId = ''

  try {
    // 🔐 AUTH
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ success: false, error: 'Authentication required', code: 'UNAUTHORIZED' }, { status: 401 })
    }
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })
    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ success: false, error: 'Insufficient permissions - Admin access required', code: 'FORBIDDEN' }, { status: 403 })
    }

    // 📝 INPUT
    const params = await context.params
    const customerId = params.id
    const body = await request.json()
    const reason: string = (body?.reason || '').toString().trim()
    const prorateAmountPence: number = Math.max(0, Math.floor(Number(body?.prorateAmountPence || 0)))
    const trialEndIso: string | undefined = body?.trialEndIso

    if (!customerId) {
      return NextResponse.json({ success: false, error: 'Customer ID is required', code: 'INVALID_REQUEST' }, { status: 400 })
    }
    if (!reason || reason.length < 5) {
      return NextResponse.json({ success: false, error: 'Reason is required (min 5 chars)', code: 'INVALID_REASON' }, { status: 400 })
    }

    // Default trial end = 1st of next month at 00:00 UTC
    const now = new Date()
    const defaultTrialEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0))
    const trialEnd = trialEndIso ? new Date(trialEndIso) : defaultTrialEnd
    if (isNaN(trialEnd.getTime())) {
      return NextResponse.json({ success: false, error: 'Invalid trialEndIso', code: 'INVALID_TRIAL_END' }, { status: 400 })
    }
    if (trialEnd.getTime() <= Date.now()) {
      return NextResponse.json({ success: false, error: 'trialEndIso must be in the future', code: 'INVALID_TRIAL_END' }, { status: 400 })
    }
    const trialEndTs = Math.floor(trialEnd.getTime() / 1000)

    // 🔍 FIND CUSTOMER + CANCELLED SUBSCRIPTION
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        subscriptions: {
          where: { status: 'CANCELLED' },
          include: { routedEntity: true }
        },
        memberships: {
          where: { status: 'CANCELLED' }
        }
      }
    })
    if (!customer) {
      return NextResponse.json({ success: false, error: 'Customer not found', code: 'CUSTOMER_NOT_FOUND' }, { status: 404 })
    }

    // If more than one CANCELLED sub, pick the most recently updated. (Almost always exactly one.)
    const cancelledSub = customer.subscriptions
      .slice()
      .sort((a, b) => (b.updatedAt?.getTime() || 0) - (a.updatedAt?.getTime() || 0))[0]
    if (!cancelledSub) {
      return NextResponse.json({ success: false, error: 'No cancelled subscription found for this customer', code: 'NO_CANCELLED_SUBSCRIPTION' }, { status: 404 })
    }

    // Idempotency: if user already has an ACTIVE sub, refuse to avoid double-billing
    const existingActive = await prisma.subscription.findFirst({
      where: { userId: customer.id, status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE'] } }
    })
    if (existingActive) {
      return NextResponse.json({
        success: false,
        error: 'Customer already has a non-cancelled subscription',
        code: 'ALREADY_ACTIVE',
        existingSubscriptionId: existingActive.id
      }, { status: 409 })
    }

    if (!cancelledSub.stripeCustomerId) {
      return NextResponse.json({ success: false, error: 'Cancelled subscription has no Stripe customer', code: 'NO_STRIPE_CUSTOMER' }, { status: 400 })
    }
    if (!cancelledSub.stripeAccountKey) {
      return NextResponse.json({ success: false, error: 'Cancelled subscription has no stripeAccountKey', code: 'NO_STRIPE_ACCOUNT' }, { status: 400 })
    }
    const monthlyPrice = Number(cancelledSub.monthlyPrice)
    if (!monthlyPrice || monthlyPrice <= 0) {
      return NextResponse.json({ success: false, error: 'Invalid monthlyPrice on subscription', code: 'INVALID_PRICE' }, { status: 400 })
    }

    operationId = `reactivate_${cancelledSub.id}_${Date.now()}`
    console.log(`🔄 [${operationId}] Reactivate request for ${customer.email} sub=${cancelledSub.id} prorate=${prorateAmountPence}p trialEnd=${trialEnd.toISOString()}`)

    const stripeClient = getStripeClient(cancelledSub.stripeAccountKey as any)
    const oldStripeSubscriptionId = cancelledSub.stripeSubscriptionId

    // 🔒 PREFLIGHT STRIPE — customer must exist + have a default PM
    let stripeCustomer: any
    try {
      stripeCustomer = await stripeClient.customers.retrieve(cancelledSub.stripeCustomerId, {
        expand: ['invoice_settings.default_payment_method']
      })
    } catch (e: any) {
      return NextResponse.json({ success: false, error: 'Stripe customer not retrievable', details: e.message, code: 'STRIPE_CUSTOMER_MISSING' }, { status: 400 })
    }
    if (stripeCustomer?.deleted) {
      return NextResponse.json({ success: false, error: 'Stripe customer is deleted', code: 'STRIPE_CUSTOMER_DELETED' }, { status: 400 })
    }
    const dpm = stripeCustomer?.invoice_settings?.default_payment_method
    const dpmId = (typeof dpm === 'string') ? dpm : dpm?.id
    if (!dpmId) {
      return NextResponse.json({
        success: false,
        error: 'Customer has no default payment method. Ask them to update their card before reactivating.',
        code: 'NO_DEFAULT_PAYMENT_METHOD'
      }, { status: 400 })
    }

    // STEP 1: optional prorate
    let prorateInvoiceId: string | null = null
    let prorateChargedPence = 0
    if (prorateAmountPence > 0) {
      try {
        const sharedMeta = {
          reason: 'reactivation_prorate',
          dbSubscriptionId: cancelledSub.id,
          memberUserId: customer.id,
          userId: customer.id,
          operationId,
        }
        await stripeClient.invoiceItems.create({
          customer: cancelledSub.stripeCustomerId,
          amount: prorateAmountPence,
          currency: 'gbp',
          description: `Reactivation prorate for ${customer.firstName} ${customer.lastName}`,
          metadata: sharedMeta,
        }, { idempotencyKey: `${operationId}:ii` })

        const inv = await stripeClient.invoices.create({
          customer: cancelledSub.stripeCustomerId,
          collection_method: 'charge_automatically',
          auto_advance: true,
          pending_invoice_items_behavior: 'include',
          description: `Reactivation prorate for ${customer.firstName} ${customer.lastName}`,
          metadata: sharedMeta,
        }, { idempotencyKey: `${operationId}:inv` })

        const finalized = await stripeClient.invoices.finalizeInvoice(inv.id!)
        const paid = await stripeClient.invoices.pay(finalized.id!)

        if (paid.status !== 'paid') {
          return NextResponse.json({
            success: false,
            error: `Prorate invoice did not pay (status=${paid.status}). New subscription was NOT created.`,
            code: 'PRORATE_PAYMENT_FAILED',
            invoiceId: finalized.id,
            operationId
          }, { status: 402 })
        }
        prorateInvoiceId = finalized.id || null
        prorateChargedPence = paid.amount_paid || prorateAmountPence
        console.log(`✅ [${operationId}] Prorate paid £${(prorateChargedPence/100).toFixed(2)} invoice=${prorateInvoiceId}`)
      } catch (e: any) {
        console.error(`❌ [${operationId}] Prorate failed`, e)
        return NextResponse.json({
          success: false,
          error: 'Failed to collect prorate. New subscription was NOT created.',
          details: e.message,
          code: 'PRORATE_FAILED',
          operationId
        }, { status: 402 })
      }
    }

    // STEP 2: new Stripe subscription
    let newSub: any
    try {
      const priceId = await getOrCreatePrice(
        { monthlyPrice, name: cancelledSub.membershipType },
        cancelledSub.stripeAccountKey
      )
      newSub = await stripeClient.subscriptions.create({
        customer: cancelledSub.stripeCustomerId,
        items: [{ price: priceId }],
        collection_method: 'charge_automatically',
        trial_end: trialEndTs,
        proration_behavior: 'none',
        metadata: {
          userId: customer.id,
          memberUserId: customer.id,
          dbSubscriptionId: cancelledSub.id,
          membershipType: cancelledSub.membershipType,
          routedEntityId: cancelledSub.routedEntityId || '',
          reason: 'reactivation',
          operationId,
        }
      }, { idempotencyKey: `${operationId}:sub` })
    } catch (e: any) {
      console.error(`❌ [${operationId}] Subscription create failed`, e)
      return NextResponse.json({
        success: false,
        error: 'Failed to create new Stripe subscription after prorate was collected. Refund manually if needed.',
        details: e.message,
        code: 'STRIPE_SUB_CREATE_FAILED',
        operationId,
        prorateInvoiceId,
        prorateChargedPence
      }, { status: 500 })
    }

    // STEP 3: DB updates
    try {
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({
          where: { id: cancelledSub.id },
          data: {
            status: 'ACTIVE',
            stripeSubscriptionId: newSub.id,
            currentPeriodStart: new Date(),
            currentPeriodEnd: trialEnd,
            nextBillingDate: trialEnd,
            cancelAtPeriodEnd: false,
          }
        })
        await tx.membership.updateMany({
          where: { userId: customer.id, status: 'CANCELLED' },
          data: { status: 'ACTIVE' }
        })
      })
      console.log(`✅ [${operationId}] DB updated: sub ACTIVE with new stripeSubscriptionId=${newSub.id}`)
    } catch (dbError: any) {
      console.error(`❌ [${operationId}] DB update failed (Stripe state already advanced)`, dbError)
      return NextResponse.json({
        success: false,
        error: 'Stripe reactivation completed but DB update failed. Run reconciliation.',
        details: dbError.message,
        code: 'DATABASE_UPDATE_FAILED',
        operationId,
        newStripeSubscriptionId: newSub.id,
        prorateInvoiceId
      }, { status: 500 })
    }

    // STEP 4: audit log
    try {
      await prisma.subscriptionAuditLog.create({
        data: {
          subscriptionId: cancelledSub.id,
          action: 'REACTIVATE',
          performedBy: adminUser.id,
          performedByName: `${adminUser.firstName} ${adminUser.lastName}`,
          reason,
          operationId,
          metadata: JSON.stringify({
            oldStripeSubscriptionId,
            newStripeSubscriptionId: newSub.id,
            stripeCustomer: cancelledSub.stripeCustomerId,
            stripeAccount: cancelledSub.stripeAccountKey,
            prorateChargedPence,
            prorateInvoiceId,
            trialEnd: trialEnd.toISOString(),
            membershipType: cancelledSub.membershipType,
            monthlyPrice,
            customerEmail: customer.email,
            timestamp: new Date().toISOString(),
            processingTimeMs: Date.now() - startTime
          })
        }
      })
    } catch (auditError) {
      console.warn(`⚠️ [${operationId}] Audit log failed`, auditError)
    }

    return NextResponse.json({
      success: true,
      message: prorateChargedPence > 0
        ? `Membership reactivated. Charged £${(prorateChargedPence/100).toFixed(2)} prorate; first £${monthlyPrice.toFixed(2)} charge ${trialEnd.toISOString().slice(0,10)}.`
        : `Membership reactivated (no prorate). First £${monthlyPrice.toFixed(2)} charge ${trialEnd.toISOString().slice(0,10)}.`,
      subscription: {
        id: cancelledSub.id,
        status: 'ACTIVE',
        oldStripeSubscriptionId,
        newStripeSubscriptionId: newSub.id,
        customerId: customer.id,
        customerEmail: customer.email,
        membershipType: cancelledSub.membershipType,
        monthlyPrice,
        trialEnd: trialEnd.toISOString(),
        prorateChargedPence,
        prorateInvoiceId
      },
      operationId,
      processingTimeMs: Date.now() - startTime,
      code: 'REACTIVATE_SUCCESS'
    })

  } catch (error: any) {
    console.error(`❌ [${operationId || 'unknown'}] Unexpected error during reactivate operation`, error)
    return NextResponse.json({
      success: false,
      error: 'Internal server error during reactivate operation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      code: 'INTERNAL_ERROR',
      operationId: operationId || 'unknown',
      processingTimeMs: Date.now() - startTime
    }, { status: 500 })
  }
}
