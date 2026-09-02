import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// POST — immediately end an offline (cash) package. Sets endDate to yesterday
// so the member derives EXPIRED everywhere (admin card, door, kiosk) at once.
// No money involved: cash packages have no Stripe billing to cancel.
export async function POST(_request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id: customerId } = await context.params
  const membership = await prisma.membership.findFirst({ where: { userId: customerId, endDate: { not: null } }, orderBy: { createdAt: 'desc' } })
  if (!membership) return NextResponse.json({ error: 'No package membership found for this customer' }, { status: 404 })

  // Guard: this endpoint is for offline members only — never touch someone with live Stripe billing
  const liveSub = await prisma.subscription.findFirst({ where: { userId: customerId, status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'PAST_DUE'] } }, select: { id: true } })
  if (liveSub) return NextResponse.json({ error: 'This member has live Stripe billing — use Cancel Membership instead' }, { status: 400 })

  const yesterday = new Date(Date.now() - 86400000)
  const previousEnd = membership.endDate!
  await prisma.membership.update({ where: { id: membership.id }, data: { endDate: yesterday, nextBillingDate: yesterday } })

  const sub = await prisma.subscription.findFirst({ where: { userId: customerId } })
  if (sub) await prisma.subscriptionAuditLog.create({ data: { subscriptionId: sub.id, action: 'PACKAGE_ENDED', performedBy: admin.id, performedByName: `${admin.firstName} ${admin.lastName}`, reason: 'Offline package ended early by admin', operationId: `end_pkg_${membership.id}_${Date.now()}`, metadata: JSON.stringify({ membershipId: membership.id, previousEndDate: previousEnd.toISOString().slice(0, 10) }) } }).catch(() => {})

  return NextResponse.json({ success: true, message: 'Package ended — member now shows as expired and the door will block them.' })
}
