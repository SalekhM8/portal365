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

  const classes = await prisma.class.findMany({
    include: { service: { select: { name: true } } },
    orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
  })

  const rows = classes.map((c: any) => ({
    id: c.id,
    name: c.name,
    dayOfWeek: c.dayOfWeek,
    startTime: c.startTime,
    endTime: c.endTime,
    duration: c.duration,
    instructor: c.instructorName,
    location: c.location,
    maxParticipants: c.maxParticipants,
    isActive: c.isActive ? 'ACTIVE' : 'INACTIVE',
    requiredMemberships: (() => { try { return (JSON.parse(c.requiredMemberships) || []).join(', ') } catch { return '' } })(),
    serviceName: c.service?.name || 'General'
  }))

  const fileBase = `portal365-classes-${new Date().toISOString().slice(0,10)}`

  if (format === 'csv') {
    const header = ['ID','Name','Day','Start','End','Duration','Instructor','Location','Max','Status','Required Memberships','Service']
    const csvLines = [header.join(',')]
    for (const r of rows) {
      csvLines.push([
        r.id,
        escapeCsv(r.name),
        String(r.dayOfWeek),
        r.startTime,
        r.endTime,
        String(r.duration),
        escapeCsv(r.instructor || ''),
        escapeCsv(r.location || ''),
        String(r.maxParticipants || 0),
        r.isActive,
        escapeCsv(r.requiredMemberships || ''),
        escapeCsv(r.serviceName || '')
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
  const sheet = workbook.addWorksheet('Classes')
  sheet.columns = [
    { header: 'ID', key: 'id', width: 28 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Day', key: 'dayOfWeek', width: 6 },
    { header: 'Start', key: 'startTime', width: 8 },
    { header: 'End', key: 'endTime', width: 8 },
    { header: 'Duration', key: 'duration', width: 10 },
    { header: 'Instructor', key: 'instructor', width: 24 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Max', key: 'maxParticipants', width: 6 },
    { header: 'Status', key: 'isActive', width: 10 },
    { header: 'Required Memberships', key: 'requiredMemberships', width: 36 },
    { header: 'Service', key: 'serviceName', width: 18 },
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

function escapeCsv(val: string) {
  const s = (val || '').toString()
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"'
  return s
}


