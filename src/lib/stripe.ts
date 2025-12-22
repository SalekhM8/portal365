import Stripe from 'stripe'
import { prisma } from './prisma'
import { IntelligentVATRouter, RoutingOptions } from './vat-routing'
import { getPlanDbFirst } from '@/lib/plans'

// =============================================================================
// Multi-account Stripe manager
// =============================================================================

export type StripeAccountKey = 'SU' | 'IQ' | 'AURA'

type StripeAccountConfig = {
  secretKey?: string
  publishableKey?: string
  webhookSecret?: string
  label: string
}

const STRIPE_ACCOUNTS: Record<StripeAccountKey, StripeAccountConfig> = {
  SU: {
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    label: 'Sporting U'
  },
  IQ: {
    secretKey: process.env.STRIPE_IQ_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_IQ_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_IQ_WEBHOOK_SECRET,
    label: 'IQ Learning Centre'
  },
  AURA: {
    secretKey: process.env.STRIPE_AURA_SECRET_KEY,
    publishableKey: process.env.NEXT_PUBLIC_STRIPE_AURA_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_AURA_WEBHOOK_SECRET,
    label: 'Aura MMA'
  }
}

const stripeClients = new Map<StripeAccountKey, Stripe>()

export function getStripeClient(account: StripeAccountKey): Stripe {
  const existing = stripeClients.get(account)
  if (existing) return existing
  const cfg = STRIPE_ACCOUNTS[account]
  if (!cfg?.secretKey) throw new Error(`Missing Stripe secret for account ${account}`)
  const client = new Stripe(cfg.secretKey, { typescript: true, appInfo: { name: 'Portal365', version: '1.0.0' } })
  stripeClients.set(account, client)
  return client
}

export function getPublishableKey(account: StripeAccountKey): string {
  const key = STRIPE_ACCOUNTS[account]?.publishableKey
  if (!key) throw new Error(`Missing publishable key for account ${account}`)
  return key
}

export function getWebhookSecrets(): Array<{ account: StripeAccountKey; secret: string }> {
  const out: Array<{ account: StripeAccountKey; secret: string }> = []
  for (const k of Object.keys(STRIPE_ACCOUNTS) as StripeAccountKey[]) {
    const s = STRIPE_ACCOUNTS[k].webhookSecret
    if (s) out.push({ account: k, secret: s })
  }
  return out
}

// Backward-compatible default client (SU). Existing code may still import { stripe }
export const stripe = getStripeClient('SU')

// ============================================================================
// SUBSCRIPTION PROCESSING - 1ST OF MONTH BILLING WITH PRORATED FIRST PAYMENT
// ============================================================================

export interface SubscriptionRequest {
  userId: string
  membershipType: string
  businessId: string
  customerEmail: string
  customerName: string
  
  // Optional admin overrides (existing flow ignores these)
  customPrice?: number     // If provided, overrides getPlan() price
  customStartDate?: string // If provided, overrides "next month" logic
  isAdminCreated?: boolean // Flag to skip prorated billing
  payerUserId?: string     // If provided, create subscription under parent's Stripe customer
}

export interface SubscriptionResult {
  subscription: any
  clientSecret: string
  routing: any
  proratedAmount: number
  nextBillingDate: string
  paymentStatus?: string // 'succeeded', 'requires_action', 'requires_payment_method', etc.
}

export class SubscriptionProcessor {
  
