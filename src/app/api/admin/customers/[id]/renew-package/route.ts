import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST { months } — extend an offline package membership by N months.
// New term runs from the current end date if still active, else from today.
export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: customerId } = await context.params
  const { months } = await request.json().catch(() => ({}))
  if (!Number.isInteger(months) || months < 1 || months > 24) return NextResponse.json({ error: 'months (1-24) required' }, { status: 400 })

  const membership = await prisma.membership.findFirst({ where: { userId: customerId, endDate: { not: null } }, orderBy: { createdAt: 'desc' } })
  if (!membership) return NextResponse.json({ error: 'No package membership found for this customer' }, { status: 404 })

  const now = new Date()
  const base = membership.endDate && membership.endDate > now ? membership.endDate : now
  const newEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, base.getUTCDate()))
  await prisma.membership.update({ where: { id: membership.id }, data: { endDate: newEnd, status: 'ACTIVE', nextBillingDate: newEnd } })

  const sub = await prisma.subscription.findFirst({ where: { userId: customerId } })
  if (sub) await prisma.subscriptionAuditLog.create({ data: { subscriptionId: sub.id, action: 'PACKAGE_RENEWED', performedBy: admin.id, performedByName: `${admin.firstName} ${admin.lastName}`, reason: `Offline package renewed ${months} months (cash)`, operationId: `renew_pkg_${membership.id}_${Date.now()}`, metadata: JSON.stringify({ membershipId: membership.id, months, newEndDate: newEnd.toISOString().slice(0, 10) }) } }).catch(() => {})

  return NextResponse.json({ success: true, message: `Package renewed — now runs until ${newEnd.toISOString().slice(0, 10)}.`, endDate: newEnd.toISOString().slice(0, 10) })
}
