import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET() {
	const session: any = await getServerSession(authOptions as any)
	if (!session || session?.user?.role !== 'ADMIN') {
		return NextResponse.json({ ok: false, error: 'Unauthorized' }, { status: 401 })
	}

	const sources = [
		{ key: 'DB_OVERRIDE_URL', value: process.env.DB_OVERRIDE_URL },
		{ key: 'PRISMA_DATABASE_URL', value: process.env.PRISMA_DATABASE_URL },
		{ key: 'DATABASE_URL', value: process.env.DATABASE_URL }
	]
	const chosen = sources.find(s => !!s.value)
	let host = ''
	try {
		const parsed = new URL(chosen?.value || '')
		host = parsed.host
	} catch {}

	try {
		// Minimal query to verify connectivity and correct schema presence
		const counts = await Promise.all([
			prisma.user.count().catch(() => -1),
			prisma.subscription.count().catch(() => -1),
			prisma.payment.count().catch(() => -1),
			prisma.systemSetting.count().catch(() => -1),
		])
		return NextResponse.json({
			ok: true,
			selectedEnvVar: chosen?.key || null,
			host,
			counts: {
				users: counts[0],
				subscriptions: counts[1],
				payments: counts[2],
				systemSettings: counts[3],
			}
		})
	} catch (e: any) {
		return NextResponse.json({
			ok: false,
			selectedEnvVar: chosen?.key || null,
			host,
			error: e?.message || 'DB query failed'
		}, { status: 500 })
	}
}


