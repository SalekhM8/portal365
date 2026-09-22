import { describe, it, expect } from 'vitest'
import { packageEndFor } from '@/lib/package-handover'

describe('packageEndFor', () => {
  it('a package starting on the 1st ends on the last day of its final month', () => {
    expect(packageEndFor(new Date('2026-10-01T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-03-31')
    expect(packageEndFor(new Date('2026-10-01T00:00:00Z'), 12).toISOString().slice(0, 10)).toBe('2027-09-30')
    expect(packageEndFor(new Date('2026-09-01T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-02-28')
  })
  it('a mid-month start keeps its day of month', () => {
    expect(packageEndFor(new Date('2026-09-21T00:00:00Z'), 6).toISOString().slice(0, 10)).toBe('2027-03-21')
  })
})
