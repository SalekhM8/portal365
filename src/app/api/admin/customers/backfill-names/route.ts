import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

type Item = {
  email?: string | null
  customerId?: string
  firstName?: string | null
  lastName?: string | null
  guardianEmail?: string | null
}

function mergeGuardianPrefs(existing: string | null | undefined, guardianEmail?: string | null): string | null | undefined {
  if (!guardianEmail) return existing
  try {
    const parsed = existing ? JSON.parse(existing) : {}
    if (parsed.guardianEmail === guardianEmail) return existing
    return JSON.stringify({ ...parsed, guardianEmail })
  } catch {
    return JSON.stringify({ guardianEmail })
  }
}

function splitName(full?: string | null): { firstName: string; lastName: string } {
  const safe = (full || '').trim()
  if (!safe) return { firstName: 'Member', lastName: '' }
  const parts = safe.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  const firstName = parts[0]
  const lastName = parts.slice(1).join(' ')
  return { firstName, lastName }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    const me = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!me || !['ADMIN','SUPER_ADMIN','STAFF'].includes(me.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json().catch(() => ({} as any))
    const items: Item[] = Array.isArray(body?.items) ? body.items : []
    const account: StripeAccountKey = ((body?.account as string) || 'IQ').toUpperCase() as StripeAccountKey
    if (!items.length) {
      return NextResponse.json({ error: 'Provide items: [{ email?, customerId }]' }, { status: 400 })
    }

    const stripe = getStripeClient(account)
    const results: Array<{ customerId: string; email?: string | null; ok: boolean; userId?: string; firstName?: string; lastName?: string; error?: string }> = []

    for (const it of items) {
      try {
        if (!it.customerId && !it.email) {
          results.push({ customerId: it.customerId || 'unknown', email: it.email || null, ok: false, error: 'missing_identifiers' })
          continue
        }
        let firstName: string | undefined
        let lastName: string | undefined
        if (it.firstName || it.lastName) {
          firstName = (it.firstName || '').trim() || undefined
          lastName = (it.lastName || '').trim() || undefined
        }

        // Resolve the local user: prefer email if provided; else via subscription by stripeCustomerId
        let userId: string | null = null
        if (it.email) {
          const u = await prisma.user.findUnique({ where: { email: it.email } })
          if (u) userId = u.id
        }
        if (!userId) {
          if (!it.customerId) {
            results.push({ customerId: it.customerId || 'unknown', email: it.email || null, ok: false, error: 'user_not_found' })
            continue
          }
          const sub = await prisma.subscription.findFirst({
            where: { stripeCustomerId: it.customerId },
            orderBy: { updatedAt: 'desc' },
            select: { userId: true }
          })
          if (sub?.userId) userId = sub.userId
        }
        if (!userId) {
          results.push({ customerId: it.customerId || 'unknown', email: it.email || null, ok: false, error: 'user_not_found' })
          continue
        }

        const existingUser = await prisma.user.findUnique({ where: { id: userId }, select: { communicationPrefs: true, email: true } })

        // Fetch Stripe customer only if we still need name metadata
        if ((!firstName || !lastName) && it.customerId) {
          const cust = await stripe.customers.retrieve(it.customerId)
          if ('deleted' in cust) {
            results.push({ customerId: it.customerId, email: it.email as any, ok: false, error: 'customer_deleted' })
            continue
          }
          const derived = splitName((cust as any).name || (cust as any).email || existingUser?.email || null)
          firstName = firstName || derived.firstName
          lastName = lastName || derived.lastName
        } else {
          const fallback = splitName(existingUser?.email || it.email || null)
          firstName = firstName || fallback.firstName
          lastName = lastName || fallback.lastName
        }

        const guardianPrefs = mergeGuardianPrefs(existingUser?.communicationPrefs, it.guardianEmail)

        await prisma.user.update({
          where: { id: userId },
          data: {
            firstName,
            lastName,
            communicationPrefs: guardianPrefs
          }
        })

        results.push({
          customerId: it.customerId || 'unknown',
          email: it.email || existingUser?.email || null,
          ok: true,
          userId,
          firstName,
          lastName
        })
      } catch (e: any) {
        results.push({ customerId: it.customerId || 'unknown', email: it.email || null, ok: false, error: e?.message || 'failed' })
      }
    }

    return NextResponse.json({ success: true, account, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'backfill failed' }, { status: 500 })
  }
}


