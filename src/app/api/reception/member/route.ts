import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { effectiveMemberStatus } from '@/lib/member-status'
import { planAccessDays, planAllowedWeekdays, ukWeekday } from '@/lib/plan-access'

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
  const { status, isOfflinePackage: isOffline } = effectiveMemberStatus(sub, membership)
  const plan = membership?.membershipType || sub?.membershipType || null
  const since30 = new Date(Date.now() - 30 * 24 * 3600 * 1000)
  const since90 = new Date(Date.now() - 90 * 24 * 3600 * 1000)
  const [recent90, visitsTotal, first, last] = await Promise.all([
    prisma.accessLog.findMany({ where: { userId, accessMethod: 'PIN_RECEPTION', accessTime: { gte: since90 } }, select: { accessTime: true } }),
    prisma.accessLog.count({ where: { userId, accessMethod: 'PIN_RECEPTION' } }),
    prisma.accessLog.findFirst({ where: { userId, accessMethod: 'PIN_RECEPTION' }, orderBy: { accessTime: 'asc' }, select: { accessTime: true } }),
    prisma.accessLog.findFirst({ where: { userId, accessMethod: 'PIN_RECEPTION' }, orderBy: { accessTime: 'desc' }, select: { accessTime: true } }),
  ])
  const allowed = planAllowedWeekdays(plan)
  const recent30 = recent90.filter(r => r.accessTime >= since30)
  const offPlan30 = allowed ? recent30.filter(r => !allowed.includes(ukWeekday(r.accessTime))).length : 0
  return NextResponse.json({
    member: {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`.replace(/\s+/g, ' ').trim(),
      photo: u.profileImage || null,
      pin: u.pin || null,
      plan,
      status,
      allowedDays: planAccessDays(plan),
      attendance: { visits30: recent30.length, visits90: recent90.length, visitsTotal, offPlanVisits30: offPlan30, firstVisit: first?.accessTime.toISOString() || null, lastVisit: last?.accessTime.toISOString() || null },
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
