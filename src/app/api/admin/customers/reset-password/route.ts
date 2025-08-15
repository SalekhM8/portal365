import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import * as bcrypt from 'bcryptjs'
import { z } from 'zod'

const resetPasswordSchema = z.object({
  customerId: z.string().min(1, 'Customer ID is required')
})

export async function POST(request: NextRequest) {
  try {
    // ✅ REUSE your exact auth pattern
    const session = await getServerSession(authOptions) as any
    
    if (!session || !session.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🔄 Processing admin password reset...')
    
    const body = await request.json()
    const validatedData = resetPasswordSchema.parse(body)
    
    // Check if customer exists
    const customer = await prisma.user.findUnique({
      where: { 
        id: validatedData.customerId,
        role: 'CUSTOMER' // Only allow resetting customer passwords
      }
    })
    
    if (!customer) {
      return NextResponse.json(
        { error: 'Customer not found' },
        { status: 404 }
      )
    }
    
    // Generate secure temporary password
    const tempPassword = `Temp${Math.random().toString(36).slice(2, 8)}!${Math.floor(Math.random() * 100)}`
    const hashedPassword = await bcrypt.hash(tempPassword, 12)
    
    // Update customer's password
    await prisma.user.update({
      where: { id: validatedData.customerId },
      data: { password: hashedPassword }
    })
    
    console.log(`✅ Password reset for customer: ${customer.email}`)
    
    // TODO: Log this action for security audit
    // await prisma.adminLog.create({
    //   data: {
    //     adminId: session.user.id,
    //     action: 'PASSWORD_RESET',
    //     targetUserId: customer.id,
    //     details: `Password reset for ${customer.email}`
    //   }
    // })
    
    return NextResponse.json({
      success: true,
      message: 'Password reset successfully',
      tempPassword: tempPassword,
      customerEmail: customer.email,
      customerName: `${customer.firstName} ${customer.lastName}`
    })
    
  } catch (error) {
    console.error('❌ Password reset error:', error)
    
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Validation failed', details: error.issues },
        { status: 400 }
      )
    }
    
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
