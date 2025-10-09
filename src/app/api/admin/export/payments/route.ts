import { NextRequest } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !['ADMIN','SUPER_ADMIN'].includes(session.user.role)) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 })
  }

  const { searchParams } = new URL(req.url)
  const format = (searchParams.get('format') || 'xlsx').toLowerCase()
  const status = (searchParams.get('status') || 'all').toUpperCase()
  const q = (searchParams.get('search') || '').trim().toLowerCase()
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  const where: any = { amount: { gt: 0 } }
  if (status !== 'ALL') where.status = status
  if (from || to) {
    where.createdAt = {}
    if (from) where.createdAt.gte = new Date(from)
    if (to) where.createdAt.lte = new Date(to)
  }

  const payments = await prisma.payment.findMany({
    where,
    orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      routedEntity: { select: { displayName: true } }
    }
  })

  const filtered = payments.filter(p => {
    if (!q) return true
    const name = `${p.user?.firstName || ''} ${p.user?.lastName || ''}`.toLowerCase()
    return name.includes(q) || (p.user?.email || '').toLowerCase().includes(q)
  })

  const rows = filtered.map(p => ({
    id: p.id,
    customer: `${p.user?.firstName || ''} ${p.user?.lastName || ''}`.trim(),
    email: p.user?.email || '',
    amount: Number(p.amount),
    status: p.status,
    failureReason: p.failureReason || '',
    entity: p.routedEntity?.displayName || '',
    date: toIsoDate((p.processedAt || p.createdAt) as Date),
    description: p.description || ''
  }))

  const fileBase = `portal365-payments-${new Date().toISOString().slice(0,10)}`

  if (format === 'csv') {
    const header = ['Payment ID','Customer','Email','Amount','Status','Failure Reason','Entity','Date','Description']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        r.id,
        escapeCsv(r.customer),
        r.email,
        String(r.amount),
        r.status,
        escapeCsv(r.failureReason),
        escapeCsv(r.entity),
        r.date,
        escapeCsv(r.description)
      ].join(','))
    }
    const body = `\uFEFF${lines.join('\n')}`
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileBase}.csv"`
      }
    })
  }

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Payments')
  sheet.columns = [
    { header: 'Payment ID', key: 'id', width: 28 },
    { header: 'Customer', key: 'customer', width: 28 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Amount', key: 'amount', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Failure Reason', key: 'failureReason', width: 24 },
    { header: 'Entity', key: 'entity', width: 22 },
    { header: 'Date', key: 'date', width: 16 },
    { header: 'Description', key: 'description', width: 40 },
  ]
  sheet.addRows(rows)
  sheet.getRow(1).font = { bold: true }
  sheet.views = [{ state: 'frozen', ySplit: 1 }]
  const buffer = await workbook.xlsx.writeBuffer()
  return new Response(buffer, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${fileBase}.xlsx"`
    }
  })
}

function toIsoDate(d: Date) {
  try { return new Date(d).toISOString().slice(0,10) } catch { return 'N/A' }
}

function escapeCsv(val: string) {
  const s = (val || '').toString()
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}


