import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding demo customers, memberships, subscriptions, invoices, and payments...')

  const entities = await prisma.businessEntity.findMany({ take: 1 })
  if (entities.length === 0) throw new Error('No business entities found. Run npm run db:seed first.')
  const entity = entities[0]

  const demo = [
    { firstName: 'Zoufshan', lastName: 'Ejaz', email: 'zee68575@outlook.com', phone: '07796687774', membershipType: 'FULL_ADULT', amount: 65 },
    { firstName: 'Abdussalam', lastName: 'Abdul-Qayyum', email: 'abdussalam_aq@outlook.com', phone: '07796687774', membershipType: 'FULL_ADULT', amount: 75 },
    { firstName: 'Musa', lastName: 'Mohammed', email: 'jaffar.a.m@gmail.com', phone: '07796687774', membershipType: 'WEEKEND_ADULT', amount: 55 }
  ]

  for (const d of demo) {
    const user = await prisma.user.upsert({
      where: { email: d.email },
      update: { firstName: d.firstName, lastName: d.lastName, phone: d.phone, status: 'ACTIVE' },
      create: { firstName: d.firstName, lastName: d.lastName, email: d.email, phone: d.phone, status: 'ACTIVE', role: 'CUSTOMER' }
    })

    // Membership
    await prisma.membership.upsert({
      where: { id: `${user.id}_m1` },
      update: {},
      create: {
        id: `${user.id}_m1`,
        userId: user.id,
        membershipType: d.membershipType,
        status: 'ACTIVE',
        monthlyPrice: d.amount,
        accessPermissions: JSON.stringify(['GYM','BJJ','MMA']),
        scheduleAccess: JSON.stringify({ days: [1,2,3,4,5,6], start: '08:00', end: '22:00' }),
        ageCategory: 'ADULT',
        nextBillingDate: new Date(new Date().getFullYear(), new Date().getMonth()+1, 1)
      }
    })

    // Subscription
    const sub = await prisma.subscription.upsert({
      where: { stripeSubscriptionId: `sub_demo_${user.id}` },
      update: {},
      create: {
        userId: user.id,
        stripeSubscriptionId: `sub_demo_${user.id}`,
        stripeCustomerId: `cus_demo_${user.id}`,
        routedEntityId: entity.id,
        membershipType: d.membershipType,
        monthlyPrice: d.amount,
        status: 'ACTIVE',
        currentPeriodStart: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        currentPeriodEnd: new Date(new Date().getFullYear(), new Date().getMonth()+1, 1),
        nextBillingDate: new Date(new Date().getFullYear(), new Date().getMonth()+1, 1)
      }
    })

    // Invoice (last month) and Payment
    const lastMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth()-1, 1))
    const thisMonthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1))
    const invId = `in_demo_${user.id}_${lastMonthStart.toISOString().slice(0,7)}`

    await prisma.invoice.upsert({
      where: { stripeInvoiceId: invId },
      update: {},
      create: {
        subscriptionId: sub.id,
        stripeInvoiceId: invId,
        amount: d.amount,
        currency: 'GBP',
        status: 'paid',
        billingPeriodStart: lastMonthStart,
        billingPeriodEnd: thisMonthStart,
        dueDate: thisMonthStart,
        paidAt: thisMonthStart
      }
    })

    const desc = `Monthly membership payment [inv:${invId}]`
    const existing = await prisma.payment.findFirst({ where: { userId: user.id, description: { contains: `[inv:${invId}]` } } })
    if (!existing) {
      await prisma.payment.create({
        data: {
          userId: user.id,
          amount: d.amount,
          currency: 'GBP',
          status: 'CONFIRMED',
          description: desc,
          routedEntityId: entity.id,
          processedAt: thisMonthStart
        }
      })
    }
  }

  console.log('🎉 Demo customers seeded.')
}

main().then(async () => { await prisma.$disconnect() }).catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1) })


