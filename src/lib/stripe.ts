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
      
      // 2. Determine optimal routing using existing VAT engine
      const routingOptions: RoutingOptions = {
        amount: membershipDetails.monthlyPrice,
        membershipType: request.membershipType as any
      }

      const routing = await IntelligentVATRouter.routePayment(routingOptions)
      console.log('✅ VAT routing decision:', routing)

      // 3. Create Stripe customer
      const customer = await stripe.customers.create({
        email: request.customerEmail,
        name: request.customerName,
        metadata: {
          userId: request.userId,
          routedEntity: routing.selectedEntityId
        }
      })

      // 4. Get or create Stripe price for this membership type
      const priceId = await this.getOrCreatePrice({ monthlyPrice: membershipDetails.monthlyPrice, name: membershipDetails.name })

      // 5. Calculate prorated billing details
      const now = new Date()
      const firstOfNextMonth = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 1))
      const trialEndTimestamp = Math.floor(firstOfNextMonth.getTime() / 1000)
      
      const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()
      const daysRemaining = daysInMonth - now.getDate() + 1 // Include today
      const fullAmountPence = membershipDetails.monthlyPrice * 100
      const proratedAmountPence = Math.round(fullAmountPence * (daysRemaining / daysInMonth))
      
      console.log('📊 Billing calculation:', {
        today: now.toISOString().split('T')[0],
        nextBilling: firstOfNextMonth.toISOString().split('T')[0],
        daysInMonth,
        daysRemaining,
        fullAmount: membershipDetails.monthlyPrice,
        proratedAmount: proratedAmountPence / 100
      })

      // 6. Create SetupIntent for payment method collection
      const setupIntent = await stripe.setupIntents.create({
        customer: customer.id,
        payment_method_types: ['card'],
        usage: 'off_session', // For future recurring payments
        metadata: {
          userId: request.userId,
          membershipType: request.membershipType,
          routedEntityId: routing.selectedEntityId,
          proratedAmount: (proratedAmountPence / 100).toString(),
          nextBillingDate: firstOfNextMonth.toISOString().split('T')[0]
        }
      })

      console.log('✅ SetupIntent created for payment method collection:', setupIntent.id)

      // 7. Create subscription record in database (PENDING_PAYMENT status)
      const dbSubscription = await prisma.subscription.create({
        data: {
          userId: request.userId,
          stripeSubscriptionId: setupIntent.id, // Temporarily store SetupIntent ID
          stripeCustomerId: customer.id,
          routedEntityId: routing.selectedEntityId,
          membershipType: request.membershipType,
          monthlyPrice: membershipDetails.monthlyPrice,
          status: 'PENDING_PAYMENT', // Will be updated after payment method setup
          currentPeriodStart: now,
          currentPeriodEnd: firstOfNextMonth,
          nextBillingDate: firstOfNextMonth
        }
      })

      // 8. Create routing audit record
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

      console.log('✅ Setup ready - customer will complete payment method setup, then prorated billing will process')

      return {
        subscription: dbSubscription,
        clientSecret: setupIntent.client_secret!, // SetupIntent client secret for frontend
        routing,
        proratedAmount: proratedAmountPence / 100,
        nextBillingDate: firstOfNextMonth.toISOString().split('T')[0]
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