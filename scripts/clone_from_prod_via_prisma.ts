import { PrismaClient } from '@prisma/client'

/**
 * Clone data from production into local using Prisma (safe, read-only from prod).
 *
 * Usage:
 *   PROD_PRISMA_DATABASE_URL="prisma+postgres://...accelerate..." \
 *   DATABASE_URL="postgresql://localhost:5432/portal365_dev" \
 *   npx tsx scripts/clone_from_prod_via_prisma.ts
 */

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`Missing env ${name}`)
  return v
}

async function main() {
  const prodUrl = requireEnv('PROD_PRISMA_DATABASE_URL')
  const localUrl = requireEnv('DATABASE_URL')

  const prod = new PrismaClient({ datasources: { db: { url: prodUrl } } })
  const local = new PrismaClient({ datasources: { db: { url: localUrl } } })

  console.log('🔌 Connected. Pulling data from prod (read-only)...')

  // Pull data from prod in dependency-friendly order
  const [
    businessEntities,
    services,
    classes,
    users,
    memberships,
    subscriptions,
    invoices,
    payments,
    subscriptionRouting,
    paymentRouting,
    vatCalculations,
    systemSettings,
  ] = await Promise.all([
    prod.businessEntity.findMany(),
    prod.service.findMany(),
    prod.class.findMany(),
    prod.user.findMany(),
    prod.membership.findMany(),
    prod.subscription.findMany(),
    prod.invoice.findMany(),
    prod.payment.findMany(),
    prod.subscriptionRouting.findMany(),
    prod.paymentRouting.findMany(),
    prod.vATCalculation.findMany(),
    prod.systemSetting.findMany(),
  ])

  console.log('📦 Rows:', {
    businessEntities: businessEntities.length,
    services: services.length,
    classes: classes.length,
    users: users.length,
    memberships: memberships.length,
    subscriptions: subscriptions.length,
    invoices: invoices.length,
    payments: payments.length,
  })

  console.log('🧹 Truncating local tables...')
  await local.$executeRawUnsafe(`
    TRUNCATE TABLE
      "payment_routing",
      "payments",
      "invoices",
      "subscription_routing",
      "subscriptions",
      "memberships",
      "classes",
      "services",
      "vat_calculations",
      "business_entities",
      "system_settings",
      "bookings",
      "access_logs",
      "biometric_data",
      "users"
    RESTART IDENTITY CASCADE;
  `)

  console.log('✍️  Inserting entities (preserving IDs)...')
  if (businessEntities.length) {
    await local.businessEntity.createMany({ data: businessEntities.map(b => ({ ...b })) })
  }
  if (services.length) {
    await local.service.createMany({ data: services.map(s => ({ ...s })) })
  }
  if (classes.length) {
    await local.class.createMany({ data: classes.map(c => ({ ...c })) })
  }

  // Sanitize users: emails and passwords
  if (users.length) {
    await local.user.createMany({
      data: users.map(u => ({
        ...u,
        email: `test+${u.id}@example.com`,
        password: null,
      })),
    })
  }

  if (memberships.length) {
    await local.membership.createMany({ data: memberships.map(m => ({ ...m })) })
  }

  // Subscriptions: break live Stripe identifiers
  if (subscriptions.length) {
    await local.subscription.createMany({
      data: subscriptions.map(s => ({
        ...s,
        stripeSubscriptionId: `stg_${s.id}`,
        stripeCustomerId: `stg_${s.userId}`,
      })),
    })
  }

  if (invoices.length) {
    await local.invoice.createMany({
      data: invoices.map(i => ({
        ...i,
        stripeInvoiceId: `stg_${i.id}`,
      })),
    })
  }

  if (payments.length) {
    await local.payment.createMany({
      data: payments.map(p => ({
        ...p,
        goCardlessPaymentId: null,
        goCardlessMandateId: null,
        goCardlessStatus: null,
      })),
    })
  }

  if (subscriptionRouting.length) {
    await local.subscriptionRouting.createMany({ data: subscriptionRouting.map(r => ({ ...r })) })
  }
  if (paymentRouting.length) {
    await local.paymentRouting.createMany({ data: paymentRouting.map(r => ({ ...r })) })
  }
  if (vatCalculations.length) {
    await local.vATCalculation.createMany({ data: vatCalculations.map(v => ({ ...v })) })
  }
  if (systemSettings.length) {
    await local.systemSetting.createMany({ data: systemSettings.map(s => ({ ...s })) })
  }

  console.log('👤 Upserting local admin (admin@portal365.com / admin123)')
  try {
    const mod = await import('./upsert_admin')
    const fn = (mod as any).default
    if (typeof fn === 'function') {
      await fn()
    }
  } catch {
    // no-op in build environments where this script isn't executed
  }

  await prod.$disconnect()
  await local.$disconnect()
  console.log('✅ Clone complete (sanitized).')
}

main().catch(async (e) => {
  console.error(e)
  process.exit(1)
})


