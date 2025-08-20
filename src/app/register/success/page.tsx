'use client'

import { useSearchParams, useRouter } from 'next/navigation'
import { useEffect, useState, Suspense } from 'react'
import { signIn } from 'next-auth/react'
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
      const setupCompleted = searchParams.get('setup_completed')
      
      // New flow: payment already completed via API call
      if (paymentCompleted === 'true' && userEmail) {
        console.log('✅ Payment already completed during registration')
        setUserEmail(userEmail)
        setIsProcessing(false)
        
        // Wait 2 seconds then redirect to dashboard (user is already logged in)
        setTimeout(() => {
          router.push('/dashboard')
          router.refresh()
        }, 2000)
        
        return
      }
      
      // SetupIntent flow: setup completed, need to process via API
      if (setupCompleted === 'true' && subscriptionId) {
        console.log('✅ Setup completed, processing subscription...')
        
        try {
          setIsProcessing(true)
          
          // Get the setup intent ID from URL parameters
          const setupIntentId = searchParams.get('setup_intent')
          
          if (!setupIntentId) {
            setError('Missing setup intent information')
            setIsProcessing(false)
            return
          }
          
          // Call our API to process prorated billing
          const response = await fetch('/api/confirm-payment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              setupIntentId: setupIntentId,
              subscriptionId: subscriptionId
            })
          })

          const confirmResult = await response.json()

          if (confirmResult.success) {
            // Success! Payment method setup completed
            console.log('✅ Payment method setup completed')
            setUserEmail(confirmResult.user.email)
            setIsProcessing(false)
            
            // Show success message and redirect to dashboard
            // Note: Subscription will activate via webhook after payment is processed
            setTimeout(() => {
              router.push('/dashboard')
              router.refresh() // Refresh to ensure session is current
            }, 3000) // Slightly longer to show the message
          } else {
            setError(confirmResult.error || 'Failed to complete subscription setup')
            setIsProcessing(false)
          }
        } catch (error) {
          setError('Failed to complete subscription setup')
          setIsProcessing(false)
        }
        
        return
      }
      
      // Legacy PaymentIntent flow: confirm payment via API
      const paymentIntent = searchParams.get('payment_intent')
      const redirectStatus = searchParams.get('redirect_status')

      if (paymentIntent && redirectStatus === 'succeeded' && subscriptionId) {
        try {
          // Call API to confirm payment and update subscription status
          const response = await fetch('/api/confirm-payment', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              paymentIntentId: paymentIntent,
              subscriptionId: subscriptionId
            })
          })

          const result = await response.json()

          if (result.success) {
            setUserEmail(result.user.email)
            setIsProcessing(false)
            
            // Redirect to dashboard after 2 seconds (user is already authenticated)
            setTimeout(() => {
              router.push('/dashboard')
              router.refresh()
            }, 2000)
          } else {
            setError(result.error || 'Failed to confirm payment')
            setIsProcessing(false)
          }
        } catch (error) {
          setError('Failed to confirm payment')
          setIsProcessing(false)
        }
        return
      }
      
      // If we get here, we don't have the right parameters
      console.error('Missing required parameters:', {
        subscriptionId,
        paymentCompleted,
        userEmail,
        setupCompleted,
        paymentIntent,
        redirectStatus
      })
      setError('Invalid payment confirmation - missing required parameters')
      setIsProcessing(false)
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
            <div className="bg-green-500/10 border border-green-500/20 p-4 rounded-lg">
              <CreditCard className="h-8 w-8 text-green-400 mx-auto mb-2" />
              <h3 className="font-semibold text-green-300">Subscription Active</h3>
              <p className="text-sm text-green-200">
                Your membership is now active and ready to use.
              </p>
            </div>

            {/* Payment Information */}
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg text-left">
              <h4 className="font-semibold text-white mb-2">Next Steps:</h4>
              <ul className="space-y-1 text-sm text-white/80">
                <li>• Download our mobile app for easy access</li>
                <li>• View class timetables and facility information</li>
                <li>• Update your profile and emergency contacts</li>
                <li>• Join our community on social media</li>
              </ul>
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
                  onClick={() => {
                    router.push('/dashboard')
                    router.refresh()
                  }}
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