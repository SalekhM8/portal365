import { prisma } from './prisma'
import { MEMBERSHIP_PLANS, MembershipKey } from '@/config/memberships'
import { SAFETY_BUFFER_GBP } from '@/config/routing'

type VATRiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' | 'EXCEEDED'
type RoutingMethod = 'LOAD_BALANCING' | 'VAT_OPTIMIZED' | 'SERVICE_PREFERENCE' | 'HEADROOM_OPTIMIZED' | 'MANUAL_OVERRIDE'
type RoutingConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'FORCED'
type MembershipType = 'WEEKEND_ADULT' | 'WEEKEND_UNDER18' | 'FULL_ADULT' | 'FULL_UNDER18' | 'PERSONAL_TRAINING' | 'WOMENS_CLASSES' | 'WELLNESS_PACKAGE' | 'CORPORATE'

// Simple payment type to avoid any
type PaymentData = {
  amount: number | string
  status: string
  createdAt: Date
}

export interface VATPosition {
  entityId: string
  entityName: string
  currentRevenue: number
  vatThreshold: number
  headroom: number
  riskLevel: VATRiskLevel
  monthlyAverage: number
  projectedYearEnd: number
}

export interface RoutingDecision {
  selectedEntityId: string
  routingReason: string
  routingMethod: RoutingMethod
  confidence: RoutingConfidence
  thresholdDistance: number
  availableEntities: VATPosition[]
  decisionTimeMs: number
}

export interface RoutingOptions {
  amount: number
  membershipType?: MembershipType
  customerPreference?: string
  adminOverride?: {
    entityId: string
    reason: string
    userId: string
  }
}

// ============================================================================
// VAT CALCULATION ENGINE
// ============================================================================

export class VATCalculationEngine {
  
  /**
   * Calculate current VAT positions for all entities
   */
  static async calculateVATPositions(): Promise<VATPosition[]> {
    const startTime = Date.now()
    
    const entities = await prisma.businessEntity.findMany({
      where: { status: 'ACTIVE' },
      include: {
        payments: {
          where: {
            status: 'CONFIRMED',
            createdAt: {
              gte: this.getCurrentVATYearStart(),
              lte: this.getCurrentVATYearEnd()
            }
          },
          select: { amount: true, createdAt: true }
        }
      }
    })

    const positions: VATPosition[] = []

    for (const entity of entities) {
      const totalRevenue = entity.payments.reduce((sum: number, p: { amount: any; createdAt: Date }) => sum + Number(p.amount), 0)
      
      const headroom = Number(entity.vatThreshold) - totalRevenue
      const monthlyAverage = this.calculateMonthlyAverage(entity.payments.map(p => ({ amount: Number(p.amount), status: 'CONFIRMED', createdAt: p.createdAt } as PaymentData)))
      const projectedYearEnd = this.projectYearEndRevenue(
        totalRevenue, 
        monthlyAverage
      )
      
      positions.push({
        entityId: entity.id,
        entityName: entity.name,
        currentRevenue: totalRevenue,
        vatThreshold: Number(entity.vatThreshold),
        headroom,
        riskLevel: this.calculateRiskLevel(totalRevenue, Number(entity.vatThreshold)),
        monthlyAverage,
        projectedYearEnd
      })
    }

    await this.updateEntityRevenueCache(positions)

    console.log(`VAT calculation completed in ${Date.now() - startTime}ms`)
    return positions
  }

  /**
   * Calculate risk level based on current revenue
   */
  private static calculateRiskLevel(revenue: number, threshold: number): VATRiskLevel {
    const percentage = (revenue / threshold) * 100
    
    if (percentage >= 100) return 'EXCEEDED'
    if (percentage >= 94) return 'CRITICAL'  // £85k+
    if (percentage >= 89) return 'HIGH'      // £80k+
    if (percentage >= 78) return 'MEDIUM'    // £70k+
    return 'LOW'
  }

