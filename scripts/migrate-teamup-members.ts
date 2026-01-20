/**
 * Migrate TeamUp members to Portal365
 * Creates Stripe subscriptions + Portal records
 */

import { PrismaClient } from '@prisma/client'
import Stripe from 'stripe'
import * as crypto from 'crypto'

const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY_IQ!, { apiVersion: '2025-04-30.basil' as any })

// Price IDs on IQ
const PRICES = {
  FULL_ADULT: { priceId: 'price_1SQT3wBXylQd2gzCQbGY10bX', amount: 75, key: 'FULL_ADULT' },
  FULL_CHILD: { priceId: 'price_1SQT3zBXylQd2gzCfwCIIrLl', amount: 55, key: 'FULL_CHILD' },
  WEEKEND_CHILD: { priceId: 'price_1SQT4ABXylQd2gzCzpU6C3sX', amount: 40, key: 'WEEKEND_CHILD' },
  WOMENS_CLASSES: { priceId: 'price_1SQT4DBXylQd2gzCtDVeR6rD', amount: 25, key: 'WOMENS_CLASSES' },
}

// Trial ends Feb 1, 2026 at midnight UTC
const TRIAL_END = Math.floor(new Date('2026-02-01T00:00:00Z').getTime() / 1000)

const membersToMigrate = [
  { name: "Adnan Ahmed", firstName: "Adnan", lastName: "Ahmed", email: "adnanahmed98@hotmail.com", cusId: "cus_RkTsiPYLCa8Gu1", plan: PRICES.FULL_ADULT },
  { name: "Isaaq Suhaib", firstName: "Isaaq", lastName: "Suhaib", email: "ahmedsuhaib925@gmail.com", cusId: "cus_TiKKsMD43egHP3", plan: PRICES.FULL_CHILD },
  { name: "Safah Ellahi", firstName: "Safah", lastName: "Ellahi", email: "iramxe17@gmail.com", cusId: "cus_SgbtRTvdclKka9", plan: PRICES.WOMENS_CLASSES },
  { name: "Luhayyah Hussain", firstName: "Luhayyah", lastName: "Hussain", email: "goaway121@hotmail.com", cusId: "cus_RbuFJOINyrnnlR", plan: PRICES.WOMENS_CLASSES },
  { name: "Nusaybah Isaan", firstName: "Nusaybah", lastName: "Isaan", email: "mrisaanraza@gmail.com", cusId: "cus_Rba62tM2gkWlLt", plan: PRICES.WOMENS_CLASSES },
  { name: "Sumayyah Isaan", firstName: "Sumayyah", lastName: "Isaan", email: "mrisaanraza@gmail.com", portalEmail: "child.mrisaanraza@member.local", cusId: "cus_RbZsA8zY7z3iWR", plan: PRICES.WOMENS_CLASSES },
  { name: "Mohammed Khan", firstName: "Mohammed", lastName: "Khan", email: "mohkhane37@gmail.com", cusId: "cus_S4f2tBbEd7b35v", plan: PRICES.FULL_ADULT },
  // Rehaan Nadim - SKIP - handle separately (already has sub)
  { name: "Faiza Nourain", firstName: "Faiza", lastName: "Nourain", email: "faizanourain@gmail.com", cusId: "cus_S6zNaBn8qy34ZT", plan: PRICES.WOMENS_CLASSES },
  { name: "Musa Sheraz", firstName: "Musa", lastName: "Sheraz", email: "msheraz1996@gmail.com", cusId: "cus_Rh49ntuB7QaQcf", plan: PRICES.WEEKEND_CHILD },
  { name: "Muhammad Hassan Taj", firstName: "Muhammad Hassan", lastName: "Taj", email: "mzt365@hotmail.com", cusId: "cus_Saz29ZpKsWHQAR", plan: PRICES.FULL_CHILD },
  { name: "Muhammad Hammaad Taj", firstName: "Muhammad Hammaad", lastName: "Taj", email: "mzt365@hotmail.com", portalEmail: "child.mzt365@member.local", cusId: "cus_Sayy96AiEt7rAI", plan: PRICES.FULL_CHILD },
  { name: "Nasteha Hassan", firstName: "Nasteha", lastName: "Hassan", email: "nastehah194@gmail.com", cusId: "cus_SISoaA3uR1gkxI", plan: PRICES.WOMENS_CLASSES },
]

