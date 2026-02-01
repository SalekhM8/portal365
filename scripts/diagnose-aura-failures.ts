import 'dotenv/config'
import Stripe from 'stripe'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_AURA_SECRET_KEY || '', { apiVersion: '2025-05-28.basil' as any })

async function diagnose() {
  console.log('\n🔍 DEEP DIAGNOSIS OF AURA STRIPE ACCOUNT\n')
  console.log('='.repeat(80))
  
  // Check various invoice statuses
  const statuses = ['open', 'uncollectible', 'void']
  
  for (const status of statuses) {
    try {
      const invoices = await stripe.invoices.list({ status: status as any, limit: 20 })
      console.log(`\n📊 ${status.toUpperCase()} invoices: ${invoices.data.length}`)
      
      for (const inv of invoices.data.slice(0, 5)) {
        const i = inv as any
        console.log(`   - ${i.id}: £${(i.amount_due || 0)/100} (sub: ${i.subscription || 'N/A'})`)
      }
    } catch (e: any) {
      console.log(`   Error: ${e.message}`)
    }
  }
  
  // Check recent failed payment intents
  console.log('\n📊 Recent FAILED payment intents (last 24h):')
  try {
    const yesterday = Math.floor((Date.now() - 24*60*60*1000) / 1000)
    const paymentIntents = await stripe.paymentIntents.list({
      limit: 50,
      created: { gte: yesterday }
    })
    
    const failed = paymentIntents.data.filter((pi: any) => 
      pi.status === 'requires_payment_method' || 
      pi.status === 'canceled' ||
      pi.last_payment_error
    )
    
    console.log(`   Found ${failed.length} failed/problematic payment intents`)
    
    for (const pi of failed.slice(0, 10)) {
      const p = pi as any
      console.log(`\n   💳 ${p.id}`)
      console.log(`      Status: ${p.status}`)
      console.log(`      Amount: £${(p.amount || 0)/100}`)
      console.log(`      Customer: ${p.customer}`)
      if (p.last_payment_error) {
        console.log(`      Error: ${p.last_payment_error.message}`)
        console.log(`      Code: ${p.last_payment_error.decline_code || p.last_payment_error.code}`)
      }
      
      // Check if customer exists in Portal
      if (p.customer) {
        const customer = await stripe.customers.retrieve(p.customer) as any
        const email = customer.email
        if (email) {
          const user = await prisma.user.findUnique({ where: { email } })
          if (user) {
            console.log(`      ✅ User in Portal: ${user.firstName} ${user.lastName}`)
          } else {
            console.log(`      ❌ No user with email ${email} in Portal`)
          }
        }
      }
    }
  } catch (e: any) {
    console.log(`   Error: ${e.message}`)
  }
  
  // Check Portal's failed payments
  console.log('\n📊 FAILED payments in Portal DB (last 7 days):')
  const weekAgo = new Date(Date.now() - 7*24*60*60*1000)
  const portalFailed = await prisma.payment.findMany({
    where: { 
      status: 'FAILED',
      createdAt: { gte: weekAgo }
    },
    include: { user: { select: { firstName: true, lastName: true, email: true } } },
    orderBy: { createdAt: 'desc' },
    take: 20
  })
  
  console.log(`   Found ${portalFailed.length} failed payments in Portal`)
  for (const p of portalFailed) {
    console.log(`   - ${p.user.firstName} ${p.user.lastName}: £${p.amount} (${p.failureReason || 'no reason'})`)
  }
  
  console.log('\n' + '='.repeat(80))
  await prisma.$disconnect()
}

diagnose().catch(console.error)
