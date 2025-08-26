'use client'

import { useSearchParams } from 'next/navigation'
import { useState, useEffect, Suspense } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, CreditCard, ArrowLeft } from 'lucide-react'

if (!process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) {
  throw new Error('NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY is not set')
}

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

function PaymentPageContent() {
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
          {/* Payment Explanation */}
          <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-6">
            <div className="flex items-center gap-2 mb-2">
              <CreditCard className="h-4 w-4 text-blue-400" />
              <h3 className="font-semibold text-blue-300">Secure Payment</h3>
            </div>
            <p className="text-sm text-white/80">
              Your payment information is encrypted and secure. We use industry-standard security measures.
            </p>
          </div>
          
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

export default function PaymentPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <PaymentPageContent />
    </Suspense>
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

  // Detect PaymentIntent vs SetupIntent
  const isPaymentIntent = clientSecret?.startsWith('pi_')
  const isSetupIntent = clientSecret?.startsWith('seti_') || clientSecret?.includes('_secret_seti_')

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    if (!stripe || !elements) {
      return
    }

    setIsProcessing(true)
    setError(null)

    try {
      if (isPaymentIntent) {
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
      } else if (isSetupIntent) {
        const result = await stripe.confirmSetup({
          elements,
          confirmParams: {
            return_url: `${window.location.origin}/register/success?subscription_id=${subscriptionId}&setup_completed=true`,
          },
        })
        if (result.error) {
          setError(result.error.message || 'Card setup failed')
          setIsProcessing(false)
        } else {
          setPaymentComplete(true)
        }
      } else {
        setError('Invalid payment session')
        setIsProcessing(false)
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