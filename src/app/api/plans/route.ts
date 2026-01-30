import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const business = searchParams.get('business') // e.g., 'aura_mma' | 'aura_womens'
    const includeMigration = searchParams.get('includeMigration') === 'true' // Include migration-only plans

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
      preferredEntities: safeParseArray(r.preferredEntities),
      migrationOnly: r.migrationOnly
    }))

    // Filter by business if specified
    let filtered = business
      ? plans.filter(p => (p.preferredEntities || []).includes(business))
      : plans
    
    // For normal signups, exclude migration-only plans
    // For migration page (includeMigration=true), include everything
    if (!includeMigration) {
      filtered = filtered.filter(p => !p.migrationOnly)
    }

    // Cache plans for 5 minutes - they rarely change
    return NextResponse.json(
      { success: true, plans: filtered },
      {
        headers: {
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      }
    )
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Failed to load plans' }, { status: 500 })
  }
}

function safeParseArray(value: string | null): string[] {
  if (!value) return []
  try { return (JSON.parse(value) as string[]) || [] } catch { return [] }
}


