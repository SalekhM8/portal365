import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true }
    })

    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    // Get all classes with service information
    const classes = await prisma.class.findMany({
      include: {
        service: {
          select: {
            name: true,
            category: true
          }
        }
      },
      orderBy: [
        { dayOfWeek: 'asc' },
        { startTime: 'asc' }
      ]
    })

    // Format classes for admin interface
    const formattedClasses = classes.map(cls => ({
      id: cls.id,
      name: cls.name,
      description: cls.description || '',
      instructorName: cls.instructorName,
      dayOfWeek: cls.dayOfWeek,
      startTime: cls.startTime,
      endTime: cls.endTime,
      duration: cls.duration,
      maxParticipants: cls.maxParticipants,
      location: cls.location,
      isActive: cls.isActive,
      requiredMemberships: cls.requiredMemberships ? JSON.parse(cls.requiredMemberships) : [],
      ageRestrictions: cls.ageRestrictions || ''
    }))

    return NextResponse.json({
      success: true,
      classes: formattedClasses
    })

  } catch (error) {
    console.error('❌ Error fetching classes:', error)
    return NextResponse.json(
      { error: 'Failed to fetch classes' },
      { status: 500 }
    )
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Check if user is admin
    const user = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true }
    })

    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })
    }

    const {
      name,
      description,
      instructorName,
      dayOfWeek,
      startTime,
      endTime,
      duration,
      maxParticipants,
      location,
      isActive,
      requiredMemberships,
      ageRestrictions
    } = await request.json()

    // Validate required fields
    if (!name || !instructorName || dayOfWeek === undefined || !startTime || !endTime || !location) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      )
    }

    // Get or create service for martial arts (classes need to be linked to a service)
    let service = await prisma.service.findFirst({
      where: { name: 'Martial Arts Training' }
    })

    if (!service) {
      service = await prisma.service.create({
        data: {
          name: 'Martial Arts Training',
          description: 'General martial arts and fitness classes',
          category: 'MARTIAL_ARTS',
          basePrice: 0,
          currency: 'GBP',
          isActive: true,
          availableDays: JSON.stringify([0, 1, 2, 3, 4, 5, 6]),
          availableTimes: JSON.stringify(['06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00'])
        }
      })
    }

    // Calculate duration from start and end times
    const [startHour, startMin] = startTime.split(':').map(Number)
    const [endHour, endMin] = endTime.split(':').map(Number)
    const calculatedDuration = (endHour * 60 + endMin) - (startHour * 60 + startMin)

    // Create new class
    const newClass = await prisma.class.create({
      data: {
        serviceId: service.id,
        name,
        description: description || '',
        instructorName,
        dayOfWeek: parseInt(dayOfWeek),
        startTime,
        endTime,
        duration: calculatedDuration > 0 ? calculatedDuration : 60,
        maxParticipants: parseInt(maxParticipants) || 20,
        location,
        isActive: isActive !== false,
        requiredMemberships: JSON.stringify(requiredMemberships || []),
        ageRestrictions: ageRestrictions || null
      }
    })

    console.log(`✅ Class created: ${newClass.name} by admin ${session.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Class created successfully',
      class: {
        id: newClass.id,
        name: newClass.name,
        instructorName: newClass.instructorName,
        dayOfWeek: newClass.dayOfWeek,
        startTime: newClass.startTime,
        endTime: newClass.endTime
      }
    })

  } catch (error) {
    console.error('❌ Error creating class:', error)
    return NextResponse.json(
      { error: 'Failed to create class' },
      { status: 500 }
    )
  }
} 