async function migrate() {
  console.log('═══════════════════════════════════════════════════════════════')
  console.log('   🚀 MIGRATING TEAMUP MEMBERS TO PORTAL365')
  console.log('═══════════════════════════════════════════════════════════════\n')
  console.log(`Trial ends: Feb 1, 2026 (${TRIAL_END})\n`)

  let created = 0
  let failed = 0

  // Get default business entity for routing
  const defaultEntity = await prisma.businessEntity.findFirst()
  if (!defaultEntity) {
    console.log('❌ No business entity found!')
    return
  }

  for (const member of membersToMigrate) {
    console.log(`\n┌─────────────────────────────────────────────────────────────`)
    console.log(`│ Processing: ${member.name}`)
    console.log(`├─────────────────────────────────────────────────────────────`)

    try {
      const portalEmail = member.portalEmail || member.email

      // 1. Check if user already exists in Portal
      const existingUser = await prisma.user.findFirst({
        where: { email: { equals: portalEmail, mode: 'insensitive' } }
      })

      if (existingUser) {
        console.log(`│ ⚠️  User already exists in Portal: ${portalEmail}`)
        console.log(`│ Skipping...`)
        continue
      }

      // 2. Get customer's default payment method from Stripe
      const customer = await stripe.customers.retrieve(member.cusId) as Stripe.Customer
      const paymentMethods = await stripe.paymentMethods.list({ customer: member.cusId, type: 'card' })
      const defaultPM = paymentMethods.data[0]

      if (!defaultPM) {
        console.log(`│ ❌ No payment method found!`)
        failed++
        continue
      }

      // Set as default payment method on customer
      await stripe.customers.update(member.cusId, {
        invoice_settings: { default_payment_method: defaultPM.id }
      })

      console.log(`│ ✅ Payment method: ${defaultPM.card?.brand} ****${defaultPM.card?.last4}`)

      // 3. Create Stripe subscription with trial until Feb 1
      const subscription = await stripe.subscriptions.create({
        customer: member.cusId,
        items: [{ price: member.plan.priceId }],
        trial_end: TRIAL_END,
        default_payment_method: defaultPM.id,
        metadata: {
          source: 'teamup_migration',
          migrated_at: new Date().toISOString(),
          portal_email: portalEmail
        }
      })

      console.log(`│ ✅ Stripe subscription created: ${subscription.id}`)
      console.log(`│    Status: ${subscription.status}, Trial until: Feb 1, 2026`)

      // 4. Create Portal User
      const hashedPassword = crypto.createHash('sha256').update(`temp_${Date.now()}`).digest('hex')
      
      const user = await prisma.user.create({
        data: {
          email: portalEmail,
          firstName: member.firstName,
          lastName: member.lastName,
          password: hashedPassword,
          role: 'CUSTOMER',
          isVerified: true,
        }
      })

      console.log(`│ ✅ Portal user created: ${user.id}`)

      // 5. Create Portal Membership
      const membership = await prisma.membership.create({
        data: {
          userId: user.id,
          membershipType: member.plan.key,
          status: 'TRIALING',
          startDate: new Date(),
          nextBillingDate: new Date('2026-02-01'),
        }
      })

      console.log(`│ ✅ Membership created: ${membership.id} (${member.plan.key})`)

      // 6. Create Portal Subscription record
      const portalSub = await prisma.subscription.create({
        data: {
          userId: user.id,
          stripeSubscriptionId: subscription.id,
          stripeCustomerId: member.cusId,
          stripeAccountKey: 'IQ',
          routedEntityId: defaultEntity.id,
          membershipType: member.plan.key,
          monthlyPrice: member.plan.amount,
          status: 'TRIALING',
          currentPeriodStart: new Date(),
          currentPeriodEnd: new Date('2026-02-01'),
          nextBillingDate: new Date('2026-02-01'),
        }
      })

      console.log(`│ ✅ Portal subscription linked: ${portalSub.id}`)
      console.log(`└─────────────────────────────────────────────────────────────`)

      created++

    } catch (err: any) {
      console.log(`│ ❌ ERROR: ${err.message}`)
      console.log(`└─────────────────────────────────────────────────────────────`)
      failed++
    }
  }

  console.log('\n═══════════════════════════════════════════════════════════════')
  console.log('   MIGRATION COMPLETE')
  console.log('═══════════════════════════════════════════════════════════════')
  console.log(`✅ Created: ${created}`)
  console.log(`❌ Failed:  ${failed}`)
  console.log(`\nRemember: Rehaan Nadim needs to be handled separately!`)

  await prisma.$disconnect()
}

migrate().catch(console.error)

