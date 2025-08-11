import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'

const prisma = new PrismaClient()

async function main() {
  const email = 'admin@portal365.com'
  const user = await prisma.user.findUnique({ where: { email } })
  if (!user) {
    console.log('USER_MISSING')
    return
  }
  console.log('USER_FOUND', { id: user.id, role: user.role, status: user.status, hasPassword: !!user.password })
  if (user.password) {
    const ok = await bcrypt.compare('admin123', user.password)
    console.log('BCRYPT_OK', ok)
  }
}

main().then(async () => {
  await prisma.$disconnect()
}).catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
}) 