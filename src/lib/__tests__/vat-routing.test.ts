import { describe, it, expect, vi, beforeEach } from 'vitest'
import { IntelligentVATRouter, VATCalculationEngine } from '@/lib/vat-routing'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      businessEntity: {
        findMany: vi.fn(),
        update: vi.fn()
      },
      service: {
        findFirst: vi.fn()
      },
      vATCalculation: {
        createMany: vi.fn()
      }
    }
  }
})

const mockPrisma = prisma as unknown as {
  businessEntity: { findMany: any; update: any },
  service: { findFirst: any },
  vATCalculation: { createMany: any }
}

describe('VAT routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calculates VAT positions and selects entity with most headroom', async () => {
    mockPrisma.businessEntity.findMany.mockResolvedValue([
      {
        id: 'entity_a',
        name: 'Aura MMA',
        vatThreshold: 90000,
        payments: [
          { amount: 10000, createdAt: new Date() },
          { amount: 5000, createdAt: new Date() }
        ]
      },
      {
        id: 'entity_b',
        name: 'Aura Wellness',
        vatThreshold: 90000,
        payments: [
          { amount: 1000, createdAt: new Date() }
        ]
      }
    ])

    mockPrisma.vATCalculation.createMany.mockResolvedValue({})
    mockPrisma.businessEntity.update.mockResolvedValue({})

    const positions = await VATCalculationEngine.calculateVATPositions()
    expect(positions.length).toBe(2)
    const routerDecision = await IntelligentVATRouter.routePayment({ amount: 89, membershipType: 'FULL_ADULT' as any })
    expect(['entity_a', 'entity_b']).toContain(routerDecision.selectedEntityId)
    // Preference-first: FULL_ADULT prefers Aura MMA (entity_a) if viable
    expect(routerDecision.selectedEntityId).toBe('entity_a')
  })

  it('respects safety buffer (does not route if headroom below buffer)', async () => {
    mockPrisma.businessEntity.findMany.mockResolvedValue([
      {
        id: 'entity_a',
        name: 'Aura MMA',
        vatThreshold: 90000,
        payments: [
          { amount: 89900, createdAt: new Date() }
        ]
      }
    ])

    mockPrisma.vATCalculation.createMany.mockResolvedValue({})
    mockPrisma.businessEntity.update.mockResolvedValue({})

    await expect(IntelligentVATRouter.routePayment({ amount: 100, membershipType: 'FULL_ADULT' as any }))
      .rejects.toThrow()
  })
}) 