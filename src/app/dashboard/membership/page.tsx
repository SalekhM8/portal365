'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, Crown, CheckCircle2, Phone, Loader2 } from 'lucide-react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

export default function MembershipPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [currentMembership, setCurrentMembership] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
      return
    }

    if (session?.user?.email) {
      fetchMembership()
    }
  }, [session, status])

  const fetchMembership = async () => {
    try {
      const response = await fetch('/api/customers/membership')
      const data = await response.json()

      if (data.success) {
        setCurrentMembership(data.membership)
      } else {
        setError(data.error || 'Failed to load membership')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2 text-muted-foreground">Loading membership details...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Membership</h1>
          <p className="text-muted-foreground">Your current membership plan</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Current Membership */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Crown className="h-5 w-5 text-yellow-600" />
            Current Membership
          </CardTitle>
          <CardDescription>
            Your active membership plan and benefits
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentMembership && (
            <div className="bg-blue-500/10 border border-blue-500/20 p-6 rounded-lg">
              <div className="flex items-center gap-3 mb-4">
                <CheckCircle2 className="h-4 w-4 text-blue-400" />
                <h3 className="font-semibold text-blue-300">Current Plan Benefits</h3>
              </div>
              <div className="space-y-4">
                <div>
                  <div className="text-white/60 text-xs uppercase mb-2">Features</div>
                  {currentMembership.type && MEMBERSHIP_PLANS[currentMembership.type as keyof typeof MEMBERSHIP_PLANS]?.features?.map((feature: string, index: number) => (
                    <div key={index} className="flex items-center gap-2 text-sm text-white/80">
                      <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0" />
                      <span>{feature}</span>
                    </div>
                  )) || (
                    <p className="text-white/60 text-sm">No features available for this membership type.</p>
                  )}
                </div>
                {currentMembership.scheduleAccess?.allowedWindows?.length ? (
                  <div>
                    <div className="text-white/60 text-xs uppercase mb-2">Your Access Times</div>
                    <ul className="text-sm text-white/80 space-y-1">
                      {currentMembership.scheduleAccess.allowedWindows.map((w: any, idx: number) => (
                        <li key={idx}>{formatDays(w.days)} {w.start}–{w.end}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Contact Notice */}
      <Card className="border-orange-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-800">
            <Phone className="h-5 w-5" />
            Need to Make Changes?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-orange-700">
            To change or cancel your membership, please call us at{' '}
            <a href="tel:07825443999" className="font-semibold underline">
              07825 443 999
            </a>
            {' '}or speak to us at the gym.
          </p>
        </CardContent>
      </Card>
    </div>
  )
} 

function formatDays(days: string[] = []) {
  if (!Array.isArray(days) || days.length === 0) return 'Any day'
  const map: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
  return days.map(d => map[d] || d).join(', ')
}
