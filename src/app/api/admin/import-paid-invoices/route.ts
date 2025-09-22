import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { stripe } from '@/lib/stripe'

/**
 * Safely import paid Stripe invoices for specific customers (emails)
 * - Idempotent (skips existing stripeInvoiceId)
 * - Skips amount_paid <= 0
 * - Flips subscription/membership to ACTIVE
 */
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { role: true } })
    if (!admin || !['ADMIN','SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const emails: string[] = body?.emails || []
    const sinceIso: string | undefined = body?.sinceIso
    const forceCustomerLookup: boolean = body?.forceCustomerLookup === true
    const since = sinceIso ? new Date(sinceIso) : new Date(Date.now() - 7*24*60*60*1000)

    if (!Array.isArray(emails) || emails.length === 0) {
      return NextResponse.json({ error: 'Provide emails: string[]' }, { status: 400 })
    }

    const results: any[] = []

    for (const email of emails) {
      const user = await prisma.user.findUnique({ where: { email } })
      if (!user) { results.push({ email, note: 'user_not_found' }); continue }

      const subs = await prisma.subscription.findMany({ where: { userId: user.id }, include: { user: true } })
      if (subs.length === 0) { results.push({ email, note: 'no_subscription' }); continue }

      let imported = 0
      let examined = 0
      const processedCustomerIds = new Set<string>()

      for (const sub of subs) {
        if (!sub.stripeCustomerId) continue
        processedCustomerIds.add(sub.stripeCustomerId)
        const invs: any = await stripe.invoices.list({ customer: sub.stripeCustomerId, status: 'paid', created: { gte: Math.floor(since.getTime()/1000) }, limit: 100 })
        for (const inv of invs.data) {
          examined++
          const amountPaid = Number(inv.amount_paid || 0) / 100
          if (!amountPaid || amountPaid <= 0) continue
          const exists = await prisma.invoice.findUnique({ where: { stripeInvoiceId: inv.id } })
          // If invoice already exists, ensure a matching CONFIRMED payment row also exists; if not, create it (idempotent backfill)
          if (exists) {
            const paidAtMs = (inv.status_transitions?.paid_at || inv.created) * 1000
            const paidAt = new Date(paidAtMs)
            const existingPayment = await prisma.payment.findFirst({
              where: {
                userId: user.id,
                status: 'CONFIRMED',
                OR: [
                  { description: { contains: `[inv:${inv.id}]` } },
                  {
                    AND: [
                      { amount: amountPaid },
                      {
                        processedAt: {
                          gte: new Date(paidAtMs - 7 * 24 * 60 * 60 * 1000),
                          lte: new Date(paidAtMs + 7 * 24 * 60 * 60 * 1000)
                        }
                      }
                    ]
                  }
                ]
              }
            })
            if (!existingPayment) {
              await prisma.payment.create({
                data: {
                  userId: user.id,
                  amount: amountPaid,
                  currency: (inv.currency || 'gbp').toUpperCase(),
                  status: 'CONFIRMED',
                  description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                  routedEntityId: sub.routedEntityId,
                  processedAt: paidAt
                }
              })
              imported++
            }
            continue
          }

          // Create invoice
          const invoiceRecord = await prisma.invoice.create({
            data: {
              subscriptionId: sub.id,
              stripeInvoiceId: inv.id,
              amount: amountPaid,
              currency: (inv.currency || 'gbp').toUpperCase(),
              status: inv.status,
              billingPeriodStart: new Date((inv.period_start || inv.lines?.data?.[0]?.period?.start || inv.created) * 1000),
              billingPeriodEnd: new Date((inv.period_end || inv.lines?.data?.[0]?.period?.end || inv.created) * 1000),
              dueDate: new Date((inv.status_transitions?.paid_at || inv.created) * 1000),
              paidAt: new Date((inv.status_transitions?.paid_at || inv.created) * 1000)
            }
          })

          // Set statuses
          await prisma.subscription.update({ where: { id: sub.id }, data: { status: 'ACTIVE', currentPeriodStart: new Date(sub.currentPeriodStart), currentPeriodEnd: new Date(sub.currentPeriodEnd) } })
          await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: 'ACTIVE' } })

          // Create payment
          await prisma.payment.create({
            data: {
              userId: user.id,
              amount: amountPaid,
              currency: (inv.currency || 'gbp').toUpperCase(),
              status: 'CONFIRMED',
              description: `Monthly membership payment (imported) [inv:${inv.id}]`,
              routedEntityId: sub.routedEntityId,
              processedAt: new Date((inv.status_transitions?.paid_at || inv.created) * 1000)
            }
          })

          imported++
        }
      }

      // Optional fallback: also fetch by Stripe customer via email (covers legacy users where local customerId is missing/mismatched)
      if (forceCustomerLookup || processedCustomerIds.size === 0) {
        try {
          const customerList = await stripe.customers.list({ email, limit: 5 })
          for (const cust of customerList.data) {
            if (!cust.id || processedCustomerIds.has(cust.id)) continue
            processedCustomerIds.add(cust.id)
            const invs: any = await stripe.invoices.list({ customer: cust.id, status: 'paid', created: { gte: Math.floor(since.getTime()/1000) }, limit: 100 })
            for (const inv of invs.data) {
              examined++
              const amountPaid = Number(inv.amount_paid || 0) / 100
              if (!amountPaid || amountPaid <= 0) continue

              const exists = await prisma.invoice.findUnique({ where: { stripeInvoiceId: inv.id } })
              if (exists) {
                // Ensure payment exists
                const paidAtMs = (inv.status_transitions?.paid_at || inv.created) * 1000
                const paidAt = new Date(paidAtMs)
                const existingPayment = await prisma.payment.findFirst({
                  where: {
                    userId: user.id,
                    status: 'CONFIRMED',
                    OR: [
                      { description: { contains: `[inv:${inv.id}]` } },
                      { amount: amountPaid }
                    ]
                  }
                })
                if (!existingPayment) {
                  // Attach to latest subscription for this user
                  const targetSub = subs[0]
                  await prisma.payment.create({
                    data: {
                      userId: user.id,
                      amount: amountPaid,
                      currency: (inv.currency || 'gbp').toUpperCase(),
                      status: 'CONFIRMED',
                      description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                      routedEntityId: targetSub?.routedEntityId || subs[0]?.routedEntityId,
                      processedAt: paidAt
                    }
                  })
                  imported++
                }
                continue
              }

              // Create invoice + payment linked to latest subscription
              const targetSub = subs[0]
              if (!targetSub) continue
              await prisma.invoice.create({
                data: {
                  subscriptionId: targetSub.id,
                  stripeInvoiceId: inv.id,
                  amount: amountPaid,
                  currency: (inv.currency || 'gbp').toUpperCase(),
                  status: inv.status,
                  billingPeriodStart: new Date((inv.period_start || inv.lines?.data?.[0]?.period?.start || inv.created) * 1000),
                  billingPeriodEnd: new Date((inv.period_end || inv.lines?.data?.[0]?.period?.end || inv.created) * 1000),
                  dueDate: new Date((inv.status_transitions?.paid_at || inv.created) * 1000),
                  paidAt: new Date((inv.status_transitions?.paid_at || inv.created) * 1000)
                }
              })
              await prisma.payment.create({
                data: {
                  userId: user.id,
                  amount: amountPaid,
                  currency: (inv.currency || 'gbp').toUpperCase(),
                  status: 'CONFIRMED',
                  description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                  routedEntityId: targetSub.routedEntityId,
                  processedAt: new Date((inv.status_transitions?.paid_at || inv.created) * 1000)
                }
              })
              await prisma.subscription.update({ where: { id: targetSub.id }, data: { status: 'ACTIVE' } })
              await prisma.membership.updateMany({ where: { userId: user.id }, data: { status: 'ACTIVE' } })
              imported++
            }
          }
        } catch {}
      }

      results.push({ email, examined, imported })
    }

    return NextResponse.json({ success: true, results })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Failed to import paid invoices' }, { status: 500 })
  }
}


