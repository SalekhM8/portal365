import 'dotenv/config'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

const accounts = {
  SU: process.env.STRIPE_SECRET_KEY,
  IQ: process.env.STRIPE_IQ_SECRET_KEY,
  AURA: process.env.STRIPE_AURA_SECRET_KEY
}

async function diagnose() {
  console.log('\n🔍 CHECKING ALL ACCOUNTS FOR REAL FAILURES\n')
  
  for (const [name, key] of Object.entries(accounts)) {
    if (!key) continue
    
    const stripe = new Stripe(key, { apiVersion: '2025-05-28.basil' as any })
    console.log(`\n${'='.repeat(60)}`)
    console.log(`📊 ${name} ACCOUNT`)
    console.log('='.repeat(60))
    
    try {
      // Get all invoices from today
      const today = new Date()
      today.setHours(0, 0, 0, 0)
      const todayTs = Math.floor(today.getTime() / 1000)
      
      const allInvoices = await stripe.invoices.list({ 
        limit: 100,
        created: { gte: todayTs }
      })
      
      const paid = allInvoices.data.filter((i: any) => i.status === 'paid')
      const open = allInvoices.data.filter((i: any) => i.status === 'open')
      const draft = allInvoices.data.filter((i: any) => i.status === 'draft')
      
      console.log(`\nToday's invoices:`)
      console.log(`   ✅ Paid: ${paid.length}`)
      console.log(`   ⚠️  Open (unpaid): ${open.length}`)
      console.log(`   📝 Draft: ${draft.length}`)
      
      // For each open invoice, show details
      if (open.length > 0) {
        console.log(`\n⚠️  OPEN INVOICES (need attention):`)
        for (const inv of open) {
          const i = inv as any
          const subId = i.subscription
          const custId = i.customer
          
          console.log(`\n   Invoice: ${i.id}`)
          console.log(`   Amount: £${(i.amount_due || 0) / 100}`)
          console.log(`   Subscription: ${subId || 'N/A'}`)
          
          // Try to find the user
          if (subId) {
            const sub = await prisma.subscription.findUnique({
              where: { stripeSubscriptionId: subId },
              include: { user: true }
            })
            if (sub) {
              console.log(`   ✅ Portal User: ${sub.user.firstName} ${sub.user.lastName} (${sub.user.email})`)
              
              // Check if this failure is in Portal payments
              const payment = await prisma.payment.findFirst({
                where: { stripeInvoiceId: i.id }
              })
              if (payment) {
                console.log(`   Portal Payment Status: ${payment.status}`)
              } else {
                console.log(`   ❌ NO PAYMENT RECORD IN PORTAL!`)
              }
            } else {
              console.log(`   ❌ Subscription ${subId} not in Portal`)
            }
          } else if (custId) {
            const cust = await stripe.customers.retrieve(custId) as any
            if (cust.email) {
              const user = await prisma.user.findUnique({ where: { email: cust.email } })
              if (user) {
                console.log(`   ✅ User by email: ${user.firstName} ${user.lastName}`)
              } else {
                console.log(`   ❌ No user with email ${cust.email}`)
              }
            }
          }
        }
      }
      
      // Also check for subscriptions with past_due status
      const pastDueSubs = await stripe.subscriptions.list({
        status: 'past_due',
        limit: 50
      })
      
      if (pastDueSubs.data.length > 0) {
        console.log(`\n🔴 PAST DUE SUBSCRIPTIONS: ${pastDueSubs.data.length}`)
        for (const sub of pastDueSubs.data.slice(0, 10)) {
          const s = sub as any
          console.log(`\n   Sub: ${s.id}`)
          console.log(`   Customer: ${s.customer}`)
          
          const portalSub = await prisma.subscription.findUnique({
            where: { stripeSubscriptionId: s.id },
            include: { user: true }
          })
          
          if (portalSub) {
            console.log(`   ✅ Portal: ${portalSub.user.firstName} ${portalSub.user.lastName}`)
            console.log(`   Portal Status: ${portalSub.status}`)
          } else {
            console.log(`   ❌ NOT IN PORTAL`)
          }
        }
      }
      
    } catch (e: any) {
      console.log(`Error: ${e.message}`)
    }
  }
  
  await prisma.$disconnect()
}

diagnose().catch(console.error)
