'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Crown, ArrowLeft, Dumbbell, Heart, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

// Business configurations referencing central plan data
const businessConfigs = {
  aura_mma: {
    name: 'Aura MMA',
    icon: Dumbbell,
    color: 'bg-red-500',
    description: 'Premier martial arts training facility',
    memberships: [
      { type: 'WEEKEND_ADULT', popular: false },
      { type: 'FULL_ADULT', popular: true },
      { type: 'WEEKEND_UNDER18', popular: false },
      { type: 'FULL_UNDER18', popular: false },
      { type: 'MASTERS', popular: false }
    ]
  },
  aura_womens: {
    name: "Aura Women's Gym",
    icon: Heart,
    color: 'bg-pink-500',
    description: 'Dedicated women-only fitness space',
    memberships: [
      { type: 'WOMENS_CLASSES', popular: true }
    ]
  }
} as const

function RegisterContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [selectedBusiness, setSelectedBusiness] = useState<string>('')

  useEffect(() => {
    const businessParam = searchParams.get('business')
    if (businessParam && (businessParam in businessConfigs)) {
      setSelectedBusiness(businessParam)
    }
  }, [searchParams])

  const currentBusiness = selectedBusiness ? (businessConfigs as any)[selectedBusiness] : null

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
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </Button>
                </CardContent>
              </Card>
            )
          })}
        </div>
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
          {currentBusiness?.memberships.map((membership: any, index: number) => {
            const plan = MEMBERSHIP_PLANS[membership.type as keyof typeof MEMBERSHIP_PLANS]
            return (
              <Link key={index} href={`/register/details?business=${selectedBusiness}&plan=${membership.type}`}>
                <Card 
                  className={`cursor-pointer transition-all hover:shadow-lg border-2 hover:border-primary/50 ${membership.popular ? 'border-primary' : ''}`}
                >
                  <CardHeader className="text-center space-y-2">
                    {membership.popular && (
                      <Badge className="mx-auto w-fit">
                        <Crown className="h-3 w-3 mr-1" />
                        Most Popular
                      </Badge>
                    )}
                    <CardTitle className="text-xl">{plan.displayName}</CardTitle>
                    <CardDescription>{plan.description}</CardDescription>
                    <div className="text-3xl font-bold">
                      £{plan.monthlyPrice}
                      <span className="text-sm font-normal text-muted-foreground">/month</span>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {plan.features.map((feature: string, featureIndex: number) => (
                      <div key={featureIndex} className="flex items-center gap-2 text-sm">
                        <div className="w-2 h-2 bg-green-500 rounded-full flex-shrink-0" />
                        <span>{feature}</span>
                      </div>
                    ))}
                  </CardContent>
                  <CardFooter>
                    <Button className="w-full">
                      Choose {plan.displayName}
                      <ArrowRight className="h-4 w-4 ml-2" />
                    </Button>
                  </CardFooter>
                </Card>
              </Link>
            )
          })}
        </div>
      </div>
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