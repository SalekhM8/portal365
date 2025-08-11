import { prisma } from '@/lib/prisma'

export async function handlePaymentSucceeded(invoice: any) {
  try {
    const subscriptionId = invoice.subscription
    const amountPaid = invoice.amount_paid / 100

    const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
    if (!subscription) return

    const existingInvoice = await prisma.invoice.findUnique({ where: { stripeInvoiceId: invoice.id } })
    if (existingInvoice) return

    await prisma.invoice.create({
      data: {
        subscriptionId: subscription.id,
        stripeInvoiceId: invoice.id,
        amount: amountPaid,
        currency: invoice.currency.toUpperCase(),
        status: invoice.status,
        billingPeriodStart: new Date(invoice.lines.data[0]?.period?.start * 1000 || invoice.period_start * 1000),
        billingPeriodEnd: new Date(invoice.lines.data[0]?.period?.end * 1000 || invoice.period_end * 1000),
        dueDate: new Date(invoice.status_transitions?.paid_at ? invoice.status_transitions.paid_at * 1000 : Date.now()),
        paidAt: new Date()
      }
    })

    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'ACTIVE', currentPeriodStart: new Date(invoice.period_start * 1000), currentPeriodEnd: new Date(invoice.period_end * 1000), nextBillingDate: new Date(invoice.period_end * 1000) } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'ACTIVE' } })
    await prisma.payment.create({ data: { userId: subscription.userId, amount: amountPaid, currency: invoice.currency.toUpperCase(), status: 'CONFIRMED', description: invoice.billing_reason === 'subscription_create' ? 'Initial subscription payment (prorated)' : 'Monthly membership payment', routedEntityId: subscription.routedEntityId, processedAt: new Date() } })
  } catch {}
}

export async function handlePaymentFailed(invoice: any) {
  try {
    const subscriptionId = invoice.subscription
    const amountDue = invoice.amount_due / 100
    const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: subscriptionId }, include: { user: true } })
    if (!subscription) return
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'PAST_DUE' } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'SUSPENDED' } })
    await prisma.payment.create({ data: { userId: subscription.userId, amount: amountDue, currency: invoice.currency.toUpperCase(), status: 'FAILED', description: 'Failed monthly membership payment', routedEntityId: subscription.routedEntityId, failureReason: 'Payment declined', processedAt: new Date() } })
  } catch {}
}

export async function handleSubscriptionUpdated(stripeSubscription: any) {
  try {
    await prisma.subscription.updateMany({ where: { stripeSubscriptionId: stripeSubscription.id }, data: { status: stripeSubscription.status.toUpperCase(), currentPeriodStart: new Date(stripeSubscription.current_period_start * 1000), currentPeriodEnd: new Date(stripeSubscription.current_period_end * 1000), nextBillingDate: new Date(stripeSubscription.current_period_end * 1000), cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end } })
  } catch {}
}

export async function handleSubscriptionCancelled(stripeSubscription: any) {
  try {
    const subscription = await prisma.subscription.findUnique({ where: { stripeSubscriptionId: stripeSubscription.id }, include: { user: true } })
    if (!subscription) return
    await prisma.subscription.update({ where: { id: subscription.id }, data: { status: 'CANCELLED' } })
    await prisma.membership.updateMany({ where: { userId: subscription.userId }, data: { status: 'CANCELLED' } })
  } catch {}
} 