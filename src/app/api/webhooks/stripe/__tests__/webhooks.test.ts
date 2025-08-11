import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock Stripe before importing handlers so route.ts doesn't load real client
vi.mock('@/lib/stripe', () => ({
  stripe: {
    // add any stubbed members if route.ts references them
  }
}))

import { handlePaymentSucceeded, handlePaymentFailed, handleSubscriptionUpdated, handleSubscriptionCancelled } from '@/app/api/webhooks/stripe/route'
import { prisma } from '@/lib/prisma'

vi.mock('@/lib/prisma', () => {
  return {
    prisma: {
      subscription: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
      membership: { updateMany: vi.fn() },
      invoice: { findUnique: vi.fn(), create: vi.fn() },
      payment: { create: vi.fn() }
    }
  }
})

const mockPrisma = prisma as any

describe('Stripe webhook handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('handles payment succeeded and is idempotent on duplicate invoice', async () => {
    const invoice = {
      id: 'in_1',
      subscription: 'sub_live',
      amount_paid: 2500,
      currency: 'gbp',
      status: 'paid',
      period_start: Math.floor(Date.now() / 1000),
      period_end: Math.floor(Date.now() / 1000),
      lines: { data: [{ period: { start: Math.floor(Date.now() / 1000), end: Math.floor(Date.now() / 1000) } }] },
      status_transitions: { paid_at: Math.floor(Date.now() / 1000) },
      billing_reason: 'subscription_cycle'
    }

    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'db_sub', userId: 'user_1', routedEntityId: 'entity_a', user: { email: 't@example.com' } })
    mockPrisma.invoice.findUnique.mockResolvedValueOnce(null)
    mockPrisma.invoice.create.mockResolvedValueOnce({ id: 'db_inv' })
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.membership.updateMany.mockResolvedValue({})
    mockPrisma.payment.create.mockResolvedValue({})

    await handlePaymentSucceeded(invoice as any)
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)

    // second time, idempotent: invoice exists
    mockPrisma.invoice.findUnique.mockResolvedValueOnce({ id: 'db_inv' })
    await handlePaymentSucceeded(invoice as any)
    expect(mockPrisma.payment.create).toHaveBeenCalledTimes(1)
  })

  it('handles payment failed and sets statuses', async () => {
    const invoice = {
      id: 'in_fail',
      subscription: 'sub_live',
      amount_due: 2500,
      currency: 'gbp'
    }
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'db_sub', userId: 'user_1', user: { email: 't@example.com' } })
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.membership.updateMany.mockResolvedValue({})
    mockPrisma.payment.create.mockResolvedValue({})

    await handlePaymentFailed(invoice as any)
    expect(mockPrisma.subscription.update).toHaveBeenCalled()
    expect(mockPrisma.membership.updateMany).toHaveBeenCalled()
    expect(mockPrisma.payment.create).toHaveBeenCalled()
  })

  it('handles subscription updated', async () => {
    const sub = { id: 'sub_live', status: 'active', current_period_start: Date.now()/1000, current_period_end: Date.now()/1000, cancel_at_period_end: false }
    mockPrisma.subscription.updateMany.mockResolvedValue({})
    await handleSubscriptionUpdated(sub as any)
    expect(mockPrisma.subscription.updateMany).toHaveBeenCalled()
  })

  it('handles subscription cancelled', async () => {
    const sub = { id: 'sub_live' }
    mockPrisma.subscription.findUnique.mockResolvedValue({ id: 'db_sub', userId: 'user_1', user: { email: 't@example.com' } })
    mockPrisma.subscription.update.mockResolvedValue({})
    mockPrisma.membership.updateMany.mockResolvedValue({})
    await handleSubscriptionCancelled(sub as any)
    expect(mockPrisma.subscription.update).toHaveBeenCalled()
    expect(mockPrisma.membership.updateMany).toHaveBeenCalled()
  })
}) 