  /**
   * Calculate monthly average from payments
   */
  private static calculateMonthlyAverage(payments: PaymentData[]): number {
    if (payments.length === 0) return 0
    
    const vatYearStart = this.getCurrentVATYearStart()
    const monthsElapsed = this.getMonthsElapsed(vatYearStart)
    
    if (monthsElapsed === 0) return 0
    
    const totalRevenue = payments.reduce((sum, p) => sum + Number(p.amount), 0)
    return totalRevenue / monthsElapsed
  }

  /**
   * Project year-end revenue based on current trends
   */
  private static projectYearEndRevenue(currentRevenue: number, monthlyAverage: number): number {
    const vatYearStart = this.getCurrentVATYearStart()
    const monthsElapsed = this.getMonthsElapsed(vatYearStart)
    const monthsRemaining = 12 - monthsElapsed
    
    return currentRevenue + (monthlyAverage * monthsRemaining)
  }

  /**
   * Get current VAT year start date (April 1st)
   */
  private static getCurrentVATYearStart(): Date {
    const now = new Date()
    const currentYear = now.getFullYear()
    const vatYearStart = new Date(currentYear, 3, 1) // April 1st (month is 0-indexed)
    
    // If we're before April 1st, use previous year's VAT year
    if (now < vatYearStart) {
      vatYearStart.setFullYear(currentYear - 1)
    }
    
    return vatYearStart
  }

  /**
   * Get current VAT year end date (March 31st)
   */
  private static getCurrentVATYearEnd(): Date {
    const vatYearStart = this.getCurrentVATYearStart()
    const vatYearEnd = new Date(vatYearStart)
    vatYearEnd.setFullYear(vatYearStart.getFullYear() + 1)
    vatYearEnd.setDate(31) // March 31st
    return vatYearEnd
  }

  /**
   * Calculate months elapsed in current VAT year
   */
  private static getMonthsElapsed(vatYearStart: Date): number {
    const now = new Date()
    const monthsDiff = (now.getFullYear() - vatYearStart.getFullYear()) * 12 + 
                      (now.getMonth() - vatYearStart.getMonth())
    return Math.max(1, monthsDiff) // At least 1 month
  }

  /**
   * Update entity revenue cache in database
   */
  private static async updateEntityRevenueCache(positions: VATPosition[]): Promise<void> {
    const updatePromises = positions.map(position => 
      prisma.businessEntity.update({
        where: { id: position.entityId },
        data: { currentRevenue: position.currentRevenue }
      })
    )
    
    await Promise.all(updatePromises)
  }
}

// ============================================================================
// INTELLIGENT ROUTING ENGINE
// ============================================================================

export class IntelligentVATRouter {
  
  /**
   * Main routing function - determines optimal entity for payment
   */
  static async routePayment(options: RoutingOptions): Promise<RoutingDecision> {
    const startTime = Date.now()
    
    // Get current VAT positions
    const vatPositions = await VATCalculationEngine.calculateVATPositions()
    
    // Handle admin override
    if (options.adminOverride) {
      return this.handleAdminOverride(options, vatPositions, startTime)
    }
    
    // Filter entities that can safely handle this payment
    const viableEntities = this.getViableEntities(vatPositions, options.amount)
    
    if (viableEntities.length === 0) {
      throw new Error('No entities can safely handle this payment - manual intervention required')
    }
    
    // Apply business logic routing
    const selectedEntity: VATPosition = await this.selectOptimalEntity(viableEntities, options)
    
    const decision: RoutingDecision = {
      selectedEntityId: selectedEntity.entityId,
      routingReason: this.generateRoutingReason(selectedEntity, viableEntities, options),
      routingMethod: this.determineRoutingMethod(options),
      confidence: this.calculateConfidence(selectedEntity, viableEntities),
      thresholdDistance: selectedEntity.headroom,
      availableEntities: vatPositions,
      decisionTimeMs: Date.now() - startTime
    }
    
    console.log('Routing decision:', decision)
    return decision
  }

