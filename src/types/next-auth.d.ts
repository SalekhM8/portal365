// Define types locally (will be replaced when Prisma generates)
type UserRole = 'CUSTOMER' | 'ADMIN' | 'INSTRUCTOR' | 'SUPER_ADMIN'
type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      email: string
      role: UserRole
      status: UserStatus
      firstName?: string
      lastName?: string
    }
  }

  interface User {
    id: string
    email: string
    role: UserRole
    status: UserStatus
    firstName?: string
    lastName?: string
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    id: string
    role: UserRole
    status: UserStatus
    firstName?: string
    lastName?: string
  }
} 