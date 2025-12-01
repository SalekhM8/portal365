import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * 🔄 BACKFILL MISSING AUTOPAYMENTS
 * 
 * Recovers all autopayments that were dropped due to webhook failures.
 * Uses the same robust mapping logic as the fixed webhook handler.
 */
export async function POST(request: NextRequest) {
  try {
    // 🔐 AUTHENTICATION
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const adminUser = await prisma.user.findUnique({
      where: { email: session.user.email },
      select: { role: true, firstName: true, lastName: true }
    })

    if (!adminUser || !['ADMIN', 'SUPER_ADMIN'].includes(adminUser.role)) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    console.log('🔄 Starting autopayment backfill...')

    // Get the date range for backfill (last 90 days to be safe)
    const ninetyDaysAgo = Math.floor((Date.now() - 90 * 24 * 60 * 60 * 1000) / 1000)
    
    // Fetch all paid invoices from Stripe
    console.log('📡 Fetching paid invoices from Stripe...')
    let allStripeInvoices: any[] = []
    let hasMore = true
    let startingAfter: string | undefined = undefined

    while (hasMore) {
      const batch: any = await stripe.invoices.list({
        status: 'paid',
        created: { gte: ninetyDaysAgo },
        limit: 100,
        starting_after: startingAfter
      })
      
      allStripeInvoices.push(...batch.data)
      hasMore = batch.has_more
      startingAfter = batch.data[batch.data.length - 1]?.id
    }

    console.log(`📊 Found ${allStripeInvoices.length} paid invoices in Stripe (last 90 days)`)

    // Get existing invoices to avoid duplicates
    const existingInvoices = await prisma.invoice.findMany({
      select: { stripeInvoiceId: true }
    })
    const existingInvoiceIds = new Set(existingInvoices.map(inv => inv.stripeInvoiceId))

    console.log(`📊 Found ${existingInvoices.length} existing invoices in database`)

    const results = []
    let recovered = 0
    let skipped = 0
    let failed = 0

    for (const invoice of allStripeInvoices) {
      const operationId = `backfill_${invoice.id}_${Date.now()}`
      
      try {
        // Skip if already in database
        if (existingInvoiceIds.has(invoice.id)) {
          skipped++
          continue
        }

        console.log(`🔄 [${operationId}] Processing missing invoice: ${invoice.id}`)

        // Use the same robust mapping logic as the fixed webhook
        let subscription = null
        let mappingMethod = 'UNKNOWN'
        const subscriptionId = invoice.subscription
        const amountPaid = invoice.amount_paid / 100

        // Method 1: Direct subscription lookup
        if (subscriptionId) {
          subscription = await prisma.subscription.findUnique({ 
            where: { stripeSubscriptionId: subscriptionId }, 
            include: { user: true } 
          })
          
          if (subscription) {
            mappingMethod = 'STRIPE_SUBSCRIPTION_ID'
          }
        }

        // Method 2: Metadata fallback
        if (!subscription && invoice.metadata?.dbSubscriptionId) {
          subscription = await prisma.subscription.findUnique({ 
            where: { id: invoice.metadata.dbSubscriptionId }, 
            include: { user: true } 
          })
          
          if (subscription) {
            mappingMethod = 'METADATA_SUBSCRIPTION_ID'
          }
        }

        // Method 3: Customer metadata fallback (the one that works)
        if (!subscription && invoice.customer) {
          try {
            const stripeCustomer = await stripe.customers.retrieve(invoice.customer as string)
            const userId = (stripeCustomer as any).metadata?.userId
            
            if (userId) {
              subscription = await prisma.subscription.findFirst({
                where: { 
                  userId, 
                  status: { in: ['ACTIVE', 'TRIALING', 'PAUSED', 'CANCELLED'] } 
                },
                include: { user: true },
                orderBy: { createdAt: 'desc' }
              })
              
              if (subscription) {
                mappingMethod = 'CUSTOMER_METADATA_FALLBACK'
              }
            }
          } catch (customerError) {
            console.error(`❌ [${operationId}] Customer retrieval failed:`, customerError)
          }
        }

        if (!subscription) {
          console.error(`❌ [${operationId}] Cannot map invoice to subscription`)
          results.push({
            invoiceId: invoice.id,
            amount: amountPaid,
            status: 'FAILED',
            reason: 'No subscription mapping found'
          })
          failed++
          continue
        }

        // Create missing invoice and payment records
        await prisma.$transaction(async (tx) => {
          // Create invoice record
          const invoiceRecord = await tx.invoice.create({
            data: {
              subscriptionId: subscription.id,
              stripeInvoiceId: invoice.id,
              amount: amountPaid,
              currency: invoice.currency.toUpperCase(),
              status: invoice.status,
              billingPeriodStart: new Date(invoice.lines.data[0]?.period?.start * 1000 || invoice.period_start * 1000),
              billingPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || invoice.period_end * 1000),
              dueDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
              paidAt: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now())
            }
          })

          // Create payment record
          const paymentDescription = invoice.billing_reason === 'subscription_create' 
            ? 'Initial subscription payment (prorated)' 
            : 'Monthly membership payment'
            
          const paymentRecord = await tx.payment.create({ 
            data: { 
              userId: subscription.userId, 
              amount: amountPaid, 
              currency: invoice.currency.toUpperCase(), 
              status: 'CONFIRMED', 
              description: paymentDescription, 
              routedEntityId: subscription.routedEntityId, 
              processedAt: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
              stripeInvoiceId: invoice.id
            } 
          })

          console.log(`✅ [${operationId}] Recovered: Invoice ${invoiceRecord.id} + Payment ${paymentRecord.id} for ${subscription.user.email}`)
        })

        results.push({
          invoiceId: invoice.id,
          amount: amountPaid,
          customerEmail: subscription.user.email,
          mappingMethod,
          status: 'RECOVERED'
        })
        
        recovered++

      } catch (error) {
        console.error(`❌ [${operationId}] Failed to process invoice:`, error)
        results.push({
          invoiceId: invoice.id,
          amount: invoice.amount_paid / 100,
          status: 'ERROR',
          error: error instanceof Error ? error.message : String(error)
        })
        failed++
      }
    }

    console.log(`✅ Backfill completed: ${recovered} recovered, ${skipped} skipped, ${failed} failed`)

    return NextResponse.json({
      success: true,
      message: `Backfill completed: ${recovered} autopayments recovered`,
      summary: {
        totalStripeInvoices: allStripeInvoices.length,
        existingInDatabase: existingInvoices.length,
        recovered,
        skipped,
        failed
      },
      results: results.slice(0, 50), // Limit response size
      processedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Backfill failed:', error)
    return NextResponse.json({
      success: false,
      error: 'Backfill operation failed',
      details: error.message
    }, { status: 500 })
  }
}
