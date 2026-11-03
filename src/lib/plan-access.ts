// Single source of truth for the access line shown to customers.
//
// Deliberately dumb on purpose: derived from the plan key in code, never from
// the stored schedule blobs (MembershipPlan.schedulePolicy / Membership.scheduleAccess
// are stale — e.g. WEEKEND plans stored as all-week 00:00–24:00), so it cannot
// drift from what the plan actually is. Add a plan here if it ever needs a
// different line; unknown plans fall back on the WEEKEND rule then "every day".
const EXACT: Record<string, string> = {
  'KIDS AGED 4 TO 6 ONLY': 'Sundays, 4:30–5:15pm',
  'WEEKEND_FEMALE_UNDER_16': 'Fridays, Saturdays & Sundays',
  'PARENT_WEIGHT': 'Mon–Fri 5:00–6:30pm · Mon, Sat & Sun 10:00am–12:30pm',
}

export function planAccessDays(planKey: string | null | undefined): string {
  const key = (planKey || '').toUpperCase().trim()
  if (EXACT[key]) return EXACT[key]
  if (key.includes('WEEKEND')) return 'Saturdays & Sundays'
  return 'Every day of the week'
}

// ---------------------------------------------------------------------------
// Day rules for the desk. Same source of truth as the access line above (plan
// key, not the stale schedule blobs). null = every day is fine.
// Sunday = 0 … Saturday = 6 (JS convention), evaluated in UK local time.
// ---------------------------------------------------------------------------
const EXACT_DAYS: Record<string, number[]> = {
  'KIDS AGED 4 TO 6 ONLY': [0],
  'WEEKEND_FEMALE_UNDER_16': [5, 6, 0],
}

export function planAllowedWeekdays(planKey: string | null | undefined): number[] | null {
  const key = (planKey || '').toUpperCase().trim()
  if (EXACT_DAYS[key]) return EXACT_DAYS[key]
  if (key.includes('WEEKEND')) return [6, 0]
  return null
}

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

/** Day of week (0–6) of an instant in UK local time, so a 23:30 BST Sunday check-in is still Sunday. */
export function ukWeekday(at: Date | string | number = new Date()): number {
  const name = new Date(at).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'Europe/London' })
  const i = WEEKDAY_NAMES.indexOf(name)
  return i === -1 ? new Date(at).getDay() : i
}

/**
 * Is this visit on a day the plan does not include? e.g. a Kids Weekend member on a
 * Monday. Returns the human reason, or null when the day is fine (or the plan has no
 * day rule). Used to flag — never to block — so the desk makes the call.
 */
export function outsidePlanDays(planKey: string | null | undefined, at: Date | string | number = new Date()): string | null {
  const allowed = planAllowedWeekdays(planKey)
  if (!allowed) return null
  const day = ukWeekday(at)
  if (allowed.includes(day)) return null
  return `${WEEKDAY_NAMES[day]} visit on a ${planAccessDays(planKey).toLowerCase()} plan`
}
