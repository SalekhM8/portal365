import { PrismaClient } from '../src/generated/prisma/index.js'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  console.log('🌱 Seeding database...')

  // Create business entities
  const entities = [
    {
      name: 'aura_mma',
      displayName: 'Aura MMA',
      description: 'Premier martial arts training facility',
      vatThreshold: 90000,
      currentRevenue: 78500,
      vatYearStart: new Date('2024-04-01'),
      vatYearEnd: new Date('2025-03-31'),
      status: 'ACTIVE' as const
    },
    {
      name: 'aura_tuition',
      displayName: 'Aura Tuition Company',
      description: '1-on-1 personal training & coaching',
      vatThreshold: 90000,
      currentRevenue: 45200,
      vatYearStart: new Date('2024-04-01'),
      vatYearEnd: new Date('2025-03-31'),
      status: 'ACTIVE' as const
    },
    {
      name: 'aura_womens',
      displayName: "Aura Women's Gym",
      description: 'Dedicated women-only fitness space',
      vatThreshold: 90000,
      currentRevenue: 23800,
      vatYearStart: new Date('2024-04-01'),
      vatYearEnd: new Date('2025-03-31'),
      status: 'ACTIVE' as const
    },
    {
      name: 'aura_wellness',
      displayName: 'Aura Wellness Center',
      description: 'Recovery, wellness & mental health',
      vatThreshold: 90000,
      currentRevenue: 67300,
      vatYearStart: new Date('2024-04-01'),
      vatYearEnd: new Date('2025-03-31'),
      status: 'ACTIVE' as const
    }
  ]

  for (const entity of entities) {
    await prisma.businessEntity.upsert({
      where: { name: entity.name },
      update: entity,
      create: entity
    })
    console.log(`✅ Created business entity: ${entity.displayName}`)
  }

  // Create demo admin user
  const hashedPassword = await bcrypt.hash('admin123', 12)
  
  await prisma.user.upsert({
    where: { email: 'admin@portal365.com' },
    update: {},
    create: {
      firstName: 'Admin',
      lastName: 'User',
      email: 'admin@portal365.com',
      password: hashedPassword,
      role: 'ADMIN',
      status: 'ACTIVE'
    }
  })
  console.log('✅ Created admin user: admin@portal365.com')

  // ✅ ADD real services and classes
  const mmaEntity = await prisma.businessEntity.findUnique({
    where: { name: 'aura_mma' }
  })

  if (mmaEntity) {
    // Create martial arts service
    let martialArtsService = await prisma.service.findFirst({
      where: { name: 'Martial Arts Training' }
    })

    if (!martialArtsService) {
      martialArtsService = await prisma.service.create({
        data: {
          name: 'Martial Arts Training',
          description: 'Comprehensive martial arts training including BJJ, MMA, Boxing, and Muay Thai',
          category: 'MARTIAL_ARTS',
          basePrice: 89.00,
          duration: 60,
          maxParticipants: 25,
          preferredEntityId: mmaEntity.id,
          availableDays: JSON.stringify([1, 2, 3, 4, 5, 6]), // Mon-Sat
          availableTimes: JSON.stringify(['19:00', '20:00', '21:00'])
        }
      })
    }
    console.log('✅ Created martial arts service')

    // Create real classes that match the hardcoded ones
    const classes = [
      {
        serviceId: martialArtsService.id,
        name: 'Brazilian Jiu-Jitsu Fundamentals',
        description: 'Learn the fundamentals of Brazilian Jiu-Jitsu',
        instructorName: 'John Smith',
        dayOfWeek: 1, // Monday
        startTime: '19:00',
        endTime: '20:00',
        duration: 60,
        maxParticipants: 20,
        requiredMemberships: JSON.stringify(['FULL_ADULT', 'WEEKEND_ADULT', 'FULL_UNDER18']),
        location: 'Mat Area 1'
      },
      {
        serviceId: martialArtsService.id,
        name: 'Boxing Technique',
        description: 'Technical boxing training and sparring',
        instructorName: 'Sarah Wilson',
        dayOfWeek: 3, // Wednesday
        startTime: '18:30',
        endTime: '19:30',
        duration: 60,
        maxParticipants: 15,
        requiredMemberships: JSON.stringify(['FULL_ADULT', 'WEEKEND_ADULT']),
        location: 'Boxing Ring'
      },
      {
        serviceId: martialArtsService.id,
        name: 'MMA Sparring',
        description: 'Mixed martial arts sparring sessions',
        instructorName: 'Mike Johnson',
        dayOfWeek: 5, // Friday
        startTime: '20:00',
        endTime: '21:00',
        duration: 60,
        maxParticipants: 12,
        requiredMemberships: JSON.stringify(['FULL_ADULT']),
        location: 'Octagon'
      },
      {
        serviceId: martialArtsService.id,
        name: 'Muay Thai Conditioning',
        description: 'High-intensity Muay Thai conditioning',
        instructorName: 'Alex Chen',
        dayOfWeek: 6, // Saturday
        startTime: '10:00',
        endTime: '11:00',
        duration: 60,
        maxParticipants: 18,
        requiredMemberships: JSON.stringify(['FULL_ADULT', 'WEEKEND_ADULT', 'FULL_UNDER18', 'WEEKEND_UNDER18']),
        location: 'Training Area 2'
      }
    ]

    for (const classData of classes) {
      const existingClass = await prisma.class.findFirst({
        where: { name: classData.name }
      })

      if (!existingClass) {
        await prisma.class.create({
          data: classData
        })
        console.log(`✅ Created class: ${classData.name}`)
      }
    }
  }

  console.log('🎉 Database seeded successfully!')
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (e) => {
    console.error(e)
    await prisma.$disconnect()
    process.exit(1)
  }) 