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
  const key = searchParams.get('key')
  const format = (searchParams.get('format') || 'xlsx').toLowerCase()
  if (!key) return new Response(JSON.stringify({ error: 'Missing key' }), { status: 400 })

  const plan = await prisma.membershipPlan.findUnique({ where: { key } })
  if (!plan) return new Response(JSON.stringify({ error: 'Plan not found' }), { status: 404 })

  // Reuse admin members listing shape
  const members = await prisma.user.findMany({
    where: { role: 'CUSTOMER' },
    select: {
      id: true, firstName: true, lastName: true, email: true,
      memberships: {
        where: { membershipType: key },
        orderBy: { createdAt: 'desc' },
        take: 1
      },
      payments: {
        where: { status: 'CONFIRMED' },
        orderBy: { processedAt: 'desc' },
        take: 1,
        select: { createdAt: true, processedAt: true, amount: true }
      }
    }
  })

  // Totals (all time) and last month for these users
  const nowUtc = new Date()
  const thisMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), 1))
  const lastMonthStartUtc = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth() - 1, 1))

  const totals = await prisma.payment.groupBy({ by: ['userId'], where: { status: 'CONFIRMED' }, _sum: { amount: true } })
  const totalsMap: Record<string, number> = {}
  for (const t of totals) totalsMap[t.userId] = Number(t._sum.amount || 0)

  // Last payment amount comes from most recent confirmed payment (already joined above)

  const rows = members.filter(m => m.memberships.length > 0).map(m => {
    const membership = m.memberships[0] as any
    const lastPaid = (m.payments[0]?.processedAt || m.payments[0]?.createdAt) as Date | undefined
    const totalPaid = totalsMap[m.id] || 0
    const lastPayment = m.payments[0]?.amount ? Number(m.payments[0].amount) : 0
    return {
      id: m.id,
      name: `${m.firstName} ${m.lastName}`,
      email: m.email,
      status: membership?.status || 'N/A',
      joinedAt: membership?.startDate ? toIsoDate(membership.startDate) : 'N/A',
      nextBilling: membership?.nextBillingDate ? toIsoDate(membership.nextBillingDate) : 'N/A',
      lastPaidAt: lastPaid ? toIsoDate(lastPaid) : 'N/A',
      totalPaid,
      lastPayment
    }
  })

  const fileBase = `portal365-plan-${plan.key}-members-${new Date().toISOString().slice(0,10)}`

  if (format === 'csv') {
    const header = ['User ID','Name','Email','Status','Joined','Next Billing','Last Paid (date)','Total Paid','Last Payment']
    const csvLines = [header.join(',')]
    for (const r of rows) {
      csvLines.push([
        r.id,
        escapeCsv(r.name),
        r.email,
        r.status,
        r.joinedAt,
        r.nextBilling,
        r.lastPaidAt,
        String(r.totalPaid),
        String(r.lastPayment)
      ].join(','))
    }
    const body = `\uFEFF${csvLines.join('\n')}`
    return new Response(body, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${fileBase}.csv"`
      }
    })
  }

  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('Members')
  sheet.columns = [
    { header: 'User ID', key: 'id', width: 28 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Email', key: 'email', width: 32 },
    { header: 'Status', key: 'status', width: 14 },
    { header: 'Joined', key: 'joinedAt', width: 14 },
    { header: 'Next Billing', key: 'nextBilling', width: 14 },
    { header: 'Last Paid (date)', key: 'lastPaidAt', width: 16 },
    { header: 'Total Paid', key: 'totalPaid', width: 14 },
    { header: 'Last Payment', key: 'lastPayment', width: 14 },
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


