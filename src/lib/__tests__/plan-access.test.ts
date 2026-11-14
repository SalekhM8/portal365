import { describe, it, expect } from 'vitest'
import { planAllowedWeekdays, outsidePlanDays, ukWeekday, planAccessDays } from '@/lib/plan-access'

describe('plan-access day rules', () => {
  it('kids weekend plans allow Saturday and Sunday only; unlimited plans allow every day', () => {
    expect(planAllowedWeekdays('KIDS_WEEKEND_UNDER14')).toEqual([6, 0])
    expect(planAllowedWeekdays('MIG_KIDS_WEEKEND')).toEqual([6, 0])
    expect(planAllowedWeekdays('WEEKEND_CHILD')).toEqual([6, 0])
    expect(planAllowedWeekdays('WEEKEND_FEMALE_UNDER_16')).toEqual([5, 6, 0])
    expect(planAllowedWeekdays('Kids aged 4 to 6 only')).toEqual([0])
    expect(planAllowedWeekdays('KIDS_UNLIMITED_UNDER14')).toBeNull()
    expect(planAllowedWeekdays('FULL_ADULT')).toBeNull()
    expect(planAllowedWeekdays(null)).toBeNull()
  })

  it('adult weekend plans include Friday; female plans keep their existing days', () => {
    expect(planAllowedWeekdays('WEEKEND_ADULT')).toEqual([5, 6, 0])
    expect(planAllowedWeekdays('MIG_WEEKEND_55')).toEqual([5, 6, 0])
    expect(planAccessDays('WEEKEND_ADULT')).toBe('Fridays, Saturdays & Sundays')
    // Fri 13 Nov 2026 19:05 GMT — fine for an adult, flagged for a kid
    expect(outsidePlanDays('WEEKEND_ADULT', '2026-11-13T19:05:00Z')).toBeNull()
    expect(outsidePlanDays('KIDS_WEEKEND_UNDER14', '2026-11-13T19:05:00Z')).toBe('Friday visit on a saturdays & sundays plan')
    // Thursday is still outside for an adult weekend plan
    expect(outsidePlanDays('WEEKEND_ADULT', '2026-11-12T19:05:00Z')).toBe('Thursday visit on a fridays, saturdays & sundays plan')
    // untouched
    expect(planAllowedWeekdays('WEEKEND_FEMALE')).toEqual([6, 0])
    expect(planAllowedWeekdays('WOMENS_CLASSES')).toBeNull()
  })

  it('evaluates the weekday in UK time', () => {
    // 23:30 BST on Sunday 13 Sep 2026 is 22:30Z Sunday — still Sunday
    expect(ukWeekday('2026-09-13T22:30:00Z')).toBe(0)
    // 00:30 BST Monday 14 Sep is 23:30Z Sunday 13 Sep — Monday in the UK
    expect(ukWeekday('2026-09-13T23:30:00Z')).toBe(1)
  })

  it('flags a Kids Weekend member training on a Monday evening, with a readable reason', () => {
    // Mon 19 Oct 2026, 17:33 BST
    expect(outsidePlanDays('KIDS_WEEKEND_UNDER14', '2026-10-19T16:33:00Z')).toBe('Monday visit on a saturdays & sundays plan')
  })

  it('does not flag weekend visits on a weekend plan, or any day on an unlimited plan', () => {
    expect(outsidePlanDays('KIDS_WEEKEND_UNDER14', '2026-10-17T10:22:00Z')).toBeNull() // Saturday
    expect(outsidePlanDays('KIDS_WEEKEND_UNDER14', '2026-10-25T10:43:00Z')).toBeNull() // Sunday
    expect(outsidePlanDays('KIDS_UNLIMITED_UNDER14', '2026-10-19T16:33:00Z')).toBeNull()
    expect(outsidePlanDays(null, '2026-10-19T16:33:00Z')).toBeNull()
  })

  it('keeps the member-facing access line consistent with the day rule', () => {
    expect(planAccessDays('KIDS_WEEKEND_UNDER14')).toBe('Saturdays & Sundays')
  })
})
