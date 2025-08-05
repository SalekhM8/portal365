import { NextAuthOptions } from 'next-auth'
import { PrismaAdapter } from '@next-auth/prisma-adapter'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { prisma } from './prisma'

// Define enums locally to avoid import issues
type UserRole = 'CUSTOMER' | 'ADMIN' | 'STAFF' | 'INSTRUCTOR' | 'SUPER_ADMIN'
type UserStatus = 'ACTIVE' | 'INACTIVE' | 'SUSPENDED'

export const authOptions: NextAuthOptions = {
  adapter: PrismaAdapter(prisma),
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        console.log('🔐 Auth attempt for:', credentials?.email)
        
        if (!credentials?.email || !credentials?.password) {
          console.log('❌ Missing credentials')
          return null
        }

        try {
          console.log('🔍 Looking up user:', credentials.email)
          const user = await prisma.user.findUnique({
            where: { email: credentials.email },
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              password: true,
              role: true,
              status: true,
              lastLoginAt: true
            }
          })

          console.log('👤 User found:', !!user)
          
          if (!user || !user.password) {
            console.log('❌ No user or password found')
            return null
          }

          // Check if user is active
          if (user.status !== 'ACTIVE') {
            console.log('❌ User not active:', user.status)
            throw new Error('Account is suspended or expired')
          }

          // Verify password
          console.log('🔑 Verifying password...')
          const isValidPassword = await bcrypt.compare(credentials.password, user.password)
          console.log('🔑 Password valid:', isValidPassword)
          
          if (!isValidPassword) {
            console.log('❌ Invalid password')
            return null
          }

          // Update last login
          await prisma.user.update({
            where: { id: user.id },
            data: { lastLoginAt: new Date() }
          })

          console.log('✅ Login successful for:', user.email)
          return {
            id: user.id,
            email: user.email,
            name: `${user.firstName} ${user.lastName}`,
            role: user.role,
            status: user.status
          }
        } catch (error) {
          console.error('❌ Auth error:', error)
          return null
        }
      }
    })
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.role = user.role
        token.status = user.status
      }
      return token
    },
    async session({ session, token }) {
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
  return async (req: any) => {
    // This would be used in API routes
    // Implementation depends on how you handle auth in API routes
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