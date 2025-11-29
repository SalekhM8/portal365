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
type DuplicateRequest = {
  email?: string
  date?: string
}

function dayBounds(dateIso: string): { start: Date; end: Date } {
  const base = new Date(dateIso)
  if (isNaN(base.getTime())) throw new Error('Invalid date')
  const start = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 0, 0, 0))
  const end = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), 23, 59, 59, 999))
  return { start, end }
}

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
    const duplicates: DuplicateRequest[] = Array.isArray(body?.duplicates) ? body.duplicates : []

    if (!invoiceId && !paymentId && duplicates.length === 0) {
      return NextResponse.json({ error: 'Provide invoiceId, paymentId, or duplicates[]' }, { status: 400 })
    }

    if (paymentId) {
      const deleted = await prisma.payment.delete({ where: { id: paymentId } }).catch(() => null)
      return NextResponse.json({ success: true, deleted: deleted ? [deleted.id] : [] })
    }

    if (duplicates.length) {
      const summaries: Array<{ email?: string; date?: string; deletedIds: string[] }> = []
      for (const dup of duplicates) {
        if (!dup.email || !dup.date) {
          summaries.push({ email: dup.email, date: dup.date, deletedIds: [] })
          continue
        }
        const user = await prisma.user.findUnique({ where: { email: dup.email }, select: { id: true } })
        if (!user) {
          summaries.push({ email: dup.email, date: dup.date, deletedIds: [] })
          continue
        }
        try {
          const { start, end } = dayBounds(dup.date)
          const payments = await prisma.payment.findMany({
            where: {
              userId: user.id,
              status: 'CONFIRMED',
              processedAt: { gte: start, lte: end }
            },
            orderBy: { processedAt: 'asc' }
          })
          if (payments.length <= 1) {
            summaries.push({ email: dup.email, date: dup.date, deletedIds: [] })
            continue
          }
          const keeperCandidate = payments.find(p => p.description?.includes('[inv:'))
          const keeper = keeperCandidate || payments[0]
          const toDelete = payments.filter(p => p.id !== keeper.id)
          if (toDelete.length) {
            await prisma.payment.deleteMany({ where: { id: { in: toDelete.map(p => p.id) } } })
          }
          summaries.push({ email: dup.email, date: dup.date, deletedIds: toDelete.map(p => p.id) })
        } catch {
          summaries.push({ email: dup.email, date: dup.date, deletedIds: [] })
        }
      }
      return NextResponse.json({ success: true, deletedDuplicates: summaries })
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


