/**
 * PREVIEW ONLY - Does NOT modify anything
 * 
 * Shows what the sync would change without actually changing it.
 * 100% read-only and safe.
 */

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'

const prisma = new PrismaClient()

// All Stripe accounts
const stripeClients: Record<string, Stripe> = {
  AURA: new Stripe(process.env.STRIPE_SECRET_KEY_AURA!, { apiVersion: '2025-04-30.basil' as any }),
  AURAUP: new Stripe(process.env.STRIPE_SECRET_KEY_AURAUP || process.env.STRIPE_AURAUP_SECRET_KEY!, { apiVersion: '2025-04-30.basil' as any }),
  IQ: new Stripe(process.env.STRIPE_SECRET_KEY_IQ!, { apiVersion: '2025-04-30.basil' as any }),
  SU: new Stripe(process.env.STRIPE_SECRET_KEY_SU!, { apiVersion: '2025-04-30.basil' as any }),
}

async function previewSync() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   🔍 PREVIEW MODE - NO CHANGES WILL BE MADE')
  console.log('═══════════════════════════════════════════════════════════════\n')

  const allSubs = await prisma.subscription.findMany({
    where: {
      status: { in: ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED'] }
    },
    include: { user: true }
  })
  
  const subscriptions = allSubs.filter(s => s.stripeSubscriptionId && s.stripeSubscriptionId.length > 0)

  console.log(`Found ${subscriptions.length} subscriptions to check\n`)

  const wouldUpdate: any[] = []
  const alreadyCorrect: any[] = []
  const errors: any[] = []

  for (const sub of subscriptions) {
    try {
      // Determine which Stripe account to use
      let accountKey = (sub.stripeAccountKey as string) || 'AURA'
      if (accountKey === 'IQ' || accountKey === 'iq') accountKey = 'IQ'
      if (accountKey === 'SU' || accountKey === 'su') accountKey = 'SU'
      if (accountKey === 'AURA' || accountKey === 'aura') accountKey = 'AURA'
      if (accountKey === 'AURAUP' || accountKey === 'auraup') accountKey = 'AURAUP'
      
      const stripe = stripeClients[accountKey]
      
      if (!stripe) {
        errors.push({
          email: sub.user.email,
          error: `Unknown Stripe account: ${accountKey}`
        })
        continue
      }

      const stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId)
      
      // NEW API: current_period_end is on items, not subscription root
      const item = stripeSub.items?.data?.[0]
      const periodEnd = item?.current_period_end
      
      if (!periodEnd) {
        errors.push({
          email: sub.user.email,
          error: 'No current_period_end found on subscription items'
        })
        continue
      }
      
      const stripeDate = new Date(periodEnd * 1000)
      const dbDate = sub.nextBillingDate

      const diffDays = dbDate 
        ? Math.round((stripeDate.getTime() - dbDate.getTime()) / (1000 * 60 * 60 * 24))
        : null

      if (!dbDate || Math.abs(diffDays!) > 0) {
        wouldUpdate.push({
          email: sub.user.email,
          name: `${sub.user.firstName} ${sub.user.lastName}`,
          account: accountKey,
          current: dbDate?.toISOString().split('T')[0] || 'NULL',
          correct: stripeDate.toISOString().split('T')[0],
          diffDays: diffDays ?? 'N/A'
        })
      } else {
        alreadyCorrect.push({
          email: sub.user.email,
          date: dbDate.toISOString().split('T')[0]
        })
      }

    } catch (err: any) {
      errors.push({
        email: sub.user.email,
        subId: sub.stripeSubscriptionId,
        account: sub.stripeAccountKey,
        error: err.message
      })
    }
  }

  // Summary
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   SUMMARY')
  console.log('═══════════════════════════════════════════════════════════════\n')
  
  console.log(`✅ Already correct: ${alreadyCorrect.length}`)
  console.log(`📝 Would update:    ${wouldUpdate.length}`)
  console.log(`❌ Errors:          ${errors.length}`)
  console.log('')

  if (wouldUpdate.length > 0) {
    console.log('═══════════════════════════════════════════════════════════════')
    console.log('   RECORDS THAT WOULD BE UPDATED')
    console.log('═══════════════════════════════════════════════════════════════\n')
    
    console.log('Email                                    | Acct | Current    | Correct    | Diff')
    console.log('-'.repeat(90))
    
    for (const item of wouldUpdate) {
      const email = item.email.padEnd(40).slice(0, 40)
      const acct = item.account.padEnd(4)
      const current = item.current.padEnd(10)
      const correct = item.correct.padEnd(10)
      const diff = String(item.diffDays).padStart(5)
      console.log(`${email} | ${acct} | ${current} | ${correct} | ${diff}`)
    }
  }

  if (errors.length > 0) {
    console.log('\n═══════════════════════════════════════════════════════════════')
    console.log('   ERRORS')
    console.log('═══════════════════════════════════════════════════════════════\n')
    
    for (const item of errors) {
      console.log(`❌ ${item.email} [${item.account}]: ${item.error}`)
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('   ✋ NO CHANGES WERE MADE - This was preview only')
  console.log('═══════════════════════════════════════════════════════════════\n')

  await prisma.$disconnect()
}

previewSync().catch(console.error)
