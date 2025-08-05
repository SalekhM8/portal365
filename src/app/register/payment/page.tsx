'use client'

import { useSearchParams } from 'next/navigation'
import { useEffect, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, CreditCard, ArrowLeft } from 'lucide-react'

if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
  throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set')
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

export default function PaymentPage() {
  const searchParams = useSearchParams()
  const clientSecret = searchParams.get('client_secret')
  const subscriptionId = searchParams.get('subscription_id')

  if (!clientSecret) {
    return (
      <div className="container mx-auto p-6">
        <Card>
          <CardContent className="p-6">
            <p className="text-center text-destructive">Missing payment information</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-md">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <CreditCard className="h-5 w-5" />
            Complete Your Subscription
          </CardTitle>
          <CardDescription>
            Complete your payment to activate your membership
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Elements 
            stripe={stripePromise} 
            options={{
              clientSecret,
              appearance: {
                theme: 'stripe',
              },
            }}
          >
            <PaymentForm subscriptionId={subscriptionId} />
          </Elements>
        </CardContent>
      </Card>
    </div>
  )
}

function PaymentForm({ subscriptionId }: { subscriptionId: string | null }) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [paymentComplete, setPaymentComplete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const searchParams = useSearchParams()
  const clientSecret = searchParams.get('client_secret')

  // Detect if this is a PaymentIntent or SetupIntent based on client secret prefix
  const isSetupIntent = clientSecret?.startsWith('seti_')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      if (isSetupIntent) {
        // Use confirmSetup for SetupIntent
        const result = await stripe.confirmSetup({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/register/success?subscription_id=${subscriptionId}&setup_completed=true`,
          },
        })

        if (result.error) {
          setError(result.error.message || 'Setup failed')
          setIsProcessing(false)
        } else {
          // Setup completed - call our API to process prorated billing
          const setupIntent = (result as any).setupIntent
          try {
            const response = await fetch('/api/confirm-payment', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({
                setupIntentId: setupIntent.id,
                subscriptionId: subscriptionId
              })
            })

            const confirmResult = await response.json()

            if (confirmResult.success) {
              // Redirect to success page
              window.location.href = `/register/success?subscription_id=${subscriptionId}&payment_completed=true&user_email=${encodeURIComponent(confirmResult.user.email)}`
            } else {
              setError(confirmResult.error || 'Failed to complete subscription setup')
              setIsProcessing(false)
            }
          } catch (err) {
            setError('Failed to complete subscription setup')
            setIsProcessing(false)
          }
        }
      } else {
        // Use confirmPayment for PaymentIntent
        const result = await stripe.confirmPayment({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/register/success?subscription_id=${subscriptionId}`,
          },
        })

        if (result.error) {
          setError(result.error.message || 'Payment failed')
          setIsProcessing(false)
        } else {
          setPaymentComplete(true)
        }
      }
    } catch (err) {
      setError('An unexpected error occurred')
      setIsProcessing(false)
    }
  }

  if (paymentComplete) {
    return (
      <div className="text-center space-y-4">
        <CheckCircle className="h-12 w-12 text-green-600 mx-auto" />
        <h3 className="text-lg font-semibold">Payment Successful!</h3>
        <p className="text-muted-foreground">
          Your subscription has been activated. Redirecting...
        </p>
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <PaymentElement />
      
      {error && (
        <div className="text-sm text-destructive bg-destructive/10 p-3 rounded">
          {error}
        </div>
      )}
      
      <div className="flex gap-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => window.history.back()}
          className="flex-1"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back
        </Button>
        <Button
          type="submit"
          disabled={!stripe || isProcessing}
          className="flex-1"
        >
          {isProcessing ? 'Processing...' : 'Complete Payment'}
        </Button>
      </div>
    </form>
  )
} 