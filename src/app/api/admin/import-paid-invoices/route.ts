import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'

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
    const accountParam: StripeAccountKey = ((body?.account || 'SU') as string).toUpperCase() as StripeAccountKey
    const stripe = getStripeClient(accountParam)
    const forceCustomerLookup: boolean = body?.forceCustomerLookup === true
    const reassignAcrossUsers: boolean = body?.reassignAcrossUsers === true
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
          // If invoice already exists, ensure a matching CONFIRMED payment row exists for this user;
          // if a payment exists for another user and reassignAcrossUsers=true, reassign it.
          if (exists) {
            const paidAtMs = (inv.status_transitions?.paid_at || inv.created) * 1000
            const paidAt = new Date(paidAtMs)
            // Any payment with this invoice tag, regardless of user
            const paymentAnyUser = await prisma.payment.findFirst({ where: { description: { contains: `[inv:${inv.id}]` } } })
            if (paymentAnyUser) {
              if (paymentAnyUser.userId !== user.id && reassignAcrossUsers) {
                await prisma.payment.update({ where: { id: paymentAnyUser.id }, data: { userId: user.id } })
                imported++
              }
            } else {
              // No payment with this invoice id anywhere → prefer tagging an existing same-day payment, else create
              const dayStart = new Date(paidAt)
              dayStart.setHours(0,0,0,0)
              const dayEnd = new Date(paidAt)
              dayEnd.setHours(23,59,59,999)
              const sameDay = await prisma.payment.findFirst({
                where: {
                  userId: user.id,
                  status: 'CONFIRMED',
                  amount: amountPaid,
                  processedAt: { gte: dayStart, lte: dayEnd }
                }
              })
              if (sameDay) {
                const desc = sameDay.description || 'Monthly membership payment'
                if (!desc.includes(`[inv:${inv.id}]`)) {
                  await prisma.payment.update({ where: { id: sameDay.id }, data: { description: `${desc} [inv:${inv.id}]` } })
                }
              } else {
                await prisma.payment.create({
                  data: {
                    userId: user.id,
                    amount: amountPaid,
                    currency: (inv.currency || 'gbp').toUpperCase(),
                    status: 'CONFIRMED',
                    description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                    routedEntityId: sub.routedEntityId,
                processedAt: paidAt,
                stripeInvoiceId: inv.id
                  }
                })
              }
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

          // Create/Tag payment idempotently (same-day, same-amount)
          const paidAtMsCreate = (inv.status_transitions?.paid_at || inv.created) * 1000
          const paidAtCreate = new Date(paidAtMsCreate)
          const dayStartCreate = new Date(paidAtCreate); dayStartCreate.setHours(0,0,0,0)
          const dayEndCreate = new Date(paidAtCreate); dayEndCreate.setHours(23,59,59,999)
          const sameDayExistingCreate = await prisma.payment.findFirst({
            where: { userId: user.id, status: 'CONFIRMED', amount: amountPaid, processedAt: { gte: dayStartCreate, lte: dayEndCreate } }
          })
          if (sameDayExistingCreate) {
            const desc = sameDayExistingCreate.description || 'Monthly membership payment'
            if (!desc.includes(`[inv:${inv.id}]`)) {
              await prisma.payment.update({ where: { id: sameDayExistingCreate.id }, data: { description: `${desc} [inv:${inv.id}]` } })
            }
          } else {
            await prisma.payment.create({
              data: {
                userId: user.id,
                amount: amountPaid,
                currency: (inv.currency || 'gbp').toUpperCase(),
                status: 'CONFIRMED',
                description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                routedEntityId: sub.routedEntityId,
                processedAt: paidAtCreate,
                stripeInvoiceId: inv.id
              }
            })
          }

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
                // Ensure payment exists; if it exists under a different user, optionally reassign
                const paidAtMs = (inv.status_transitions?.paid_at || inv.created) * 1000
                const paidAt = new Date(paidAtMs)
                const paymentAnyUser = await prisma.payment.findFirst({ where: { description: { contains: `[inv:${inv.id}]` } } })
                if (paymentAnyUser) {
                  if (paymentAnyUser.userId !== user.id && reassignAcrossUsers) {
                    await prisma.payment.update({ where: { id: paymentAnyUser.id }, data: { userId: user.id } })
                    imported++
                  }
                } else {
                  // Attach or tag latest subscription for this user idempotently
                  const targetSub = subs[0]
                  const dayStart = new Date(paidAt); dayStart.setHours(0,0,0,0)
                  const dayEnd = new Date(paidAt); dayEnd.setHours(23,59,59,999)
                  const sameDay = await prisma.payment.findFirst({
                    where: { userId: user.id, status: 'CONFIRMED', amount: amountPaid, processedAt: { gte: dayStart, lte: dayEnd } }
                  })
                  if (sameDay) {
                    const desc = sameDay.description || 'Monthly membership payment'
                    if (!desc.includes(`[inv:${inv.id}]`)) {
                      await prisma.payment.update({ where: { id: sameDay.id }, data: { description: `${desc} [inv:${inv.id}]` } })
                    }
                  } else {
                    await prisma.payment.create({
                      data: {
                        userId: user.id,
                        amount: amountPaid,
                        currency: (inv.currency || 'gbp').toUpperCase(),
                        status: 'CONFIRMED',
                        description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                    routedEntityId: targetSub?.routedEntityId || subs[0]?.routedEntityId,
                    processedAt: paidAt,
                    stripeInvoiceId: inv.id
                      }
                    })
                  }
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
              // Create/Tag payment idempotently
              const paidAtMs2 = (inv.status_transitions?.paid_at || inv.created) * 1000
              const paidAt2 = new Date(paidAtMs2)
              const dayStart2 = new Date(paidAt2); dayStart2.setHours(0,0,0,0)
              const dayEnd2 = new Date(paidAt2); dayEnd2.setHours(23,59,59,999)
              const sameDay2 = await prisma.payment.findFirst({
                where: { userId: user.id, status: 'CONFIRMED', amount: amountPaid, processedAt: { gte: dayStart2, lte: dayEnd2 } }
              })
              if (sameDay2) {
                const desc = sameDay2.description || 'Monthly membership payment'
                if (!desc.includes(`[inv:${inv.id}]`)) {
                  await prisma.payment.update({ where: { id: sameDay2.id }, data: { description: `${desc} [inv:${inv.id}]` } })
                }
              } else {
                await prisma.payment.create({
                  data: {
                    userId: user.id,
                    amount: amountPaid,
                    currency: (inv.currency || 'gbp').toUpperCase(),
                    status: 'CONFIRMED',
                    description: `Monthly membership payment (imported) [inv:${inv.id}]`,
                    routedEntityId: targetSub.routedEntityId,
                    processedAt: paidAt2,
                    stripeInvoiceId: inv.id
                  }
                })
              }
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


