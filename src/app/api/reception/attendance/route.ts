import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']

// GET ?date=YYYY-MM-DD -> that day's attendance list (defaults to today)
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const dateStr = request.nextUrl.searchParams.get('date')
  const day = dateStr ? new Date(dateStr + 'T00:00:00') : new Date(new Date().setHours(0, 0, 0, 0))
  const next = new Date(day.getTime() + 24 * 3600 * 1000)

  const logs = await prisma.accessLog.findMany({
    where: { accessMethod: 'PIN_RECEPTION', accessTime: { gte: day, lt: next } },
    orderBy: { accessTime: 'desc' },
    include: { user: { select: { firstName: true, lastName: true, profileImage: true } } },
  })
  return NextResponse.json({
    date: day.toISOString().slice(0, 10),
    count: logs.length,
    entries: logs.map(l => ({
      time: l.accessTime.toISOString(),
      name: `${l.user.firstName} ${l.user.lastName}`.replace(/\s+/g, ' ').trim(),
      photo: l.user.profileImage || null,
      status: l.membershipStatus || '-',
    })),
  })
}
