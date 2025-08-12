'use client'

import { useState } from 'react'
import { signIn } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Shield, ArrowLeft, Lock, Mail } from 'lucide-react'
import Link from 'next/link'

export default function SignInPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    try {
      const result = await signIn('credentials', {
        email: formData.email,
        password: formData.password,
        redirect: false
      })

      if (result?.error) {
        setError('Invalid email or password')
      } else if (result?.ok) {
        // Get user session to determine redirect
        const response = await fetch('/api/auth/session')
        if (response.ok) {
          const sessionData = await response.json()
          const userRole = sessionData?.user?.role
          
          // Redirect based on user role
          if (userRole === 'ADMIN' || userRole === 'SUPER_ADMIN') {
            router.push('/admin')
          } else {
            router.push('/dashboard')
          }
          router.refresh()
        } else {
          // Fallback to admin if we can't determine role
          router.push('/admin')
          router.refresh()
        }
      }
    } catch (error) {
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-md space-y-8">
          {/* Header */}
          <div className="text-center space-y-4">
            <Link href="/" className="inline-flex items-center gap-3 text-2xl font-bold hover:opacity-80 transition-opacity">
              <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center">
                <span className="text-black font-bold text-sm">P</span>
              </div>
              <span className="text-white">Portal365</span>
            </Link>
            <p className="text-white/70 text-lg">Sign in to your account</p>
          </div>

          {/* Sign In Form */}
          <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
            <CardHeader className="space-y-4 text-center p-6 sm:p-8">
              <div className="mx-auto w-16 h-16 bg-white/10 rounded-full flex items-center justify-center">
                <Shield className="h-8 w-8 text-white" />
              </div>
              <div className="space-y-2">
                <CardTitle className="text-2xl sm:text-3xl text-white font-bold">Welcome Back</CardTitle>
                <CardDescription className="text-white/70 text-base">
                  Enter your credentials to access your account
                </CardDescription>
              </div>
            </CardHeader>
            <CardContent className="p-6 sm:p-8 pt-0">
              <form onSubmit={handleSubmit} className="space-y-6">
                {error && (
                  <Alert className="bg-red-500/10 border-red-500/20 text-red-300">
                    <AlertDescription>{error}</AlertDescription>
                  </Alert>
                )}

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="email" className="text-white/90 flex items-center gap-2 text-sm font-medium">
                      <Mail className="h-4 w-4" />
                      Email Address
                    </Label>
                    <Input
                      id="email"
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                      className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12"
                      placeholder="admin@portal365.com"
                      required
                      disabled={loading}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="password" className="text-white/90 flex items-center gap-2 text-sm font-medium">
                      <Lock className="h-4 w-4" />
                      Password
                    </Label>
                    <Input
                      id="password"
                      type="password"
                      value={formData.password}
                      onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                      className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 h-12"
                      placeholder="Enter your password"
                      required
                      disabled={loading}
                    />
                  </div>
                </div>

                <Button 
                  type="submit" 
                  className="w-full bg-white text-black hover:bg-white/90 font-semibold text-base py-6 rounded-xl transition-all duration-300" 
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    'Sign In to Portal365'
                  )}
                </Button>
              </form>

              <div className="mt-8 text-center">
                <Link 
                  href="/" 
                  className="inline-flex items-center gap-2 text-sm text-white/60 hover:text-white transition-colors"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Back to Portal365
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
} 