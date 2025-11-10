export type PlanMapResult = { planKey: 'FULL_ADULT'|'KIDS_UNLIMITED_UNDER14'|'KIDS_WEEKEND_UNDER14'|'WEEKEND_ADULT'|'WOMENS_CLASSES' } | null

export function inferPlanKeyFromDescription(desc?: string | null): PlanMapResult {
  if (!desc) return null
  const d = desc.toLowerCase()
  if (d.includes('unlimited adults')) return { planKey: 'FULL_ADULT' }
  if (d.includes('unlimited kids')) return { planKey: 'KIDS_UNLIMITED' as any } // backward compat
  if (d.includes('weekends only') && d.includes('kids')) return { planKey: 'KIDS_WEEKEND_UNDER14' }
  if (d.includes('weekend exclusive')) return { planKey: 'WEEKEND_ADULT' }
  if (d.includes('female only')) return { planKey: 'WOMENS_CLASSES' }
  return null
}

export function normalizePlanKey(k: string): any {
  if (k === 'KIDS_UNLIMITED') return 'KIDS_UNLIMITED_UNDER14'
  return k
}


