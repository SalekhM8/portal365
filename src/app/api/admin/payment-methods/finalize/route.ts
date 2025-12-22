import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

// Finalize admin PM update: set customer's default_payment_method from a succeeded SetupIntent
// POST body: { account: 'SU' | 'IQ' | 'AURA', setupIntentId: string, stripeCustomerId: string }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['ADMIN', 'SUPER_ADMIN', 'STAFF'].includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { account, setupIntentId, stripeCustomerId } = await request.json()
    if (!setupIntentId || !stripeCustomerId) return NextResponse.json({ error: 'setupIntentId and stripeCustomerId required' }, { status: 400 })

    const acct = (account || 'SU') as StripeAccountKey
    const stripe = getStripeClient(acct)

    const si = await stripe.setupIntents.retrieve(setupIntentId)
    if (si.status !== 'succeeded') return NextResponse.json({ error: 'SetupIntent not succeeded' }, { status: 400 })
    const pm = si.payment_method as string
    await stripe.customers.update(stripeCustomerId, { invoice_settings: { default_payment_method: pm } })

    // Try to pay newest open overdue invoice immediately (parity with customer flow)
    try {
      const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 5 })
      const openOverdue = invoices.data.find(i => i.status === 'open' || i.status === 'uncollectible' || i.status === 'draft')
      if (openOverdue && openOverdue.id && openOverdue.status === 'open') {
        try { await stripe.invoices.pay(openOverdue.id as string) } catch {}
      }
    } catch {}

    return NextResponse.json({ success: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to finalize payment method' }, { status: 500 })
  }
}


