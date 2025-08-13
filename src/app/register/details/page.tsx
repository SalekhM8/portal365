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
import { Loader2, ArrowLeft, Dumbbell, Heart, Crown, ShieldCheck, User, Mail, Phone, Calendar, ArrowRight, X } from 'lucide-react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-gradient-to-br from-red-500 to-red-700',
    description: 'Premier martial arts training facility'
  },
  aura_womens: {
    name: "Aura Women's Gym",
    icon: Heart,
    color: 'bg-gradient-to-br from-pink-500 to-pink-600',
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
  const [showWaiverModal, setShowWaiverModal] = useState(false)
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
      setError('Something went wrong. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (!currentBusiness || !currentPlan) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
          <p className="text-white/70">Loading registration details...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-red-700/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative container mx-auto px-4 sm:px-6 py-8 max-w-4xl">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-8">
          <Link href={`/register?business=${selectedBusiness}`} className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div className={`p-3 rounded-xl ${currentBusiness.color} text-white shadow-lg`}>
              <currentBusiness.icon className="h-6 w-6" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold leading-tight">
                Join <span className="bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">{currentBusiness.name}</span>
              </h1>
              <p className="text-white/70 mt-1">{currentPlan.displayName} Membership</p>
            </div>
          </div>
        </div>

        <div className="grid gap-8 lg:grid-cols-3">
          {/* Registration Form */}
          <div className="lg:col-span-2">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm">
              <CardHeader className="p-6 sm:p-8">
                <CardTitle className="text-2xl text-white">Complete Your Registration</CardTitle>
                <CardDescription className="text-white/70">
                  Fill in your details to start your martial arts journey
                </CardDescription>
              </CardHeader>
              <CardContent className="p-6 sm:p-8 pt-0">
                <form onSubmit={handleSubmit} className="space-y-6">
                  {error && (
                    <Alert className="bg-red-500/10 border-red-500/20 text-red-300">
                      <AlertDescription>{error}</AlertDescription>
                    </Alert>
                  )}

                  {/* Personal Details */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <User className="h-5 w-5" />
                      Personal Details
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="firstName" className="text-white/90">First Name</Label>
                        <Input
                          id="firstName"
                          value={formData.firstName}
                          onChange={(e) => handleInputChange('firstName', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Enter first name"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="lastName" className="text-white/90">Last Name</Label>
                        <Input
                          id="lastName"
                          value={formData.lastName}
                          onChange={(e) => handleInputChange('lastName', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Enter last name"
                          required
                        />
                      </div>
                    </div>
                  </div>

                  {/* Contact Information */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Mail className="h-5 w-5" />
                      Contact Information
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="email" className="text-white/90">Email Address</Label>
                        <Input
                          id="email"
                          type="email"
                          value={formData.email}
                          onChange={(e) => handleInputChange('email', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Enter email address"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="phone" className="text-white/90">Phone Number</Label>
                        <Input
                          id="phone"
                          type="tel"
                          value={formData.phone}
                          onChange={(e) => handleInputChange('phone', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Enter phone number"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Account Security */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5" />
                      Account Security
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="password" className="text-white/90">Password</Label>
                        <Input
                          id="password"
                          type="password"
                          value={formData.password}
                          onChange={(e) => handleInputChange('password', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Create password"
                          required
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="dateOfBirth" className="text-white/90">Date of Birth</Label>
                        <Input
                          id="dateOfBirth"
                          type="date"
                          value={formData.dateOfBirth}
                          onChange={(e) => handleInputChange('dateOfBirth', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Emergency Contact */}
                  <div className="space-y-4">
                    <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                      <Phone className="h-5 w-5" />
                      Emergency Contact
                    </h3>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor="emergencyName" className="text-white/90">Contact Name</Label>
                        <Input
                          id="emergencyName"
                          value={formData.emergencyContact.name}
                          onChange={(e) => handleInputChange('emergencyContact.name', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Emergency contact name"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="emergencyPhone" className="text-white/90">Contact Phone</Label>
                        <Input
                          id="emergencyPhone"
                          type="tel"
                          value={formData.emergencyContact.phone}
                          onChange={(e) => handleInputChange('emergencyContact.phone', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="Emergency contact phone"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="emergencyRelationship" className="text-white/90">Relationship</Label>
                      <Input
                        id="emergencyRelationship"
                        value={formData.emergencyContact.relationship}
                        onChange={(e) => handleInputChange('emergencyContact.relationship', e.target.value)}
                        className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                        placeholder="Relationship to you"
                      />
                    </div>
                  </div>

                  {/* Terms and Conditions */}
                  <div className="space-y-4 pt-4 border-t border-white/10">
                    {/* Terms & Conditions and Liability Waiver */}
                    <div className="flex items-start space-x-3 p-4 bg-white/5 border border-white/10 rounded-lg">
                      <Checkbox
                        id="waiver"
                        checked={acceptedWaiver}
                        onCheckedChange={(checked) => setAcceptedWaiver(checked as boolean)}
                        className="mt-1"
                      />
                      <Label htmlFor="waiver" className="text-sm text-white/80 leading-relaxed">
                        I acknowledge that I have read and agree to the{' '}
                        <button
                          type="button"
                          onClick={() => setShowWaiverModal(true)}
                          className="text-white hover:underline font-medium underline"
                        >
                          Terms & Conditions
                        </button>
                        {' '}and{' '}
                        <button
                          type="button"
                          onClick={() => setShowWaiverModal(true)}
                          className="text-white hover:underline font-medium underline"
                        >
                          Liability Waiver
                        </button>
                        . I understand the risks involved in martial arts training and agree to participate at my own risk.
                      </Label>
                    </div>

                    <Button
                      type="submit"
                      className="w-full bg-white text-black hover:bg-white/90 font-semibold py-6 text-base"
                      disabled={loading || !acceptedWaiver}
                    >
                      {loading ? (
                        <>
                          <Loader2 className="h-5 w-5 mr-2 animate-spin" />
                          Creating Account...
                        </>
                      ) : (
                        <>
                          Complete Registration
                          <ArrowRight className="h-5 w-5 ml-2" />
                        </>
                      )}
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>
          </div>

          {/* Plan Summary */}
          <div className="lg:col-span-1">
            <Card className="bg-white/5 border-white/10 backdrop-blur-sm sticky top-8">
              <CardHeader className="p-6">
                <CardTitle className="text-xl text-white">Plan Summary</CardTitle>
              </CardHeader>
              <CardContent className="p-6 pt-0 space-y-6">
                <div className="text-center space-y-2">
                  <Badge className="bg-gradient-to-r from-red-500 to-red-700 text-white border-0">
                    <Crown className="h-3 w-3 mr-1" />
                    {currentPlan.displayName}
                  </Badge>
                  <div className="text-3xl font-bold text-white">
                    £{currentPlan.monthlyPrice}
                    <span className="text-sm text-white/60 font-normal">/month</span>
                  </div>
                  <p className="text-white/70 text-sm">{currentPlan.description}</p>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium text-white/90">Included Features:</h4>
                  {currentPlan.features.map((feature, index) => (
                    <div key={index} className="flex items-start gap-2 text-sm text-white/80">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0 mt-2"></div>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10 text-xs text-white/60">
                  <p>
                    Your membership will be prorated for the remainder of this month, 
                    then billed monthly on the 1st.
                  </p>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Waiver & Terms Modal */}
      {showWaiverModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-black border border-white/20 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex items-center justify-between p-6 border-b border-white/10">
              <h2 className="text-xl font-bold text-white">Terms & Conditions and Liability Waiver</h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowWaiverModal(false)}
                className="text-white hover:bg-white/10"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            <div className="overflow-y-auto max-h-[calc(90vh-180px)] p-6 space-y-6 text-white/80">
              {/* Terms & Conditions Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white border-b border-white/10 pb-2">Terms & Conditions</h3>
                
                <div className="space-y-3 text-sm leading-relaxed">
                  <p><strong className="text-white">1. Membership Agreement:</strong> By joining Aura MMA, you agree to abide by all gym rules, policies, and procedures. Your membership is non-transferable and subject to the terms outlined in this agreement.</p>
                  
                  <p><strong className="text-white">2. Payment Terms:</strong> Monthly membership fees are due on the 1st of each month. Failed payments may result in suspension of membership privileges. All fees are non-refundable unless otherwise specified.</p>
                  
                  <p><strong className="text-white">3. Facility Usage:</strong> Members must follow all posted rules and instructions from staff. Aura MMA reserves the right to revoke membership privileges for violation of rules or inappropriate behavior.</p>
                  
                  <p><strong className="text-white">4. Equipment and Property:</strong> Members are responsible for any damage to equipment or property caused by their actions. Personal belongings are left at your own risk.</p>
                  
                  <p><strong className="text-white">5. Code of Conduct:</strong> All members must maintain respectful behavior towards staff and other members. Harassment, discrimination, or aggressive behavior will not be tolerated.</p>
                </div>
              </div>

              {/* Liability Waiver Section */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white border-b border-white/10 pb-2">Liability Waiver & Risk Acknowledgment</h3>
                
                <div className="space-y-3 text-sm leading-relaxed">
                  <p><strong className="text-white">ASSUMPTION OF RISK:</strong> I understand that martial arts training involves inherent risks including but not limited to:</p>
                  
                  <ul className="list-disc list-inside ml-4 space-y-2">
                    <li>Physical injury including cuts, bruises, sprains, fractures, and concussions</li>
                    <li>Muscle strains, joint injuries, and overexertion</li>
                    <li>Contact injuries from sparring, grappling, and training exercises</li>
                    <li>Equipment-related injuries from training apparatus</li>
                    <li>Injuries resulting from falls or unexpected contact</li>
                  </ul>
                  
                  <p><strong className="text-white">RELEASE OF LIABILITY:</strong> I voluntarily assume all risks associated with martial arts training and release Aura MMA, its owners, instructors, staff, and affiliates from any and all liability for injuries or damages that may occur during my participation.</p>
                  
                  <p><strong className="text-white">MEDICAL CLEARANCE:</strong> I confirm that I am physically capable of participating in martial arts activities. I will inform instructors of any medical conditions, injuries, or limitations that may affect my training.</p>
                  
                  <p><strong className="text-white">INDEMNIFICATION:</strong> I agree to indemnify and hold harmless Aura MMA from any claims, demands, or lawsuits arising from my participation in training activities.</p>
                  
                  <p><strong className="text-white">EMERGENCY MEDICAL TREATMENT:</strong> I authorize Aura MMA staff to seek emergency medical treatment on my behalf if I am unable to do so myself during training.</p>
                  
                  <p><strong className="text-white">PHOTOGRAPHY/VIDEO CONSENT:</strong> I consent to the use of photographs or videos taken during training for promotional purposes by Aura MMA.</p>
                </div>
              </div>

              {/* Safety Guidelines */}
              <div className="space-y-4">
                <h3 className="text-lg font-semibold text-white border-b border-white/10 pb-2">Safety Guidelines</h3>
                
                <div className="space-y-3 text-sm leading-relaxed">
                  <p><strong className="text-white">General Safety:</strong></p>
                  <ul className="list-disc list-inside ml-4 space-y-1">
                    <li>Always warm up properly before training</li>
                    <li>Follow instructor guidance and training protocols</li>
                    <li>Report injuries immediately to staff</li>
                    <li>Maintain proper hygiene and cleanliness</li>
                    <li>Respect personal boundaries of training partners</li>
                    <li>No training under the influence of alcohol or drugs</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="flex items-center justify-between p-6 border-t border-white/10 bg-white/5">
              <p className="text-sm text-white/60">
                Please read all terms carefully before accepting.
              </p>
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  onClick={() => setShowWaiverModal(false)}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => {
                    setAcceptedWaiver(true)
                    setShowWaiverModal(false)
                  }}
                  className="bg-white text-black hover:bg-white/90"
                >
                  Accept Terms & Waiver
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function RegisterDetailsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <RegisterDetailsContent />
    </Suspense>
  )
} 