import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions, hasPermission } from '@/lib/auth'
import { z } from 'zod'
import * as bcrypt from 'bcryptjs'
import { prisma } from '@/lib/prisma'
import { packageEndFor } from '@/lib/package-handover'
import { assignUniquePin } from '@/lib/pin'
import { SubscriptionProcessor, getPublishableKey, type StripeAccountKey } from '@/lib/stripe'

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
  membershipType: z.enum(['WEEKEND_ADULT', 'KIDS_WEEKEND_UNDER14', 'FULL_ADULT', 'KIDS_UNLIMITED_UNDER14', 'MASTERS', 'PERSONAL_TRAINING', 'WOMENS_CLASSES', 'WELLNESS_PACKAGE']).optional(),
  offlinePackageId: z.string().optional(), // cash/offline package — no Stripe, fixed term
  packageMonths: z.number().int().min(1).max(24).optional(),   // per-member override of the catalogue length
  packagePrice: z.number().min(0).optional(),                  // per-member override of the catalogue price (bespoke deals)
  packageCashPaid: z.number().min(0).optional(),               // cash taken at the desk — recorded on the membership only (no VAT routing)
  force: z.boolean().optional(),                               // create even though a possible duplicate member exists
  customPrice: z.number().min(1, 'Price must be greater than 0'),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Start date must be YYYY-MM-DD'),
  routedEntity: z.string().optional()
}).superRefine((data, ctx) => {
  // Monthly Stripe members bill on the 1st; cash packages can start any day
  if (!data.offlinePackageId && !data.startDate.endsWith('-01')) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['startDate'], message: 'Start date must be first of month (YYYY-MM-01)' })
  }
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

    // Soft duplicate guard: same name, or same phone, as an existing member.
    // Creating a second account is how cash-package conversions used to be
    // done (14 duplicate accounts) — the right tool for an existing member is
    // "Switch to cash package" on their own card. Admin can still force it.
    if (!validatedData.force) {
      const fn = validatedData.firstName.trim(), ln = validatedData.lastName.trim(), ph = (validatedData.phone || '').replace(/\s+/g, '')
      const lookalikes = await prisma.user.findMany({
        where: {
          role: 'CUSTOMER',
          OR: [
            { AND: [{ firstName: { equals: fn, mode: 'insensitive' } }, { lastName: { equals: ln, mode: 'insensitive' } }] },
            ...(ph.length >= 10 ? [{ phone: { contains: ph.slice(-10) } }] : [])
          ]
        },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true, createdAt: true, memberships: { orderBy: { createdAt: 'desc' }, take: 1, select: { membershipType: true, status: true, endDate: true } } },
        take: 5
      })
      if (lookalikes.length > 0) {
        return NextResponse.json({
          error: 'Looks like this member already exists',
          code: 'POSSIBLE_DUPLICATE',
          duplicates: lookalikes.map(u => ({ id: u.id, name: `${u.firstName} ${u.lastName}`, email: u.email, phone: u.phone, joined: u.createdAt.toISOString().slice(0, 10), membership: u.memberships[0]?.membershipType || '—', status: u.memberships[0]?.status || '—', matchedBy: (u.firstName.trim().toLowerCase() === fn.toLowerCase() && u.lastName.trim().toLowerCase() === ln.toLowerCase()) ? 'name' : 'phone' }))
        }, { status: 409 })
      }
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
    await assignUniquePin(user.id) // door check-in PIN
    
    console.log('✅ Admin-created user:', user.id)

    // ── OFFLINE (CASH) PACKAGE: fixed-term membership, no Stripe at all ──
    if (validatedData.offlinePackageId) {
      const pkg = await prisma.offlinePackage.findUnique({ where: { id: validatedData.offlinePackageId } })
      if (!pkg || !pkg.active) {
        await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
        return NextResponse.json({ error: 'Unknown or inactive package' }, { status: 400 })
      }
      const start = new Date(validatedData.startDate)
      // Bespoke deals: length and price can be set per member (catalogue values are the defaults)
      const months = validatedData.packageMonths ?? pkg.months
      const price = validatedData.packagePrice ?? Number(pkg.price)
      const end = packageEndFor(start, months)
      await prisma.membership.create({
        data: {
          userId: user.id,
          membershipType: pkg.name,
          status: 'ACTIVE',
          startDate: start,
          endDate: end,
          monthlyPrice: price,
          packageCashPaid: validatedData.packageCashPaid ?? null,
          setupFee: 0,
          accessPermissions: JSON.stringify({ martialArts: ['bjj', 'boxing', 'muay_thai', 'mma'], personalTraining: false, womensClasses: false, wellness: false }),
          scheduleAccess: JSON.stringify({ weekdays: true, weekends: true, timeSlots: ['morning', 'afternoon', 'evening'] }),
          ageCategory: 'ADULT',
          billingDay: 1,
          nextBillingDate: end
        }
      })
      const freshUser = await prisma.user.findUnique({ where: { id: user.id }, select: { pin: true } })
      return NextResponse.json({
        success: true,
        offlinePackage: true,
        message: `${validatedData.firstName} added on ${pkg.name} (${months} months, £${price}) — runs ${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}. PIN: ${freshUser?.pin}`,
        customer: { id: user.id, pin: freshUser?.pin, packageEnd: end.toISOString().slice(0, 10) }
      })
    }
    if (!validatedData.membershipType) {
      await prisma.user.delete({ where: { id: user.id } }).catch(() => {})
      return NextResponse.json({ error: 'membershipType or offlinePackageId required' }, { status: 400 })
    }
    
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
        'KIDS_WEEKEND_UNDER14': {
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
        'KIDS_UNLIMITED_UNDER14': {
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
        },
        'MASTERS': {
          accessPermissions: {
            martialArts: ['bjj', 'boxing', 'muay_thai'],
            personalTraining: false,
            womensClasses: false,
            wellness: false
          },
          scheduleAccess: {
            weekdays: true,
            weekends: false,
            timeSlots: ['evening'] // 9:30pm Tuesday & Thursday
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
        ageCategory: validatedData.membershipType.includes('UNDER14') ? 'YOUTH' : 'ADULT',
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

      // Get publishable key for the assigned account
      const accountKey = (subscriptionResult.subscription as any).stripeAccountKey as StripeAccountKey || 'AURAUP'
      const publishableKey = getPublishableKey(accountKey)

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
          paymentRequired: true,
          publishableKey
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