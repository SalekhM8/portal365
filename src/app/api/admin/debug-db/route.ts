import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

function parseHostAndDb(raw?: string | null) {
  if (!raw) return { host: null, db: null, scheme: null }
  try {
    // Handle prisma+postgres scheme by normalizing for URL parser
    const norm = raw.replace(/^prisma\+postgres/, 'postgres')
    const u = new URL(norm)
    const pathname = (u.pathname || '').replace(/^\//, '')
    return { host: u.hostname, db: pathname || null, scheme: raw.split(':')[0] }
  } catch {
    return { host: null, db: null, scheme: raw.split(':')[0] }
  }
}

export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams
    const token = search.get('token') || req.headers.get('x-debug-token')
    const expected = process.env.DEBUG_TOKEN || process.env.ADMIN_DEBUG_TOKEN
    if (!expected || token !== expected) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const selected = process.env.DB_OVERRIDE_URL
      ? 'DB_OVERRIDE_URL'
      : (process.env.PRISMA_DATABASE_URL ? 'PRISMA_DATABASE_URL' : 'DATABASE_URL')

    const rawUrl = selected === 'DB_OVERRIDE_URL'
      ? process.env.DB_OVERRIDE_URL
      : selected === 'PRISMA_DATABASE_URL'
      ? process.env.PRISMA_DATABASE_URL
      : process.env.DATABASE_URL

    const meta = parseHostAndDb(rawUrl || null)

    // Lightweight counts to confirm which DB we are hitting
    const [users, memberships, subscriptions, payments] = await Promise.all([
      prisma.user.count(),
      prisma.membership.count(),
      prisma.subscription.count(),
      prisma.payment.count()
    ])

    return NextResponse.json({
      ok: true,
      selectedEnvVar: selected,
      scheme: meta.scheme,
      host: meta.host,
      database: meta.db,
      sample: rawUrl ? rawUrl.slice(0, 24) + '…' : null,
      counts: { users, memberships, subscriptions, payments }
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'debug failed' }, { status: 500 })
  }
}