  /**
   * Get entities that can safely handle the payment amount
   */
  private static getViableEntities(positions: VATPosition[], amount: number): VATPosition[] {
    const SAFETY_BUFFER = SAFETY_BUFFER_GBP
    
    return positions.filter(entity => {
      const safeHeadroom = entity.headroom - SAFETY_BUFFER
      return safeHeadroom >= amount && entity.riskLevel !== 'EXCEEDED'
    })
  }

  /**
   * Select the optimal entity based on business rules
   */
  private static async selectOptimalEntity(
    viableEntities: VATPosition[], 
    options: RoutingOptions
  ): Promise<VATPosition> {
    // 1. Service preference routing (DB-backed, with config fallback)
    if (options.membershipType) {
      const preferredEntity = await this.getServicePreferredEntity(viableEntities, options.membershipType)
      if (preferredEntity) return preferredEntity
    }
    
    // 2. Load balancing - prefer entities with medium utilization
    const balancedEntities = this.getBalancedEntities(viableEntities)
    if (balancedEntities.length > 0) {
      return balancedEntities.sort((a, b) => b.headroom - a.headroom)[0]
    }
    
    // 3. Fallback - entity with most headroom
    return viableEntities.sort((a, b) => b.headroom - a.headroom)[0]
  }

  /**
   * Get preferred entity based on service type (DB first, config fallback)
   */
  private static async getServicePreferredEntity(
    entities: VATPosition[], 
    membershipType: MembershipType
  ): Promise<VATPosition | null> {
    const key = (membershipType as unknown) as MembershipKey
    const plan = MEMBERSHIP_PLANS[key]
    const preferred = plan?.preferredEntities || []

    // DB-backed: ensure a Service actually prefers this entity
    for (const name of preferred) {
      const found = entities.find(e => e.entityName.toLowerCase().includes(name.replace('aura_', '')))
      if (found) {
        const service = await prisma.service.findFirst({
          where: { preferredEntityId: found.entityId, isActive: true }
        })
        if (service) return found
      }
    }

    // Config fallback: if no DB-backed service preference, still prefer based on plan hint
    for (const name of preferred) {
      const found = entities.find(e => e.entityName.toLowerCase().includes(name.replace('aura_', '')))
      if (found) return found
    }

    return null
  }

  /**
   * Get entities with balanced utilization (not too high, not too low)
   */
  private static getBalancedEntities(entities: VATPosition[]): VATPosition[] {
    return entities.filter(entity => {
      const utilizationPercent = ((entity.vatThreshold - entity.headroom) / entity.vatThreshold) * 100
      return utilizationPercent >= 30 && utilizationPercent <= 70 // 30-70% utilization is ideal
    })
  }

  /**
   * Handle admin manual override
   */
  private static handleAdminOverride(
    options: RoutingOptions, 
    vatPositions: VATPosition[], 
    startTime: number
  ): RoutingDecision {
    const selectedEntity = vatPositions.find(e => e.entityId === options.adminOverride!.entityId)
    
    if (!selectedEntity) {
      throw new Error('Invalid entity ID in admin override')
    }
    
    return {
      selectedEntityId: selectedEntity.entityId,
      routingReason: `Admin override: ${options.adminOverride!.reason}`,
      routingMethod: 'MANUAL_OVERRIDE',
      confidence: 'FORCED',
      thresholdDistance: selectedEntity.headroom,
      availableEntities: vatPositions,
      decisionTimeMs: Date.now() - startTime
    }
  }

