import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

// Return a hosted payment link for the latest open or action_required invoice
// POST body: { account: 'SU' | 'IQ', stripeCustomerId: string }
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['ADMIN', 'SUPER_ADMIN', 'STAFF'].includes(session.user.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { account, stripeCustomerId } = await request.json()
    const acct = (account || 'SU') as StripeAccountKey
    const stripe = getStripeClient(acct)

    if (!stripeCustomerId) return NextResponse.json({ error: 'stripeCustomerId required' }, { status: 400 })

    const invoices = await stripe.invoices.list({ customer: stripeCustomerId, limit: 10 })
    // Prefer open invoices; else pick the most recent with hosted link
    const candidate = invoices.data.find(i => i.status === 'open') || invoices.data[0]

    const hosted = (candidate as any)?.hosted_invoice_url || null
    if (!hosted) return NextResponse.json({ success: false, error: 'No hosted invoice link found' }, { status: 404 })

    return NextResponse.json({ success: true, hostedInvoiceUrl: hosted, invoiceId: candidate?.id })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to fetch hosted invoice link' }, { status: 500 })
  }
}


