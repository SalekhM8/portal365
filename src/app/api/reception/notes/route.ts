import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { ukDateTime } from '@/lib/uk-time'

const ALLOWED = ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN']
const MAX_LEN = 500

async function staff() {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.role || !ALLOWED.includes(session.user.role)) return null
  const u = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, firstName: true, lastName: true, role: true } })
  return u
}

const shapeNote = (n: { id: string; text: string; authorName: string; createdAt: Date }) =>
  ({ id: n.id, text: n.text, authorName: n.authorName, createdAt: n.createdAt.toISOString(), atLabel: ukDateTime(n.createdAt) })

// GET ?userId= -> all notes, newest first
export async function GET(request: NextRequest) {
  if (!(await staff())) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const userId = request.nextUrl.searchParams.get('userId')
  if (!userId) return NextResponse.json({ error: 'userId required' }, { status: 400 })
  const notes = await prisma.memberNote.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } })
  return NextResponse.json({ notes: notes.map(shapeNote) })
}

// POST { userId, text } -> add a note
export async function POST(request: NextRequest) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  const { userId, text } = await request.json().catch(() => ({}))
  const clean = typeof text === 'string' ? text.trim() : ''
  if (!userId || !clean) return NextResponse.json({ error: 'userId and text required' }, { status: 400 })
  if (clean.length > MAX_LEN) return NextResponse.json({ error: `Keep notes under ${MAX_LEN} characters` }, { status: 400 })
  const member = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } })
  if (!member) return NextResponse.json({ error: 'Member not found' }, { status: 404 })
  const authorName = `${me.firstName} ${me.lastName}`.replace(/\s+/g, ' ').trim() || 'Desk'
  const note = await prisma.memberNote.create({ data: { userId, text: clean, authorId: me.id, authorName } })
  return NextResponse.json({ success: true, note: shapeNote(note) })
}

// DELETE { id } -> admins only (reception can add, not remove)
export async function DELETE(request: NextRequest) {
  const me = await staff()
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  if (!['ADMIN', 'SUPER_ADMIN'].includes(me.role)) return NextResponse.json({ error: 'Only an admin can delete a note' }, { status: 403 })
  const { id } = await request.json().catch(() => ({}))
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  await prisma.memberNote.delete({ where: { id } }).catch(() => null)
  return NextResponse.json({ success: true })
}
