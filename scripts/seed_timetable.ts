import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type TimetableEntry = {
  day: number // 0=Sun ... 6=Sat
  name: string
  startTime: string // HH:MM
  endTime: string // HH:MM
  location?: string
  tags?: string[] // e.g., ['PRO','6M+','Invite only','Ages 7+']
}

type CoachRule = (e: TimetableEntry) => string | null

type MembershipRule = (e: TimetableEntry) => string[]

function minutesBetween(start: string, end: string): number {
  const [sh, sm] = start.split(':').map(Number)
  const [eh, em] = end.split(':').map(Number)
  return (eh * 60 + em) - (sh * 60 + sm)
}

const timetable: TimetableEntry[] = [
  // Monday (1)
  { day: 1, name: 'Morning Class', startTime: '06:30', endTime: '07:30', tags: ['6M+'] },
  { day: 1, name: 'Gi BJJ / Wall Wrestling', startTime: '11:00', endTime: '12:30', tags: ['PRO'] },
  { day: 1, name: 'Kids Striking', startTime: '17:30', endTime: '18:30', tags: ['Ages 7+'] },
  { day: 1, name: 'Beginners No Gi BJJ', startTime: '18:30', endTime: '19:30', tags: ['Beginners'] },
  { day: 1, name: 'Intermediate No Gi BJJ', startTime: '18:30', endTime: '19:30', tags: ['6M+'] },
  { day: 1, name: 'Gi BJJ', startTime: '19:30', endTime: '21:00', tags: ['PRO'] },
  { day: 1, name: 'Adult Wrestling', startTime: '20:00', endTime: '21:00', tags: ['All levels'] },

  // Tuesday (2)
  { day: 2, name: 'Morning Class', startTime: '06:30', endTime: '07:30', tags: ['6M+'] },
  { day: 2, name: 'No Gi BJJ', startTime: '11:00', endTime: '12:30', tags: ['PRO'] },
  { day: 2, name: 'Kids No Gi BJJ', startTime: '17:30', endTime: '18:30', tags: ['Ages 7+'] },
  { day: 2, name: 'Submission Grappling', startTime: '18:30', endTime: '19:45', tags: ['6M+'] },
  { day: 2, name: 'Beginners Gi BJJ', startTime: '19:30', endTime: '20:30', tags: ['Beginners'] },
  { day: 2, name: 'Adult MMA', startTime: '19:45', endTime: '21:00', tags: ['All levels'] },
  { day: 2, name: 'Masters BJJ', startTime: '21:30', endTime: '22:30', tags: ['Ages 30+'] },

  // Wednesday (3)
  { day: 3, name: 'Morning Class', startTime: '06:30', endTime: '07:30', tags: ['6M+'] },
  { day: 3, name: 'Gi BJJ', startTime: '11:00', endTime: '12:30', tags: ['PRO'] },
  { day: 3, name: 'Beginners No Gi Sparring', startTime: '18:00', endTime: '19:00', tags: ['Beginners'] },
  { day: 3, name: 'Adult Striking Class', startTime: '19:00', endTime: '20:00', tags: ['All levels'] },
  { day: 3, name: 'Wall Wrestling', startTime: '20:00', endTime: '21:00', tags: ['Invite only'] },

  // Thursday (4)
  { day: 4, name: 'Morning Class', startTime: '06:30', endTime: '07:30', tags: ['6M+'] },
  { day: 4, name: 'No Gi BJJ', startTime: '11:00', endTime: '12:30', tags: ['PRO'] },
  { day: 4, name: 'Kids Wrestling', startTime: '17:30', endTime: '18:30', tags: ['Ages 7+'] },
  { day: 4, name: 'Submission Grappling', startTime: '18:30', endTime: '19:45', tags: ['6M+'] },
  { day: 4, name: 'Beginners Gi BJJ', startTime: '19:30', endTime: '20:30', tags: ['Beginners'] },
  { day: 4, name: 'Adult MMA', startTime: '19:45', endTime: '21:00', tags: ['All levels'] },
  { day: 4, name: 'Masters BJJ', startTime: '21:30', endTime: '22:30', tags: ['Ages 30+'] },

  // Friday (5)
  { day: 5, name: 'Kids Gi BJJ', startTime: '17:30', endTime: '18:30', tags: ['Ages 7+'] },
  { day: 5, name: 'Beginners No Gi BJJ', startTime: '18:30', endTime: '19:30', tags: ['Beginners'] },
  { day: 5, name: 'Intermediate No Gi BJJ', startTime: '18:30', endTime: '19:30', tags: ['6M+'] },
  { day: 5, name: 'Gi BJJ', startTime: '19:30', endTime: '21:00', tags: ['PRO'] },
  { day: 5, name: 'Adult Wrestling', startTime: '20:00', endTime: '21:00', tags: ['All levels'] },

  // Saturday (6)
  { day: 6, name: 'Kids Striking', startTime: '10:00', endTime: '11:00', tags: ['Ages 6 to 9'] },
  { day: 6, name: 'Kids Striking', startTime: '11:00', endTime: '12:00', tags: ['Ages 10 to 13'] },
  { day: 6, name: 'MMA Team Sparring', startTime: '15:00', endTime: '16:00', tags: ['Invite only'] },
  { day: 6, name: 'Beginners No Gi BJJ', startTime: '18:00', endTime: '19:00', tags: ['Beginners'] },
  { day: 6, name: '10 Rounds BJJ Sparring', startTime: '19:00', endTime: '20:00', tags: ['All levels'] },

  // Sunday (0)
  { day: 0, name: 'Kids Wrestling', startTime: '10:00', endTime: '11:00', tags: ['Ages 6 to 9'] },
  { day: 0, name: 'Kids Wrestling', startTime: '11:00', endTime: '12:00', tags: ['Ages 10 to 13'] },
  { day: 0, name: 'Beginners No Gi BJJ', startTime: '18:00', endTime: '19:00', tags: ['Beginners'] },
  { day: 0, name: 'Adult Striking', startTime: '19:00', endTime: '20:00', tags: ['All levels'] }
]

