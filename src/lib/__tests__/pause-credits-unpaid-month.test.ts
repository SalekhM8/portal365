import { describe, it, expect } from 'vitest'
import { calculateSettlementBreakdown } from '@/lib/pause-credits'

describe('pause settlement: credit only when the month was actually paid', () => {
  const period = { startDate: new Date('2026-08-04T00:00:00Z'), endDate: new Date('2026-08-31T00:00:00Z'), monthlyPrice: 55 }

  it('paid month, pause after the 1st → paused days credited (unchanged behaviour)', () => {
    const s = calculateSettlementBreakdown(period)
    expect(s.partialMonths[0].creditable).toBe(true)
    expect(s.totalSettlementAmount).toBe(49.68)
    expect(s.totalChargeAmount).toBe(0)
  })

  it('UNPAID (void) month, pause after the 1st → written off: no credit, no charge (Zakariya Ali, Aug 2026)', () => {
    const s = calculateSettlementBreakdown(period, { unpaidMonths: new Set(['2026-08']) })
    expect(s.partialMonths[0].creditable).toBe(false)
    expect(s.partialMonths[0].writtenOff).toBe(true)
    expect(s.totalSettlementAmount).toBe(0)
    expect(s.totalChargeAmount).toBe(0)
  })

  it('pause covering the 1st is unaffected by the unpaid flag (non-creditable branch as before)', () => {
    const p = { startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-20T00:00:00Z'), monthlyPrice: 31 }
    const a = calculateSettlementBreakdown(p)
    const b = calculateSettlementBreakdown(p, { unpaidMonths: new Set(['2026-07']) })
    expect(a).toEqual(b)
    expect(a.totalSettlementAmount).toBe(0)
    expect(a.totalChargeAmount).toBe(11) // 11 used days after resume at £1/day
  })
})
