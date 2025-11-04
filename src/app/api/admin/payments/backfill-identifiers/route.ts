import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

function hasTag(desc: string | null | undefined, tag: 'pi' | 'inv'): boolean {
  if (!desc) return false
  return new RegExp(`\\[${tag}:[^\\]]+\\]`).test(desc)
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({} as any))
    const sinceIso: string | undefined = body?.sinceIso
    const userEmail: string | undefined = body?.userEmail
    const limit: number = typeof body?.limit === 'number' ? Math.max(1, Math.min(500, body.limit)) : 100

    const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)

    // Fetch candidate payments missing tags (filter again in code for safety)
    const where: any = {
      status: 'CONFIRMED',
      createdAt: { gte: since },
      amount: { gt: 0 }
    }
    if (userEmail) where.user = { email: userEmail }

    const candidates = await prisma.payment.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
      include: { user: { select: { id: true, email: true } } }
    })

    const results: Array<{ id: string; addedPi?: string | null; addedInv?: string | null; note?: string }>
      = []

    for (const p of candidates) {
      const hasPi = hasTag(p.description, 'pi')
      const hasInv = hasTag(p.description, 'inv')
      if (hasPi && hasInv) { results.push({ id: p.id, note: 'already_tagged' }); continue }
      if (p.goCardlessPaymentId) { results.push({ id: p.id, note: 'non_stripe' }); continue }

      const sub = await prisma.subscription.findFirst({ where: { userId: p.userId }, orderBy: { createdAt: 'desc' } })
      const stripeCustomerId = sub?.stripeCustomerId
      if (!stripeCustomerId) { results.push({ id: p.id, note: 'no_customer' }); continue }

      const targetTs = p.processedAt || p.createdAt
      const targetMinor = Math.round(Number(p.amount) * 100)
      let resolvedInv: string | null = null
      let resolvedPi: string | null = null

      try {
        const ts = Math.floor(new Date(targetTs).getTime() / 1000)
        const invList: any = await stripe.invoices.list({ customer: stripeCustomerId, status: 'paid', created: { gte: ts - 60 * 24 * 60 * 60, lte: ts + 60 * 24 * 60 * 60 }, limit: 100 })
        const candidatesInv = invList.data.filter((inv: any) => Number(inv.amount_paid || 0) === targetMinor)
        if (candidatesInv.length) {
          const best = candidatesInv.reduce((a: any, b: any) => {
            const aTs = (a.status_transitions?.paid_at || a.created) * 1000
            const bTs = (b.status_transitions?.paid_at || b.created) * 1000
            return Math.abs(aTs - Number(targetTs)) <= Math.abs(bTs - Number(targetTs)) ? a : b
          })
          resolvedInv = best.id
          resolvedPi = (best as any).payment_intent || null
        }
      } catch {}

      if (!resolvedPi) {
        try {
          const ts = Math.floor(new Date(targetTs).getTime() / 1000)
          const chList: any = await stripe.charges.list({ customer: stripeCustomerId, created: { gte: ts - 60 * 24 * 60 * 60, lte: ts + 60 * 24 * 60 * 60 }, limit: 100 })
          const ch = chList.data.find((c: any) => Number(c.amount || 0) === targetMinor)
          if (ch) {
            resolvedPi = (ch as any).payment_intent || null
          }
        } catch {}
      }

      if (!resolvedPi && !resolvedInv) { results.push({ id: p.id, note: 'not_found' }); continue }

      const descBase = p.description || 'Monthly membership payment'
      const withInv = (resolvedInv && !hasInv) ? `${descBase} [inv:${resolvedInv}]` : descBase
      const withPi = (resolvedPi && !hasPi) ? `${withInv} [pi:${resolvedPi}]` : withInv
      try {
        if (withPi !== p.description) {
          await prisma.payment.update({ where: { id: p.id }, data: { description: withPi } })
        }
        results.push({ id: p.id, addedPi: resolvedPi || null, addedInv: resolvedInv || null })
      } catch {
        results.push({ id: p.id, note: 'update_failed' })
      }
    }

    return NextResponse.json({ success: true, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Backfill failed' }, { status: 500 })
  }
}


