import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import * as bcrypt from 'bcryptjs'
import { prisma } from '../../../lib/prisma'
import { SubscriptionProcessor } from '../../../lib/stripe'

// Validation schema
const registerSchema = z.object({
  firstName: z.string().min(1, 'First name is required'),
  lastName: z.string().min(1, 'Last name is required'),
  email: z.string().email('Invalid email address'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  phone: z.string().optional(),
  dateOfBirth: z.string().optional(),
  emergencyContact: z.object({
    name: z.string(),
    phone: z.string(),
    relationship: z.string()
  }).optional(),
  guardian: z.object({
    name: z.string().min(1),
    phone: z.string().min(1)
  }).optional(),
  guardianConsent: z.boolean().optional(),
  membershipType: z.enum(['WEEKEND_ADULT', 'KIDS_WEEKEND_UNDER14', 'FULL_ADULT', 'KIDS_UNLIMITED_UNDER14', 'MASTERS', 'PERSONAL_TRAINING', 'WOMENS_CLASSES', 'WELLNESS_PACKAGE']),
  businessId: z.string()
})

export async function POST(request: NextRequest) {
  try {
    console.log('🔄 Processing registration request...')
    
    const body = await request.json()

    // Sanitize optional guardian payload: if both fields are blank, treat as undefined
    if (body && body.guardian) {
      const g = body.guardian || {}
      const nameBlank = !g.name || String(g.name).trim().length === 0
      const phoneBlank = !g.phone || String(g.phone).trim().length === 0
      if (nameBlank && phoneBlank) {
        delete body.guardian
      }
    }

    const validatedData = registerSchema.parse(body)
    
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
    
    // Hash password
    const hashedPassword = await bcrypt.hash(validatedData.password, 12)
    
    // Store plain password temporarily for auto-login (will be cleared after use)
    const plainPassword = validatedData.password
    
    // Age & guardian enforcement
    let guardianConsentAt: Date | null = null
    let emergencyContactPayload: any = validatedData.emergencyContact || null
    if (validatedData.dateOfBirth) {
      const dob = new Date(validatedData.dateOfBirth)
      const today = new Date()
      const age = today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0)
      if (age < 16) {
        if (!validatedData.guardian || !validatedData.guardianConsent) {
          return NextResponse.json({ error: 'Parental/guardian consent is required for under-16s' }, { status: 400 })
        }
        guardianConsentAt = new Date()
        // Merge guardian into emergency contact blob for now
        emergencyContactPayload = {
          ...(validatedData.emergencyContact || {}),
          guardian: {
            name: validatedData.guardian.name,
            phone: validatedData.guardian.phone,
            relationship: 'guardian'
          }
        }
      }
    }

    // Create user
    const userCreateData: any = {
      firstName: validatedData.firstName,
      lastName: validatedData.lastName,
      email: validatedData.email,
      password: hashedPassword,
      phone: validatedData.phone,
      dateOfBirth: validatedData.dateOfBirth ? new Date(validatedData.dateOfBirth) : null,
      emergencyContact: emergencyContactPayload ? JSON.stringify(emergencyContactPayload) : null,
      role: 'CUSTOMER',
      status: 'ACTIVE'
    }
    if (guardianConsentAt) {
      userCreateData.guardianConsentAt = guardianConsentAt
    }
    const user = await prisma.user.create({ data: userCreateData })
    
    console.log('✅ User created:', user.id)
    
    // Get membership details
    const membershipDetails = getMembershipDetails(validatedData.membershipType)
    
    // Create membership record
    const membership = await prisma.membership.create({
      data: {
        userId: user.id,
        membershipType: validatedData.membershipType,
        status: 'PENDING_PAYMENT',
        startDate: new Date(),
        monthlyPrice: membershipDetails.monthlyPrice,
        setupFee: membershipDetails.setupFee || 0,
        accessPermissions: JSON.stringify(membershipDetails.accessPermissions),
        scheduleAccess: JSON.stringify(membershipDetails.scheduleAccess),
        ageCategory: validatedData.membershipType.includes('UNDER14') ? 'YOUTH' : 'ADULT',
        billingDay: 1, // Always bill on the 1st of the month
        nextBillingDate: (() => {
          // Set to 1st of next month to match prorated billing strategy
          const now = new Date()
          const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)
          return nextMonth
        })()
      }
    })
    
    console.log('✅ Membership created:', membership.id)
    
    try {
      // ✅ CREATE SUBSCRIPTION WITH STRIPE (NEW PRORATED BILLING)
      console.log('🔄 Starting Stripe subscription creation...')
      console.log('🔍 Environment check:', {
        stripeKeyExists: !!process.env.STRIPE_SECRET_KEY
      })
      
      const subscriptionResult = await SubscriptionProcessor.createSubscription({
        userId: user.id,
        membershipType: validatedData.membershipType,
        businessId: validatedData.businessId,
        customerEmail: validatedData.email,
        customerName: `${validatedData.firstName} ${validatedData.lastName}`
      })

      console.log('✅ Subscription created successfully')

      // Return success response - payment setup required
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
          price: membership.monthlyPrice,
          status: membership.status
        },
        subscription: {
          id: subscriptionResult.subscription.id,
          clientSecret: subscriptionResult.clientSecret,
          status: subscriptionResult.subscription.status,
          routedTo: subscriptionResult.routing.selectedEntityId,
          routingReason: subscriptionResult.routing.routingReason,
          confidence: subscriptionResult.routing.confidence,
          proratedAmount: subscriptionResult.proratedAmount,
          nextBillingDate: subscriptionResult.nextBillingDate,
          paymentRequired: true
        }
      })

    } catch (stripeError: unknown) {
      console.error('❌ Stripe subscription error:', stripeError)
      console.error('❌ Full error details:', {
        name: stripeError instanceof Error ? stripeError.name : 'Unknown',
        message: stripeError instanceof Error ? stripeError.message : String(stripeError),
        stack: stripeError instanceof Error ? stripeError.stack : undefined
      })
      return NextResponse.json({
        success: true, // User and membership created, but payment failed
        user: {
          id: user.id,
          firstName: user.firstName,
          lastName: user.lastName,
          email: user.email
        },
        membership: {
          type: validatedData.membershipType,
          price: membership.monthlyPrice,
          status: membership.status
        },
        subscription: {
          error: 'Payment setup failed',
          details: stripeError instanceof Error ? stripeError.message : 'Unknown error'
        }
      }, { status: 207 }) // Multi-status: user created, payment failed
    }
    
  } catch (error) {
    console.error('❌ Registration error:', error)
    
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

// Helper function to get membership details
function getMembershipDetails(membershipType: string) {
  const memberships: Record<string, any> = {
    'WEEKEND_ADULT': {
      monthlyPrice: 55,
      setupFee: 0,
      accessPermissions: {
        martialArts: ['bjj', 'striking'],
        personalTraining: false,
        womensClasses: false,
        wellness: false
      },
      scheduleAccess: {
        weekdays: false,
        weekends: true, // Fri-Sun considered weekend here
        timeSlots: ['morning', 'afternoon', 'evening']
      }
    },
    'KIDS_WEEKEND_UNDER14': {
      monthlyPrice: 40,
      setupFee: 0,
      accessPermissions: {
        martialArts: ['kids_classes'],
        personalTraining: false,
        womensClasses: false,
        wellness: false
      },
      scheduleAccess: {
        weekdays: false,
        weekends: true, // Sat-Sun only for kids
        timeSlots: ['morning', 'afternoon']
      }
    },
    'FULL_ADULT': {
      monthlyPrice: 75,
      setupFee: 0,
      accessPermissions: {
        martialArts: ['bjj', 'striking', 'mma'],
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
    'KIDS_UNLIMITED_UNDER14': {
      monthlyPrice: 55,
      setupFee: 0,
      accessPermissions: {
        martialArts: ['kids_classes'],
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
    'MASTERS': {
      monthlyPrice: 45,
      setupFee: 0,
      accessPermissions: {
        martialArts: ['bjj', 'striking'],
        personalTraining: false,
        womensClasses: false,
        wellness: false
      },
      scheduleAccess: {
        weekdays: true,
        weekends: false,
        timeSlots: ['evening'] // 9:30pm exclusively Tuesday & Thursday
      }
    },
    'WOMENS_CLASSES': {
      monthlyPrice: 25,
      setupFee: 0,
      accessPermissions: {
        martialArts: [],
        personalTraining: false,
        womensClasses: true, // Access to all women's classes
        wellness: false
      },
      scheduleAccess: {
        weekdays: true,
        weekends: true,
        timeSlots: ['morning', 'afternoon', 'evening']
      }
    }
  }
  return memberships[membershipType]
} 