// Coach assignment according to provided rules
const coachRules: CoachRule[] = [
  // Weekend kids override: Saturday/Sunday kids = Hamza
  (e) => ((e.day === 6 || e.day === 0) && (e.name.startsWith('Kids ') || e.name === 'Kids No Gi BJJ') ? 'Hamza' : null),
  // Wall Wrestling is Uzair (Wednesday)
  (e) => (e.name === 'Wall Wrestling' ? 'Uzair' : null),
  // Monday and Friday Wrestling is Ehsan (Adult Wrestling)
  (e) => ((e.name.startsWith('Adult Wrestling') && (e.day === 1 || e.day === 5)) ? 'Ehsan' : null),
  // MMA sparring is Dani
  (e) => (e.name === 'MMA Team Sparring' ? 'Dani' : null),
  // 10 rounds BJJ is Salekh
  (e) => (e.name.toLowerCase().includes('10 rounds bjj') ? 'Salekh' : null),
  // All beginner no gi is Salekh (includes sparring)
  (e) => (e.name.toLowerCase().includes('beginners') && e.name.toLowerCase().includes('no gi') ? 'Salekh' : null),
  // All beginner gi is Israr
  (e) => (e.name.toLowerCase().includes('beginners') && e.name.toLowerCase().includes('gi') && !e.name.toLowerCase().includes('no gi') ? 'Israr' : null),
  // Tuesday & Thursday Submission Grappling (18:30) is Dani
  (e) => ((e.name === 'Submission Grappling' && (e.day === 2 || e.day === 4)) ? 'Dani' : null),
  // Monday and Friday evening Gi is Dani (Gi BJJ at 19:30)
  (e) => ((e.name === 'Gi BJJ' && (e.day === 1 || e.day === 5)) ? 'Dani' : null),
  // All 6:30 am classes is Dani
  (e) => (e.startTime === '06:30' ? 'Dani' : null),
  // All 11am classes is Dani (but not for weekend kids which were already handled)
  (e) => (e.startTime === '11:00' ? 'Dani' : null),
  // Adults Striking or Adult MMA is Qudrat (do not capture Kids Striking)
  (e) => (((e.name.toLowerCase().includes('striking') && !e.name.startsWith('Kids ')) || e.name === 'Adult MMA') ? 'Qudrat' : null),
  // Remaining Kids classes (weekdays) are Dani
  (e) => ((e.name.startsWith('Kids ') || e.name === 'Kids No Gi BJJ') ? 'Dani' : null)
]

