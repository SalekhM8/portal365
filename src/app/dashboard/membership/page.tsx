'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, Crown, CheckCircle2, Phone, Loader2 } from 'lucide-react'

const membershipPlans = {
  'WEEKEND_ADULT': {
    name: 'Weekend Warrior',
    price: 59,
    description: 'Perfect for busy schedules',
    features: ['Weekend access (Sat & Sun)', 'BJJ, MMA, Boxing, Muay Thai', 'Equipment access', 'No contract']
  },
  'FULL_ADULT': {
    name: 'Full Access',
    price: 89,
    description: 'Complete training freedom',
    features: ['7 days/week access', 'All martial arts classes', 'Equipment access', 'Priority access', 'Guest passes']
  },
  'WEEKEND_UNDER18': {
    name: 'Weekend Youth',
    price: 49,
    description: 'For young warriors under 18',
    features: ['Weekend access (Sat & Sun)', 'Youth martial arts classes', 'Equipment access', 'Parental updates']
  },
  'FULL_UNDER18': {
    name: 'Full Youth Access',
    price: 69,
    description: 'Complete youth program',
    features: ['7 days/week access', 'Youth martial arts classes', 'Equipment access', 'Mentorship program']
  },
  'PERSONAL_TRAINING': {
    name: 'Personal Training',
    price: 120,
    description: '1-on-1 coaching sessions',
    features: ['1-on-1 personal training', 'Nutrition guidance', 'Technique refinement', 'Flexible scheduling']
  },
  'WOMENS_CLASSES': {
    name: "Women's Classes",
    price: 65,
    description: 'Women-only fitness space',
    features: ['Women-only classes', 'Self-defense training', 'Supportive community', 'Specialized programs']
  },
  'WELLNESS_PACKAGE': {
    name: 'Wellness Package',
    price: 95,
    description: 'Recovery & wellness services',
    features: ['Massage therapy', 'Mental health support', 'Recovery sessions', 'Wellness workshops']
  }
}

export default function MembershipPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [currentMembership, setCurrentMembership] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [changingTo, setChangingTo] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

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

  const handlePlanChange = async (newPlan: string) => {
    if (newPlan === currentMembership?.type) return

    setChangingTo(newPlan)
    setError(null)

    try {
      const response = await fetch('/api/customers/membership/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newMembershipType: newPlan })
      })

      const data = await response.json()

      if (data.success) {
        setSuccess(`Successfully changed to ${membershipPlans[newPlan as keyof typeof membershipPlans].name}!`)
        await fetchMembership() // Refresh data
      } else {
        setError(data.error || 'Failed to change membership plan')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setChangingTo(null)
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
          <h1 className="text-2xl font-bold">Membership Management</h1>
          <p className="text-muted-foreground">View and change your membership plan</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {success && (
        <Alert className="border-green-200 bg-green-50">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800">{success}</AlertDescription>
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
            <div className="bg-blue-50 p-6 rounded-lg">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold">
                    {membershipPlans[currentMembership.type as keyof typeof membershipPlans]?.name || currentMembership.type}
                  </h3>
                  <p className="text-muted-foreground">
                    {membershipPlans[currentMembership.type as keyof typeof membershipPlans]?.description}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold">£{currentMembership.price}/month</p>
                  <Badge variant="secondary">Active</Badge>
                </div>
              </div>
              <div className="space-y-2">
                <h4 className="font-medium">Included Features:</h4>
                {membershipPlans[currentMembership.type as keyof typeof membershipPlans]?.features.map((feature, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-green-600" />
                    <span className="text-sm">{feature}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available Plans */}
      <Card>
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
          <CardDescription>
            Change your membership plan. Changes take effect on your next billing cycle.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(membershipPlans).map(([key, plan]) => (
              <Card 
                key={key}
                className={`cursor-pointer transition-all hover:shadow-md ${
                  currentMembership?.type === key ? 'ring-2 ring-blue-500 bg-blue-50' : ''
                }`}
              >
                <CardHeader className="text-center">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="text-2xl font-bold">
                    £{plan.price}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {plan.features.map((feature, index) => (
                    <div key={index} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                  
                  <Button
                    onClick={() => handlePlanChange(key)}
                    disabled={currentMembership?.type === key || changingTo !== null}
                    className="w-full mt-4"
                    variant={currentMembership?.type === key ? "secondary" : "default"}
                  >
                    {changingTo === key ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Changing...
                      </>
                    ) : currentMembership?.type === key ? (
                      'Current Plan'
                    ) : (
                      'Change to This Plan'
                    )}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Cancellation Notice */}
      <Card className="border-orange-200">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-orange-800">
            <Phone className="h-5 w-5" />
            Need to Cancel?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-orange-700">
            To cancel your membership, please call us at{' '}
            <a href="tel:07825443999" className="font-semibold underline">
              07825 443 999
            </a>
            . Our team will be happy to assist you with the cancellation process.
          </p>
        </CardContent>
      </Card>
    </div>
  )
} 