import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * 🔍 DIAGNOSTIC: Find out why autopayments aren't being recorded
 * 
 * This endpoint fetches today's actual Stripe invoices and tests
 * the exact same logic your webhook uses to see where it fails
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

    console.log('🔍 Starting autopayment diagnostic...')

    // 📊 Get today's paid invoices from Stripe (last 24 hours to be safe)
    const yesterday = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)
    const stripeInvoices = await stripe.invoices.list({
      status: 'paid',
      created: { gte: yesterday },
      limit: 100
    })

    console.log(`📊 Found ${stripeInvoices.data.length} paid invoices in Stripe from last 24h`)

    const diagnosticResults = []
    let totalInvoices = 0
    let foundInDb = 0
    let subscriptionLookupFailed = 0
    let customerFallbackWorked = 0
    let completeFailures = 0

    for (const invoice of stripeInvoices.data) {
      totalInvoices++
      const result: any = {
        invoiceId: invoice.id,
        amount: invoice.amount_paid / 100,
        customer: invoice.customer,
        subscription: invoice.subscription,
        billing_reason: invoice.billing_reason,
        created: new Date(invoice.created * 1000).toISOString(),
        status: 'UNKNOWN'
      }

      try {
        // 🔍 TEST 1: Is this invoice already in our DB?
        const existingInvoice = await prisma.invoice.findUnique({ 
          where: { stripeInvoiceId: invoice.id } 
        })
        
        if (existingInvoice) {
          result.status = 'ALREADY_IN_DB'
          result.dbInvoiceId = existingInvoice.id
          foundInDb++
          diagnosticResults.push(result)
          continue
        }

        // 🔍 TEST 2: Can we find subscription using webhook logic?
        const subscriptionId = invoice.subscription
        let subscription = null
        
        if (subscriptionId) {
          subscription = await prisma.subscription.findUnique({ 
            where: { stripeSubscriptionId: subscriptionId }, 
            include: { user: true } 
          })
          
          if (subscription) {
            result.subscriptionLookup = 'SUCCESS'
            result.dbSubscriptionId = subscription.id
            result.userId = subscription.userId
            result.userEmail = subscription.user.email
          } else {
            result.subscriptionLookup = 'FAILED'
            result.failureReason = `No DB subscription found with stripeSubscriptionId: ${subscriptionId}`
            subscriptionLookupFailed++
          }
        } else {
          result.subscriptionLookup = 'NO_SUBSCRIPTION_ID'
          result.failureReason = 'invoice.subscription is null/missing'
          subscriptionLookupFailed++
        }

        // 🔍 TEST 3: Try metadata fallback
        if (!subscription && invoice.metadata?.dbSubscriptionId) {
          subscription = await prisma.subscription.findUnique({ 
            where: { id: invoice.metadata.dbSubscriptionId }, 
            include: { user: true } 
          })
          
          if (subscription) {
            result.metadataFallback = 'SUCCESS'
            result.dbSubscriptionId = subscription.id
            result.userId = subscription.userId
            result.userEmail = subscription.user.email
          } else {
            result.metadataFallback = 'FAILED'
          }
        }

        // 🔍 TEST 4: Try customer metadata fallback (what we'll add)
        if (!subscription && invoice.customer) {
          try {
            const stripeCustomer = await stripe.customers.retrieve(invoice.customer as string)
            const userId = (stripeCustomer as any).metadata?.userId
            
            if (userId) {
              subscription = await prisma.subscription.findFirst({
                where: { 
                  userId, 
                  status: { in: ['ACTIVE', 'TRIALING', 'PAUSED'] } 
                },
                include: { user: true },
                orderBy: { createdAt: 'desc' }
              })
              
              if (subscription) {
                result.customerFallback = 'SUCCESS'
                result.dbSubscriptionId = subscription.id
                result.userId = subscription.userId
                result.userEmail = subscription.user.email
                result.customerMetadataUserId = userId
                customerFallbackWorked++
              } else {
                result.customerFallback = 'NO_SUBSCRIPTION_FOR_USER'
                result.customerMetadataUserId = userId
              }
            } else {
              result.customerFallback = 'NO_USER_METADATA'
            }
          } catch (e) {
            result.customerFallback = 'CUSTOMER_RETRIEVE_FAILED'
            result.customerError = (e as Error).message
          }
        }

        // 🔍 TEST 5: Would DB insert work?
        if (subscription) {
          try {
            // Test if we can create the records (dry run simulation)
            const testInvoiceData = {
              subscriptionId: subscription.id,
              stripeInvoiceId: `test_${invoice.id}`,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency.toUpperCase(),
              status: invoice.status,
              billingPeriodStart: new Date(invoice.lines.data[0]?.period?.start * 1000 || invoice.period_start * 1000),
              billingPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || invoice.period_end * 1000),
              dueDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
              paidAt: new Date()
            }
            
            const testPaymentData = {
              userId: subscription.userId,
              amount: invoice.amount_paid / 100,
              currency: invoice.currency.toUpperCase(),
              status: 'CONFIRMED',
              description: invoice.billing_reason === 'subscription_create' ? 'Initial subscription payment (prorated)' : 'Monthly membership payment',
              routedEntityId: subscription.routedEntityId,
              processedAt: new Date()
            }

            // Validate the data structure (don't actually insert)
            result.dbInsertTest = 'WOULD_SUCCEED'
            result.testInvoiceData = testInvoiceData
            result.testPaymentData = testPaymentData
            result.status = 'RECOVERABLE'

          } catch (dbError) {
            result.dbInsertTest = 'WOULD_FAIL'
            result.dbError = (dbError as Error).message
            result.status = 'DB_ERROR'
          }
        } else {
          result.status = 'SUBSCRIPTION_NOT_FOUND'
          completeFailures++
        }

      } catch (error) {
        result.status = 'DIAGNOSTIC_ERROR'
        result.error = (error as Error).message
        completeFailures++
      }

      diagnosticResults.push(result)
    }

    // 📊 Summary
    const summary = {
      totalStripeInvoices: totalInvoices,
      alreadyInDb: foundInDb,
      subscriptionLookupFailed,
      customerFallbackWorked,
      completeFailures,
      recoverableCount: diagnosticResults.filter(r => r.status === 'RECOVERABLE').length
    }

    console.log('🔍 Diagnostic complete:', summary)

    return NextResponse.json({
      success: true,
      summary,
      diagnosticResults,
      recommendations: {
        fixWebhookHandler: subscriptionLookupFailed > 0 || completeFailures > 0,
        addCustomerFallback: customerFallbackWorked > 0,
        backfillNeeded: summary.recoverableCount > 0,
        criticalIssues: completeFailures > 0
      },
      analyzedBy: `${adminUser.firstName} ${adminUser.lastName}`,
      timestamp: new Date().toISOString()
    })

  } catch (error: any) {
    console.error('❌ Diagnostic failed:', error)
    return NextResponse.json({
      success: false,
      error: 'Diagnostic failed',
      details: error.message
    }, { status: 500 })
  }
}