  /**
   * Generate human-readable routing reason
   */
  private static generateRoutingReason(
    selected: VATPosition, 
    available: VATPosition[], 
    options: RoutingOptions
  ): string {
    const reasons: string[] = []
    
    if (options.membershipType) {
      // Config-only preference check to keep this method sync (selection used DB-backed check)
      const key = (options.membershipType as unknown) as MembershipKey
      const plan = MEMBERSHIP_PLANS[key]
      const preferred = plan?.preferredEntities || []
      const preferredMatch = preferred.some(name => selected.entityName.toLowerCase().includes(name.replace('aura_', '')))
      if (preferredMatch) {
        reasons.push('Service type alignment')
      }
    }
    
    const maxHeadroom = Math.max(...available.map(e => e.headroom))
    if (selected.headroom === maxHeadroom) {
      reasons.push('Maximum VAT headroom')
    }
    
    if (selected.riskLevel === 'LOW') {
      reasons.push('Low VAT risk')
    }
    
    reasons.push(`£${selected.headroom.toLocaleString()} remaining capacity`)
    
    return reasons.join(' + ')
  }

  /**
   * Determine routing method used
   */
  private static determineRoutingMethod(options: RoutingOptions): RoutingMethod {
    if (options.adminOverride) return 'MANUAL_OVERRIDE'
    if (options.membershipType) return 'SERVICE_PREFERENCE'
    return 'HEADROOM_OPTIMIZED'
  }

  /**
   * Calculate confidence level in routing decision
   */
  private static calculateConfidence(
    selected: VATPosition, 
    available: VATPosition[]
  ): RoutingConfidence {
    if (available.length === 1) return 'FORCED'
    
    // ✅ FIX: Base confidence on VAT threshold safety, not entity differences
    const thresholdDistance = selected.headroom
    const riskLevel = selected.riskLevel
    
    // High confidence: Safe distance from VAT threshold
    if (thresholdDistance > 30000 && riskLevel === 'LOW') return 'HIGH'
    
    // Medium confidence: Moderate distance, manageable risk  
    if (thresholdDistance > 15000 && (riskLevel === 'LOW' || riskLevel === 'MEDIUM')) return 'MEDIUM'
    
    // Low confidence: Close to threshold or high risk
    if (thresholdDistance > 5000 && riskLevel !== 'CRITICAL') return 'MEDIUM'
    
    // Very low confidence: Critical situation
    return 'LOW'
  }
}

// ============================================================================
// BACKGROUND PROCESSING
// ============================================================================

/**
 * Background job to update VAT calculations (run hourly)
 */
export async function updateVATCalculationsJob(): Promise<void> {
  try {
    console.log('Starting VAT calculations update...')
    
    const positions = await VATCalculationEngine.calculateVATPositions()
    
    // Store calculations in database
    const calculations = positions.map(position => ({
      entityId: position.entityId,
      calculationDate: new Date(),
      vatYearStart: VATCalculationEngine['getCurrentVATYearStart'](),
      vatYearEnd: VATCalculationEngine['getCurrentVATYearEnd'](),
      totalRevenue: position.currentRevenue,
      monthlyAverage: position.monthlyAverage,
      projectedYearEnd: position.projectedYearEnd,
      headroomRemaining: position.headroom,
      riskLevel: position.riskLevel,
      paymentCount: 0 // Will be calculated separately if needed
    }))
    
    // Batch insert calculations
    await prisma.vATCalculation.createMany({
      data: calculations
    })
    
    // Check for alerts
    await checkVATAlerts(positions)
    
    console.log('VAT calculations updated successfully')
    
  } catch (error) {
    console.error('Error updating VAT calculations:', error)
    throw error
  }
}

/**
 * Check for VAT threshold alerts
 */
async function checkVATAlerts(positions: VATPosition[]): Promise<void> {
  for (const position of positions) {
    if (position.riskLevel === 'CRITICAL' || position.riskLevel === 'HIGH') {
      console.warn(`VAT Alert: ${position.entityName} at ${position.riskLevel} risk level`)
      
      // In production, this would send alerts via email/SMS
      // await sendVATAlert(position)
    }
  }
} 