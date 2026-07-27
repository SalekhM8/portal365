import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']
async function gate() {
  const session = await getServerSession(authOptions) as any
  return session?.user?.role && ALLOWED.includes(session.user.role)
}

// GET ?userId= -> current photo (on-demand so big lists never carry base64)
export async function GET(request: NextRequest) {
  if (!(await gate())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { profileImage: true } })
  return NextResponse.json({ photo: u?.profileImage || null })
}

// POST { userId, image: dataURL } -> save member photo
export async function POST(request: NextRequest) {
  if (!(await gate())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId, image } = await request.json().catch(() => ({}))
  if (!userId || typeof image !== 'string') return NextResponse.json({ error: 'userId and image required' }, { status: 400 })
  if (!/^data:image\/jpeg;base64,/.test(image)) return NextResponse.json({ error: 'JPEG data URL required' }, { status: 400 })
  if (image.length > 400_000) return NextResponse.json({ error: 'Image too large' }, { status: 400 })
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!u) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  await prisma.user.update({ where: { id: userId }, data: { profileImage: image } })
  return NextResponse.json({ success: true })
}


// DELETE { userId } -> remove member photo
export async function DELETE(request: NextRequest) {
  if (!(await gate())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId } = await request.json().catch(() => ({}))
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  await prisma.user.update({ where: { id: userId }, data: { profileImage: null } })
  return NextResponse.json({ success: true })
}
