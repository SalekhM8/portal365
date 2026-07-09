import { prisma } from '@/lib/prisma'

const WEAK = new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','1122'])

/** Assign a unique 4-digit door PIN to a user (no-op if they already have one). */
export async function assignUniquePin(userId: string): Promise<string | null> {
  try {
    const existing = await prisma.user.findUnique({ where: { id: userId }, select: { pin: true } })
    if (existing?.pin) return existing.pin
    for (let i = 0; i < 30; i++) {
      const pin = String(Math.floor(Math.random() * 10000)).padStart(4, '0')
      if (WEAK.has(pin)) continue
      try {
        await prisma.user.update({ where: { id: userId }, data: { pin } })
        return pin
      } catch { /* unique collision — retry */ }
    }
  } catch {}
  return null
}
