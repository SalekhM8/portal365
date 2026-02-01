import 'dotenv/config'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

// All 3 Stripe accounts - only create if key exists
const stripeAccounts: Record<string, Stripe | null> = {
  SU: process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2025-05-28.basil' as any }) : null,
  IQ: process.env.STRIPE_IQ_SECRET_KEY ? new Stripe(process.env.STRIPE_IQ_SECRET_KEY, { apiVersion: '2025-05-28.basil' as any }) : null,
  AURA: process.env.STRIPE_AURA_SECRET_KEY ? new Stripe(process.env.STRIPE_AURA_SECRET_KEY, { apiVersion: '2025-05-28.basil' as any }) : null,
}

async function diagnose() {
  console.log('\n🔍 DIAGNOSING FAILED PAYMENTS FROM ALL STRIPE ACCOUNTS\n')
  console.log('='.repeat(80))
  
  for (const [accountName, stripe] of Object.entries(stripeAccounts)) {
    if (!stripe) {
      console.log(`\n⏭️  Skipping ${accountName} - no API key`)
      continue
    }
    
    console.log(`\n📊 Checking ${accountName} account...`)
    
    try {
      // Get open invoices (these are failed/unpaid)
      const invoices = await stripe.invoices.list({
        status: 'open',
        limit: 50,
      })
      
      console.log(`   Found ${invoices.data.length} open invoices`)
      
      for (const invoice of invoices.data.slice(0, 15)) {
        const inv = invoice as any
        const subscriptionId = inv.subscription as string
        const customerId = inv.customer as string
        const amount = (inv.amount_due || 0) / 100
        
        console.log(`\n   📧 Invoice: ${inv.id}`)
        console.log(`      Amount Due: £${amount}`)
        console.log(`      Stripe Sub ID: ${subscriptionId || 'N/A'}`)
        
        // Check 1: Can we find by subscription ID?
        let portalSub = null
        if (subscriptionId) {
          portalSub = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: subscriptionId },
            include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } }
          })
        }
        
        if (portalSub) {
          console.log(`      ✅ FOUND in Portal: ${portalSub.user.firstName} ${portalSub.user.lastName}`)
          
          // Check if payment exists in DB
          const existingPayment = await prisma.payment.findFirst({
            where: { stripeInvoiceId: inv.id }
          })
          
          if (existingPayment) {
            console.log(`         Payment record: ${existingPayment.status}`)
          } else {
            console.log(`         ⚠️  NO payment record - webhook didn't record it!`)
          }
        } else {
          console.log(`      ❌ NOT FOUND by subscription ID`)
          
          // Check by customer email
          try {
            const customer = await stripe.customers.retrieve(customerId) as any
            const email = customer.email
            const userId = customer.metadata?.userId
            
            console.log(`      Customer email: ${email}`)
            console.log(`      Customer userId metadata: ${userId || 'NOT SET'}`)
            
            if (email) {
              const user = await prisma.user.findUnique({ 
                where: { email },
                include: { subscriptions: { orderBy: { createdAt: 'desc' }, take: 1 } }
              })
              
              if (user) {
                console.log(`      ✅ User exists in Portal: ${user.firstName} ${user.lastName}`)
                if (user.subscriptions[0]) {
                  console.log(`         Portal sub ID: ${user.subscriptions[0].stripeSubscriptionId}`)
                  console.log(`         Invoice sub ID: ${subscriptionId}`)
                  if (user.subscriptions[0].stripeSubscriptionId !== subscriptionId) {
                    console.log(`         🔴 SUBSCRIPTION ID MISMATCH!`)
                  }
                } else {
                  console.log(`         🔴 User has NO subscription record in Portal!`)
                }
              } else {
                console.log(`      🔴 No user with email "${email}" in Portal`)
              }
            }
          } catch (e: any) {
            console.log(`      Error: ${e.message}`)
          }
        }
      }
    } catch (e: any) {
      console.log(`   ❌ Error: ${e.message}`)
    }
  }
  
  console.log('\n' + '='.repeat(80))
  console.log('DIAGNOSIS COMPLETE\n')
  
  await prisma.$disconnect()
}

diagnose().catch(console.error)
