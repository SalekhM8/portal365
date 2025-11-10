import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

// Create a SetupIntent for admin to update a customer's default payment method (no member login needed)
// POST body: { account: 'SU' | 'IQ', stripeCustomerId: string }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Require admin/staff roles
    if (!['ADMIN', 'SUPER_ADMIN', 'STAFF'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { account, stripeCustomerId } = await request.json()
    const acct = (account || 'SU') as StripeAccountKey
    const stripe = getStripeClient(acct)

    if (!stripeCustomerId) {
      return NextResponse.json({ error: 'stripeCustomerId required' }, { status: 400 })
    }

    const setup = await stripe.setupIntents.create({
      customer: stripeCustomerId,
      usage: 'off_session',
      metadata: { reason: 'admin_pm_update', account: acct }
    })

    return NextResponse.json({ success: true, clientSecret: setup.client_secret })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to create setup intent' }, { status: 500 })
  }
}


