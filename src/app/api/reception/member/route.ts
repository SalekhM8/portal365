import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']

// GET ?userId= — desk-side member details for the check-in peek panel.
export async function GET(request: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const u = await prisma.user.findUnique({ where: { id: userId } })
  if (!u) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sub = await prisma.subscription.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  const membership = await prisma.membership.findFirst({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  let ec: any = {}
  try { ec = u.emergencyContact ? JSON.parse(u.emergencyContact) : {} } catch {}
  const isOffline = !sub && !!membership?.endDate
  let status = sub?.status || membership?.status || 'NONE'
  if (isOffline) status = membership!.endDate! >= new Date() ? 'ACTIVE' : 'EXPIRED'
  return NextResponse.json({
    member: {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.replace(/\s+/g, ' ').trim(),
      photo: u.profileImage || null,
      pin: u.pin || null,
      plan: membership?.membershipType || sub?.membershipType || null,
      status,
      packageEnd: isOffline ? membership!.endDate!.toISOString().slice(0, 10) : null,
      phone: u.phone || null,
      email: /@child\.local$|@member\.local$|@local$/.test(u.email) ? null : u.email,
      dateOfBirth: u.dateOfBirth ? u.dateOfBirth.toISOString().slice(0, 10) : null,
      address: ec?.addressInfo?.address || null,
      postcode: ec?.addressInfo?.postcode || null,
      emergency: ec?.name ? { name: ec.name, phone: ec.phone || null, relationship: ec.relationship || null } : null,
    },
  })
}
