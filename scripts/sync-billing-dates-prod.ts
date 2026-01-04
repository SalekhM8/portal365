/**
 * Production script to sync nextBillingDate from Stripe for all active subscriptions
 * Supports multiple Stripe accounts (SU, AURA, CF)
 * 
 * Usage: DATABASE_URL="your-prod-url" npx tsx scripts/sync-billing-dates-prod.ts
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.production' })  // or set vars manually

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'

const prisma = new PrismaClient()

// Build Stripe clients for each account
const stripeClients: Record<string, Stripe | null> = {
  SU: process.env.STRIPE_SECRET_KEY_SU 
    ? new Stripe(process.env.STRIPE_SECRET_KEY_SU, { apiVersion: '2025-04-30.basil' as any }) 
    : null,
  AURA: process.env.STRIPE_SECRET_KEY_AURA || process.env.STRIPE_SECRET_KEY
    ? new Stripe(process.env.STRIPE_SECRET_KEY_AURA || process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any })
    : null,
  CF: process.env.STRIPE_SECRET_KEY_CF
    ? new Stripe(process.env.STRIPE_SECRET_KEY_CF, { apiVersion: '2025-04-30.basil' as any })
    : null,
}

async function syncBillingDates() {
  console.log('🔄 Syncing billing dates from Stripe (Production)...\n')
  console.log('Available accounts:', Object.entries(stripeClients).filter(([k, v]) => v).map(([k]) => k).join(', '))
  console.log('')

  const allSubs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'] }
    },
    include: { user: true }
  })
  
  const subscriptions = allSubs.filter(s => s.stripeSubscriptionId && s.stripeSubscriptionId.length > 0)

  console.log(`Found ${subscriptions.length} active subscriptions to sync\n`)

  let updated = 0
  let errors = 0
  let unchanged = 0
  let skipped = 0

  for (const sub of subscriptions) {
    try {
      const accountKey = (sub.stripeAccountKey as string) || 'AURA'  // Default to AURA if not set
      const stripe = stripeClients[accountKey]
      
      if (!stripe) {
        console.log(`⏭️  Skipping ${sub.user.email} - no Stripe client for account: ${accountKey}`)
        skipped++
        continue
      }

      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      const stripeNextBilling = new Date(stripeSub.current_period_end * 1000)
      const dbNextBilling = sub.nextBillingDate

      const needsUpdate = !dbNextBilling || 
        Math.abs(stripeNextBilling.getTime() - dbNextBilling.getTime()) > 60000 // More than 1 minute diff

      if (needsUpdate) {
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { 
            nextBillingDate: stripeNextBilling,
            currentPeriodEnd: stripeNextBilling
          }
        })
        console.log(`✅ [${accountKey}] ${sub.user.email}: ${dbNextBilling?.toISOString().split('T')[0] || 'null'} → ${stripeNextBilling.toISOString().split('T')[0]}`)
        updated++
      } else {
        unchanged++
      }

    } catch (err: any) {
      console.log(`❌ Error for ${sub.user.email}: ${err.message}`)
      errors++
    }
  }

  console.log(`\n✨ Done!`)
  console.log(`   Updated: ${updated}`)
  console.log(`   Unchanged: ${unchanged}`)
  console.log(`   Skipped: ${skipped}`)
  console.log(`   Errors: ${errors}`)

  await prisma.$disconnect()
}

syncBillingDates().catch(console.error)

