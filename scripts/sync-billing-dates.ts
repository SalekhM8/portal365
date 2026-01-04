/**
 * One-time script to sync nextBillingDate from Stripe for all active subscriptions
 * Run before deploying to ensure all billing dates are accurate
 */

import * as dotenv from 'dotenv'
dotenv.config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'

const prisma = new PrismaClient()

// Use the main Stripe key (local env only has STRIPE_SECRET_KEY)
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || '', { apiVersion: '2025-04-30.basil' as any })

async function syncBillingDates() {
  console.log('🔄 Syncing billing dates from Stripe...\n')

  const allSubs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'] }
    },
    include: { user: true }
  })
  // Filter out ones without Stripe subscription ID
  const subscriptions = allSubs.filter(s => s.stripeSubscriptionId && s.stripeSubscriptionId.length > 0)

  console.log(`Found ${subscriptions.length} active subscriptions to sync\n`)

  let updated = 0
  let errors = 0
  let unchanged = 0

  for (const sub of subscriptions) {
    try {
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
        console.log(`✅ Updated ${sub.user.email}: ${dbNextBilling?.toISOString().split('T')[0] || 'null'} → ${stripeNextBilling.toISOString().split('T')[0]}`)
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
  console.log(`   Errors: ${errors}`)

  await prisma.$disconnect()
}

syncBillingDates().catch(console.error)
