import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { z } from 'zod'
import * as bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { SubscriptionProcessor } from '@/lib/stripe'

// Validation schema for admin customer creation
const adminCreateCustomerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  emergencyContact: z.object({
    name: z.string(),
    phone: z.string(),
    relationship: z.string()
  }).optional(),
  membershipType: z.enum(['WEEKEND_ADULT', 'WEEKEND_UNDER18', 'FULL_ADULT', 'FULL_UNDER18', 'PERSONAL_TRAINING', 'WOMENS_CLASSES', 'WELLNESS_PACKAGE']),
  customPrice: z.number().min(1, 'Price must be greater than 0'),
  startDate: z.string().regex(/^\d{4}-\d{2}-01$/, 'Start date must be first of month (YYYY-MM-01)'),
  routedEntity: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    // Check admin authentication
    const session = await getServerSession(authOptions) as any
    
    if (!session || !session.user || !hasPermission(session.user.role, 'ADMIN')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    console.log('🔄 Processing admin customer creation...')
    
    const body = await request.json()
    const validatedData = adminCreateCustomerSchema.parse(body)
    
    // Check if user already exists
    const existingUser = await prisma.user.findUnique({
      where: { email: validatedData.email }
    })
    
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 400 }
      )
    }
    
    // Generate a temporary password (customer will set up payment method instead)
    const tempPassword = Math.random().toString(36).slice(-8)
    const hashedPassword = await bcrypt.hash(tempPassword, 12)
    
    // Create user
    const user = await prisma.user.create({
      data: {
        firstName: validatedData.firstName,
        lastName: validatedData.lastName,
        email: validatedData.email,
        password: hashedPassword,
        phone: validatedData.phone,
        dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : null,
        emergencyContact: validatedData.emergencyContact ? JSON.stringify(validatedData.emergencyContact) : null,
        role: 'CUSTOMER',
        status: 'ACTIVE'
      }
    })
    
    console.log('✅ Admin-created user:', user.id)
    
    // Get membership details (will be overridden by custom price)
    const getMembershipDetails = (membershipType: string) => {
      const memberships: Record<string, any> = {
        'WEEKEND_ADULT': {
          accessPermissions: {
            martialArts: ['bjj', 'boxing', 'muay_thai'],
            personalTraining: false,
            womensClasses: false,
            wellness: false
          },
          scheduleAccess: {
            weekdays: false,
            weekends: true,
            timeSlots: ['morning', 'afternoon', 'evening']
          }
        },
        'WEEKEND_UNDER18': {
          accessPermissions: {
            martialArts: ['bjj', 'boxing'],
            personalTraining: false,
            womensClasses: false,
            wellness: false
          },
          scheduleAccess: {
            weekdays: false,
            weekends: true,
            timeSlots: ['morning', 'afternoon']
          }
        },
        'FULL_ADULT': {
          accessPermissions: {
            martialArts: ['bjj', 'boxing', 'muay_thai', 'mma'],
            personalTraining: false,
            womensClasses: false,
            wellness: false
          },
          scheduleAccess: {
            weekdays: true,
            weekends: true,
            timeSlots: ['morning', 'afternoon', 'evening']
          }
        },
        'FULL_UNDER18': {
          accessPermissions: {
            martialArts: ['bjj', 'boxing'],
            personalTraining: false,
            womensClasses: false,
            wellness: false
          },
          scheduleAccess: {
            weekdays: true,
            weekends: true,
            timeSlots: ['afternoon', 'evening']
          }
        },
        'WOMENS_CLASSES': {
          accessPermissions: {
            martialArts: [],
            personalTraining: false,
            womensClasses: true,
            wellness: false
          },
          scheduleAccess: {
            weekdays: true,
            weekends: true,
            timeSlots: ['morning', 'afternoon', 'evening']
          }
        }
      }
      return memberships[membershipType] || memberships['FULL_ADULT']
    }

    const membershipDetails = getMembershipDetails(validatedData.membershipType)
    
    // Create membership record with admin custom price
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        membershipType: validatedData.membershipType,
        status: 'PENDING_PAYMENT',
        startDate: new Date(validatedData.startDate),
        monthlyPrice: validatedData.customPrice, // Admin custom price
        setupFee: 0,
        accessPermissions: JSON.stringify(membershipDetails.accessPermissions),
        scheduleAccess: JSON.stringify(membershipDetails.scheduleAccess),
        ageCategory: validatedData.membershipType.includes('UNDER18') ? 'YOUTH' : 'ADULT',
        billingDay: 1, // Always bill on the 1st of the month
        nextBillingDate: new Date(validatedData.startDate)
      }
    })
    
    console.log('✅ Admin membership created:', membership.id)
    
    try {
      // Create subscription using existing flow with admin overrides
      const subscriptionResult = await SubscriptionProcessor.createSubscription({
        userId: user.id,
        membershipType: validatedData.membershipType,
        businessId: 'aura_mma', // Default business for admin-created
        customerEmail: validatedData.email,
        customerName: `${validatedData.firstName} ${validatedData.lastName}`,
        
        // Admin overrides
        customPrice: validatedData.customPrice,
        customStartDate: validatedData.startDate,
        isAdminCreated: true // Skip prorated billing
      })

      console.log('✅ Admin subscription created successfully')

      // Return same format as registration
      return NextResponse.json({
        success: true,
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        },
        membership: {
          type: validatedData.membershipType,
          price: validatedData.customPrice,
          status: membership.status,
          startDate: validatedData.startDate
        },
        subscription: {
          id: subscriptionResult.subscription.id,
          clientSecret: subscriptionResult.clientSecret,
          status: subscriptionResult.subscription.status,
          routedTo: subscriptionResult.routing.selectedEntityId,
          routingReason: subscriptionResult.routing.routingReason,
          confidence: subscriptionResult.routing.confidence,
          proratedAmount: subscriptionResult.proratedAmount, // Should be 0 for admin
          nextBillingDate: subscriptionResult.nextBillingDate,
          paymentRequired: true
        }
      })

    } catch (stripeError: unknown) {
      console.error('❌ Stripe subscription error for admin customer:', stripeError)
      return NextResponse.json({
        success: true, // User and membership created
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        },
        membership: {
          type: validatedData.membershipType,
          price: validatedData.customPrice,
          status: membership.status
        },
        subscription: {
          error: 'Payment setup failed',
          details: stripeError instanceof Error ? stripeError.message : 'Unknown error'
        }
      }, { status: 207 })
    }
    
  } catch (error) {
    console.error('❌ Admin customer creation error:', error)
    
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