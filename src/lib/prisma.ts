import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Prefer PRISMA_DATABASE_URL (Accelerate/pooled) and fall back to DATABASE_URL
const resolvedDatabaseUrl = process.env.PRISMA_DATABASE_URL || process.env.DATABASE_URL

export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  datasources: resolvedDatabaseUrl ? { db: { url: resolvedDatabaseUrl } } : undefined
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma