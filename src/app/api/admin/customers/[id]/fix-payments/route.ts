import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * 🎯 FIX PAYMENTS FOR A SINGLE CUSTOMER (SURGICAL)
 * - Validates against Stripe for the user's current customer/subscription
 * - If Stripe shows no paid invoices or successful charges, flips local
 *   prorated "confirmed" rows to FAILED
 * - Optionally aligns local sub/membership to Stripe status
 */
export async function POST(
  request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true }
    })
    if (!adminUser || !['ADMIN','SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const { id } = context.params
    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 },
        payments: { where: { status: 'CONFIRMED' } }
      }
    })
    if (!user) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })

    const sub = user.subscriptions[0]
    let stripeCustomerId: string | null = sub?.stripeCustomerId || null
    let stripeSubStatus: string | null = null
    let hasPaidInvoice = false

    if (stripeCustomerId) {
      try {
        // Check invoices paid
        const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 10 })
        hasPaidInvoice = invoices.data.some(inv => inv.status === 'paid')

        // Check subscription status if we have a real sub id
        if (sub?.stripeSubscriptionId && sub.stripeSubscriptionId.startsWith('sub_')) {
          const remoteSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId as string)
          stripeSubStatus = remoteSub.status
        }
      } catch {}
    }

    // If Stripe shows no PAID invoices, flip suspicious local payments
    let updatedPayments = 0
    if (!hasPaidInvoice) {
      const res = await prisma.payment.updateMany({
        where: {
          userId: user.id,
          status: 'CONFIRMED',
          OR: [
            { description: { contains: 'Initial subscription payment' } },
            { description: { contains: 'prorated' } }
          ]
        },
        data: {
          status: 'FAILED',
          failureReason: 'Manual fix: Stripe shows no paid invoice/charge',
          failedAt: new Date()
        }
      })
      updatedPayments = res.count
    }

    // Align local membership/subscription if Stripe indicates incomplete
    if (stripeSubStatus) {
      const normalized = stripeSubStatus.toUpperCase()
      const mappedMembership =
        normalized === 'PAUSED' ? 'SUSPENDED' :
        normalized === 'PAST_DUE' ? 'SUSPENDED' :
        normalized === 'INCOMPLETE' ? 'PENDING_PAYMENT' :
        normalized === 'INCOMPLETE_EXPIRED' ? 'PENDING_PAYMENT' :
        normalized === 'CANCELLED' ? 'CANCELLED' :
        'ACTIVE'

      await prisma.subscription.updateMany({ where: { userId: user.id }, data: { status: normalized } })
      await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: mappedMembership } })
    }

    return NextResponse.json({ success: true, updatedPayments, stripeSubStatus, hasPaidInvoice })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fix payments' }, { status: 500 })
  }
}

// Convenience: allow GET to perform the same action for easier console testing
export async function GET(request: NextRequest, context: { params: { id: string } }) {
  return POST(request, context)
}


