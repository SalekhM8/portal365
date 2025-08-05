'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { CheckCircle, ArrowRight, CreditCard } from 'lucide-react'

function SuccessContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  
  const [isProcessing, setIsProcessing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [userEmail, setUserEmail] = useState<string | null>(null)

  useEffect(() => {
    const handleSuccess = async () => {
      const subscriptionId = searchParams.get('subscription_id')
      const paymentCompleted = searchParams.get('payment_completed')
      const userEmail = searchParams.get('user_email')
      
      if (paymentCompleted === 'true' && userEmail) {
        // New flow: payment already completed, no API call needed
        console.log('✅ Payment already completed during registration')
        setUserEmail(userEmail)
        setIsProcessing(false)
        
        // Wait 2 seconds then redirect to dashboard
        setTimeout(() => {
          router.push(`/dashboard?email=${encodeURIComponent(userEmail)}`)
        }, 2000)
        
        return
      }
      
      // Legacy flow: confirm payment via API
      const paymentIntent = searchParams.get('payment_intent')
      const redirectStatus = searchParams.get('redirect_status')

      if (!subscriptionId || !paymentIntent || redirectStatus !== 'succeeded') {
        setError('Invalid payment confirmation')
        setIsProcessing(false)
        return
      }

      try {
        // Call API to confirm payment and update subscription status
        const response = await fetch('/api/confirm-payment', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            subscriptionId,
            paymentIntentId: paymentIntent
          })
        })

        const result = await response.json()

        if (result.success) {
          setUserEmail(result.user.email)
          // Wait 2 seconds then redirect to customer dashboard with email
          setTimeout(() => {
            router.push(`/dashboard?email=${encodeURIComponent(result.user.email)}`)
          }, 2000)
        } else {
          setError('Failed to confirm payment')
        }
      } catch (err) {
        setError('Failed to process payment confirmation')
      } finally {
        setIsProcessing(false)
      }
    }

    handleSuccess()
  }, [searchParams, router])

  if (error) {
    return (
      <div className="container mx-auto p-6 max-w-md">
        <Card>
          <CardContent className="p-6">
            <div className="text-center space-y-4">
              <div className="text-destructive">⚠️</div>
              <h3 className="text-lg font-semibold">Payment Error</h3>
              <p className="text-muted-foreground">{error}</p>
              <Button onClick={() => router.push('/register')} className="w-full">
                Try Again
              </Button>
            </div>
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
            <CheckCircle className="h-6 w-6 text-green-600" />
            Payment Successful!
          </CardTitle>
          <CardDescription>
            Your membership has been activated
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="text-center space-y-4">
            <div className="bg-green-50 p-4 rounded-lg">
              <CreditCard className="h-8 w-8 text-green-600 mx-auto mb-2" />
              <h3 className="font-semibold text-green-800">Subscription Active</h3>
              <p className="text-sm text-green-700">
                Your payment has been processed and your gym membership is now active.
              </p>
            </div>

            {isProcessing ? (
              <div className="space-y-2">
                <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full mx-auto"></div>
                <p className="text-sm text-muted-foreground">
                  Setting up your account...
                </p>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Redirecting to your dashboard...
                </p>
                <Button 
                  onClick={() => router.push(`/dashboard?email=${encodeURIComponent(userEmail || '')}`)}
                  className="w-full"
                >
                  Go to Dashboard
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function RegistrationSuccessPage() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <SuccessContent />
    </Suspense>
  )
} 