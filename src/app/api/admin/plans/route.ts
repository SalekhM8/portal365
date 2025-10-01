import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { isPlansAdminEnabled } from '@/lib/flags'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  try {
    if (!isPlansAdminEnabled()) {
      return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
    }
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.role || !['ADMIN','SUPER_ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const rows = await prisma.membershipPlan.findMany({ orderBy: { displayName: 'asc' } })
    const plans = rows.map(r => ({
      key: r.key,
      name: r.name,
      displayName: r.displayName,
      description: r.description,
      monthlyPrice: Number(r.monthlyPrice),
      features: safeParse(r.features),
      schedulePolicy: safeParse(r.schedulePolicy),
      preferredEntities: safeParse(r.preferredEntities),
      active: r.active,
      stripeProductId: r.stripeProductId,
      stripePriceIdActive: r.stripePriceIdActive
    }))
    return NextResponse.json({ success: true, plans })
  } catch (e) {
    return NextResponse.json({ error: 'Failed to load plans' }, { status: 500 })
  }
}

function safeParse(value: string | null): any {
  if (!value) return null
  try { return JSON.parse(value) } catch { return null }
}

export async function POST(req: NextRequest) {
  try {
    if (!isPlansAdminEnabled()) return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.role || !['ADMIN','SUPER_ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json()
    const {
      key,
      name,
      displayName,
      description,
      monthlyPrice,
      features = [],
      schedulePolicy,
      preferredEntities = [],
      active = true
    } = body || {}

    if (!key || !name || !displayName || typeof monthlyPrice !== 'number') {
      return NextResponse.json({ error: 'Validation failed' }, { status: 400 })
    }

    const created = await prisma.membershipPlan.create({
      data: {
        key,
        name,
        displayName,
        description: description || '',
        monthlyPrice,
        features: JSON.stringify(Array.isArray(features) ? features : []),
        schedulePolicy: schedulePolicy ? JSON.stringify(schedulePolicy) : null,
        preferredEntities: JSON.stringify(Array.isArray(preferredEntities) ? preferredEntities : []),
        active
      }
    })

    return NextResponse.json({ success: true, plan: created })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create plan' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  try {
    if (!isPlansAdminEnabled()) return NextResponse.json({ error: 'Not enabled' }, { status: 404 })
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.role || !['ADMIN','SUPER_ADMIN'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const body = await req.json()
    const { key, update } = body || {}

    if (!key || !update) return NextResponse.json({ error: 'Validation failed' }, { status: 400 })

    const data: any = {}
    if (typeof update.name === 'string') data.name = update.name
    if (typeof update.displayName === 'string') data.displayName = update.displayName
    if (typeof update.description === 'string') data.description = update.description
    if (typeof update.monthlyPrice === 'number') data.monthlyPrice = update.monthlyPrice
    if (Array.isArray(update.features)) data.features = JSON.stringify(update.features)
    if (update.schedulePolicy) data.schedulePolicy = JSON.stringify(update.schedulePolicy)
    if (Array.isArray(update.preferredEntities)) data.preferredEntities = JSON.stringify(update.preferredEntities)
    if (typeof update.active === 'boolean') data.active = update.active
    if (typeof update.stripeProductId === 'string') data.stripeProductId = update.stripeProductId
    if (typeof update.stripePriceIdActive === 'string') data.stripePriceIdActive = update.stripePriceIdActive

    const updated = await prisma.membershipPlan.update({ where: { key }, data })
    return NextResponse.json({ success: true, plan: updated })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update plan' }, { status: 500 })
  }
}


