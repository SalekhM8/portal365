'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { ArrowLeft, Crown, CheckCircle2, Phone, Loader2, ArrowUpRight, ArrowDownRight, CreditCard, Calendar } from 'lucide-react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

type Preview = {
  currentPlan: string
  currentPrice: number
  newPlan: string
  newPrice: number
  isUpgrade: boolean
  prorationAmount: number
  prorationAction: 'charge' | 'credit'
  nextBillingDate: string | null
  stripeStatus: string
}

export default function MembershipPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [currentMembership, setCurrentMembership] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  
  // Modal state
  const [selectedPlan, setSelectedPlan] = useState<string | null>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [processing, setProcessing] = useState(false)

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

  const openPlanModal = async (planKey: string) => {
    if (planKey === currentMembership?.type) return

    setSelectedPlan(planKey)
    setPreview(null)
    setPreviewLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/customers/membership/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newMembershipType: planKey })
      })
      const data = await response.json()
      
      if (data.success) {
        setPreview(data.preview)
      } else {
        setError(data.error || 'Failed to preview change')
        setSelectedPlan(null)
      }
    } catch (err) {
      setError('Network error. Please try again.')
      setSelectedPlan(null)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handlePlanChange = async (settlement: 'charge_now' | 'defer') => {
    if (!selectedPlan) return
    
    setProcessing(true)
    setError(null)

    try {
      const response = await fetch('/api/customers/membership/change', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newMembershipType: selectedPlan, settlement })
      })

      const data = await response.json()

      if (data.success) {
        setSuccess(data.message)
        setSelectedPlan(null)
        setPreview(null)
        await fetchMembership()
      } else {
        setError(data.error || 'Failed to change membership plan')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setProcessing(false)
    }
  }

  const closeModal = () => {
    setSelectedPlan(null)
    setPreview(null)
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

  const selectedPlanDetails = selectedPlan ? MEMBERSHIP_PLANS[selectedPlan as keyof typeof MEMBERSHIP_PLANS] : null

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
        <Alert className="border-green-500/20 bg-green-500/10">
          <CheckCircle2 className="h-4 w-4 text-green-400" />
          <AlertDescription className="text-green-300">{success}</AlertDescription>
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

      {/* Available Plans */}
      <Card>
        <CardHeader>
          <CardTitle>Available Plans</CardTitle>
          <CardDescription>
            Click on a plan to see pricing options and change your membership.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {Object.entries(MEMBERSHIP_PLANS)
              .filter(([key]) => !['PERSONAL_TRAINING', 'WELLNESS_PACKAGE'].includes(key))
              .map(([key, plan]) => (
              <Card 
                key={key}
                className={`cursor-pointer transition-all hover:shadow-lg border-2 ${
                  currentMembership?.type === key ? 'ring-2 ring-blue-400 bg-blue-500/10 border-blue-500/20' : 'hover:border-white/30'
                }`}
                onClick={() => openPlanModal(key)}
              >
                <CardHeader className="text-center">
                  <CardTitle className="text-lg">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="text-2xl font-bold">
                    £{plan.monthlyPrice}
                    <span className="text-sm font-normal text-muted-foreground">/month</span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {plan.features.map((feature) => (
                    <div key={feature} className="flex items-center gap-2 text-sm">
                      <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
                      <span>{feature}</span>
                    </div>
                  ))}
                  <Button
                    disabled={currentMembership?.type === key}
                    className="w-full mt-4"
                    variant={currentMembership?.type === key ? 'secondary' : 'default'}
                  >
                    {currentMembership?.type === key ? 'Current Plan' : 'Select This Plan'}
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Plan Change Modal */}
      <Dialog open={!!selectedPlan} onOpenChange={(open) => !open && closeModal()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {preview?.isUpgrade ? (
                <ArrowUpRight className="h-5 w-5 text-green-500" />
              ) : (
                <ArrowDownRight className="h-5 w-5 text-blue-500" />
              )}
              {preview?.isUpgrade ? 'Upgrade' : 'Change'} to {selectedPlanDetails?.name}
            </DialogTitle>
            <DialogDescription>
              Choose how you'd like to handle the price adjustment
            </DialogDescription>
          </DialogHeader>

          {previewLoading ? (
            <div className="py-8 text-center">
              <Loader2 className="h-8 w-8 animate-spin mx-auto" />
              <p className="mt-2 text-muted-foreground">Calculating adjustment...</p>
            </div>
          ) : preview ? (
            <div className="space-y-4">
              {/* Price Summary */}
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Current plan</span>
                  <span>£{preview.currentPrice}/month</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">New plan</span>
                  <span className="font-semibold">£{preview.newPrice}/month</span>
                </div>
                <div className="border-t pt-2 mt-2">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">
                      {preview.isUpgrade ? 'Amount due today' : 'Credit to account'}
                    </span>
                    <span className={`font-bold ${preview.isUpgrade ? 'text-green-500' : 'text-blue-500'}`}>
                      £{preview.prorationAmount.toFixed(2)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Prorated for remaining days until {preview.nextBillingDate}
                  </p>
                </div>
              </div>

              {/* Options */}
              <div className="space-y-3">
                <Button
                  className="w-full h-auto py-4"
                  onClick={() => handlePlanChange('charge_now')}
                  disabled={processing}
                >
                  <div className="flex items-center gap-3 w-full">
                    <CreditCard className="h-5 w-5 flex-shrink-0" />
                    <div className="text-left flex-1">
                      <div className="font-semibold">
                        {preview.isUpgrade ? `Pay £${preview.prorationAmount.toFixed(2)} now` : 'Switch now'}
                      </div>
                      <div className="text-xs opacity-80">
                        {preview.isUpgrade 
                          ? 'Charge my card immediately and upgrade now' 
                          : `Receive £${preview.prorationAmount.toFixed(2)} credit on next invoice`}
                      </div>
                    </div>
                  </div>
                </Button>

                <Button
                  variant="outline"
                  className="w-full h-auto py-4"
                  onClick={() => handlePlanChange('defer')}
                  disabled={processing}
                >
                  <div className="flex items-center gap-3 w-full">
                    <Calendar className="h-5 w-5 flex-shrink-0" />
                    <div className="text-left flex-1">
                      <div className="font-semibold">Add to next invoice</div>
                      <div className="text-xs opacity-80">
                        {preview.isUpgrade 
                          ? `Pay £${(preview.newPrice + preview.prorationAmount).toFixed(2)} on ${preview.nextBillingDate}` 
                          : `Pay £${(preview.newPrice - preview.prorationAmount).toFixed(2)} on ${preview.nextBillingDate}`}
                      </div>
                    </div>
                  </div>
                </Button>
              </div>

              {processing && (
                <div className="text-center py-2">
                  <Loader2 className="h-5 w-5 animate-spin mx-auto" />
                  <p className="text-sm text-muted-foreground mt-1">Processing...</p>
                </div>
              )}
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="ghost" onClick={closeModal} disabled={processing}>
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

function formatDays(days: string[] = []) {
  if (!Array.isArray(days) || days.length === 0) return 'Any day'
  const map: Record<string, string> = { mon: 'Mon', tue: 'Tue', wed: 'Wed', thu: 'Thu', fri: 'Fri', sat: 'Sat', sun: 'Sun' }
  return days.map(d => map[d] || d).join(', ')
}
