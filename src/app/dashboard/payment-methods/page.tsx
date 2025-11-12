'use client'

import { useState, useEffect, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, CreditCard, Loader2, CheckCircle } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

// We load Stripe dynamically with the publishable key returned from the API per subscription

function PaymentMethodsInner() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const searchParams = useSearchParams()
  const pkParam = searchParams.get('pk')
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [currentPaymentMethod, setCurrentPaymentMethod] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
      return
    }

    // Handle redirect return from Stripe if present
    const setupIntentId = searchParams.get('setup_intent')
    const redirectStatus = searchParams.get('redirect_status')
    const familySub = searchParams.get('family_sub')
    const genericSub = searchParams.get('sub')
    const clientSecretFromLink = searchParams.get('client_secret')
    // If a client_secret is supplied in URL (resume path), seed local state so Elements can render even if API excludes pending subscriptions
    if (clientSecretFromLink && !clientSecret) {
      setClientSecret(clientSecretFromLink)
    }
    if (setupIntentId && redirectStatus === 'succeeded') {
      // finalize by informing backend to set default payment method
      finalizePaymentMethod(setupIntentId)
        .then(() => fetchPaymentMethods())
        .finally(() => {
          // optional: clean URL params
          const url = new URL(window.location.href)
          url.searchParams.delete('setup_intent')
          url.searchParams.delete('redirect_status')
          // For family activation: also finalize the child's subscription now that PM is saved
          if (familySub) {
            // Use confirm-payment with setupIntent path to create child subscription
            fetch('/api/confirm-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ setupIntentId, subscriptionId: familySub })
            }).finally(() => {})
            url.searchParams.delete('family_sub')
          } else if (genericSub) {
            // Generic resume path for main user subscriptions
            fetch('/api/confirm-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ setupIntentId, subscriptionId: genericSub })
            }).finally(() => {})
            url.searchParams.delete('sub')
          }
          window.history.replaceState({}, '', url.toString())
        })
    } else if (clientSecretFromLink && (familySub || genericSub)) {
      // Family prorate SCA: confirm PaymentIntent and then finalize
      (async () => {
        try {
          const pk = (await fetch('/api/customers/payment-methods').then(r => r.json()).catch(() => ({})))?.publishableKey
          const stripeJs = pk ? await loadStripe(pk) : null
          if (!stripeJs) return
          const result = await stripeJs.confirmCardPayment(clientSecretFromLink)
          if (result.error) {
            setError(result.error.message || 'Payment confirmation failed')
          } else if (result.paymentIntent && result.paymentIntent.status === 'succeeded') {
            await fetch('/api/confirm-payment', {
              method: 'POST', headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ paymentIntentId: result.paymentIntent.id, subscriptionId: familySub || genericSub })
            })
          }
        } catch (e) {
          // swallow
        } finally {
          const url = new URL(window.location.href)
          url.searchParams.delete('client_secret')
          if (familySub) url.searchParams.delete('family_sub')
          if (genericSub) url.searchParams.delete('sub')
          window.history.replaceState({}, '', url.toString())
        }
      })()
    } else if (session?.user?.email) {
      fetchPaymentMethods()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, status])

  const finalizePaymentMethod = async (setupIntentId: string) => {
    try {
      await fetch('/api/customers/payment-methods', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ setupIntentId })
      })
    } catch (e) {
      // swallow; GET will reflect current state
    }
  }

  const fetchPaymentMethods = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/customers/payment-methods')
      const data = await response.json()

      if (data.success) {
        setCurrentPaymentMethod(data.currentPaymentMethod)
        setClientSecret(data.setupIntentClientSecret)
        if (data.publishableKey) {
          // Preload the Stripe instance for this account
          await loadStripe(data.publishableKey)
        } else if (pkParam) {
          await loadStripe(pkParam)
        }
      } else {
        setError(data.error || 'Failed to load payment methods')
      }
    } catch (err) {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-2xl">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2 text-muted-foreground">Loading payment methods...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-2xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => router.push('/dashboard')}>
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Dashboard
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Payment Methods</h1>
          <p className="text-muted-foreground">Manage your payment details</p>
        </div>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Current Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Current Payment Method
          </CardTitle>
          <CardDescription>
            This payment method will be used for your monthly membership billing
          </CardDescription>
        </CardHeader>
        <CardContent>
          {currentPaymentMethod ? (
            <div className="bg-white/5 border border-white/10 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium text-white">
                    •••• •••• •••• {currentPaymentMethod.last4}
                  </p>
                  <p className="text-sm text-white/70">
                    {currentPaymentMethod.brand?.toUpperCase()} • Expires {currentPaymentMethod.exp_month}/{currentPaymentMethod.exp_year}
                  </p>
                </div>
                <CheckCircle className="h-5 w-5 text-green-400" />
              </div>
            </div>
          ) : (
            <p className="text-white/70">No payment method on file</p>
          )}
        </CardContent>
      </Card>

      {/* Update Payment Method */}
      <Card>
        <CardHeader>
          <CardTitle>Update Payment Method</CardTitle>
          <CardDescription>
            Add a new payment method to replace your current one
          </CardDescription>
        </CardHeader>
        <CardContent>
          {clientSecret && (
            <Elements
              // elements will lazy-init with the pk that matches the client secret
              stripe={(async () => {
                if (pkParam) return loadStripe(pkParam)
                const pk = (await fetch('/api/customers/payment-methods').then(r => r.json()).catch(() => ({})))?.publishableKey
                return pk ? loadStripe(pk) : null as any
              })() as any}
              options={{
                clientSecret,
                appearance: { theme: 'stripe' }
              }}
            >
              <PaymentMethodForm onSuccess={() => {
                fetchPaymentMethods()
              }} />
            </Elements>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

export default function PaymentMethodsPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PaymentMethodsInner />
    </Suspense>
  )
}

function PaymentMethodForm({ onSuccess }: { onSuccess: () => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState(false)

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements) return

    setIsProcessing(true)
    setError(null)

    try {
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/dashboard/payment-methods?updated=true`,
        },
        redirect: 'if_required'
      })

      if (result.error) {
        setError(result.error.message || 'Failed to update payment method')
      } else {
        // If no redirect happened, Stripe may return the setupIntent
        const setupIntentId = result.setupIntent?.id
        if (setupIntentId && result.setupIntent.status === 'succeeded') {
          await fetch('/api/customers/payment-methods', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ setupIntentId })
          })
        }
        setSuccess(true)
        setTimeout(() => {
          onSuccess()
          setSuccess(false)
        }, 1500)
      }
    } catch (err) {
      setError('An unexpected error occurred')
    } finally {
      setIsProcessing(false)
    }
  }

  if (success) {
    return (
      <div className="text-center space-y-4 py-8">
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
        <h3 className="text-lg font-semibold">Payment Method Updated!</h3>
        <p className="text-muted-foreground">
          Your new payment method has been saved successfully.
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      
      <Button
        type="submit"
        disabled={!stripe || isProcessing}
        className="w-full"
      >
        {isProcessing ? (
          <>
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            Updating...
          </>
        ) : (
          'Update Payment Method'
        )}
      </Button>
    </form>
  )
} 