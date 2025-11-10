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
import { 
  Loader2, 
  ArrowLeft, 
  Dumbbell, 
  Heart, 
  Crown, 
  ShieldCheck, 
  User, 
  Mail, 
  Phone, 
  Calendar, 
  ArrowRight, 
  X,
  CheckCircle,
  ArrowDown,
  Clock,
  Scale,
  Users,
  AlertTriangle,
  Shield,
  FileText
} from 'lucide-react'
import Link from 'next/link'
import { signIn } from 'next-auth/react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'
import { getPlanDbFirst } from '@/lib/plans'

const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-gradient-to-br from-red-500 to-red-700',
    description: 'Premier martial arts training facility'
  },
  aura_womens: {
    name: "Women's Striking Classes",
    icon: Heart,
    color: 'bg-gradient-to-br from-pink-500 to-pink-600',
    description: 'Dedicated women-only striking program'
  }
} as const

function RegisterDetailsContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedBusiness, setSelectedBusiness] = useState<string>('')
  const [selectedPlan, setSelectedPlan] = useState<string>('')
  const [specialPrice, setSpecialPrice] = useState<number | null>(null)
  const [startOnFirst, setStartOnFirst] = useState<boolean>(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [acceptedWaiver, setAcceptedWaiver] = useState(false)
  const [showWaiverModal, setShowWaiverModal] = useState(false)
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    password: '',
    confirmPassword: '',
    phone: '',
    address: '',
    postcode: '',
    dateOfBirth: '',
    emergencyContact: {
      name: '',
      phone: '',
      relationship: ''
    },
    guardian: {
      name: '',
      phone: ''
    },
    guardianConsent: false
  })
  const [planDetails, setPlanDetails] = useState<any | null>(null)

  useEffect(() => {
    const businessParam = searchParams.get('business')
    const planParam = searchParams.get('plan')
    const priceParam = searchParams.get('price')
    const startParam = searchParams.get('start')
    
    if (businessParam && (businessParam in businessConfigs)) {
      setSelectedBusiness(businessParam)
    }
    if (planParam) {
      setSelectedPlan(planParam)
    }
    if (priceParam && !Number.isNaN(Number(priceParam))) {
      setSpecialPrice(Number(priceParam))
    }
    if (startParam === 'firstOfNextMonth') {
      setStartOnFirst(true)
    }
  }, [searchParams])

  useEffect(() => {
    ;(async () => {
      if (!selectedPlan) return
      try {
        const res = await fetch(`/api/plans/${selectedPlan}`, { cache: 'no-store' })
        const json = await res.json()
        if (json?.success && json.plan) {
          setPlanDetails(json.plan)
          return
        }
      } catch {}
      try {
        const p = await getPlanDbFirst(selectedPlan)
        setPlanDetails(p)
      } catch {
        setPlanDetails(MEMBERSHIP_PLANS[selectedPlan as keyof typeof MEMBERSHIP_PLANS])
      }
    })()
  }, [selectedPlan])

  const currentBusiness = selectedBusiness ? (businessConfigs as any)[selectedBusiness] : null
  const currentPlan = planDetails

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
    } else if (field.startsWith('guardian.')) {
      const gField = field.split('.')[1]
      setFormData(prev => ({
        ...prev,
        guardian: {
          ...prev.guardian,
          [gField]: value
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
    
    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match. Please check and try again.')
      return
    }
    
    if (formData.password.length < 6) {
      setError('Password must be at least 6 characters long.')
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
          businessId: selectedBusiness,
          // Special price + no-proration path
          ...(specialPrice !== null ? { customPrice: specialPrice } : {}),
          ...(startOnFirst ? { startOnFirst: true } : {})
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
          const pk = encodeURIComponent(result.subscription.publishableKey || '')
          router.push(`/register/payment?client_secret=${result.subscription.clientSecret}&subscription_id=${result.subscription.id}&pk=${pk}`)
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
                      <div className="space-y-2 sm:col-span-2">
                        <Label htmlFor="address" className="text-white/90">Address</Label>
                        <Input
                          id="address"
                          value={formData.address}
                          onChange={(e) => handleInputChange('address', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="House/Flat, Street, City"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="postcode" className="text-white/90">Post Code</Label>
                        <Input
                          id="postcode"
                          value={formData.postcode}
                          onChange={(e) => handleInputChange('postcode', e.target.value)}
                          className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                          placeholder="e.g., UB1 1AA"
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
                        <Label htmlFor="confirmPassword" className="text-white/90">Confirm Password</Label>
                        <Input
                          id="confirmPassword"
                          type="password"
                          value={formData.confirmPassword}
                          onChange={(e) => handleInputChange('confirmPassword', e.target.value)}
                          className={`bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40 ${
                            formData.confirmPassword && formData.password !== formData.confirmPassword 
                              ? 'border-red-500/50 focus:border-red-500' 
                              : ''
                          }`}
                          placeholder="Confirm password"
                          required
                        />
                        {formData.confirmPassword && formData.password !== formData.confirmPassword && (
                          <p className="text-red-400 text-xs">Passwords do not match</p>
                        )}
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

                  {/* Under-16 Guardian Consent */}
                  {formData.dateOfBirth && (() => {
                    const dob = new Date(formData.dateOfBirth)
                    const today = new Date()
                    const age = today.getFullYear() - dob.getFullYear() - (today < new Date(today.getFullYear(), dob.getMonth(), dob.getDate()) ? 1 : 0)
                    return age < 18
                  })() && (
                    <div className="space-y-4 border-t border-white/10 pt-4">
                      <h3 className="text-lg font-semibold text-white flex items-center gap-2">
                        <Shield className="h-5 w-5" />
                        Parent/Guardian Consent (Required for under 18)
                      </h3>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="guardianName" className="text-white/90">Guardian Name</Label>
                          <Input
                            id="guardianName"
                            value={formData.guardian.name}
                            onChange={(e) => handleInputChange('guardian.name', e.target.value)}
                            className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                            placeholder="Full name"
                            required
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="guardianPhone" className="text-white/90">Guardian Phone</Label>
                          <Input
                            id="guardianPhone"
                            value={formData.guardian.phone}
                            onChange={(e) => handleInputChange('guardian.phone', e.target.value)}
                            className="bg-white/5 border-white/20 text-white placeholder:text-white/50 focus:border-white/40"
                            placeholder="Contact number"
                            required
                          />
                        </div>
                      </div>
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          id="guardianConsent"
                          checked={formData.guardianConsent}
                          onCheckedChange={(checked) => setFormData(prev => ({ ...prev, guardianConsent: !!checked }))}
                        />
                        <Label htmlFor="guardianConsent" className="text-sm text-white">
                          I confirm I am the parent/guardian and consent to this membership
                        </Label>
                      </div>
                    </div>
                  )}

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
                  <div className="pt-6 border-t border-white/10 space-y-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <Checkbox
                          id="waiver"
                          checked={acceptedWaiver}
                          onCheckedChange={(checked) => setAcceptedWaiver(checked as boolean)}
                        />
                        <Label htmlFor="waiver" className="text-sm text-white">
                          I agree to the terms and conditions and liability waiver
                        </Label>
                      </div>
                      
                      <Button
                        type="button"
                        onClick={() => setShowWaiverModal(true)}
                        variant="outline"
                        size="sm"
                        className="text-xs bg-white/10 border-white/20 text-white hover:bg-white/20"
                      >
                        Review Terms
                      </Button>
                    </div>
                    
                    {!acceptedWaiver && (
                      <p className="text-xs text-white/60">
                        Please review and accept the terms to continue
                      </p>
                    )}
                  </div>

                  <Button
                    type="submit"
                    className="w-full bg-white text-black hover:bg-white/90 font-semibold py-6 text-base"
                    disabled={loading || !acceptedWaiver || formData.password !== formData.confirmPassword || formData.password.length < 6}
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
                    £{specialPrice !== null ? specialPrice : currentPlan.monthlyPrice}
                    <span className="text-sm text-white/60 font-normal">/month</span>
                  </div>
                  <p className="text-white/70 text-sm">{currentPlan.description}</p>
                </div>

                <div className="space-y-3">
                  <h4 className="font-medium text-white/90">Included Features:</h4>
                  {(Array.isArray(currentPlan.features) ? currentPlan.features : []).map((feature: string, index: number) => (
                    <div key={index} className="flex items-start gap-2 text-sm text-white/80">
                      <div className="w-1.5 h-1.5 bg-green-400 rounded-full flex-shrink-0 mt-2"></div>
                      <span>{feature}</span>
                    </div>
                  ))}
                </div>

                <div className="pt-4 border-t border-white/10 text-xs text-white/60">
                  {specialPrice !== null || startOnFirst ? (
                    <p>No payment today. Your first payment will be taken on the 1st of next month, then monthly.</p>
                  ) : (
                    <p>Your membership will be prorated for the remainder of this month, then billed monthly on the 1st.</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>

      {/* Enhanced Terms & Conditions Modal */}
      {showWaiverModal && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-gradient-to-br from-gray-900 to-black border border-white/20 rounded-xl shadow-2xl max-w-5xl w-full max-h-[95vh] overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between p-6 border-b border-white/10 bg-gradient-to-r from-red-600/10 to-pink-600/10">
              <div>
                <h2 className="text-2xl font-bold text-white">Terms & Conditions</h2>
                <p className="text-sm text-white/70 mt-1">Please read all sections carefully before proceeding</p>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowWaiverModal(false)}
                className="text-white hover:bg-white/10 rounded-full"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
            
            {/* Scrollable Content */}
            <div className="overflow-y-auto max-h-[calc(95vh-140px)] p-8 space-y-8 text-white/90 custom-scrollbar">

              {/* 1. Terms & Conditions */}
              <section className="space-y-6">
                <div className="flex items-center gap-3 pb-3 border-b border-red-500/30">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">1</div>
                  <h3 className="text-xl font-bold text-white">Membership Terms & Conditions</h3>
                </div>
                
                <div className="space-y-5">
                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-red-500">
                    <h4 className="font-semibold text-white mb-2">1.1 Membership Agreement</h4>
                    <p className="text-sm leading-relaxed">By joining Aura MMA, you enter into a legally binding agreement to abide by all gym rules, policies, and procedures. Your membership is personal, non-transferable, and subject to all terms outlined in this agreement.</p>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-orange-500">
                    <h4 className="font-semibold text-white mb-2">1.2 Payment Terms & Admin Fees</h4>
                    <ul className="text-sm leading-relaxed space-y-2">
                      <li>• Monthly membership fees are due on the 1st of each month via automatic payment</li>
                      <li>• Failed or declined payments may result in immediate suspension of membership privileges</li>
                      <li>• <strong className="text-orange-300">Repeated payment failures (3+ consecutive failures) will incur a £50 administrative fee</strong></li>
                      <li>• All membership fees are non-refundable unless otherwise specified in writing</li>
                      <li>• Price changes require 30 days written notice</li>
                    </ul>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-yellow-500">
                    <h4 className="font-semibold text-white mb-2">1.3 Facility Usage & Conduct</h4>
                    <ul className="text-sm leading-relaxed space-y-2">
                      <li>• Members must follow all posted rules and instructions from qualified staff</li>
                      <li>• Aura MMA reserves the right to revoke membership for rule violations or inappropriate behavior</li>
                      <li>• Respectful behavior towards staff and members is mandatory at all times</li>
                      <li>• Harassment, discrimination, or aggressive behavior will result in immediate termination</li>
                    </ul>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-blue-500">
                    <h4 className="font-semibold text-white mb-2">1.4 Equipment & Property Responsibility</h4>
                    <ul className="text-sm leading-relaxed space-y-2">
                      <li>• Members are financially responsible for any equipment damage caused by negligence</li>
                      <li>• Personal belongings are stored at your own risk - Aura MMA accepts no liability</li>
                      <li>• Lockers must be emptied daily; contents may be removed after 24 hours</li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* 2. Liability Waiver */}
              <section className="space-y-6">
                <div className="flex items-center gap-3 pb-3 border-b border-red-500/30">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">2</div>
                  <h3 className="text-xl font-bold text-white">Liability Waiver & Risk Acknowledgment</h3>
                </div>

                <div className="bg-red-500/10 border border-red-500/30 p-6 rounded-lg">
                  <h4 className="font-semibold text-red-300 mb-3 flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5" />
                    IMPORTANT: Assumption of Risk
                  </h4>
                  <p className="text-sm leading-relaxed mb-4">
                    I understand and acknowledge that martial arts training involves inherent and significant risks including but not limited to:
                  </p>
                  <div className="grid md:grid-cols-2 gap-3">
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Physical injuries including cuts, bruises, sprains, and fractures
                      </li>
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Serious injuries including concussions and joint damage
                      </li>
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Contact injuries from sparring and grappling
                      </li>
                    </ul>
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Equipment-related injuries and accidents
                      </li>
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Muscle strains, overexertion, and cardiovascular stress
                      </li>
                      <li className="flex items-start gap-2">
                        <div className="w-1.5 h-1.5 bg-red-400 rounded-full mt-2 flex-shrink-0"></div>
                        Falls, collisions, and unexpected contact
                      </li>
                    </ul>
                  </div>
                </div>

                <div className="space-y-4">
                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-purple-500">
                    <h4 className="font-semibold text-white mb-2">2.1 Complete Release of Liability</h4>
                    <p className="text-sm leading-relaxed">I voluntarily assume ALL risks associated with martial arts training and completely release Aura MMA, its owners, instructors, staff, affiliates, and premises from any and all liability for injuries, damages, or losses that may occur during my participation, regardless of cause.</p>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-green-500">
                    <h4 className="font-semibold text-white mb-2">2.2 Medical Clearance & Health Responsibility</h4>
                    <ul className="text-sm leading-relaxed space-y-2">
                      <li>• I confirm I am physically capable of participating in strenuous martial arts activities</li>
                      <li>• I will immediately inform instructors of any medical conditions, injuries, or limitations</li>
                      <li>• I am responsible for my own medical insurance and any resulting medical costs</li>
                    </ul>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-pink-500">
                    <h4 className="font-semibold text-white mb-2">2.3 Indemnification Agreement</h4>
                    <p className="text-sm leading-relaxed">I agree to indemnify and hold harmless Aura MMA from any claims, demands, lawsuits, or legal actions arising from my participation in training activities, including attorney fees and court costs.</p>
                  </div>
                </div>
              </section>

              {/* 3. Safety & Operational Guidelines */}
              <section className="space-y-6">
                <div className="flex items-center gap-3 pb-3 border-b border-red-500/30">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">3</div>
                  <h3 className="text-xl font-bold text-white">Safety Guidelines & Policies</h3>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-emerald-500">
                    <h4 className="font-semibold text-white mb-3">Training Safety Requirements</h4>
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <Shield className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                        Mandatory warm-up before all training sessions
                      </li>
                      <li className="flex items-start gap-2">
                        <Shield className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                        Follow all instructor guidance and protocols
                      </li>
                      <li className="flex items-start gap-2">
                        <Shield className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                        Report injuries immediately to staff
                      </li>
                      <li className="flex items-start gap-2">
                        <Shield className="h-4 w-4 text-emerald-400 mt-0.5 flex-shrink-0" />
                        Respect training partner boundaries
                      </li>
                    </ul>
                  </div>

                  <div className="bg-white/5 p-4 rounded-lg border-l-4 border-cyan-500">
                    <h4 className="font-semibold text-white mb-3">Facility Policies</h4>
                    <ul className="text-sm space-y-2">
                      <li className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        Maintain proper hygiene and cleanliness
                      </li>
                      <li className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        No training under influence of substances
                      </li>
                      <li className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        Photography/video consent for promotions
                      </li>
                      <li className="flex items-start gap-2">
                        <Users className="h-4 w-4 text-cyan-400 mt-0.5 flex-shrink-0" />
                        Emergency medical treatment authorization
                      </li>
                    </ul>
                  </div>
                </div>
              </section>

              {/* 4. Legal Acknowledgment */}
              <section className="space-y-6">
                <div className="flex items-center gap-3 pb-3 border-b border-red-500/30">
                  <div className="w-8 h-8 bg-red-500 rounded-full flex items-center justify-center text-white font-bold text-sm">4</div>
                  <h3 className="text-xl font-bold text-white">Legal Acknowledgment</h3>
                </div>

                {/* Payment Authorization & Mandate */}
                <div className="bg-purple-500/10 border border-purple-500/30 p-6 rounded-lg">
                  <h4 className="font-semibold text-purple-300 mb-3">Payment Authorization & Mandate</h4>
                  <ul className="text-sm leading-relaxed space-y-2 list-disc pl-5">
                    <li>
                      By submitting this form and completing payment setup, I authorize Aura MMA ("the Gym") to charge the payment method I provide for the membership selected, including recurring monthly charges on or after the 1st of each month, and any prorated or adjusted amounts disclosed during sign‑up.
                    </li>
                    <li>
                      I consent to off‑session charges using my saved payment method for ongoing membership fees. Strong Customer Authentication (e.g., 3‑D Secure) may be requested when required by my bank or card issuer.
                    </li>
                    <li>
                      I confirm I am the authorized holder of the payment method and have authority to grant this authorization. This authorization remains in effect until I cancel my membership in accordance with the Cancellation section below.
                    </li>
                    <li>
                      The Gym will provide at least 30 days’ notice by email/SMS before any change to recurring membership fees. Continued membership after the notice period constitutes acceptance of the new fee.
                    </li>
                    <li>
                      If a payment is declined, the Gym may attempt retries. Repeated failures may result in suspension of access and an administrative fee as stated in these Terms.
                    </li>
                    <li>
                      Direct Debit (if used in the future): Where a bank account is used (e.g., UK Bacs Direct Debit), I will be shown a Direct Debit mandate during setup. By accepting the mandate I authorize payments per that mandate and applicable scheme rules (including the Direct Debit Guarantee). My mandate reference will be provided in my confirmation.
                    </li>
                  </ul>
                </div>

                <div className="bg-amber-500/10 border border-amber-500/30 p-6 rounded-lg">
                  <h4 className="font-semibold text-amber-300 mb-3 flex items-center gap-2">
                    <Scale className="h-5 w-5" />
                    Binding Agreement
                  </h4>
                  <p className="text-sm leading-relaxed">
                    By accepting these terms, I acknowledge that I have read, understood, and agree to be legally bound by all conditions outlined above. 
                    I confirm that I am of legal age to enter this agreement or have obtained proper parental/guardian consent. 
                    This agreement shall remain in effect for the duration of my membership and any subsequent renewals.
                  </p>
                </div>
              </section>


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