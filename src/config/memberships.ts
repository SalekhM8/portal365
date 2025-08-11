export type MembershipKey =
  | 'WEEKEND_ADULT'
  | 'WEEKEND_UNDER18'
  | 'FULL_ADULT'
  | 'FULL_UNDER18'
  | 'PERSONAL_TRAINING'
  | 'WOMENS_CLASSES'
  | 'WELLNESS_PACKAGE'

export interface MembershipPlan {
  key: MembershipKey
  name: string
  displayName: string
  monthlyPrice: number
  description: string
  features: string[]
  // Preferred entity names by business routing intent
  preferredEntities?: string[] // e.g., ['aura_mma']
}

export const MEMBERSHIP_PLANS: Record<MembershipKey, MembershipPlan> = {
  WEEKEND_ADULT: {
    key: 'WEEKEND_ADULT',
    name: 'Weekend Adult',
    displayName: 'Weekend Warrior',
    monthlyPrice: 55,
    description: 'Perfect for busy schedules',
    features: ['Weekend access (Fri, Sat & Sun)', 'BJJ, MMA, Boxing, Muay Thai', 'Equipment access', 'No contract'],
    preferredEntities: ['aura_mma']
  },
  WEEKEND_UNDER18: {
    key: 'WEEKEND_UNDER18',
    name: 'Weekend Youth',
    displayName: 'Weekend Youth',
    monthlyPrice: 40,
    description: 'For young warriors under 18',
    features: ['Weekend access (Fri, Sat & Sun)', 'Youth martial arts classes', 'Equipment access', 'Parental updates'],
    preferredEntities: ['aura_mma']
  },
  FULL_ADULT: {
    key: 'FULL_ADULT',
    name: 'Full Adult Access',
    displayName: 'Full Access',
    monthlyPrice: 75,
    description: 'Complete training freedom',
    features: ['7 days/week access', 'All martial arts classes', 'Equipment access', 'Priority access', 'Guest passes'],
    preferredEntities: ['aura_mma']
  },
  FULL_UNDER18: {
    key: 'FULL_UNDER18',
    name: 'Full Youth Access',
    displayName: 'Full Youth Access',
    monthlyPrice: 55,
    description: 'Complete youth program',
    features: ['7 days/week access', 'Youth martial arts classes', 'Equipment access', 'Mentorship program'],
    preferredEntities: ['aura_mma']
  },
  PERSONAL_TRAINING: {
    key: 'PERSONAL_TRAINING',
    name: 'Personal Training',
    displayName: 'Monthly Sessions',
    monthlyPrice: 120,
    description: '4 sessions per month',
    features: ['1-on-1 personal training', '4 sessions monthly', 'Nutrition guidance', 'Technique refinement'],
    preferredEntities: ['aura_tuition']
  },
  WOMENS_CLASSES: {
    key: 'WOMENS_CLASSES',
    name: "Women's Classes",
    displayName: "Women's Program",
    monthlyPrice: 25,
    description: 'Women-only fitness space',
    features: ['Women-only classes', 'Self-defense training', 'Supportive community', 'Specialized programs'],
    preferredEntities: ['aura_womens']
  },
  WELLNESS_PACKAGE: {
    key: 'WELLNESS_PACKAGE',
    name: 'Wellness Package',
    displayName: 'Wellness Package',
    monthlyPrice: 95,
    description: 'Recovery & wellness services',
    features: ['Massage therapy', 'Mental health support', 'Recovery sessions', 'Wellness workshops'],
    preferredEntities: ['aura_wellness']
  }
}

export function getPlan(key: string): MembershipPlan {
  const plan = MEMBERSHIP_PLANS[key as MembershipKey]
  if (!plan) throw new Error(`Unknown membership plan: ${key}`)
  return plan
} 