// Reconciler: find succeeded prorated first-period charges (NOT refunded) that have
// no matching DB Payment row, and report (or --apply to backfill from charge metadata).
// This is the safety net: catches "active but unpaid" regardless of why the webhook missed.
import dotenv from 'dotenv'
dotenv.config({ path: '.env.vercel', override: true })
const { PrismaClient } = await import('@prisma/client')
const Stripe = (await import('stripe')).default
const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

const keyMap = { SU: process.env.STRIPE_SECRET_KEY, IQ: process.env.STRIPE_IQ_SECRET_KEY, AURA: process.env.STRIPE_AURA_SECRET_KEY, AURAUP: process.env.STRIPE_AURAUP_SECRET_KEY, AFC: process.env.STRIPE_AFC_SECRET_KEY }
const since = Math.floor(new Date('2026-05-01T00:00:00Z').getTime()/1000)
const PRORATED_REASONS = new Set(['prorated_first_period','family_child_prorated_first_period'])

let missing = [], backfilled = 0
for (const [acct, key] of Object.entries(keyMap)) {
  if (!key) continue
  const stripe = new Stripe(key)
  let starting_after, scanned = 0
  while (true) {
    const page = await stripe.charges.list({ limit: 100, created: { gte: since }, ...(starting_after?{starting_after}:{}) })
    for (const c of page.data) {
      scanned++
      if (!c.paid || c.status !== 'succeeded') continue
      if (!PRORATED_REASONS.has(c.metadata?.reason)) continue
      if ((c.amount_refunded||0) >= c.amount) continue   // fully refunded → no row expected
      const piId = c.payment_intent
      if (!piId) continue
      // Does a DB payment row exist for this PI?
      const row = await prisma.payment.findFirst({ where: { description: { contains: `[pi:${piId}]` } } })
      if (row) continue
      // Resolve user
      const userId = c.metadata?.userId
      const dbSubId = c.metadata?.dbSubscriptionId
      const routedEntityId = c.metadata?.routedEntityId
      const net = (c.amount - (c.amount_refunded||0))/100
      missing.push({ acct, piId, chargeId: c.id, userId, dbSubId, net, reason: c.metadata?.reason, created: new Date(c.created*1000).toISOString().slice(0,10) })
      if (APPLY && userId && routedEntityId) {
        await prisma.payment.create({ data: {
          userId, amount: net, currency: (c.currency||'gbp').toUpperCase(), status: 'CONFIRMED',
          description: `Initial subscription payment (prorated) [pi:${piId}] [sub:${dbSubId||'?'}]`,
          routedEntityId, processedAt: new Date(c.created*1000)
        }})
        backfilled++
      }
    }
    if (!page.has_more) break
    starting_after = page.data[page.data.length-1].id
  }
  console.log(`[${acct}] scanned ${scanned} charges`)
}
console.log(`\n=== MISSING prorated payment rows (paid, not refunded, no DB row): ${missing.length} ===`)
for (const m of missing) console.log(`  ${m.created} ${m.acct} £${m.net} ${m.reason} pi=${m.piId} user=${m.userId||'?'}`)
if (APPLY) console.log(`\nBackfilled: ${backfilled}`)
else console.log(`\n(report only — re-run with --apply to backfill)`)
await prisma.$disconnect()
