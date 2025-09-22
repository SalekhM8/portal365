import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * ADMIN: Delete local Payment rows by Stripe invoice id tag or by payment id.
 * - Does NOT touch Stripe (no refund/cancel)
 * - Use for cleaning up mis-attributed or duplicate local payments
 *
 * Body:
 *   {
 *     invoiceId?: string,   // Stripe invoice id (the [inv:...] tag in description)
 *     paymentId?: string,   // Direct local payment id
 *     userEmail?: string    // Optional: constrain by user
 *   }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role as any)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const invoiceId: string | undefined = body?.invoiceId
    const paymentId: string | undefined = body?.paymentId
    const userEmail: string | undefined = body?.userEmail

    if (!invoiceId && !paymentId) {
      return NextResponse.json({ error: 'Provide invoiceId or paymentId' }, { status: 400 })
    }

    if (paymentId) {
      const deleted = await prisma.payment.delete({ where: { id: paymentId } }).catch(() => null)
      return NextResponse.json({ success: true, deleted: deleted ? [deleted.id] : [] })
    }

    // invoiceId path
    const whereClause: any = {
      description: { contains: `[inv:${invoiceId}]` }
    }
    if (userEmail) whereClause.user = { email: userEmail }

    const candidates = await prisma.payment.findMany({ where: whereClause, select: { id: true } })
    if (candidates.length === 0) {
      return NextResponse.json({ success: true, deleted: [], note: 'No matching payments found' })
    }

    const del = await prisma.payment.deleteMany({ where: whereClause })
    return NextResponse.json({ success: true, deletedCount: del.count, deletedIds: candidates.map(c => c.id) })

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Delete failed' }, { status: 500 })
  }
}


