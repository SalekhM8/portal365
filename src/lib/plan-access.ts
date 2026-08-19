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
