import Stripe from 'stripe'
import { prisma } from './prisma'
import { IntelligentVATRouter, RoutingOptions } from './vat-routing'
import { getPlan } from '@/config/memberships'

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error('STRIPE_SECRET_KEY is not set in environment variables')
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  typescript: true,
  apiVersion: '2025-06-30.basil',
  appInfo: { name: 'Portal365', version: '1.0.0' }
})

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
}

export class SubscriptionProcessor {
  
  /**
   * Create subscription with 1st of month billing using invoice-item + trial pattern
   */
  static async createSubscription(request: SubscriptionRequest): Promise<SubscriptionResult> {
    try {
      console.log('🔄 Creating subscription with 1st of month billing...')
      
      // 1. Get membership pricing details
      const membershipDetails = getPlan(request.membershipType)
      
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
          const parentCustomer = await stripe.customers.create({
            email: parentUser?.email || undefined,
            name: parentUser ? `${parentUser.firstName} ${parentUser.lastName}` : undefined,
            metadata: { userId: request.payerUserId }
          })
          customerIdToUse = parentCustomer.id
        }
      } else {
        const customer = await stripe.customers.create({
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
      const priceId = await this.getOrCreatePrice({ monthlyPrice: membershipDetails.monthlyPrice, name: membershipDetails.name })

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
            routedEntityId: routing.selectedEntityId,
            membershipType: request.membershipType,
            monthlyPrice: membershipDetails.monthlyPrice,
            status: 'PENDING_PAYMENT',
            currentPeriodStart: now,
            currentPeriodEnd: startDate,
            nextBillingDate: startDate
          }
        })

        // Create SetupIntent to collect and save card
        const setupIntent = await stripe.setupIntents.create({
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

        // Create routing audit record
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

        console.log('✅ SetupIntent created for admin flow:', setupIntent.id)

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

      const paymentIntent = await stripe.paymentIntents.create({
        amount: proratedAmountPence,
        currency: 'gbp',
        customer: customerIdToUse,
        automatic_payment_methods: { enabled: true },
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
        await stripe.paymentIntents.update(paymentIntent.id, {
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
  private static async getOrCreatePrice(membershipDetails: { monthlyPrice: number; name: string }): Promise<string> {
    try {
      // First, try to find existing price for this amount
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
        console.log('✅ Reusing existing price:', existingPrice.id)
        return existingPrice.id
      }

      // Create new product and price only if needed
      const product = await stripe.products.create({
        name: `${membershipDetails.name} Membership`,
        description: `Monthly membership for ${membershipDetails.name}`,
        metadata: {
          type: 'gym_membership'
        }
      })

      const recurringPrice = await stripe.prices.create({
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