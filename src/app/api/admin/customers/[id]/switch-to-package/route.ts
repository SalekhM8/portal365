import { NextRequest, NextResponse } from 'next/server'
import { getServerSession } from 'next-auth/next'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getStripeClient, type StripeAccountKey } from '@/lib/stripe'
import { applyPendingPackage, packageEndFor, utcMidnight } from '@/lib/package-handover'

/**
 * Switch an existing MONTHLY (Stripe) member to a CASH PACKAGE on the SAME
 * account — no cancel-and-recreate, no duplicate user, same PIN and history.
 *
 * Business rule (agreed 22 Sep 2026):
 *   - The package starts when the current paid period ends (the 1st). The
 *     Stripe subscription is set to cancel at period end; nothing is refunded,
 *     nothing is voided.
 *   - Money owed stays owed: open invoices are left open and remain in To-Do.
 *   - Cash taken is recorded on the membership + audit log ONLY (never the
 *     payments table, so it never enters VAT routing).
 *
 * On the 1st the subscription-deleted webhook (backstop: nightly reconcile
 * cron) converts the membership row in place via applyPendingPackage().
 *
 * Body: { offlinePackageId?, months?, price?, name?, cashPaid?, dryRun? }
 * dryRun returns the plan (or blockers) and changes nothing.
 */
const LIVE = ['ACTIVE', 'TRIALING', 'PAST_DUE', 'PAUSED']

