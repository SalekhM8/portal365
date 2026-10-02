import { describe, it, expect } from 'vitest'
import { remainingMonthProrationPence, firstOfNextMonthUTC, storedFirstBillHasPassed } from '@/lib/late-signup'

describe('late signup pricing', () => {
  it('30 Sep signup at £55 → 1 day of 30 = £1.83 (matches the rule the form uses)', () => {
    expect(remainingMonthProrationPence(55, new Date('2026-09-30T21:44:00Z'))).toBe(183)
  })
  it('completing on 2 Oct → 30 of 31 days = £53.23, first renewal 1 Nov', () => {
    const now = new Date('2026-10-02T16:11:00Z')
    expect(remainingMonthProrationPence(55, now)).toBe(5323)
    expect(firstOfNextMonthUTC(now).toISOString().slice(0, 10)).toBe('2026-11-01')
  })
  it('stored first-bill date in the past is detected', () => {
    expect(storedFirstBillHasPassed(new Date('2026-10-01T00:00:00Z'), new Date('2026-10-02T16:11:00Z'))).toBe(true)
    expect(storedFirstBillHasPassed(new Date('2026-11-01T00:00:00Z'), new Date('2026-10-02T16:11:00Z'))).toBe(false)
  })
})
