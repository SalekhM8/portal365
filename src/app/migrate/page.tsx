'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { ArrowLeft, ArrowRight, CheckCircle2, Dumbbell, RefreshCw } from 'lucide-react'

export default function MigratePage() {
  const [plans, setPlans] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Load ALL plans from API (both Aura MMA and Women's Striking) INCLUDING migration-only plans
    const loadPlans = async () => {
      try {
        const res = await fetch('/api/plans?includeMigration=true', { cache: 'no-store' })
        const data = await res.json()
        if (Array.isArray(data?.plans)) {
          // Group by business type for display
          setPlans(data.plans)
        }
      } catch (e) {
        console.error('Failed to load plans:', e)
      } finally {
        setLoading(false)
      }
    }
    loadPlans()
  }, [])

  return (
    <div className="min-h-screen bg-black text-white">
      {/* Background Elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-20 left-10 w-72 h-72 bg-red-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-20 right-10 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl"></div>
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-red-600/5 rounded-full blur-3xl"></div>
      </div>

      <div className="relative container mx-auto px-4 sm:px-6 py-12 max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12 space-y-6">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-8 mb-8">
            <Link href="/" className="inline-flex items-center gap-2 text-white/60 hover:text-white transition-colors">
              <ArrowLeft className="h-4 w-4" />
              Back to Portal365
            </Link>
            
            <div className="inline-flex items-center gap-3 px-4 py-2 bg-orange-500/20 border border-orange-500/30 rounded-full">
              <RefreshCw className="h-5 w-5 text-orange-400" />
              <span className="text-orange-300 font-medium">Migration Portal</span>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold leading-tight">
            Welcome, <span className="bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent">Existing Members!</span>
          </h1>
          
          <p className="text-lg text-white/70 max-w-2xl mx-auto">
            Moving from GoCardless/Direct Debit to our new system. Select your membership below - <strong className="text-white">no payment today</strong>, your first charge will be on the <strong className="text-white">1st of next month</strong>.
          </p>

          <div className="flex items-center justify-center gap-2 text-green-400">
            <CheckCircle2 className="h-5 w-5" />
            <span>Immediate access • No proration • First charge Feb 1st</span>
          </div>
        </div>

        {/* Plans Grid */}
        {loading ? (
          <div className="flex items-center justify-center py-20">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
          </div>
        ) : (
          <div className="space-y-12">
            {/* Aura MMA Plans */}
            <div>
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="bg-gradient-to-r from-red-500 to-orange-500 bg-clip-text text-transparent">Aura MMA</span>
                <Badge variant="outline" className="text-orange-400 border-orange-400/30">Mixed Martial Arts</Badge>
              </h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {plans.filter(p => (p.preferredEntities || []).includes('aura_mma')).map((plan) => (
                  <PlanCard key={plan.key} plan={plan} business="aura_mma" />
                ))}
              </div>
            </div>

            {/* Women's Striking Plans */}
            <div>
              <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-3">
                <span className="bg-gradient-to-r from-pink-500 to-purple-500 bg-clip-text text-transparent">Women's Striking Classes</span>
                <Badge variant="outline" className="text-pink-400 border-pink-400/30">Ladies Only</Badge>
              </h2>
              <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                {plans.filter(p => (p.preferredEntities || []).includes('aura_womens')).map((plan) => (
                  <PlanCard key={plan.key} plan={plan} business="aura_womens" accentColor="pink" />
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Footer Note */}
        <div className="mt-12 text-center text-white/50 text-sm">
          <p>Questions? Contact us at the gym or message us on WhatsApp.</p>
        </div>
      </div>
    </div>
  )
}

function PlanCard({ plan, business, accentColor = 'orange' }: { plan: any; business: string; accentColor?: 'orange' | 'pink' }) {
  const gradients = {
    orange: {
      icon: 'from-red-500 to-orange-600',
      button: 'from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700',
      shadow: 'group-hover:shadow-orange-500/20'
    },
    pink: {
      icon: 'from-pink-500 to-purple-600',
      button: 'from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700',
      shadow: 'group-hover:shadow-pink-500/20'
    }
  }
  const colors = gradients[accentColor]

  return (
    <Link href={`/register/details?business=${business}&plan=${plan.key}&start=firstOfNextMonth`}>
      <Card className={`group bg-white/5 border-white/10 hover:bg-white/10 hover:border-${accentColor}-500/30 transition-all duration-500 cursor-pointer backdrop-blur-sm h-full`}>
        <CardHeader className="text-center space-y-4 p-6">
          <div className={`mx-auto p-3 rounded-xl bg-gradient-to-br ${colors.icon} text-white shadow-lg w-fit`}>
            <Dumbbell className="h-6 w-6" />
          </div>
          <div className="space-y-2">
            <CardTitle className="text-xl text-white font-bold">{plan.displayName || plan.name}</CardTitle>
            <CardDescription className="text-white/60">{plan.description}</CardDescription>
          </div>
          <div className="space-y-1">
            <div className="text-4xl font-bold text-white">£{plan.monthlyPrice}</div>
            <div className="text-sm text-white/50">/month</div>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-3 px-6 pb-4">
          {(plan.features || []).map((feature: string, i: number) => (
            <div key={i} className="flex items-start gap-3 text-sm text-white/70">
              <CheckCircle2 className="h-4 w-4 text-green-400 flex-shrink-0 mt-0.5" />
              <span>{feature}</span>
            </div>
          ))}
        </CardContent>
        
        <CardFooter className="p-6 pt-2">
          <Button className={`w-full bg-gradient-to-r ${colors.button} text-white font-semibold py-6 rounded-xl transition-all duration-300 group-hover:shadow-lg ${colors.shadow}`}>
            Select {plan.displayName || plan.name}
            <ArrowRight className="h-5 w-5 ml-2 group-hover:translate-x-1 transition-transform duration-300" />
          </Button>
        </CardFooter>
      </Card>
    </Link>
  )
}

