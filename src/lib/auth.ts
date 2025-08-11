import NextAuth from 'next-auth'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

// Define enums locally to avoid import issues
type UserRole = 'CUSTOMER' | 'ADMIN' | 'STAFF' | 'INSTRUCTOR' | 'SUPER_ADMIN'
type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

export const authOptions: any = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email', placeholder: 'your-email@example.com' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          console.warn('authorize: missing credentials')
          return null
        }

        const email = credentials.email.trim().toLowerCase()
        console.log('authorize: lookup email', email)

        const user = await prisma.user.findUnique({
          where: { email },
        })

        if (!user || !user.password) {
          console.warn('authorize: user not found or has no password')
          return null
        }

        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)
        console.log('authorize: bcrypt match', isPasswordValid)

        if (!isPasswordValid) {
          return null
        }

        if (user.status === 'SUSPENDED') {
          console.warn('authorize: user suspended')
          return null
        }

        return {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          status: user.status,
        }
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }: { token: any; user: any }) {
      if (user) {
        token.role = user.role
        token.status = user.status
      }
      return token
    },
    async session({ session, token }: { session: any; token: any }) {
      if (token) {
        session.user.id = token.sub!
        session.user.role = token.role as UserRole
        session.user.status = token.status as UserStatus
      }
      return session
    }
  },
  pages: {
    signIn: '/auth/signin',
    error: '/auth/error'
  },
  debug: process.env.NODE_ENV === 'development'
}

// Helper functions for role-based access
export const requireAuth = (requiredRole?: UserRole) => {
  return async (session: any) => {
    if (!session || !session.user) return false
    if (requiredRole && session.user.role !== requiredRole) return false
    return true
  }
}

export const hasPermission = (userRole: UserRole, requiredRole: UserRole): boolean => {
  const roleHierarchy: Record<UserRole, number> = {
    CUSTOMER: 1,
    STAFF: 2,
    INSTRUCTOR: 3,
    ADMIN: 4,
    SUPER_ADMIN: 5
  }

  return roleHierarchy[userRole] >= roleHierarchy[requiredRole]
} 