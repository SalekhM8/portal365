const { PrismaClient } = require('@prisma/client')
const Stripe = require('stripe')

const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_IQ_SECRET_KEY)

const entries = [
  { email: 'aftabhussain@me.com', customerId: 'cus_SQmTOWIbglzkaD' },
  { email: 'child.aftab@member.local', customerId: 'cus_SQmQbktcF52TaY', guardianEmail: 'aftabhussain@me.com' },
  { email: 'shafiq28@outlook.com', customerId: 'cus_S7bun5S03hkZUt' },
  { email: 'q_aashi@yahoo.com', customerId: 'cus_SSlCLwOmqFWH72' },
  { email: 'solemanali357@gmail.com', customerId: 'cus_RXP0Wv3Rj1upwt' }
]

function splitName(full) {
  const safe = (full || '').trim()
  if (!safe) return { firstName: 'Member', lastName: '' }
  const parts = safe.split(/\s+/)
  if (parts.length === 1) return { firstName: parts[0], lastName: '' }
  return { firstName: parts[0], lastName: parts.slice(1).join(' ') }
}

async function run() {
  for (const entry of entries) {
    try {
      const cust = await stripe.customers.retrieve(entry.customerId)
      if ('deleted' in cust) throw new Error('customer deleted')
      const parsed = splitName(cust.name || cust.email)
      const user = await prisma.user.findUnique({ where: { email: entry.email }, select: { id: true } })
      if (!user) throw new Error('user not found')
      await prisma.user.update({
        where: { id: user.id },
        data: {
          firstName: parsed.firstName,
          lastName: parsed.lastName,
          communicationPrefs: entry.guardianEmail
            ? JSON.stringify({ guardianEmail: entry.guardianEmail })
            : undefined
        }
      })
      console.log(`Updated ${entry.email} -> ${parsed.firstName} ${parsed.lastName}`)
    } catch (err) {
      console.error(`Failed ${entry.email}:`, err.message)
    }
  }
}

run().finally(() => prisma.$disconnect())
