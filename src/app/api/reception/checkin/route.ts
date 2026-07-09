import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']

// POST { userId } -> record an attendance event (AccessLog)
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { userId } = await request.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })

  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })

  const log = await prisma.accessLog.create({
    data: {
      userId,
      accessMethod: 'PIN_RECEPTION',
      accessGranted: true,
      accessReason: `Checked in at reception (${sub?.status || 'NO_SUB'})`,
      location: 'Reception',
      membershipStatus: sub?.status || null,
    },
  })
  return NextResponse.json({ success: true, checkedInAt: log.accessTime.toISOString() })
}
