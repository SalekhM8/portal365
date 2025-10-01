import { prisma } from '@/lib/prisma'
import { MEMBERSHIP_PLANS, type MembershipKey, type MembershipPlan as ConfigPlan } from '@/config/memberships'

export type SchedulePolicy = {
  timezone: string
  allowedWindows: Array<{ days: string[]; start: string; end: string; zones?: string[] }>
  exceptions?: Array<{ date: string; start?: string; end?: string; allow?: boolean }>
}

export type DbPlan = {
  key: string
  name: string
  displayName: string
  description: string
  monthlyPrice: number
  features: string[]
  schedulePolicy?: SchedulePolicy
  preferredEntities?: string[]
  stripeProductId?: string | null
  stripePriceIdActive?: string | null
}

export async function listPlansDbFirst(): Promise<DbPlan[]> {
  try {
    const rows = await prisma.membershipPlan.findMany({ where: { active: true } })
    if (!rows || rows.length === 0) return Object.values(MEMBERSHIP_PLANS)
    return rows.map(r => ({
      key: r.key,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      monthlyPrice: Number(r.monthlyPrice),
      features: safeParseArray(r.features),
      schedulePolicy: safeParseJson<SchedulePolicy | undefined>(r.schedulePolicy || undefined),
      preferredEntities: safeParseArray(r.preferredEntities),
      stripeProductId: r.stripeProductId,
      stripePriceIdActive: r.stripePriceIdActive
    }))
  } catch {
    return Object.values(MEMBERSHIP_PLANS)
  }
}

export async function getPlanDbFirst(key: string): Promise<DbPlan> {
  try {
    const row = await prisma.membershipPlan.findUnique({ where: { key } })
    if (row) {
      return {
        key: row.key,
        name: row.name,
        displayName: row.displayName,
        description: row.description,
        monthlyPrice: Number(row.monthlyPrice),
        features: safeParseArray(row.features),
        schedulePolicy: safeParseJson<SchedulePolicy | undefined>(row.schedulePolicy || undefined),
        preferredEntities: safeParseArray(row.preferredEntities),
        stripeProductId: row.stripeProductId,
        stripePriceIdActive: row.stripePriceIdActive
      }
    }
  } catch {}
  const cfg = MEMBERSHIP_PLANS[(key as MembershipKey)] as ConfigPlan | undefined
  if (!cfg) throw new Error(`Unknown membership plan: ${key}`)
  return cfg
}

function safeParseArray(value: string | null | undefined): string[] {
  if (!value) return []
  try { return (JSON.parse(value) as string[]) || [] } catch { return [] }
}

function safeParseJson<T>(value: string | undefined): T | undefined {
  if (!value) return undefined
  try { return JSON.parse(value) as T } catch { return undefined }
}
