'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, ArrowLeft, Dumbbell, Heart, Crown } from 'lucide-react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-red-500',
    description: 'Premier martial arts training facility'
  },
  aura_womens: {
    name: "Aura Women's Gym",
    icon: Heart,
    color: 'bg-pink-500',
    description: 'Dedicated women-only fitness space'
  }
} as const

function RegisterDetailsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedBusiness, setSelectedBusiness] = useState<string>('')
  const [selectedPlan, setSelectedPlan] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [acceptedWaiver, setAcceptedWaiver] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    phone: '',
    dateOfBirth: '',
    emergencyContact: {
      name: '',
      phone: '',
      relationship: ''
    }
  })

  useEffect(() => {
    const businessParam = searchParams.get('business')
    const planParam = searchParams.get('plan')
    
    if (businessParam && (businessParam in businessConfigs)) {
      setSelectedBusiness(businessParam)
    }
    if (planParam && (planParam in MEMBERSHIP_PLANS)) {
      setSelectedPlan(planParam)
    }
  }, [searchParams])

  const currentBusiness = selectedBusiness ? (businessConfigs as any)[selectedBusiness] : null
  const currentPlan = selectedPlan ? MEMBERSHIP_PLANS[selectedPlan as keyof typeof MEMBERSHIP_PLANS] : null

  const handleInputChange = (field: string, value: string) => {
    if (field.startsWith('emergencyContact.')) {
      const contactField = field.split('.')[1]
      setFormData(prev => ({
        ...prev,
        emergencyContact: {
          ...prev.emergencyContact,
          [contactField]: value
        }
      }))
    } else {
      setFormData(prev => ({
        ...prev,
        [field]: value
      }))
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (!acceptedWaiver) {
      setError('Please accept the Terms & Conditions and Liability Waiver to continue')
      return
    }

    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...formData,
          membershipType: selectedPlan,
          businessId: selectedBusiness
        }),
      })

      const result = await response.json()

      if (result.success) {
        // Auto-login the user immediately after registration
        try {
          const loginResult = await signIn('credentials', {
            email: result.user.email,
            password: formData.password,
            redirect: false
          })
          
          if (loginResult?.ok) {
            console.log('✅ User automatically logged in after registration')
          } else {
            console.warn('⚠️ Auto-login failed, but continuing with flow')
          }
        } catch (loginError) {
          console.warn('⚠️ Auto-login error:', loginError)
        }
        
        // Check if subscription creation succeeded and requires payment
        if (result.subscription?.clientSecret) {
          // Redirect to payment page with client secret (handles both SetupIntent and PaymentIntent)
          router.push(`/register/payment?client_secret=${result.subscription.clientSecret}&subscription_id=${result.subscription.id}`)
        } else if (result.subscription?.paymentCompleted) {
          // Payment already processed - redirect directly to success page
          router.push(`/register/success?subscription_id=${result.subscription.id}&payment_completed=true&user_email=${encodeURIComponent(result.user.email)}`)
        } else {
          // Error in subscription creation
          setError(result.subscription?.error || 'Payment setup failed')
        }
      } else {
        setError(result.error || 'Registration failed')
      }
    } catch (error) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!selectedBusiness || !selectedPlan) {
    return (
      <div className="container mx-auto p-6 max-w-2xl text-center">
        <h1 className="text-2xl font-bold mb-4">Invalid Registration Link</h1>
        <p className="text-muted-foreground mb-6">Please select a business and plan to continue.</p>
        <Link href="/register">
          <Button>Back to Plan Selection</Button>
        </Link>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link href={`/register?business=${selectedBusiness}`} className="text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3">
          {currentBusiness && (
            <>
              <div className={`p-2 rounded-lg ${currentBusiness.color} text-white`}>
                <currentBusiness.icon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Complete Your Registration</h1>
                <p className="text-muted-foreground">{currentBusiness.name} - {currentPlan?.displayName}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Selected Plan Summary */}
      <Card className="border-primary">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Crown className="h-5 w-5 text-yellow-600" />
                {currentPlan?.displayName}
              </CardTitle>
              <CardDescription>{currentPlan?.description}</CardDescription>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">£{currentPlan?.monthlyPrice}/month</div>
              <Badge>Selected</Badge>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Registration Form */}
      <Card>
        <CardHeader>
          <CardTitle>Your Details</CardTitle>
          <CardDescription>
            Fill in your information to activate your membership
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {/* Personal Information */}
            <div className="space-y-4">
              <h3 className="font-semibold">Personal Information</h3>
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First Name *</Label>
                  <Input
                    id="firstName"
                    value={formData.firstName}
                    onChange={(e) => handleInputChange('firstName', e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last Name *</Label>
                  <Input
                    id="lastName"
                    value={formData.lastName}
                    onChange={(e) => handleInputChange('lastName', e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="email">Email Address *</Label>
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleInputChange('email', e.target.value)}
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={formData.password}
                  onChange={(e) => handleInputChange('password', e.target.value)}
                  required
                  minLength={8}
                />
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="phone">Phone Number</Label>
                  <Input
                    id="phone"
                    type="tel"
                    value={formData.phone}
                    onChange={(e) => handleInputChange('phone', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="dateOfBirth">Date of Birth</Label>
                  <Input
                    id="dateOfBirth"
                    type="date"
                    value={formData.dateOfBirth}
                    onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                  />
                </div>
              </div>
            </div>

            {/* Emergency Contact */}
            <div className="space-y-4">
              <h3 className="font-semibold">Emergency Contact</h3>
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2">
                  <Label htmlFor="emergencyName">Contact Name</Label>
                  <Input
                    id="emergencyName"
                    value={formData.emergencyContact.name}
                    onChange={(e) => handleInputChange('emergencyContact.name', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyPhone">Contact Phone</Label>
                  <Input
                    id="emergencyPhone"
                    type="tel"
                    value={formData.emergencyContact.phone}
                    onChange={(e) => handleInputChange('emergencyContact.phone', e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="emergencyRelationship">Relationship</Label>
                  <Input
                    id="emergencyRelationship"
                    value={formData.emergencyContact.relationship}
                    onChange={(e) => handleInputChange('emergencyContact.relationship', e.target.value)}
                    placeholder="e.g., Parent, Spouse"
                  />
                </div>
              </div>
            </div>

            {/* Waiver Agreement */}
            <div className="space-y-4">
              <h3 className="font-semibold">Terms & Liability Waiver</h3>
              <div className="rounded-md border p-4 text-sm text-muted-foreground space-y-3 bg-muted/30">
                <p className="font-semibold text-foreground">Liability Waiver Summary:</p>
                <p>
                  I acknowledge that participation in martial arts, fitness, and related activities involves inherent risk of injury. I agree to assume full responsibility for any risks, injuries, or damages which may occur as a result of participation. I waive, release, and discharge the business and its instructors from any and all claims or causes of action arising out of my participation, except in cases of gross negligence or willful misconduct.
                </p>
                <p>
                  Full Terms & Conditions and Waiver are available on request and at the facility reception.
                </p>
              </div>
              
              <div className="flex items-center space-x-2">
                <Checkbox 
                  id="waiver" 
                  checked={acceptedWaiver}
                  onCheckedChange={(checked) => setAcceptedWaiver(!!checked)}
                />
                <Label htmlFor="waiver" className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                  I accept the Terms & Conditions and Liability Waiver *
                </Label>
              </div>
            </div>

            {/* Submit Button */}
            <Button 
              type="submit" 
              size="lg" 
              className="w-full" 
              disabled={loading || !acceptedWaiver}
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing Registration...
                </>
              ) : (
                `Join ${currentBusiness?.name} - £${currentPlan?.monthlyPrice}/month`
              )}
            </Button>

            <div className="text-center text-sm text-muted-foreground">
              Your payment will be processed securely after registration.
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  )
}

export default function RegisterDetailsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RegisterDetailsContent />
    </Suspense>
  )
} 