function assignCoach(e: TimetableEntry): string {
  for (const rule of coachRules) {
    const c = rule(e)
    if (c) return c
  }
  return 'Dani' // safe default
}

// Membership access rules
const membershipRule: MembershipRule = (e) => {
  const isKids = e.name.toLowerCase().startsWith('kids')
  const isWeekend = (e.day === 6 || e.day === 0)
  if (isKids) {
    return ['WEEKEND_UNDER18', 'FULL_UNDER18']
  }
  if (isWeekend) {
    return ['FULL_ADULT', 'WEEKEND_ADULT']
  }
  return ['FULL_ADULT']
}

async function getOrCreateService() {
  let service = await prisma.service.findFirst({ where: { name: 'Martial Arts Training' } })
  if (!service) {
    service = await prisma.service.create({
      data: {
        name: 'Martial Arts Training',
        description: 'General martial arts and fitness classes',
        category: 'MARTIAL_ARTS',
        basePrice: 0,
        currency: 'GBP',
        isActive: true,
        availableDays: JSON.stringify([0,1,2,3,4,5,6]),
        availableTimes: JSON.stringify(['06:00','07:00','08:00','09:00','10:00','11:00','12:00','13:00','14:00','15:00','16:00','17:00','18:00','19:00','20:00','21:00','22:00'])
      }
    })
  }
  return service
}

async function upsertClass(e: TimetableEntry) {
  const service = await getOrCreateService()
  const duration = minutesBetween(e.startTime, e.endTime)
  const requiredMemberships = JSON.stringify(membershipRule(e))
  const description = (e.tags && e.tags.length) ? e.tags.join(' / ') : ''
  const instructorName = assignCoach(e)

  // find existing by composite key (name + day + startTime)
  const existing = await prisma.class.findFirst({
    where: { name: e.name, dayOfWeek: e.day, startTime: e.startTime }
  })

  if (existing) {
    await prisma.class.update({
      where: { id: existing.id },
      data: {
        serviceId: service.id,
        description,
        instructorName,
        endTime: e.endTime,
        duration,
        maxParticipants: existing.maxParticipants ?? 30,
        isActive: true,
        requiredMemberships,
        location: e.location || 'Main Gym'
      }
    })
    return existing.id
  }

  const created = await prisma.class.create({
    data: {
      serviceId: service.id,
      name: e.name,
      description,
      instructorName,
      dayOfWeek: e.day,
      startTime: e.startTime,
      endTime: e.endTime,
      duration,
      maxParticipants: 30,
      isActive: true,
      requiredMemberships,
      location: e.location || 'Main Gym'
    }
  })
  return created.id
}

async function main() {
  console.log('🗓️  Seeding timetable...')
  for (const entry of timetable) {
    await upsertClass(entry)
    console.log(`✅ Upserted: ${entry.name} - Day ${entry.day} ${entry.startTime}-${entry.endTime} (${assignCoach(entry)})`)
  }
  console.log('✅ Timetable seeding complete')
}

main().then(async () => {
  await prisma.$disconnect()
}).catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
}) 