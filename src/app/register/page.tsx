'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Crown, ArrowLeft, Dumbbell, Heart, ArrowRight, Star, CheckCircle2 } from 'lucide-react'
import Link from 'next/link'
import { MEMBERSHIP_PLANS } from '@/config/memberships'
import { listPlansDbFirst } from '@/lib/plans'

// Business configurations referencing central plan data
const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-gradient-to-br from-red-500 to-red-600',
    description: 'Premier martial arts training facility',
    memberships: [
      { type: 'FULL_ADULT', popular: true },
      { type: 'WEEKEND_ADULT', popular: false },
      { type: 'KIDS_UNLIMITED_UNDER14', popular: false },
      { type: 'KIDS_WEEKEND_UNDER14', popular: false },
      { type: 'MASTERS', popular: false }
    ]
  },
  aura_womens: {
    name: "Women's Striking Classes",
    icon: Heart,
    color: 'bg-gradient-to-br from-pink-500 to-pink-600',
    description: 'Dedicated women-only striking program',
    memberships: [
      { type: 'WOMENS_CLASSES', popular: true }
    ]
  }
} as const

function RegisterContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedBusiness, setSelectedBusiness] = useState<string>('')
  const [plans, setPlans] = useState<any[]>([])

  useEffect(() => {
    const businessParam = searchParams.get('business')
    if (businessParam && (businessParam in businessConfigs)) {
      setSelectedBusiness(businessParam)
    }
    // Load plans DB-first (fallback to config handled in service)
    ;(async () => {
      try {
        const dbPlans = await listPlansDbFirst()
        setPlans(dbPlans as any[])
      } catch {
        setPlans(Object.values(MEMBERSHIP_PLANS) as any[])
      }
    })()
  }, [searchParams])

  const currentBusiness = selectedBusiness ? (businessConfigs as any)[selectedBusiness] : null

  // Show business selection if no business selected
  if (!selectedBusiness) {
    return (
      <div className="min-h-screen bg-black text-white">
        {/* Background Elements */}
        <div className="absolute inset-0">
          <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
          <div className="absolute bottom-20 right-10 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
        </div>
        
        <div className="relative container mx-auto px-4 sm:px-6 py-12 max-w-4xl">
          <div className="text-center mb-12 space-y-4">
            <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors mb-6">
              <ArrowLeft className="h-4 w-4" />
              Back to Portal365
            </Link>
            <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight text-center">
              Choose a <span className="bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">Business</span> to Join
            </h1>
            <p className="text-lg text-white/70 max-w-2xl mx-auto">
              Select which business you'd like to become a member of
            </p>
          </div>

          <div className="grid gap-8 md:grid-cols-2 max-w-4xl mx-auto">
            {Object.entries(businessConfigs).map(([key, business]) => {
              const IconComponent = business.icon
              return (
                <Card 
                  key={key}
                  className="group bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-500 cursor-pointer backdrop-blur-sm"
                  onClick={() => setSelectedBusiness(key)}
                >
                  <CardHeader className="p-6 sm:p-8">
                    <div className="flex items-center gap-4">
                      <div className={`p-4 rounded-xl ${business.color} text-white shadow-lg`}>
                        <IconComponent className="h-7 w-7" />
                      </div>
                      <div>
                        <CardTitle className="text-xl sm:text-2xl text-white font-bold">{business.name}</CardTitle>
                        <CardDescription className="text-white/70 text-base">{business.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="p-6 sm:p-8 pt-0">
                    <Button className="w-full bg-white text-black hover:bg-white/90 font-semibold text-base py-6 rounded-xl transition-all duration-300 group-hover:shadow-lg group-hover:shadow-white/20">
                      Join {business.name}
                      <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                    </Button>
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background Elements */}
      <div className="absolute inset-0">
        <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-pink-500/10 rounded-full blur-3xl"></div>
      </div>

      <div className="relative container mx-auto px-4 sm:px-6 py-12 max-w-6xl space-y-12">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 mb-12">
          <Link href="/" className="text-white/60 hover:text-white transition-colors">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            {currentBusiness && (
              <>
                <div className={`p-3 rounded-xl ${currentBusiness.color} text-white shadow-lg`}>
                  <currentBusiness.icon className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-bold leading-tight">
                    Join <span className="bg-gradient-to-r from-red-500 to-red-700 bg-clip-text text-transparent">{currentBusiness.name}</span>
                  </h1>
                  <p className="text-lg text-white/70 mt-2">{currentBusiness.description}</p>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Membership Selection */}
        <div className="space-y-8">
          <div className="text-center space-y-4">
            <h2 className="text-2xl sm:text-3xl font-bold text-white">Select Your Membership</h2>
            <p className="text-white/70 text-lg">Choose the plan that fits your training goals</p>
          </div>
          
          <div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3 max-w-6xl mx-auto">
            {(plans as any[])
              .filter(p => {
                if (!selectedBusiness) return false
                const vis = Array.isArray((p as any).preferredEntities) ? (p as any).preferredEntities : []
                // default legacy behavior: if no visibility, keep original mapping
                if (vis.length === 0) return (businessConfigs as any)[selectedBusiness]?.memberships.some((m: any) => m.type === p.key)
                return vis.includes(selectedBusiness)
              })
              .map((plan: any, index: number) => {
              return (
                <Link key={index} href={`/register/details?business=${selectedBusiness}&plan=${membership.type}`}>
                  <Card 
                    className={`group bg-white/5 border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-500 cursor-pointer backdrop-blur-sm h-full ${
                      membership.popular ? 'ring-2 ring-red-500/50 relative' : ''
                    }`}
                  >
                    {membership.popular && (
                      <div className="absolute -top-4 left-1/2 transform -translate-x-1/2">
                        <Badge className="bg-gradient-to-r from-red-500 to-red-700 text-white border-0 px-4 py-1">
                          <Crown className="h-3 w-3 mr-1" />
                          Most Popular
                        </Badge>
                      </div>
                    )}
                    
                    <CardHeader className="text-center space-y-4 p-6 sm:p-8">
                      <div className="space-y-2">
                        <CardTitle className="text-xl sm:text-2xl text-white font-bold">{plan.displayName}</CardTitle>
                        <CardDescription className="text-white/70 text-base">{plan.description}</CardDescription>
                      </div>
                      <div className="space-y-1">
                        <div className="text-4xl sm:text-5xl font-bold text-white">
                          £{plan.monthlyPrice}
                        </div>
                        <div className="text-sm text-white/60">/month</div>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="space-y-4 p-6 sm:p-8 pt-0">
                      {plan.features.map((feature: string, featureIndex: number) => (
                        <div key={featureIndex} className="flex items-start gap-3 text-sm text-white/80">
                          <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
                          <span className="leading-relaxed">{feature}</span>
                        </div>
                      ))}
                    </CardContent>
                    
                    <CardFooter className="p-6 sm:p-8 pt-0">
                      <Button className="w-full bg-white text-black hover:bg-white/90 font-semibold text-base py-6 rounded-xl transition-all duration-300 group-hover:shadow-lg group-hover:shadow-white/20">
                        Choose {plan.displayName}
                        <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
                      </Button>
                    </CardFooter>
                  </Card>
                </Link>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function RegisterPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
      </div>
    }>
      <RegisterContent />
    </Suspense>
  )
} 