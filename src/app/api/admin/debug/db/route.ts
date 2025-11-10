import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'

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
	const urlString = chosen?.value || ''
	let host = ''
	let protocol = ''
	try {
		// Hide credentials while still showing host
		const parsed = new URL(urlString)
		host = parsed.host
		protocol = parsed.protocol.replace(':', '')
	} catch {
		// ignore parse failures
	}

	const masked = urlString
		? `${urlString.slice(0, 12)}...${urlString.slice(-6)}`
		: ''

	return NextResponse.json({
		ok: true,
		selectedEnvVar: chosen?.key || null,
		host,
		protocol,
		urlMasked: masked
	})
}