  /**
   * Create subscription with 1st of month billing using invoice-item + trial pattern
   */
  static async createSubscription(request: SubscriptionRequest): Promise<SubscriptionResult> {
    try {
      console.log('🔄 Creating subscription with 1st of month billing...')
      
      // 1. Get membership pricing details (DB-first)
      const membershipDetails = await getPlanDbFirst(request.membershipType)
      
      // Admin price override (doesn't affect existing flow)
      if (request.customPrice) {
        membershipDetails.monthlyPrice = request.customPrice
        console.log(`✅ Admin price override: £${request.customPrice}`)
      }
      
      // 2. Determine optimal routing using existing VAT engine
      const routingOptions: RoutingOptions = {
        amount: membershipDetails.monthlyPrice,
        membershipType: request.membershipType as any
      }

      const routing = await IntelligentVATRouter.routePayment(routingOptions)
      console.log('✅ VAT routing decision:', routing)

      // 2b. Choose Stripe account for this signup
      // Default: ALL new signups go to AURA (as of Dec 2024)
      // Set STRIPE_DEFAULT_ACCOUNT env var to override (e.g., 'SU' or 'IQ' for legacy)
      const defaultAccount = (process.env.STRIPE_DEFAULT_ACCOUNT as StripeAccountKey) || 'AURA'
      let stripeAccount: StripeAccountKey = defaultAccount

      // If creating under a parent's payer account, prefer the parent's existing Stripe account
      // (so family members stay on the same account as the parent)
      if (request.payerUserId) {
        try {
          // Prefer the parent's most recently updated, active-like subscription that has a Stripe customer
          const payerSub = await prisma.subscription.findFirst({
            where: { 
              userId: request.payerUserId,
              status: { in: ['ACTIVE','TRIALING','PAUSED','PAST_DUE'] }
            },
            orderBy: { updatedAt: 'desc' }
          })
          const payerAccount = (payerSub as any)?.stripeAccountKey as StripeAccountKey | undefined
          if (payerAccount === 'SU' || payerAccount === 'IQ' || payerAccount === 'AURA') {
            stripeAccount = payerAccount
          }
        } catch {}
      }

      const stripeClient = getStripeClient(stripeAccount)

      // 3. Create or reuse Stripe customer
      let customerIdToUse: string
      if (request.payerUserId) {
        // Use parent's Stripe customer if available; otherwise create one for parent
        const payer = await prisma.subscription.findFirst({
          where: { userId: request.payerUserId },
          orderBy: { createdAt: 'desc' }
        })
        if (payer?.stripeCustomerId) {
          customerIdToUse = payer.stripeCustomerId
        } else {
          const parentUser = await prisma.user.findUnique({ where: { id: request.payerUserId } })
          const parentCustomer = await stripeClient.customers.create({
            email: parentUser?.email || undefined,
            name: parentUser ? `${parentUser.firstName} ${parentUser.lastName}` : undefined,
            metadata: { userId: request.payerUserId }
          })
          customerIdToUse = parentCustomer.id
        }
      } else {
        const customer = await stripeClient.customers.create({
          email: request.customerEmail,
          name: request.customerName,
          metadata: {
            userId: request.userId,
            routedEntity: routing.selectedEntityId
          }
        })
        customerIdToUse = customer.id
      }

      // 4. Get or create Stripe price for this membership type
      const priceId = await this.getOrCreatePrice({ monthlyPrice: membershipDetails.monthlyPrice, name: membershipDetails.name || membershipDetails.displayName }, stripeAccount)

      // 5. Calculate billing details (with admin date override)
      const now = new Date()
      const startDate = request.customStartDate 
        ? new Date(request.customStartDate)
        : new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
      
      const trialEndTimestamp = Math.floor(startDate.getTime() / 1000)
      
      // Branch: Admin-created subscriptions use SetupIntent + Elements, no upfront PaymentIntent
      if (request.isAdminCreated) {
        // Create DB subscription placeholder first
        const dbSubscription = await prisma.subscription.create({
          data: {
            userId: request.userId,
            stripeSubscriptionId: `setup_placeholder_${Date.now()}`,
            stripeCustomerId: customerIdToUse,
            stripeAccountKey: stripeAccount,
            routedEntityId: routing.selectedEntityId,
            membershipType: request.membershipType,
            monthlyPrice: membershipDetails.monthlyPrice,
            status: 'PENDING_PAYMENT',
            currentPeriodStart: now,
            currentPeriodEnd: startDate,
            nextBillingDate: startDate
          }
        })
        // Retrieve customer to determine if a default PM exists and ensure account alignment
        let hasDefaultPm = false
        try {
          let cust: any
          try {
            cust = await stripeClient.customers.retrieve(customerIdToUse)
          } catch (e: any) {
            // If the stored customer belongs to another account, try all other accounts
            const allAccounts: StripeAccountKey[] = ['SU', 'IQ', 'AURA']
            const otherAccounts = allAccounts.filter(a => a !== stripeAccount)
            for (const otherAccount of otherAccounts) {
              try {
                const otherClient = getStripeClient(otherAccount)
                const retry = await otherClient.customers.retrieve(customerIdToUse)
                stripeAccount = otherAccount
                customerIdToUse = (retry as any).id
                cust = retry
                try {
                  await prisma.subscription.update({
                    where: { id: dbSubscription.id },
                    data: { stripeAccountKey: stripeAccount }
                  })
                } catch {}
                break
              } catch {}
            }
          }
          hasDefaultPm = !('deleted' in cust) && !!(cust as any)?.invoice_settings?.default_payment_method
        } catch {
          // If we cannot determine, assume no default PM to force on-session
          hasDefaultPm = false
        }

        // Compute prorated amount for the remainder of this month
        let proratedAmountPence = 0
        const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
        const daysRemaining = daysInMonth - now.getDate() + 1
        const fullAmountPence = membershipDetails.monthlyPrice * 100
        proratedAmountPence = Math.round(fullAmountPence * (daysRemaining / daysInMonth))

        // If there is a non-zero prorate, ALWAYS collect on-session with a PaymentIntent (3DS if needed)
        if (proratedAmountPence > 0) {
          // Get default payment method if available - we'll confirm immediately
          let defaultPm: string | undefined
          if (hasDefaultPm) {
            try {
              const cust = await getStripeClient(stripeAccount).customers.retrieve(customerIdToUse)
              if (cust && !cust.deleted) {
                defaultPm = cust.invoice_settings?.default_payment_method as string | undefined
              }
            } catch {}
          }

          const pi = await getStripeClient(stripeAccount).paymentIntents.create({
            amount: proratedAmountPence,
            currency: 'gbp',
            customer: customerIdToUse,
            ...(defaultPm ? { payment_method: defaultPm, confirm: true } : {}),
            ...(process.env.CARD_ONLY_FOR_NEW_SIGNUPS === 'true'
              ? { payment_method_types: ['card'] as any }
              : { automatic_payment_methods: { enabled: true, allow_redirects: 'never' } }),
            setup_future_usage: 'off_session',
            metadata: {
              userId: request.userId,
              membershipType: request.membershipType,
              routedEntityId: routing.selectedEntityId,
              nextBillingDate: startDate.toISOString().split('T')[0],
              reason: 'prorated_first_period',
              dbSubscriptionId: dbSubscription.id,
              familyActivation: 'true'
            }
          })

          // Record routing snapshot (for diagnostics)
          await prisma.subscriptionRouting.create({
            data: {
              subscriptionId: dbSubscription.id,
              selectedEntityId: routing.selectedEntityId,
              availableEntities: JSON.stringify(routing.availableEntities),
              routingReason: routing.routingReason,
              routingMethod: routing.routingMethod,
              confidence: routing.confidence,
              vatPositionSnapshot: JSON.stringify(routing.availableEntities),
              thresholdDistance: routing.thresholdDistance,
              decisionTimeMs: routing.decisionTimeMs
            }
          })

          console.log('✅ Admin child activation using on-session PaymentIntent:', pi.id, 'status:', pi.status)
          return {
            subscription: dbSubscription,
            clientSecret: pi.client_secret!,
            routing,
            proratedAmount: proratedAmountPence / 100,
            nextBillingDate: startDate.toISOString().split('T')[0],
            paymentStatus: pi.status // 'succeeded', 'requires_action', 'requires_payment_method', etc.
          }
        }

        // If prorate is zero: create the subscription immediately when a default PM exists,
        // otherwise create a SetupIntent to collect a card on-session.
        if (hasDefaultPm) {
          const priceIdImmediate = await this.getOrCreatePrice({ monthlyPrice: membershipDetails.monthlyPrice, name: membershipDetails.name }, stripeAccount)
          const trialEndTs = Math.floor(startDate.getTime() / 1000)
          const childStripeSub = await getStripeClient(stripeAccount).subscriptions.create({
            customer: customerIdToUse,
            items: [{ price: priceIdImmediate }],
            collection_method: 'charge_automatically',
            trial_end: trialEndTs,
            metadata: {
              userId: request.userId,
              membershipType: request.membershipType,
              routedEntityId: routing.selectedEntityId,
              dbSubscriptionId: dbSubscription.id
            }
          }, { idempotencyKey: `admin-child-sub:${dbSubscription.id}:${trialEndTs}` })

          await prisma.subscription.update({
            where: { id: dbSubscription.id },
            data: { stripeSubscriptionId: childStripeSub.id, status: 'ACTIVE' }
          })

          await prisma.subscriptionRouting.create({
            data: {
              subscriptionId: dbSubscription.id,
              selectedEntityId: routing.selectedEntityId,
              availableEntities: JSON.stringify(routing.availableEntities),
              routingReason: routing.routingReason,
              routingMethod: routing.routingMethod,
              confidence: routing.confidence,
              vatPositionSnapshot: JSON.stringify(routing.availableEntities),
              thresholdDistance: routing.thresholdDistance,
              decisionTimeMs: routing.decisionTimeMs
            }
          })

          console.log('✅ Child subscription created (zero prorate, default PM present):', childStripeSub.id)
          return {
            subscription: dbSubscription,
            clientSecret: undefined as any,
            routing,
            proratedAmount: 0,
            nextBillingDate: startDate.toISOString().split('T')[0]
          }
        }

        // No default PM and zero prorate → collect card with SetupIntent (on-session)
        const setupIntent = await stripeClient.setupIntents.create({
          customer: customerIdToUse,
          usage: 'off_session',
          metadata: {
            userId: request.userId,
            membershipType: request.membershipType,
            routedEntityId: routing.selectedEntityId,
            nextBillingDate: startDate.toISOString().split('T')[0],
            reason: 'admin_created_setup',
            dbSubscriptionId: dbSubscription.id
          }
        })

        await prisma.subscriptionRouting.create({
          data: {
            subscriptionId: dbSubscription.id,
            selectedEntityId: routing.selectedEntityId,
            availableEntities: JSON.stringify(routing.availableEntities),
            routingReason: routing.routingReason,
            routingMethod: routing.routingMethod,
            confidence: routing.confidence,
            vatPositionSnapshot: JSON.stringify(routing.availableEntities),
            thresholdDistance: routing.thresholdDistance,
            decisionTimeMs: routing.decisionTimeMs
          }
        })

        console.log('✅ SetupIntent created for admin flow (zero prorate, no default PM):', setupIntent.id)

        return {
          subscription: dbSubscription,
          clientSecret: setupIntent.client_secret!,
          routing,
          proratedAmount: 0,
          nextBillingDate: startDate.toISOString().split('T')[0]
        }
      }

      // Non-admin flow: create upfront PaymentIntent for prorated amount and save card
      // Calculate prorated amount
      let proratedAmountPence = 0
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const daysRemaining = daysInMonth - now.getDate() + 1
      const fullAmountPence = membershipDetails.monthlyPrice * 100
      proratedAmountPence = Math.round(fullAmountPence * (daysRemaining / daysInMonth))

      console.log('📊 Billing calculation:', {
        today: now.toISOString().split('T')[0],
        nextBilling: startDate.toISOString().split('T')[0],
        isAdminCreated: false,
        fullAmount: membershipDetails.monthlyPrice,
        proratedAmount: proratedAmountPence / 100
      })

      const paymentIntent = await stripeClient.paymentIntents.create({
        amount: proratedAmountPence,
        currency: 'gbp',
        customer: customerIdToUse,
        ...(process.env.CARD_ONLY_FOR_NEW_SIGNUPS === 'true' ? { payment_method_types: ['card'] as any } : { automatic_payment_methods: { enabled: true } }),
        setup_future_usage: 'off_session',
        metadata: {
          userId: request.userId,
          membershipType: request.membershipType,
          routedEntityId: routing.selectedEntityId,
          nextBillingDate: startDate.toISOString().split('T')[0],
          reason: 'prorated_first_period'
        }
      })

      console.log('✅ PaymentIntent created for prorated charge:', paymentIntent.id)

      const dbSubscription = await prisma.subscription.create({
        data: {
          userId: request.userId,
          stripeSubscriptionId: paymentIntent.id,
          stripeCustomerId: customerIdToUse,
          stripeAccountKey: stripeAccount,
          routedEntityId: routing.selectedEntityId,
          membershipType: request.membershipType,
          monthlyPrice: membershipDetails.monthlyPrice,
          status: 'PENDING_PAYMENT',
          currentPeriodStart: now,
          currentPeriodEnd: startDate,
          nextBillingDate: startDate
        }
      })

      // Add dbSubscriptionId to PaymentIntent metadata for webhook activation (e.g., Klarna async success)
      try {
        await stripeClient.paymentIntents.update(paymentIntent.id, {
          metadata: {
            userId: request.userId,
            membershipType: request.membershipType,
            routedEntityId: routing.selectedEntityId,
            nextBillingDate: startDate.toISOString().split('T')[0],
            reason: 'prorated_first_period',
            dbSubscriptionId: dbSubscription.id
          }
        })
      } catch (e) {
        console.warn('Unable to update PaymentIntent metadata with dbSubscriptionId', e)
      }

      await prisma.subscriptionRouting.create({
        data: {
          subscriptionId: dbSubscription.id,
          selectedEntityId: routing.selectedEntityId,
          availableEntities: JSON.stringify(routing.availableEntities),
          routingReason: routing.routingReason,
          routingMethod: routing.routingMethod,
          confidence: routing.confidence,
          vatPositionSnapshot: JSON.stringify(routing.availableEntities),
          thresholdDistance: routing.thresholdDistance,
          decisionTimeMs: routing.decisionTimeMs
        }
      })

      console.log('✅ Ready - customer will complete payment with 3DS if needed; card saved for future billing')

      return {
        subscription: dbSubscription,
        clientSecret: paymentIntent.client_secret!,
        routing,
        proratedAmount: proratedAmountPence / 100,
        nextBillingDate: startDate.toISOString().split('T')[0]
      }

    } catch (error) {
      console.error('❌ Error creating subscription:', error)
      throw error
    }
  }

  /**
   * Get or create Stripe price for membership type (reuse existing prices)
   */
  private static async getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }, account: StripeAccountKey = 'SU'): Promise<string> {
    try {
      const stripeClient = getStripeClient(account)
      // First, try to find existing price for this amount
      const existingPrices = await stripeClient.prices.list({
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
        console.log('✅ Reusing existing price:', existingPrice.id)
        return existingPrice.id
      }

      // Create new product and price only if needed
      const product = await stripeClient.products.create({
        name: `${membershipDetails.name} Membership`,
        description: `Monthly membership for ${membershipDetails.name}`,
        metadata: {
          type: 'gym_membership'
        }
      })

      const recurringPrice = await stripeClient.prices.create({
        unit_amount: membershipDetails.monthlyPrice * 100,
        currency: 'gbp',
        recurring: {
          interval: 'month',
        },
        product: product.id,
      })

      console.log('✅ Created new price:', recurringPrice.id)
      return recurringPrice.id

    } catch (error) {
      console.error('Error creating Stripe price:', error)
      throw error
    }
  }
} 