import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']

// POST { pin } or { name } -> member card for the reception screen.
// Deliberately returns ONLY what the desk needs (no payments, no contact details).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const { pin, name } = await request.json().catch(() => ({}))

  let users: any[] = []
  if (pin && /^\d{4}$/.test(String(pin))) {
    const u = await prisma.user.findUnique({ where: { pin: String(pin) } })
    if (u) users = [u]
  } else if (name && String(name).trim().length >= 2) {
    const q = String(name).trim()
    const words = q.split(/\s+/)
    // single word -> match either field; multi-word ("suffian elahi") ->
    // also match first+last across words in either order
    const or: any[] = [
      { firstName: { contains: q, mode: 'insensitive' } },
      { lastName: { contains: q, mode: 'insensitive' } },
    ]
    if (words.length >= 2) {
      const a = words[0], b = words.slice(1).join(' ')
      or.push(
        { AND: [{ firstName: { contains: a, mode: 'insensitive' } }, { lastName: { contains: b, mode: 'insensitive' } }] },
        { AND: [{ firstName: { contains: b, mode: 'insensitive' } }, { lastName: { contains: a, mode: 'insensitive' } }] },
      )
    }
    users = await prisma.user.findMany({ where: { role: 'CUSTOMER', OR: or }, take: 8 })
  } else {
    return NextResponse.json({ error: 'Provide a 4-digit pin or a name' }, { status: 400 })
  }
  if (users.length === 0) return NextResponse.json({ members: [] })

  const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0)
  const members = []
  for (const u of users) {
    const sub = await prisma.subscription.findFirst({ where: { userId: u.id }, orderBy: { updatedAt: 'desc' } })
    const membership = await prisma.membership.findFirst({ where: { userId: u.id }, orderBy: { updatedAt: 'desc' } })
    const lastCheckin = await prisma.accessLog.findFirst({
      where: { userId: u.id, accessMethod: 'PIN_RECEPTION' },
      orderBy: { accessTime: 'desc' },
    })
    const todayCheckin = lastCheckin && lastCheckin.accessTime >= startOfDay ? lastCheckin : null
    members.push({
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.replace(/\s+/g, ' ').trim(),
      photo: u.profileImage || null,
      pin: u.pin,
      plan: membership?.membershipType || sub?.membershipType || null,
      price: Number(sub?.monthlyPrice ?? membership?.monthlyPrice ?? 0),
      status: sub?.status || membership?.status || 'NONE',
      lastVisit: lastCheckin ? lastCheckin.accessTime.toISOString() : null,
      checkedInToday: todayCheckin ? todayCheckin.accessTime.toISOString() : null,
    })
  }
  return NextResponse.json({ members })
}
