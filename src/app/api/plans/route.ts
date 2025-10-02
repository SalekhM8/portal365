import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const business = searchParams.get('business') // e.g., 'aura_mma' | 'aura_womens'

    const rows = await prisma.membershipPlan.findMany({
      where: { active: true },
      orderBy: { displayName: 'asc' }
    })

    const plans = rows.map(r => ({
      key: r.key,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      monthlyPrice: Number(r.monthlyPrice),
      features: safeParseArray(r.features),
      preferredEntities: safeParseArray(r.preferredEntities)
    }))

    const filtered = business
      ? plans.filter(p => (p.preferredEntities || []).includes(business))
      : plans

    return NextResponse.json({ success: true, plans: filtered })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to load plans' }, { status: 500 })
  }
}

function safeParseArray(value: string | null): string[] {
  if (!value) return []
  try { return (JSON.parse(value) as string[]) || [] } catch { return [] }
}


