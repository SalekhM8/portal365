import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Admin tool: record a prorated confirmed payment for a user, idempotent by (userId, amount, currency, pi)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { email, amount, currency = 'GBP', paymentIntentId, routedEntityId } = await request.json()
    if (!email || typeof amount !== 'number' || !paymentIntentId) {
      return NextResponse.json({ error: 'email, amount, paymentIntentId required' }, { status: 400 })
    }

    const user = await prisma.user.findUnique({ where: { email } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const existing = await prisma.payment.findFirst({
      where: {
        userId: user.id,
        status: 'CONFIRMED',
        amount,
        currency: currency.toUpperCase(),
        description: { contains: paymentIntentId }
      }
    })
    if (existing) return NextResponse.json({ success: true, paymentId: existing.id, message: 'Already recorded' })

    const subscription = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    const entityId = routedEntityId || subscription?.routedEntityId || ''

    const created = await prisma.payment.create({
      data: {
        userId: user.id,
        amount,
        currency: currency.toUpperCase(),
        status: 'CONFIRMED',
        description: `Initial subscription payment (prorated) [pi:${paymentIntentId}]`,
        routedEntityId: entityId,
        processedAt: new Date()
      }
    })

    return NextResponse.json({ success: true, paymentId: created.id })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Failed to record payment' }, { status: 500 })
  }
}