export async function POST(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await getServerSession(authOptions) as any
    if (!session?.user?.email) return NextResponse.json({ error: 'Authentication required' }, { status: 401 })
    const admin = await prisma.user.findUnique({ where: { email: session.user.email }, select: { id: true, role: true, firstName: true, lastName: true } })
    if (!admin || !['ADMIN', 'SUPER_ADMIN'].includes(admin.role)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 })

    const { id: customerId } = await context.params
    const body = await request.json().catch(() => ({}))
    const dryRun = !!body.dryRun

    // ── Package definition: catalogue entry, optionally overridden per member
    let months = Number.isInteger(Number(body.months)) ? Number(body.months) : NaN
    let price: number | null = body.price != null && Number.isFinite(Number(body.price)) ? Number(body.price) : null
    let name: string | null = typeof body.name === 'string' && body.name.trim() ? body.name.trim() : null
    if (body.offlinePackageId) {
      const pkg = await prisma.offlinePackage.findUnique({ where: { id: String(body.offlinePackageId) } })
      if (!pkg || !pkg.active) return NextResponse.json({ error: 'Unknown or inactive package' }, { status: 400 })
      if (!Number.isInteger(months)) months = pkg.months
      if (price == null) price = Number(pkg.price)
      if (!name) name = pkg.name
    }
    if (!Number.isInteger(months) || months < 1 || months > 24) return NextResponse.json({ error: 'months must be 1-24 (pick a package or enter a length)' }, { status: 400 })
    if (!name) name = `${months}-Month Cash`
    const cashPaid: number | null = body.cashPaid != null && Number.isFinite(Number(body.cashPaid)) ? Number(body.cashPaid) : null

    // ── Load member
    const customer = await prisma.user.findUnique({
      where: { id: customerId },
      include: {
        memberships: { orderBy: { createdAt: 'desc' }, take: 1 },
        subscriptions: { where: { status: { in: LIVE } }, orderBy: { createdAt: 'desc' } }
      }
    })
    if (!customer) return NextResponse.json({ error: 'Customer not found' }, { status: 404 })
    const membership = customer.memberships[0]
    const liveSubs = customer.subscriptions.filter(s => s.stripeSubscriptionId?.startsWith('sub_'))
    const sub = liveSubs[0]

    // ── Preconditions: refuse anything we don't fully understand
    const blockers: string[] = []
    if (!membership) blockers.push('No membership row found.')
    if (membership?.endDate) blockers.push('Already on a cash package — use Renew instead.')
    if (membership?.pendingPackageName) blockers.push(`A switch to "${membership.pendingPackageName}" is already scheduled — undo it first.`)
    if (!sub) blockers.push('No live Stripe subscription to switch from.')
    if (liveSubs.length > 1) blockers.push('More than one live subscription on this account — resolve manually.')
    if (sub?.status === 'PAUSED') blockers.push('Membership is paused — resume (or let the pause end) first.')
    if (sub) {
      const windows = await prisma.subscriptionPauseWindow.count({ where: { subscriptionId: sub.id, status: { in: ['SCHEDULED', 'ACTIVE'] } } })
      if (windows > 0) blockers.push('A pause is scheduled or active — cancel it first.')
    }

    let stripeSub: any = null
    let stripe: ReturnType<typeof getStripeClient> | null = null
    if (sub && blockers.length === 0) {
      stripe = getStripeClient((sub.stripeAccountKey as StripeAccountKey) || 'SU')
      try { stripeSub = await stripe.subscriptions.retrieve(sub.stripeSubscriptionId) } catch (e: any) { blockers.push(`Stripe: ${e.message}`) }
      if (stripeSub?.metadata?.pending_plan) blockers.push(`A plan change to ${stripeSub.metadata.pending_plan} is pending in Stripe — resolve it first.`)
    }
    if (blockers.length) return NextResponse.json({ success: false, blockers, error: blockers[0] }, { status: 409 })

    // ── Subscription already ended in Stripe (webhook missed?) → hand over now
    if (stripeSub.status === 'canceled') {
      const start = utcMidnight(new Date())
      const end = packageEndFor(start, months)
      if (dryRun) return NextResponse.json({ success: true, dryRun: true, plan: { immediate: true, packageName: name, packageStart: start.toISOString().slice(0, 10), packageEnd: end.toISOString().slice(0, 10), price, cashPaid, notes: ['The Stripe subscription has already ended — the package would start today.'] } })
      await prisma.$transaction(async (tx) => {
        await tx.subscription.update({ where: { id: sub!.id }, data: { status: 'CANCELLED', cancelAtPeriodEnd: false } })
        await tx.membership.update({ where: { id: membership!.id }, data: { pendingPackageName: name, pendingPackageStart: start, pendingPackageEnd: end, pendingPackagePrice: price, pendingPackageCash: cashPaid } })
      })
      const applied = await applyPendingPackage(customer.id, 'switch-route-immediate')
      return NextResponse.json({ success: true, applied: true, message: `${customer.firstName} is now on ${name} until ${end.toISOString().slice(0, 10)}.`, packageEnd: applied?.endDate })
    }

    // ── Period end = the day the paid month runs out (stripe@18: on the item)
    const item = stripeSub.items?.data?.[0]
    const periodEndSec: number | undefined = item?.current_period_end || stripeSub.trial_end || stripeSub.current_period_end
    if (!periodEndSec) return NextResponse.json({ error: 'Could not read the current period end from Stripe' }, { status: 500 })
    const packageStart = utcMidnight(new Date(periodEndSec * 1000))
    const packageEnd = packageEndFor(packageStart, months)
    const monthlyEnds = new Date(packageStart.getTime() - 86400000) // last covered day

    // ── Money owed: reported, never touched
    const openInvoices = await stripe!.invoices.list({ subscription: sub!.stripeSubscriptionId, status: 'open', limit: 10 })
    const owedPence = openInvoices.data.reduce((a, i) => a + (i.amount_due || 0), 0)
    const cancelWasAlreadyScheduled = !!(stripeSub.cancel_at_period_end || stripeSub.cancel_at)

    const notes: string[] = []
    if (owedPence > 0) notes.push(`£${(owedPence / 100).toFixed(2)} is still unpaid on the monthly — it stays in To-Do until settled or voided.`)
    if (cancelWasAlreadyScheduled) notes.push('A cancellation was already scheduled; the package starts when it takes effect.')
    if (stripeSub.status === 'trialing') notes.push('Member is in their first (pre-paid) month; the package starts when it ends.')

    const plan = {
      immediate: false,
      monthlyPlan: membership!.membershipType,
      monthlyEnds: monthlyEnds.toISOString().slice(0, 10),
      packageName: name,
      packageMonths: months,
      packageStart: packageStart.toISOString().slice(0, 10),
      packageEnd: packageEnd.toISOString().slice(0, 10),
      price,
      cashPaid,
      owed: owedPence / 100,
      notes
    }
    if (dryRun) return NextResponse.json({ success: true, dryRun: true, plan })

    // ── Do it: Stripe ends the sub at period end; DB remembers the package
    if (!cancelWasAlreadyScheduled) {
      await stripe!.subscriptions.update(sub!.stripeSubscriptionId, {
        cancel_at_period_end: true,
        metadata: { ...(stripeSub.metadata || {}), pending_package: name, pending_package_start: plan.packageStart }
      })
    } else {
      await stripe!.subscriptions.update(sub!.stripeSubscriptionId, { metadata: { ...(stripeSub.metadata || {}), pending_package: name, pending_package_start: plan.packageStart } })
    }
    const operationId = `switch_pkg_${sub!.id}_${Date.now()}`
    await prisma.$transaction(async (tx) => {
      await tx.subscription.update({ where: { id: sub!.id }, data: { cancelAtPeriodEnd: true } })
      await tx.membership.update({
        where: { id: membership!.id },
        data: { pendingPackageName: name, pendingPackageStart: packageStart, pendingPackageEnd: packageEnd, pendingPackagePrice: price, pendingPackageCash: cashPaid }
      })
      await tx.subscriptionAuditLog.create({
        data: {
          subscriptionId: sub!.id,
          action: 'SWITCH_TO_PACKAGE_SCHEDULED',
          performedBy: admin.id,
          performedByName: `${admin.firstName} ${admin.lastName}`,
          reason: `Switch to cash package "${name}" from ${plan.packageStart} (monthly ends ${plan.monthlyEnds})${cashPaid != null ? ` — £${cashPaid} cash taken` : ''}`,
          operationId,
          metadata: JSON.stringify({ plan, cancelWasAlreadyScheduled, snapshot: { membershipType: membership!.membershipType, monthlyPrice: membership!.monthlyPrice, startDate: membership!.startDate, nextBillingDate: membership!.nextBillingDate, status: membership!.status } })
        }
      })
    })

    console.log(`📦 [${operationId}] ${customer.email}: monthly ends ${plan.monthlyEnds}, "${name}" ${plan.packageStart} → ${plan.packageEnd} (cash £${cashPaid ?? '-'}) by ${admin.firstName} ${admin.lastName}`)
    return NextResponse.json({
      success: true,
      plan,
      message: `${customer.firstName}: monthly ends ${plan.monthlyEnds}, then ${name} until ${plan.packageEnd}.${owedPence > 0 ? ` £${(owedPence / 100).toFixed(2)} still owed stays in To-Do.` : ''}`
    })
  } catch (e: any) {
    console.error('❌ switch-to-package failed:', e)
    return NextResponse.json({ error: e?.message || 'Failed to switch to package' }, { status: 500 })
  }
}
