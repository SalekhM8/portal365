import { describe, expect, it, beforeEach, vi } from 'vitest'
import { Prisma } from '@prisma/client'

const findFirstMock = vi.fn()
const createMock = vi.fn()
const updateMock = vi.fn()

vi.mock('@/lib/prisma', () => ({
  prisma: {
    payment: {
      findFirst: (...args: any[]) => findFirstMock(...args),
      create: (...args: any[]) => createMock(...args),
      update: (...args: any[]) => updateMock(...args)
    }
  }
}))

import { persistSuccessfulPayment } from '../handlers'

describe('persistSuccessfulPayment', () => {
  const baseArgs = {
    invoiceId: 'inv_test',
    userIdForPayment: 'user_123',
    amountPaid: 75,
    currency: 'GBP',
    description: 'Monthly membership payment',
    routedEntityId: 'entity_1',
    operationId: 'op_1'
  }

  beforeEach(() => {
    findFirstMock.mockReset()
    createMock.mockReset()
    updateMock.mockReset()
  })

  it('creates a new payment when no existing invoice is found', async () => {
    findFirstMock.mockResolvedValueOnce(null)
    createMock.mockResolvedValueOnce({ id: 'payment_new' })

    await persistSuccessfulPayment(baseArgs)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(updateMock).not.toHaveBeenCalled()
    const payload = createMock.mock.calls[0][0].data
    expect(payload).toMatchObject({
      userId: baseArgs.userIdForPayment,
      amount: baseArgs.amountPaid,
      currency: baseArgs.currency,
      status: 'CONFIRMED',
      description: baseArgs.description,
      routedEntityId: baseArgs.routedEntityId,
      stripeInvoiceId: baseArgs.invoiceId
    })
  })

  it('updates an existing payment when invoice already exists', async () => {
    findFirstMock.mockResolvedValueOnce({ id: 'payment_existing' })
    updateMock.mockResolvedValueOnce({ id: 'payment_existing' })

    await persistSuccessfulPayment(baseArgs)

    expect(createMock).not.toHaveBeenCalled()
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'payment_existing' },
      data: expect.objectContaining({
        status: 'CONFIRMED',
        description: baseArgs.description
      })
    })
  })

  it('recovers from P2002 by updating the conflicting record', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('duplicate', {
      code: 'P2002',
      clientVersion: '6.12.0',
      meta: { target: ['stripeInvoiceId'] }
    })
    findFirstMock
      .mockResolvedValueOnce(null) // first lookup before create
      .mockResolvedValueOnce({ id: 'payment_conflict' }) // lookup inside catch
    createMock.mockRejectedValueOnce(duplicateError)
    updateMock.mockResolvedValueOnce({ id: 'payment_conflict' })

    await persistSuccessfulPayment(baseArgs)

    expect(createMock).toHaveBeenCalledTimes(1)
    expect(updateMock).toHaveBeenCalledWith({
      where: { id: 'payment_conflict' },
      data: expect.objectContaining({
        status: 'CONFIRMED',
        description: baseArgs.description
      })
    })
  })
})

