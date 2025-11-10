import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { prisma } from '@/lib/prisma'

// Cancel the most recent N IQ canary subscriptions (metadata.migrated_from==='teamup')
// and remove corresponding Portal subscription rows; clean up membership if created recently.
export async function POST(request: NextRequest) {
	try {
		const session: any = await getServerSession(authOptions as any)
		if (!session || !session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
		if (!['ADMIN', 'SUPER_ADMIN', 'STAFF'].includes((session?.user as any)?.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

		const { limit = 10, account = 'IQ', hardDelete = false } = await request.json().catch(() => ({}))
		const acct = (account as StripeAccountKey) || 'IQ'
		const stripe = getStripeClient(acct)

		// Pull a wider window and select latest "teamup" subs
		const subs = await stripe.subscriptions.list({ status: 'all', limit: 100 })
		const candidates = subs.data
			.filter((s: any) => (s?.metadata?.migrated_from === 'teamup'))
			.sort((a: any, b: any) => (b.created || 0) - (a.created || 0))
			.slice(0, Math.max(1, Math.min(Number(limit) || 10, 50)))

		const results: Array<{ stripeSubId: string; cancelled: boolean; dbRemoved: boolean; membershipAdjusted?: string; userDeleted?: boolean }> = []

		for (const s of candidates) {
			const stripeSubId = s.id
			let cancelled = false
			let dbRemoved = false
			let membershipAdjusted: string | undefined
			let userDeleted: boolean | undefined

			try {
				// Cancel in Stripe (no proration; trialing implies no charge)
				await stripe.subscriptions.cancel(stripeSubId, { prorate: false } as any)
				cancelled = true
			} catch (e) {
				// keep going with DB clean-up even if Stripe cancel fails
			}

			// Remove Portal Subscription and adjust membership
			const dbSub = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: stripeSubId } })
			if (dbSub) {
				const userId = dbSub.userId
				try {
					await prisma.subscription.delete({ where: { id: dbSub.id } })
					dbRemoved = true
				} catch {}

				// Adjust membership
				try {
					const membership = await prisma.membership.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' } })
					if (membership) {
						if (hardDelete) {
							await prisma.membership.delete({ where: { id: membership.id } })
							membershipAdjusted = 'deleted_hard'
						} else {
							await prisma.membership.update({ where: { id: membership.id }, data: { status: 'INACTIVE' } })
							membershipAdjusted = 'set_inactive'
						}
					}
				} catch {}

				// Optionally remove shadow user if safe
				if (hardDelete) {
					try {
						const user = await prisma.user.findUnique({ where: { id: userId }, include: { subscriptions: true, payments: true } })
						if (user) {
							const hasSubs = await prisma.subscription.count({ where: { userId } })
							const hasPays = await prisma.payment.count({ where: { userId } })
							const isShadow = user.email?.startsWith('migrated_') === true
							if (!hasSubs && !hasPays && isShadow) {
								await prisma.user.delete({ where: { id: userId } })
								userDeleted = true
							}
						}
					} catch {}
				}
			}

			results.push({ stripeSubId, cancelled, dbRemoved, membershipAdjusted, userDeleted })
		}

		return NextResponse.json({ success: true, count: results.length, results })
	} catch (e: any) {
		return NextResponse.json({ success: false, error: e?.message || 'Failed to revert canary' }, { status: 500 })
	}
}


