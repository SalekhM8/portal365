import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@portal365.com'
  const password = 'admin123'
  const hashed = await bcrypt.hash(password, 12)

  const existing = await prisma.user.findUnique({ where: { email } })
  if (existing) {
    await prisma.user.update({
      where: { id: existing.id },
      data: {
        password: hashed,
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    })
    console.log('✅ Admin updated:', email)
  } else {
    await prisma.user.create({
      data: {
        firstName: 'Admin',
        lastName: 'User',
        email,
        password: hashed,
        role: 'ADMIN',
        status: 'ACTIVE'
      }
    })
    console.log('✅ Admin created:', email)
  }
}

main().then(async () => {
  await prisma.$disconnect()
}).catch(async (e) => {
  console.error('❌ Error ensuring admin user:', e)
  await prisma.$disconnect()
  process.exit(1)
}) 