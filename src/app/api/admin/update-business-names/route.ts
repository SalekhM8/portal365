import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

/**
 * 🏢 UPDATE BUSINESS ENTITY NAMES
 * 
 * Updates production database with new business entity names:
 * - Aura Tuition Company → IQ Learning Centre
 * - Aura Wellness Center → Aura Fitness Centre
 */
export async function POST(request: NextRequest) {
  try {
    // 🔐 AUTHENTICATION & AUTHORIZATION
    const session = await getServerSession(authOptions) as any
    
    if (!session?.user?.email) {
      return NextResponse.json({ 
        success: false, 
        error: 'Authentication required',
        code: 'UNAUTHORIZED'
      }, { status: 401 })
    }

    // Verify admin permissions
    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { id: true, role: true, firstName: true, lastName: true }
    })

    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ 
        success: false, 
        error: 'Insufficient permissions - Admin access required',
        code: 'FORBIDDEN'
      }, { status: 403 })
    }

    console.log('🔄 Updating business entity names...')

    // Update Aura Tuition to IQ Learning Centre
    const tuitionUpdate = await prisma.businessEntity.update({
      where: { name: 'aura_tuition' },
      data: { 
        displayName: 'IQ Learning Centre'
      }
    })
    console.log('✅ Updated: Aura Tuition → IQ Learning Centre')

    // Update Aura Wellness to Aura Fitness Centre  
    const wellnessUpdate = await prisma.businessEntity.update({
      where: { name: 'aura_wellness' },
      data: { 
        displayName: 'Aura Fitness Centre'
      }
    })
    console.log('✅ Updated: Aura Wellness → Aura Fitness Centre')

    // Get all current entities to verify
    const allEntities = await prisma.businessEntity.findMany({
      select: { name: true, displayName: true }
    })

    return NextResponse.json({
      success: true,
      message: 'Business entity names updated successfully',
      updates: [
        {
          name: 'aura_tuition',
          oldDisplayName: 'Aura Tuition Company',
          newDisplayName: tuitionUpdate.displayName
        },
        {
          name: 'aura_wellness', 
          oldDisplayName: 'Aura Wellness Center',
          newDisplayName: wellnessUpdate.displayName
        }
      ],
      allEntities: allEntities,
      updatedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Error updating business entity names:', error)
    
    return NextResponse.json({
      success: false,
      error: 'Failed to update business entity names',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    }, { status: 500 })
  }
}
