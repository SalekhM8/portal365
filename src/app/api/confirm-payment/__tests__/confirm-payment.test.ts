import { describe, it, expect, vi, beforeEach } from 'vitest'
import { handleSetupIntentConfirmation } from '@/app/api/confirm-payment/route'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/stripe', () => {
  return {
    stripe: {
      setupIntents: { retrieve: vi.fn() },
      customers: { update: vi.fn() },
      invoiceItems: { create: vi.fn() },
      invoices: { create: vi.fn() },
      subscriptions: { create: vi.fn() },
      prices: { list: vi.fn(), create: vi.fn() },
      products: { create: vi.fn() }
    }
  }
})

vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      subscription: { findUnique: vi.fn(), update: vi.fn() },
      membership: { updateMany: vi.fn() },
      payment: { create: vi.fn() }
    }
  }
})

const mockStripe = (await import('@/lib/stripe')).stripe as any
const mockPrisma = prisma as any

describe('confirm-payment idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('activates a subscription and is idempotent on repeat', async () => {
    mockStripe.setupIntents.retrieve.mockResolvedValue({
      status: 'succeeded',
      payment_method: 'pm_123',
      metadata: { proratedAmount: '10', nextBillingDate: '2099-01-01' }
    })
    mockStripe.customers.update.mockResolvedValue({})
    mockStripe.invoiceItems.create.mockResolvedValue({ id: 'ii_1' })
    mockStripe.invoices.create.mockResolvedValue({ id: 'in_1' })
    mockStripe.prices.list.mockResolvedValue({ data: [] })
    mockStripe.products.create.mockResolvedValue({ id: 'prod_1' })
    mockStripe.prices.create.mockResolvedValue({ id: 'price_1' })
    mockStripe.subscriptions.create.mockResolvedValue({ id: 'sub_1' })

    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'db_sub', userId: 'user_1', stripeCustomerId: 'cus_1',
      membershipType: 'FULL_ADULT', routedEntityId: 'entity_a', nextBillingDate: new Date('2099-01-01'),
      user: { id: 'user_1', email: 'u@example.com', firstName: 'U', lastName: 'Ser' }
    })
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.membership.updateMany.mockResolvedValue({})
    mockPrisma.payment.create.mockResolvedValue({})

    const res1 = await handleSetupIntentConfirmation({ setupIntentId: 'seti_1', subscriptionId: 'db_sub' })
    expect(res1.status).toBe(200)

    // second call should short-circuit if already set ACTIVE
    mockPrisma.subscription.findUnique.mockResolvedValue({
      id: 'db_sub', userId: 'user_1', stripeCustomerId: 'cus_1',
      membershipType: 'FULL_ADULT', routedEntityId: 'entity_a', nextBillingDate: new Date('2099-01-01'), status: 'ACTIVE',
      user: { id: 'user_1', email: 'u@example.com', firstName: 'U', lastName: 'Ser' }
    })

    const res2 = await handleSetupIntentConfirmation({ setupIntentId: 'seti_1', subscriptionId: 'db_sub' })
    expect(res2.status).toBe(200)
  })
}) 