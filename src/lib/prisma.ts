import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prefer manual override first, then PRISMA_DATABASE_URL (Accelerate/pooled), then DATABASE_URL
const resolvedDatabaseUrl =
  process.env.DB_OVERRIDE_URL ||
  process.env.PRISMA_DATABASE_URL ||
  process.env.DATABASE_URL

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: resolvedDatabaseUrl ? { db: { url: resolvedDatabaseUrl } } : undefined
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma