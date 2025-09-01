import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * Admin endpoint to rename BusinessEntity display names.
 * Body: { changes: Array<{ match: { id?: string; name?: string; displayName?: string }, displayName: string }> }
 * If no body is provided, defaults to renaming displayName 'Aura MMA' -> 'Sporting U'.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const changes = Array.isArray(body?.changes) && body.changes.length > 0
      ? body.changes
      : [{ match: { displayName: 'Aura MMA' }, displayName: 'Sporting U' }]

    const results: any[] = []
    for (const ch of changes) {
      const where: any = ch.match?.id
        ? { id: ch.match.id }
        : ch.match?.name
          ? { name: ch.match.name }
          : ch.match?.displayName
            ? { displayName: ch.match.displayName }
            : null
      if (!where) { results.push({ ok:false, error:'invalid_match' }); continue }

      const updated = await prisma.businessEntity.updateMany({ where, data: { displayName: ch.displayName } })
      results.push({ ok:true, count: updated.count, where, displayName: ch.displayName })
    }

    return NextResponse.json({ success: true, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to update business names' }, { status: 500 })
  }
}


