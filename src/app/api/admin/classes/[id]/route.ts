import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const params = await context.params
    const classId = params.id

    // Check if class exists
    const existingClass = await prisma.class.findUnique({
      where: { id: classId }
    })

    if (!existingClass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    const {
      name,
      description,
      instructorName,
      dayOfWeek,
      startTime,
      endTime,
      maxParticipants,
      location,
      isActive,
      requiredMemberships,
      ageRestrictions
    } = await request.json()

    // Calculate duration from start and end times
    const [startHour, startMin] = startTime.split(':').map(Number)
    const [endHour, endMin] = endTime.split(':').map(Number)
    const calculatedDuration = (endHour * 60 + endMin) - (startHour * 60 + startMin)

    // Update class
    const updatedClass = await prisma.class.update({
      where: { id: classId },
      data: {
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

    console.log(`✅ Class updated: ${updatedClass.name} by admin ${session.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Class updated successfully',
      class: {
        id: updatedClass.id,
        name: updatedClass.name,
        instructorName: updatedClass.instructorName,
        dayOfWeek: updatedClass.dayOfWeek,
        startTime: updatedClass.startTime,
        endTime: updatedClass.endTime
      }
    })

  } catch (error) {
    console.error('❌ Error updating class:', error)
    return NextResponse.json(
      { error: 'Failed to update class' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
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

    const params = await context.params
    const classId = params.id

    // Check if class exists
    const existingClass = await prisma.class.findUnique({
      where: { id: classId }
    })

    if (!existingClass) {
      return NextResponse.json({ error: 'Class not found' }, { status: 404 })
    }

    // Delete class
    await prisma.class.delete({
      where: { id: classId }
    })

    console.log(`✅ Class deleted: ${existingClass.name} by admin ${session.user.email}`)

    return NextResponse.json({
      success: true,
      message: 'Class deleted successfully'
    })

  } catch (error) {
    console.error('❌ Error deleting class:', error)
    return NextResponse.json(
      { error: 'Failed to delete class' },
      { status: 500 }
    )
  }
} 