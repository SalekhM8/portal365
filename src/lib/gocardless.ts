import { prisma } from './prisma'
import { IntelligentVATRouter, RoutingOptions } from './vat-routing'

// ============================================================================
// SIMPLIFIED GOCARDLESS INTEGRATION
// ============================================================================

interface GoCardlessInstance {
  entityId: string
  entityName: string
  accessToken: string
  environment: 'sandbox' | 'live'
  webhookSecret: string
}

export class GoCardlessManager {
  private static instances: Map<string, GoCardlessInstance> = new Map()

  /**
   * Initialize GoCardless instances for all business entities
   */
  static async initialize(): Promise<void> {
    const entities = await prisma.businessEntity.findMany({
      where: { 
        status: 'ACTIVE',
        goCardlessToken: { not: null }
      }
    })

    for (const entity of entities) {
      if (!entity.goCardlessToken) continue

      this.instances.set(entity.id, {
        entityId: entity.id,
        entityName: entity.name,
        accessToken: entity.goCardlessToken,
        environment: entity.goCardlessEnv as 'sandbox' | 'live',
        webhookSecret: entity.webhookSecret || ''
      })

      console.log(`Initialized GoCardless for ${entity.name}`)
    }
  }

  /**
   * Get GoCardless instance for specific entity
   */
  static getInstance(entityId: string): GoCardlessInstance {
    const instance = this.instances.get(entityId)
    if (!instance) {
      throw new Error(`GoCardless instance not found for entity: ${entityId}`)
    }
    return instance
  }

  /**
   * Get all available instances
   */
  static getAllInstances(): GoCardlessInstance[] {
    return Array.from(this.instances.values())
  }
}

// ============================================================================
// PAYMENT PROCESSING WITH VAT ROUTING
// ============================================================================

export interface PaymentRequest {
  userId: string
  amount: number
  description: string
  membershipType?: string
  currency?: string
}

export interface PaymentResult {
  paymentId: string
  routedEntityId: string
  routingReason: string
  goCardlessPaymentId: string
  mandateId?: string
  status: string
}

export class PaymentProcessor {
  
  /**
   * Process payment with intelligent VAT routing
   */
  static async processPayment(request: PaymentRequest): Promise<PaymentResult> {
    try {
      // 1. Determine optimal routing using VAT engine
      const routingOptions: RoutingOptions = {
        amount: request.amount,
        membershipType: request.membershipType as any
      }

      const routing = await IntelligentVATRouter.routePayment(routingOptions)
      
      // 2. Create payment record in database
      const payment = await prisma.payment.create({
        data: {
          userId: request.userId,
          amount: request.amount,
          currency: request.currency || 'GBP',
          description: request.description,
          routedEntityId: routing.selectedEntityId,
          status: 'PENDING'
        }
      })

      // 3. Create routing audit record
      await prisma.paymentRouting.create({
        data: {
          paymentId: payment.id,
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

      // 4. MOCK SUCCESSFUL PAYMENT FOR DEMO
      const gcPaymentId = `demo_payment_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      const mandateId = `demo_mandate_${routing.selectedEntityId}_${request.userId.substr(0, 8)}`

      // 5. Update payment with mock success
      const updatedPayment = await prisma.payment.update({
        where: { id: payment.id },
        data: {
          goCardlessPaymentId: gcPaymentId,
          goCardlessMandateId: mandateId,
          goCardlessStatus: 'confirmed',
          status: 'CONFIRMED',
          processedAt: new Date()
        }
      })

      // 6. Update business entity revenue (for VAT tracking)
      await prisma.businessEntity.update({
        where: { id: routing.selectedEntityId },
        data: {
          currentRevenue: {
            increment: request.amount
          }
        }
      })

      console.log(`✅ DEMO: Payment processed successfully - £${request.amount} routed to ${routing.selectedEntityId}`)

      return {
        paymentId: payment.id,
        routedEntityId: routing.selectedEntityId,
        routingReason: routing.routingReason,
        goCardlessPaymentId: gcPaymentId,
        mandateId: mandateId,
        status: updatedPayment.status
      }

    } catch (error) {
      console.error('Payment processing error:', error)
      throw new Error(`Payment processing failed: ${error}`)
    }
  }

  /**
   * Handle payment status updates from webhooks
   */
  static async handlePaymentUpdate(
    goCardlessPaymentId: string, 
    newStatus: string,
    entityId: string
  ): Promise<void> {
    try {
      const payment = await prisma.payment.findFirst({
        where: {
          goCardlessPaymentId,
          routedEntityId: entityId
        }
      })

      if (!payment) {
        console.warn(`Payment not found for GoCardless ID: ${goCardlessPaymentId}`)
        return
      }

      // Map GoCardless status to our status
      const statusMapping: Record<string, string> = {
        'pending_submission': 'PROCESSING',
        'submitted': 'PROCESSING', 
        'confirmed': 'CONFIRMED',
        'paid_out': 'CONFIRMED',
        'cancelled': 'CANCELLED',
        'customer_approval_denied': 'FAILED',
        'failed': 'FAILED',
        'charged_back': 'REFUNDED'
      }

      const mappedStatus = statusMapping[newStatus] || 'PENDING'

      await prisma.payment.update({
        where: { id: payment.id },
        data: {
          status: mappedStatus,
          goCardlessStatus: newStatus,
          processedAt: mappedStatus === 'CONFIRMED' ? new Date() : null,
          failedAt: mappedStatus === 'FAILED' ? new Date() : null
        }
      })

      console.log(`Updated payment ${payment.id} status to ${mappedStatus}`)

    } catch (error) {
      console.error('Error handling payment update:', error)
      throw error
    }
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get payment history for a user across all entities
 */
export async function getUserPaymentHistory(userId: string) {
  return await prisma.payment.findMany({
    where: { userId },
    include: {
      routedEntity: {
        select: {
          name: true,
          displayName: true
        }
      },
      routing: {
        select: {
          routingReason: true,
          routingMethod: true
        }
      }
    },
    orderBy: { createdAt: 'desc' }
  })
}

/**
 * Get revenue summary for all entities
 */
export async function getRevenueSummary() {
  const entities = await prisma.businessEntity.findMany({
    include: {
      payments: {
        where: {
          status: 'CONFIRMED',
          createdAt: {
            gte: new Date(new Date().getFullYear(), 3, 1) // VAT year start
          }
        }
      }
    }
  })

  return entities.map((entity: any) => ({
    entityId: entity.id,
    entityName: entity.name,
    currentRevenue: entity.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0),
    paymentCount: entity.payments.length,
    vatThreshold: Number(entity.vatThreshold),
    headroom: Number(entity.vatThreshold) - entity.payments.reduce((sum: number, p: any) => sum + Number(p.amount), 0)
  }))
} 