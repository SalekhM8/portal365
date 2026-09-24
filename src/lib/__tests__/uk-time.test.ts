import { describe, it, expect } from 'vitest'
import { ukDateTime, ukDate } from '@/lib/uk-time'
describe('uk-time', () => {
  it('renders summer timestamps in BST with the label', () => {
    expect(ukDateTime('2026-09-24T10:57:17.000Z')).toBe('24/09/2026, 11:57 BST')
  })
  it('renders winter timestamps in GMT with the label', () => {
    expect(ukDateTime('2026-12-01T10:57:17.000Z')).toBe('01/12/2026, 10:57 GMT')
  })
  it('date-only rolls over at UK midnight, not UTC midnight', () => {
    expect(ukDate('2026-09-23T23:30:00.000Z')).toBe('24/09/2026')
  })
})
