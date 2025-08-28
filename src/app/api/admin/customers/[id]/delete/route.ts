import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role as any)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = await context.params
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: true,
        invoices: true,
        payments: true,
        memberships: true,
      }
    }) as any
    if (!user) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const hasActiveLike = user.subscriptions.some((s: any) => ['ACTIVE','TRIALING','PAST_DUE','PAUSED'].includes(s.status))
    const hasPaidInvoice = (user.invoices || []).some((inv: any) => inv.status === 'paid')
    const hasConfirmedPayment = (user.payments || []).some((p: any) => p.status === 'CONFIRMED')

    if (hasActiveLike || hasPaidInvoice || hasConfirmedPayment) {
      return NextResponse.json({ error: 'Cannot delete customer with active subscriptions or confirmed payments' }, { status: 400 })
    }

    await prisma.$transaction(async (tx) => {
      await tx.payment.deleteMany({ where: { userId: id, status: { in: ['FAILED','PENDING'] } } })
      await tx.invoice.deleteMany({ where: { subscription: { userId: id }, status: { in: ['open','void','draft','uncollectible'] } } })
      await tx.subscription.deleteMany({ where: { userId: id } })
      await tx.membership.deleteMany({ where: { userId: id } })
      await tx.user.delete({ where: { id } })
    })

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to delete customer' }, { status: 500 })
  }
}


