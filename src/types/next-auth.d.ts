import NextAuth from 'next-auth'

// Local type definitions
type UserRole = 'CUSTOMER' | 'ADMIN' | 'INSTRUCTOR' | 'SUPER_ADMIN'
type UserStatus = 'ACTIVE' | 'SUSPENDED' | 'PENDING'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      firstName: string
      lastName: string
      role: UserRole
      status: UserStatus
    }
  }

  interface User {
    id: string
    email: string
    firstName: string
    lastName: string
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