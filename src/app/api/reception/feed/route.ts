import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']

// GET ?since=<accessLogId> — ultra-light live feed for the wall screen.
// Returns today's count + the newest few check-ins; `new` flags anything
// fresher than the caller's cursor so the screen knows to pop.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const since = request.nextUrl.searchParams.get('since') || ''
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0)

  const [count, latest] = await Promise.all([
    prisma.accessLog.count({ where: { accessMethod: 'PIN_RECEPTION', accessTime: { gte: dayStart } } }),
    prisma.accessLog.findMany({
      where: { accessMethod: 'PIN_RECEPTION', accessTime: { gte: dayStart } },
      orderBy: { accessTime: 'desc' },
      take: 8,
      include: { user: { select: { firstName: true, lastName: true, profileImage: true } } },
    }),
  ])
  const entries = latest.map(l => ({
    id: l.id,
    time: l.accessTime.toISOString(),
    name: `${l.user.firstName} ${l.user.lastName}`.replace(/\s+/g, ' ').trim(),
    photo: l.user.profileImage || null,
    status: l.membershipStatus || '-',
  }))
  const newest = entries[0]?.id || ''
  return NextResponse.json({ count, entries, newest, hasNew: !!newest && newest !== since && since !== '' })
}
