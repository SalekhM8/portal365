import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

// Reconcile a single customer's latest failed payment after a successful retry in Stripe
// Usage: POST /api/admin/customers/[id]/sync-status  OR body { email }
// Admin only; safe and forward-only

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id?: string }> }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
    if (!admin || !(['ADMIN','SUPER_ADMIN'].includes(admin.role))) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const params = await context.params
    const body = await request.json().catch(() => ({} as any))
    const email: string | undefined = body?.email

    let user = null as any
    // Prefer email (explicit) when provided; otherwise fall back to path id
    if (email) {
      user = await prisma.user.findUnique({ where: { email } })
    } else if (params?.id) {
      user = await prisma.user.findUnique({ where: { id: params.id } })
    }
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Get latest subscription for Stripe customer ID
    const sub = await prisma.subscription.findFirst({ where: { userId: user.id }, orderBy: { createdAt: 'desc' } })
    if (!sub?.stripeCustomerId) return NextResponse.json({ error: 'No Stripe customer found for user' }, { status: 400 })

    // Find most recent paid invoice on Stripe
    const invoices = await stripe.invoices.list({ customer: sub.stripeCustomerId, limit: 10, status: 'paid' as any })
    const mostRecentPaid = invoices.data.sort((a,b) => (b.created || 0) - (a.created || 0))[0]
    if (!mostRecentPaid) return NextResponse.json({ error: 'No paid invoices found for this customer in Stripe' }, { status: 404 })

    const paidAmount = (mostRecentPaid.amount_paid || 0) / 100

    // Identify latest local FAILED payment that likely corresponds (same amount, within 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30*24*60*60*1000)
    const failed = await prisma.payment.findFirst({
      where: { userId: user.id, status: 'FAILED', amount: paidAmount, createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: 'desc' }
    })

    // If a CONFIRMED already exists for the same amount very recently, just return status
    const existingConfirmed = await prisma.payment.findFirst({
      where: { userId: user.id, status: 'CONFIRMED', amount: paidAmount, createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: 'desc' }
    })

    if (!failed) {
      return NextResponse.json({
        success: true,
        message: existingConfirmed ? 'Already confirmed in DB' : 'No matching failed payment found',
        invoiceId: mostRecentPaid.id,
        paidAmount
      })
    }

    // Flip FAILED to CONFIRMED and add context
    const updated = await prisma.payment.update({
      where: { id: failed.id },
      data: {
        status: 'CONFIRMED',
        failureReason: null,
        description: `${failed.description || 'Monthly membership payment'} • Resolved by ${mostRecentPaid.id}`,
        processedAt: new Date()
      }
    })

    // Ensure membership/subscription access reflects paid state
    await prisma.subscription.updateMany({ where: { userId: user.id }, data: { status: 'ACTIVE' } })
    await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: 'ACTIVE' } })

    return NextResponse.json({ success: true, updatedPaymentId: updated.id, invoiceId: mostRecentPaid.id, amount: paidAmount })
  } catch (e: any) {
    return NextResponse.json({ error: e.message || 'Sync failed' }, { status: 500 })
  }
}


