'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, CheckCircle2, Crown, ArrowLeft, Dumbbell, GraduationCap, Heart, Sparkles } from 'lucide-react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'

// Business configurations
const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-red-500',
    description: 'Premier martial arts training facility',
    memberships: [
      {
        type: 'WEEKEND_ADULT',
        displayName: 'Weekend Warrior',
        price: 59,
        description: 'Perfect for busy schedules',
        features: ['Weekend access (Sat & Sun)', 'BJJ, MMA, Boxing, Muay Thai', 'Equipment access', 'No contract'],
        popular: false
      },
      {
        type: 'FULL_ADULT',
        displayName: 'Full Access',
        price: 89,
        description: 'Complete training freedom',
        features: ['7 days/week access', 'All martial arts classes', 'Equipment access', 'Priority access', 'Guest passes'],
        popular: true
      },
      {
        type: 'WEEKEND_UNDER18',
        displayName: 'Weekend Youth',
        price: 49,
        description: 'For young warriors under 18',
        features: ['Weekend access (Sat & Sun)', 'Youth martial arts classes', 'Equipment access', 'Parental updates'],
        popular: false
      },
      {
        type: 'FULL_UNDER18',
        displayName: 'Full Youth Access',
        price: 69,
        description: 'Complete youth program',
        features: ['7 days/week access', 'Youth martial arts classes', 'Equipment access', 'Mentorship program'],
        popular: false
      }
    ]
  },
  aura_tuition: {
    name: 'Aura Tuition Company',
    icon: GraduationCap,
    color: 'bg-blue-500',
    description: '1-on-1 personal training & coaching',
    memberships: [
      {
        type: 'PERSONAL_TRAINING',
        displayName: 'Monthly Sessions',
        price: 120,
        description: '4 sessions per month',
        features: ['1-on-1 personal training', '4 sessions monthly', 'Nutrition guidance', 'Technique refinement'],
        popular: false
      },
      {
        type: 'PERSONAL_TRAINING',
        displayName: 'Unlimited Coaching',
        price: 200,
        description: 'Unlimited access to coaching',
        features: ['Unlimited 1-on-1 sessions', 'Nutrition coaching', 'Competition prep', 'Technique workshops'],
        popular: true
      }
    ]
  },
  aura_womens: {
    name: "Aura Women's Gym",
    icon: Heart,
    color: 'bg-pink-500',
    description: 'Dedicated women-only fitness space',
    memberships: [
      {
        type: 'WOMENS_CLASSES',
        displayName: 'Basic Access',
        price: 65,
        description: 'Essential women-only classes',
        features: ['Women-only classes', 'Self-defense training', 'Basic equipment access', 'Supportive community'],
        popular: false
      },
      {
        type: 'WOMENS_CLASSES',
        displayName: "Full Women's Program",
        price: 79,
        description: 'Complete women-focused training',
        features: ['All women-only classes', 'Self-defense & martial arts', 'Yoga & Pilates', 'Strength training', 'Nutrition support'],
        popular: true
      }
    ]
  },
  aura_wellness: {
    name: 'Aura Wellness Center',
    icon: Sparkles,
    color: 'bg-green-500',
    description: 'Recovery, wellness & mental health',
    memberships: [
      {
        type: 'WELLNESS_PACKAGE',
        displayName: 'Wellness Package',
        price: 95,
        description: 'Essential wellness services',
        features: ['Massage therapy (2/month)', 'Mental health support', 'Recovery sessions', 'Wellness workshops'],
        popular: false
      },
      {
        type: 'WELLNESS_PACKAGE',
        displayName: 'Complete Wellness',
        price: 149,
        description: 'Comprehensive wellness program',
        features: ['Unlimited massage therapy', 'Weekly mental health sessions', 'Recovery & rehabilitation', 'Nutrition planning', 'Stress management'],
        popular: true
      }
    ]
  }
}

function RegisterContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedBusiness, setSelectedBusiness] = useState<string>('')
  const [selectedMembership, setSelectedMembership] = useState<string>('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
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
    if (businessParam && businessConfigs[businessParam as keyof typeof businessConfigs]) {
      setSelectedBusiness(businessParam)
    }
  }, [searchParams])

  const currentBusiness = selectedBusiness ? businessConfigs[selectedBusiness as keyof typeof businessConfigs] : null

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
    
    if (!selectedMembership) {
      setError('Please select a membership type')
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
          membershipType: selectedMembership,
          businessId: selectedBusiness
        }),
      })

      const result = await response.json()

      if (result.success) {
        // Auto-login the user immediately after registration
        try {
          const loginResult = await signIn('credentials', {
            email: result.user.email,
            password: result.user.password,
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

  // Show business selection if no business selected
  if (!selectedBusiness) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center mb-8">
          <Link href="/" className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary mb-4">
            <ArrowLeft className="h-4 w-4" />
            Back to Portal365
          </Link>
          <h1 className="text-3xl font-bold">Choose a Business to Join</h1>
          <p className="text-muted-foreground">Select which business you'd like to become a member of</p>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          {Object.entries(businessConfigs).map(([key, business]) => {
            const IconComponent = business.icon
            return (
              <Card 
                key={key}
                className="cursor-pointer hover:shadow-lg transition-all border-2 hover:border-primary/50"
                onClick={() => setSelectedBusiness(key)}
              >
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className={`p-3 rounded-lg ${business.color} text-white`}>
                      <IconComponent className="h-6 w-6" />
                    </div>
                    <div>
                      <CardTitle>{business.name}</CardTitle>
                      <CardDescription>{business.description}</CardDescription>
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <Button className="w-full">
                    Join {business.name}
                    <ArrowLeft className="h-4 w-4 ml-2 rotate-180" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <Card>
          <CardContent className="p-8 text-center space-y-6">
            <CheckCircle2 className="h-16 w-16 text-green-500 mx-auto" />
            <div className="space-y-2">
              <h2 className="text-2xl font-bold">Welcome to {currentBusiness?.name}!</h2>
              <p className="text-muted-foreground">
                Your membership has been activated and payment has been processed securely.
              </p>
            </div>
            <div className="text-sm text-muted-foreground">
              Redirecting to your dashboard...
            </div>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-6xl space-y-8">
      {/* Header */}
      <div className="flex items-center gap-4 mb-8">
        <Link href="/" className="text-muted-foreground hover:text-primary">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex items-center gap-3">
          {currentBusiness && (
            <>
              <div className={`p-2 rounded-lg ${currentBusiness.color} text-white`}>
                <currentBusiness.icon className="h-5 w-5" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Join {currentBusiness.name}</h1>
                <p className="text-muted-foreground">{currentBusiness.description}</p>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Membership Selection */}
      <div className="space-y-6">
        <h2 className="text-2xl font-semibold">Select Your Membership</h2>
        <div className="grid gap-6 md:grid-cols-2">
          {currentBusiness?.memberships.map((membership, index) => (
            <Card 
              key={index}
              className={`cursor-pointer transition-all hover:shadow-lg ${
                selectedMembership === membership.type 
                  ? 'ring-2 ring-primary border-primary' 
                  : ''
              } ${membership.popular ? 'border-primary' : ''}`}
              onClick={() => setSelectedMembership(membership.type)}
            >
              <CardHeader className="text-center space-y-2">
                {membership.popular && (
                  <Badge className="mx-auto w-fit">
                    <Crown className="h-3 w-3 mr-1" />
                    Most Popular
                  </Badge>
                )}
                <CardTitle className="text-xl">{membership.displayName}</CardTitle>
                <CardDescription>{membership.description}</CardDescription>
                <div className="text-3xl font-bold">
                  £{membership.price}
                  <span className="text-sm font-normal text-muted-foreground">/month</span>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                {membership.features.map((feature, featureIndex) => (
                  <div key={featureIndex} className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                    <span>{feature}</span>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}
        </div>
      </div>

      {/* Registration Form */}
      {selectedMembership && (
        <Card className="max-w-2xl mx-auto">
          <CardHeader>
            <CardTitle>Complete Your Registration</CardTitle>
            <CardDescription>
              Fill in your details to activate your membership with {currentBusiness?.name}
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

              {/* Submit Button */}
              <Button 
                type="submit" 
                size="lg" 
                className="w-full" 
                disabled={loading}
              >
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing Registration...
                  </>
                ) : (
                  `Join ${currentBusiness?.name} - £${currentBusiness?.memberships.find(m => m.type === selectedMembership)?.price}/month`
                )}
              </Button>

              <div className="text-center text-sm text-muted-foreground">
                By joining, you agree to our terms and conditions. 
                Your payment will be processed securely.
              </div>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <RegisterContent />
    </Suspense>
  )
} 