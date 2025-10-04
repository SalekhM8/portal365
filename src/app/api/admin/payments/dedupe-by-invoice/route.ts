import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * ADMIN: Dedupe local Payment rows by Stripe invoice id
 * - Keeps the earliest CONFIRMED payment for each invoice id
 * - Deletes only the extra duplicates (does NOT touch Stripe)
 *
 * POST body:
 * {
 *   invoiceIds: string[],
 *   dryRun?: boolean
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role as any)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({})) as { invoiceIds?: string[]; dryRun?: boolean }
    const invoiceIds = Array.isArray(body?.invoiceIds) ? body.invoiceIds.filter(Boolean) : []
    const dryRun = Boolean(body?.dryRun)

    if (invoiceIds.length === 0) {
      return NextResponse.json({ error: 'Provide invoiceIds: string[]' }, { status: 400 })
    }

    const results: Array<{
      invoiceId: string
      keptId: string | null
      deletedIds: string[]
      totalFound: number
    }> = []

    for (const invoiceId of invoiceIds) {
      const rows = await prisma.payment.findMany({
        where: {
          status: 'CONFIRMED',
          description: { contains: `[inv:${invoiceId}]` }
        },
        orderBy: { createdAt: 'asc' },
        select: { id: true, createdAt: true }
      })

      if (rows.length <= 1) {
        results.push({ invoiceId, keptId: rows[0]?.id || null, deletedIds: [], totalFound: rows.length })
        continue
      }

      const keptId = rows[0].id
      const toDelete = rows.slice(1).map(r => r.id)

      if (!dryRun && toDelete.length > 0) {
        await prisma.payment.deleteMany({ where: { id: { in: toDelete } } })
      }

      results.push({ invoiceId, keptId, deletedIds: toDelete, totalFound: rows.length })
    }

    return NextResponse.json({ success: true, dryRun, results })

  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Dedupe failed' }, { status: 500 })
  }
}


