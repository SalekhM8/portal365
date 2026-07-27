import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PATCH — inline edits from the Member Summary. Only the provided fields change.
export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

  const { id } = await context.params
  const body = await request.json().catch(() => ({}))
  const user = await prisma.user.findUnique({ where: { id } })
  if (!user) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

  const data: any = {}
  if (typeof body.firstName === 'string' && body.firstName.trim()) data.firstName = body.firstName.trim()
  if (typeof body.lastName === 'string') data.lastName = body.lastName.trim()
  if (typeof body.phone === 'string') data.phone = body.phone.trim() || null
  if (typeof body.dateOfBirth === 'string') data.dateOfBirth = body.dateOfBirth ? new Date(body.dateOfBirth + 'T00:00:00.000Z') : null
  if (typeof body.email === 'string' && body.email.trim()) {
    const email = body.email.trim()
    const clash = await prisma.user.findFirst({ where: { email: { equals: email, mode: 'insensitive' }, NOT: { id } } })
    if (clash) return NextResponse.json({ error: 'That email already belongs to another member' }, { status: 400 })
    data.email = email
  }
  if (typeof body.address === 'string' || typeof body.postcode === 'string') {
    let ec: any = {}
    try { ec = user.emergencyContact ? JSON.parse(user.emergencyContact) : {} } catch {}
    ec.addressInfo = ec.addressInfo || {}
    if (typeof body.address === 'string') ec.addressInfo.address = body.address.trim()
    if (typeof body.postcode === 'string') ec.addressInfo.postcode = body.postcode.trim()
    data.emergencyContact = JSON.stringify(ec)
  }
  if (Object.keys(data).length === 0) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  const updated = await prisma.user.update({ where: { id }, data })
  return NextResponse.json({
    success: true,
    user: {
      firstName: updated.firstName, lastName: updated.lastName,
      name: `${updated.firstName} ${updated.lastName}`.replace(/\s+/g, ' ').trim(),
      email: updated.email, phone: updated.phone,
      dateOfBirth: updated.dateOfBirth ? updated.dateOfBirth.toISOString().slice(0, 10) : null,
      emergencyContact: updated.emergencyContact,
    },
  })
}
