import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ key: string }> }
) {
  try {
    const { key } = await context.params
    const row = await prisma.membershipPlan.findUnique({ where: { key } })
    if (!row) return NextResponse.json({ success: false, error: 'Plan not found' }, { status: 404 })
    const plan = {
      key: row.key,
      name: row.name,
      displayName: row.displayName,
      description: row.description,
      monthlyPrice: Number(row.monthlyPrice),
      features: safeParseArray(row.features),
      schedulePolicy: safeParse(row.schedulePolicy),
      preferredEntities: safeParseArray(row.preferredEntities)
    }
    return NextResponse.json({ success: true, plan })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to load plan' }, { status: 500 })
  }
}

function safeParseArray(v: string | null): string[] {
  if (!v) return []
  try { return (JSON.parse(v) as string[]) || [] } catch { return [] }
}
function safeParse<T = any>(v: string | null): T | null {
  if (!v) return null
  try { return JSON.parse(v) as T } catch { return null }
}


