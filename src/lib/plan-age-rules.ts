// Age eligibility for age-banded plans, derived from the plan key/name.
// Returns null when a plan has no age rule.
export function planAgeRule(planKey: string): { min?: number; max?: number } | null {
  const k = (planKey || '').toUpperCase()
  if (k.includes('AGED 4 TO 6') || k.includes('4 TO 6')) return { min: 4, max: 6 }
  let m
  if ((m = k.match(/UNDER_?(\d{1,2})/))) return { max: Number(m[1]) - 1 }
  if ((m = k.match(/\bU(\d{2})\b/)) || (m = k.match(/_U(\d{2})/))) return { max: Number(m[1]) - 1 }
  if ((m = k.match(/(\d{1,2})_PLUS/))) return { min: Number(m[1]) }
  if ((m = k.match(/(\d{1,2})_(\d{1,2})(?:_|$)/)) && Number(m[1]) < Number(m[2]) && Number(m[2]) <= 30) return { min: Number(m[1]), max: Number(m[2]) }
  return null
}

export function ageOn(dob: Date, on: Date = new Date()): number {
  let age = on.getUTCFullYear() - dob.getUTCFullYear()
  const md = on.getUTCMonth() - dob.getUTCMonth()
  if (md < 0 || (md === 0 && on.getUTCDate() < dob.getUTCDate())) age--
  return age
}

/** Human message if the child's age doesn't fit the plan; null if fine. */
export function ageMismatchMessage(planKey: string, dob: Date | null | undefined): string | null {
  const rule = planAgeRule(planKey)
  if (!rule) return null
  if (!dob) return 'This plan has an age limit — please enter the date of birth.'
  const age = ageOn(dob)
  if (rule.min != null && age < rule.min) return `This plan is for ages ${rule.min}${rule.max != null ? `–${rule.max}` : '+'} — this child is ${age}.`
  if (rule.max != null && age > rule.max) return `This plan is for ${rule.min != null ? `ages ${rule.min}–${rule.max}` : `under ${rule.max + 1}s`} — this child is ${age}.`
  return null
}
