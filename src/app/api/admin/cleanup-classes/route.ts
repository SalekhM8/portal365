import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

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

    const results = []

    // 1. Delete the dummy hardcoded classes
    const dummyClasses = [
      'Brazilian Jiu-Jitsu Fundamentals', // John Smith Monday
      'Boxing Technique', // Sarah Wilson Wednesday  
      'MMA Sparring', // Mike Johnson Friday - keep this one, it's real
      'Masters Program - Technique Focus', // Keep - real
      'Masters Program - Sparring & Flow' // Keep - real
    ]

    for (const className of ['Brazilian Jiu-Jitsu Fundamentals', 'Boxing Technique']) {
      const deleted = await prisma.class.deleteMany({
        where: { name: className }
      })
      if (deleted.count > 0) {
        results.push(`Deleted dummy class: ${className}`)
      }
    }

    // 2. Update all classes to separate adults and kids properly
    const allClasses = await prisma.class.findMany()
    
    for (const cls of allClasses) {
      const nameLower = cls.name.toLowerCase()
      const isKidsClass = nameLower.startsWith('kids') || nameLower === 'kids no gi bjj'
      const isMastersClass = nameLower.includes('masters')
      const isWomenOnlyClass = nameLower.includes("women") || nameLower.includes("womens") || nameLower.includes("women's")
      const isWeekendDay = (cls.dayOfWeek === 5 || cls.dayOfWeek === 6 || cls.dayOfWeek === 0) // Fri, Sat, Sun

      let newRequiredMemberships: string[] = []

      if (isMastersClass) {
        newRequiredMemberships = ['MASTERS']
      } else if (isWomenOnlyClass) {
        newRequiredMemberships = ['WOMENS_CLASSES']
      } else if (isKidsClass) {
        // Kids classes: KIDS_UNLIMITED_UNDER14 always, KIDS_WEEKEND_UNDER14 only on weekends
        newRequiredMemberships = ['KIDS_UNLIMITED_UNDER14']
        if (isWeekendDay) {
          newRequiredMemberships.push('KIDS_WEEKEND_UNDER14')
        }
      } else {
        // Adult classes: FULL_ADULT always, WEEKEND_ADULT only on weekends
        newRequiredMemberships = ['FULL_ADULT']
        if (isWeekendDay) {
          newRequiredMemberships.push('WEEKEND_ADULT')
        }
      }

      // Update if different
      const currentMemberships = JSON.parse(cls.requiredMemberships)
      if (JSON.stringify(currentMemberships.sort()) !== JSON.stringify(newRequiredMemberships.sort())) {
        await prisma.class.update({
          where: { id: cls.id },
          data: { requiredMemberships: JSON.stringify(newRequiredMemberships) }
        })
        results.push(`Updated ${cls.name} (Day ${cls.dayOfWeek}): ${JSON.stringify(currentMemberships)} → ${JSON.stringify(newRequiredMemberships)}`)
      }
    }

    return NextResponse.json({ 
      success: true, 
      message: `Cleanup completed. ${results.length} changes made.`,
      results 
    })

  } catch (error) {
    console.error('Cleanup error:', error)
    return NextResponse.json({ 
      error: 'Failed to cleanup classes',
      details: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 })
  } finally {
    await prisma.$disconnect()
  }
} 