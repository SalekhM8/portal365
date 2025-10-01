import { PrismaClient } from '@prisma/client'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding membership plans...')

  for (const plan of Object.values(MEMBERSHIP_PLANS)) {
    const schedulePolicy = {
      timezone: 'Europe/London',
      allowedWindows: [
        { days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '24:00' }
      ]
    }

    await prisma.membershipPlan.upsert({
      where: { key: plan.key },
      update: {
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPrice: plan.monthlyPrice,
        features: JSON.stringify(plan.features),
        schedulePolicy: JSON.stringify(schedulePolicy),
        preferredEntities: plan.preferredEntities ? JSON.stringify(plan.preferredEntities) : null,
        active: true
      },
      create: {
        key: plan.key,
        name: plan.name,
        displayName: plan.displayName,
        description: plan.description,
        monthlyPrice: plan.monthlyPrice,
        features: JSON.stringify(plan.features),
        schedulePolicy: JSON.stringify(schedulePolicy),
        preferredEntities: plan.preferredEntities ? JSON.stringify(plan.preferredEntities) : null,
        active: true
      }
    })
    console.log(`✅ Upserted plan: ${plan.displayName}`)
  }

  await prisma.$disconnect()
  console.log('🎉 Membership plans seeded')
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})


