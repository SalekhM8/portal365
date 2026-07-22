import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireAdmin() {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return null
  const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true } })
  if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return null
  return admin
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const packages = await prisma.offlinePackage.findMany({ orderBy: { months: 'asc' } })
  return NextResponse.json({ packages: packages.map(p => ({ ...p, price: Number(p.price) })) })
}

export async function POST(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { name, months, price } = await request.json().catch(() => ({}))
  if (!name?.trim() || !Number.isInteger(months) || months < 1 || months > 24 || typeof price !== 'number' || price < 0) {
    return NextResponse.json({ error: 'name, months (1-24) and price required' }, { status: 400 })
  }
  const pkg = await prisma.offlinePackage.create({ data: { name: name.trim(), months, price } })
  return NextResponse.json({ success: true, package: { ...pkg, price: Number(pkg.price) } })
}

export async function PATCH(request: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { id, active } = await request.json().catch(() => ({}))
  if (!id || typeof active !== 'boolean') return NextResponse.json({ error: 'id and active required' }, { status: 400 })
  await prisma.offlinePackage.update({ where: { id }, data: { active } })
  return NextResponse.json({ success: true })
}
