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
  const search = (searchParams.get('search') || '').trim().toLowerCase()
  const status = (searchParams.get('status') || 'all').toUpperCase()
  const plan = (searchParams.get('plan') || 'all').toUpperCase()

  const users = await prisma.user.findMany({
    where: {
      role: 'CUSTOMER',
      ...(search ? {
        OR: [
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName:  { contains: search, mode: 'insensitive' } },
          { email:     { contains: search, mode: 'insensitive' } },
          { phone:     { contains: search, mode: 'insensitive' } },
        ]
      } : {})
    },
    include: {
      memberships: {
        orderBy: { createdAt: 'desc' },
        take: 1
      },
      payments: {
        where: { status: 'CONFIRMED' },
        orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
        take: 1
      }
    },
    orderBy: { createdAt: 'desc' }
  })

  // Compute totals across all time and last calendar month
  const nowUtc = new Date()
  const thisMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1))
  const lastMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1))

  const totals = await prisma.payment.groupBy({
    by: ['userId'],
    where: { status: 'CONFIRMED' },
    _sum: { amount: true }
  })
  const totalsMap: Record<string, number> = {}
  for (const t of totals) totalsMap[t.userId] = Number(t._sum.amount || 0)

  const lastMonthTotals = await prisma.payment.groupBy({
    by: ['userId'],
    where: {
      status: 'CONFIRMED',
      processedAt: { gte: lastMonthStartUtc, lt: thisMonthStartUtc }
    },
    _sum: { amount: true }
  })
  const lastMonthMap: Record<string, number> = {}
  for (const t of lastMonthTotals) lastMonthMap[t.userId] = Number(t._sum.amount || 0)

  const filtered = users.filter(u => {
    const m = u.memberships[0] as any
    if (status !== 'ALL' && m && m.status !== status) return false
    if (plan !== 'ALL' && m && m.membershipType !== plan) return false
    return !!m
  })

  const rows = filtered.map(u => {
    const m = u.memberships[0] as any
    const p = (u.payments[0]?.processedAt || u.payments[0]?.createdAt) as Date | undefined
    const totalPaid = totalsMap[u.id] || 0
    const lastMonthPaid = lastMonthMap[u.id] || 0
    return {
      id: u.id,
      name: `${u.firstName} ${u.lastName}`,
      email: u.email,
      phone: u.phone || '',
      membershipType: m?.membershipType || 'N/A',
      status: m?.status || 'N/A',
      joinedAt: m?.startDate ? toIsoDate(m.startDate) : 'N/A',
      nextBilling: m?.nextBillingDate ? toIsoDate(m.nextBillingDate) : 'N/A',
      lastPaid: p ? toIsoDate(p) : 'N/A',
      totalPaid,
      lastMonthPaid
    }
  })

  const fileBase = `portal365-customers-${new Date().toISOString().slice(0,10)}`

  if (format === 'csv') {
    const header = ['User ID','Name','Email','Phone','Membership','Status','Joined','Next Billing','Last Paid (date)','Total Paid','Last Month Paid']
    const lines = [header.join(',')]
    for (const r of rows) {
      lines.push([
        r.id,
        escapeCsv(r.name),
        r.email,
        escapeCsv(r.phone),
        r.membershipType,
        r.status,
        r.joinedAt,
        r.nextBilling,
        r.lastPaid,
        String(r.totalPaid),
        String(r.lastMonthPaid)
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
  const sheet = workbook.addWorksheet('Customers')
  sheet.columns = [
    { header: 'User ID', key: 'id', width: 28 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Phone', key: 'phone', width: 16 },
    { header: 'Membership', key: 'membershipType', width: 16 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Joined', key: 'joinedAt', width: 14 },
    { header: 'Next Billing', key: 'nextBilling', width: 14 },
    { header: 'Last Paid (date)', key: 'lastPaid', width: 16 },
    { header: 'Total Paid', key: 'totalPaid', width: 14 },
    { header: 'Last Month Paid', key: 'lastMonthPaid', width: 16 },
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


