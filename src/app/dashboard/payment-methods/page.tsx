'use client'

import { useState, useEffect } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { ArrowLeft, CreditCard, Loader2, CheckCircle } from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function PaymentMethodsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [currentPaymentMethod, setCurrentPaymentMethod] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
      return
    }

    if (session?.user?.email) {
      fetchPaymentMethods()
    }
  }, [session, status])

  const fetchPaymentMethods = async () => {
    try {
      const response = await fetch('/api/customers/payment-methods')
      const data = await response.json()

      if (data.success) {
        setCurrentPaymentMethod(data.currentPaymentMethod)
        setClientSecret(data.setupIntentClientSecret)
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
            <div className="bg-gray-50 p-4 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">
                    •••• •••• •••• {currentPaymentMethod.last4}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {currentPaymentMethod.brand?.toUpperCase()} • Expires {currentPaymentMethod.exp_month}/{currentPaymentMethod.exp_year}
                  </p>
                </div>
                <CheckCircle className="h-5 w-5 text-green-600" />
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No payment method on file</p>
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
              stripe={stripePromise}
              options={{
                clientSecret,
                appearance: { theme: 'stripe' }
              }}
            >
              <PaymentMethodForm onSuccess={fetchPaymentMethods} />
            </Elements>
          )}
        </CardContent>
      </Card>
    </div>
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
        setSuccess(true)
        setTimeout(() => {
          onSuccess()
          setSuccess(false)
        }, 2000)
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