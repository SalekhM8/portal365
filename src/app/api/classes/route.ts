import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET() {
  try {
    const classes = await prisma.class.findMany({
      where: { isActive: true },
      include: { service: { select: { name: true } } },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }]
    })

    // Normalize payload for the landing page timetable
    const payload = classes.map((c: any) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      instructorName: c.instructorName,
      dayOfWeek: c.dayOfWeek,
      startTime: c.startTime,
      endTime: c.endTime,
      duration: c.duration,
      maxParticipants: c.maxParticipants,
      location: c.location,
      serviceName: c.service?.name || 'General'
    }))

    return NextResponse.json({ success: true, classes: payload })
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Failed to load classes' }, { status: 500 })
  }
}


