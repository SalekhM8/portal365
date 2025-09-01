import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const backfillStartIso: string = body?.backfillStartIso || '2025-09-01T00:00:00Z'
    const preview: boolean = body?.preview !== false // default preview=true

    const start = new Date(backfillStartIso)

    const zeroPayments = await prisma.payment.findMany({ where: { amount: 0, createdAt: { gte: start } }, select: { id: true, userId: true, createdAt: true } })
    const zeroInvoices = await prisma.invoice.findMany({ where: { amount: 0, createdAt: { gte: start } }, select: { id: true, stripeInvoiceId: true, createdAt: true } })

    if (preview) {
      return NextResponse.json({
        success: true,
        mode: 'preview',
        backfillStartIso,
        willDelete: {
          zeroAmountPayments: zeroPayments.length,
          zeroAmountInvoices: zeroInvoices.length
        },
        samples: {
          payments: zeroPayments.slice(0, 10),
          invoices: zeroInvoices.slice(0, 10)
        }
      })
    }

    const delP = await prisma.payment.deleteMany({ where: { id: { in: zeroPayments.map(p => p.id) } } })
    const delI = await prisma.invoice.deleteMany({ where: { id: { in: zeroInvoices.map(i => i.id) } } })

    return NextResponse.json({
      success: true,
      mode: 'apply',
      backfillStartIso,
      deleted: {
        zeroAmountPayments: delP.count,
        zeroAmountInvoices: delI.count
      },
      processedBy: `${admin.firstName} ${admin.lastName}`
    })
  } catch (e: any) {
    return NextResponse.json({ success: false, error: e?.message || 'Cleanup failed' }, { status: 500 })
  }
}


