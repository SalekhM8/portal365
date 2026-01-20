/**
 * ACTUAL SYNC - Updates nextBillingDate from Stripe
 */

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'

const prisma = new PrismaClient()

const stripeClients: Record<string, Stripe> = {
  AURA: new Stripe(process.env.STRIPE_SECRET_KEY_AURA!, { apiVersion: '2025-04-30.basil' as any }),
  IQ: new Stripe(process.env.STRIPE_SECRET_KEY_IQ!, { apiVersion: '2025-04-30.basil' as any }),
  SU: new Stripe(process.env.STRIPE_SECRET_KEY_SU!, { apiVersion: '2025-04-30.basil' as any }),
}

async function runSync() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   🔄 RUNNING BILLING DATE SYNC')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const allSubs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'] }
    },
    include: { user: true }
  })
  
  const subscriptions = allSubs.filter(s => s.stripeSubscriptionId && s.stripeSubscriptionId.length > 0)

  console.log(`Processing ${subscriptions.length} subscriptions...\n`)

  let updated = 0
  let unchanged = 0
  let errors = 0

  for (const sub of subscriptions) {
    try {
      let accountKey = (sub.stripeAccountKey as string) || 'AURA'
      if (accountKey === 'IQ' || accountKey === 'iq') accountKey = 'IQ'
      if (accountKey === 'SU' || accountKey === 'su') accountKey = 'SU'
      if (accountKey === 'AURA' || accountKey === 'aura') accountKey = 'AURA'
      
      const stripe = stripeClients[accountKey]
      if (!stripe) {
        console.log(`❌ ${sub.user.email}: Unknown account ${accountKey}`)
        errors++
        continue
      }

      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      const item = stripeSub.items?.data?.[0]
      const periodEnd = item?.current_period_end
      
      if (!periodEnd) {
        console.log(`❌ ${sub.user.email}: No period_end found`)
        errors++
        continue
      }
      
      const stripeDate = new Date(periodEnd * 1000)
      const dbDate = sub.nextBillingDate

      const diffDays = dbDate 
        ? Math.round((stripeDate.getTime() - dbDate.getTime()) / (1000 * 60 * 60 * 24))
        : null

      if (!dbDate || Math.abs(diffDays!) > 0) {
        // UPDATE THE DATABASE
        await prisma.subscription.update({
          where: { id: sub.id },
          data: { 
            nextBillingDate: stripeDate,
            currentPeriodEnd: stripeDate
          }
        })
        
        const oldDate = dbDate?.toISOString().split('T')[0] || 'NULL'
        const newDate = stripeDate.toISOString().split('T')[0]
        console.log(`✅ ${sub.user.email}: ${oldDate} → ${newDate}`)
        updated++
      } else {
        unchanged++
      }

    } catch (err: any) {
      console.log(`❌ ${sub.user.email}: ${err.message}`)
      errors++
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('   COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  console.log(`✅ Updated:   ${updated}`)
  console.log(`⏭️  Unchanged: ${unchanged}`)
  console.log(`❌ Errors:    ${errors}`)

  await prisma.$disconnect()
}

runSync().catch(console.error)

