import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

// Self-serve pausing disabled (July 2026) — pauses are handled by the gym so
// they're always scheduled and tracked properly. Members contact the desk.
// (Admin pausing lives in the admin panel; self-serve RESUME is still allowed.)
export async function POST() {
  const session = await getServerSession(authOptions) as any
  if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json(
    { error: "Pausing is handled by the gym — please message us or speak to the desk and we'll sort it." },
    { status: 403 }
  )
}
