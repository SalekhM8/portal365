import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

type TimetableEntry = {
  day: number
  name: string
  startTime: string
  endTime: string
  location?: string
  tags?: string[]
}

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

const coachRules = [
  (e: TimetableEntry) => ((e.day === 6 || e.day === 0) && (e.name.startsWith('Kids ') || e.name === 'Kids No Gi BJJ') ? 'Hamza' : null),
  (e: TimetableEntry) => (e.name === 'Wall Wrestling' ? 'Uzair' : null),
  (e: TimetableEntry) => ((e.name.startsWith('Adult Wrestling') && (e.day === 1 || e.day === 5)) ? 'Ehsan' : null),
  (e: TimetableEntry) => (e.name === 'MMA Team Sparring' ? 'Dani' : null),
  (e: TimetableEntry) => (e.name.toLowerCase().includes('10 rounds bjj') ? 'Salekh' : null),
  (e: TimetableEntry) => (e.name.toLowerCase().includes('beginners') && e.name.toLowerCase().includes('no gi') ? 'Salekh' : null),
  (e: TimetableEntry) => (e.name.toLowerCase().includes('beginners') && e.name.toLowerCase().includes('gi') && !e.name.toLowerCase().includes('no gi') ? 'Israr' : null),
  (e: TimetableEntry) => ((e.name === 'Submission Grappling' && (e.day === 2 || e.day === 4)) ? 'Dani' : null),
  (e: TimetableEntry) => ((e.name === 'Gi BJJ' && (e.day === 1 || e.day === 5)) ? 'Dani' : null),
  (e: TimetableEntry) => (e.startTime === '06:30' ? 'Dani' : null),
  (e: TimetableEntry) => (e.startTime === '11:00' ? 'Dani' : null),
  (e: TimetableEntry) => (((e.name.toLowerCase().includes('striking') && !e.name.startsWith('Kids ')) || e.name === 'Adult MMA') ? 'Qudrat' : null),
  (e: TimetableEntry) => ((e.name.startsWith('Kids ') || e.name === 'Kids No Gi BJJ') ? 'Dani' : null)
]

function assignCoach(e: TimetableEntry): string {
  for (const rule of coachRules) {
    const c = rule(e)
    if (c) return c
  }
  return 'Dani'
}

const membershipRule: MembershipRule = (e) => {
  const nameLower = e.name.toLowerCase()
  const isKidsClass = nameLower.startsWith('kids') || nameLower === 'kids no gi bjj'
  const isMastersClass = nameLower.includes('masters')
  const isWomenOnlyClass = nameLower.includes("women") || nameLower.includes("womens") || nameLower.includes("women's")
  const isWeekendDay = (e.day === 5 || e.day === 6 || e.day === 0)

  if (isMastersClass) {
    return ['MASTERS']
  }

  if (isWomenOnlyClass) {
    return ['WOMENS_CLASSES']
  }

  const allowed: string[] = ['FULL_ADULT', 'FULL_UNDER18']
  if (isWeekendDay) {
    allowed.push('WEEKEND_ADULT', 'WEEKEND_UNDER18')
  }
  return allowed
}

export async function POST(request: NextRequest) {
  try {
    // Check admin auth
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true }
    })

    if (!user || user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    // Get or create service
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

    const results = []
    
    for (const entry of timetable) {
      const duration = minutesBetween(entry.startTime, entry.endTime)
      const requiredMemberships = JSON.stringify(membershipRule(entry))
      const description = (entry.tags && entry.tags.length) ? entry.tags.join(' / ') : ''
      const instructorName = assignCoach(entry)

      const existing = await prisma.class.findFirst({
        where: { name: entry.name, dayOfWeek: entry.day, startTime: entry.startTime }
      })

      if (existing) {
        await prisma.class.update({
          where: { id: existing.id },
          data: {
            serviceId: service.id,
            description,
            instructorName,
            endTime: entry.endTime,
            duration,
            maxParticipants: existing.maxParticipants ?? 30,
            isActive: true,
            requiredMemberships,
            location: entry.location || 'Main Gym'
          }
        })
        results.push(`Updated: ${entry.name} - Day ${entry.day} ${entry.startTime}-${entry.endTime}`)
      } else {
        await prisma.class.create({
          data: {
            serviceId: service.id,
            name: entry.name,
            description,
            instructorName,
            dayOfWeek: entry.day,
            startTime: entry.startTime,
            endTime: entry.endTime,
            duration,
            maxParticipants: 30,
            isActive: true,
            requiredMemberships,
            location: entry.location || 'Main Gym'
          }
        })
        results.push(`Created: ${entry.name} - Day ${entry.day} ${entry.startTime}-${entry.endTime}`)
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Timetable synced successfully. ${results.length} classes processed.`,
      results 
    })

  } catch (error) {
    console.error('Timetable sync error:', error)
    return NextResponse.json({ 
      error: 'Failed to sync timetable',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
} 