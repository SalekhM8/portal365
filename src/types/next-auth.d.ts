import { DefaultSession, DefaultUser } from 'next-auth'
import { UserRole, UserStatus } from '@/generated/prisma'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      role: UserRole
      status: UserStatus
    } & DefaultSession['user']
  }

  interface User extends DefaultUser {
    role: UserRole
    status: UserStatus
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    role: UserRole
    status: UserStatus
  }
} 