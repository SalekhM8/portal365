'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar, CreditCard, User, Clock, MapPin, Users, LogOut, Settings, Crown } from 'lucide-react'

interface MembershipData {
  type: string
  status: string
  price: number
  nextBilling: string
  accessPermissions: any
}

interface PaymentData {
  id: string
  amount: number
  date: string
  status: string
  description: string
  memberId?: string
}

interface ClassData {
  id: string
  name: string
  instructor: string
  time: string
  location: string
  duration: number
  maxParticipants: number
  canAccess: boolean
}

function DashboardContent() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const userEmail = searchParams.get('email')
  const [loading, setLoading] = useState(true)
  const [membershipData, setMembershipData] = useState<MembershipData | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentData[]>([])
  const [members, setMembers] = useState<Array<{ id: string; name: string }>>([])
  const [selectedMemberId, setSelectedMemberId] = useState<string>('ALL')
  const [upcomingClasses, setUpcomingClasses] = useState<ClassData[]>([])
  const [userData, setUserData] = useState<any>(null)

  useEffect(() => {
    // ✅ REPLACE mock data with real API call
    fetchDashboardData()
  }, [])

  const fetchDashboardData = async () => {
    try {
      setLoading(true)
      
      console.log('🔍 Fetching real customer dashboard data...')
      
      // Include email parameter if available (for post-registration flow)
      const url = userEmail 
        ? `/api/customers/dashboard?email=${encodeURIComponent(userEmail)}` 
        : '/api/customers/dashboard'
      
      const response = await fetch(url, {
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        if (response.status === 401) {
          // ✅ Handle authentication redirect
          window.location.href = '/auth/signin'
          return
        }
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()

      // ✅ Set all data including user information
      setUserData(data.user)
      setMembershipData(data.membership)
      // Backwards compatibility: if new shape exists, remap; else use legacy paymentHistory
      if (Array.isArray(data.paymentsWithMember) && Array.isArray(data.members)) {
        setMembers([{ id: 'ALL', name: 'All' }, ...data.members])
        const mapped: PaymentData[] = data.paymentsWithMember.map((p: any) => ({
          id: p.id,
          amount: p.amount,
          date: p.date,
          status: p.status,
          description: `${p.description || 'Payment'} — ${p.memberName}`,
          memberId: p.memberId
        }))
        setPaymentHistory(mapped)
      } else {
        setPaymentHistory(data.paymentHistory)
      }
      setUpcomingClasses(data.classSchedule)
      
      console.log(`✅ Real customer data loaded for: ${data.user.firstName} ${data.user.lastName}`)
      
    } catch (error) {
      console.error('❌ Error fetching real customer data:', error)
      // ✅ KEEP your existing error handling pattern
    } finally {
      setLoading(false)
    }
  }

  const handleLogout = async () => {
    await signOut({ callbackUrl: '/' })
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const getMembershipDisplayName = (type: string) => {
    const names: Record<string, string> = {
      'WEEKEND_ADULT': 'Weekend Only Membership',
      'KIDS_WEEKEND_UNDER14': 'Kids Weekend (Under 14s)',
      'FULL_ADULT': 'Full Access Membership',
      'KIDS_UNLIMITED_UNDER14': 'Kids Unlimited (Under 14s)',
      'PERSONAL_TRAINING': 'Personal Training',
      'WOMENS_CLASSES': "Women's Classes",
      'WELLNESS_PACKAGE': 'Wellness Package',
      'MASTERS': 'Masters Program (30+)'
    }
    return names[type] || type
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'default'
      case 'PENDING_PAYMENT': return 'destructive'
      case 'SUSPENDED': return 'secondary'
      default: return 'secondary'
    }
  }

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6 lg:space-y-8">
      {/* Pending payment CTA */}
      {membershipData?.status === 'PENDING_PAYMENT' && (
        <div className="border border-yellow-500/30 bg-yellow-500/10 rounded-lg p-4">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-yellow-200">Payment required to activate your membership</p>
              <p className="text-yellow-200/80 text-sm">Complete your initial payment to unlock access. You won’t be charged again until the 1st of next month.</p>
            </div>
            <Button
              onClick={async () => {
                try {
                  const resp = await fetch('/api/customers/membership/resume', { method: 'POST' })
                  const json = await resp.json()
                  if (!resp.ok || !json?.clientSecret) {
                    alert(json?.error || 'Unable to resume payment, please try again.')
                    return
                  }
                  if (json.mode === 'payment_intent') {
                    router.push(`/register/payment?subscription_id=${encodeURIComponent(json.subscriptionId)}&client_secret=${encodeURIComponent(json.clientSecret)}`)
                  } else if (json.mode === 'setup_intent') {
                    router.push(`/dashboard/payment-methods?sub=${encodeURIComponent(json.subscriptionId)}&client_secret=${encodeURIComponent(json.clientSecret)}`)
                  } else {
                    alert('Unsupported resume mode')
                  }
                } catch (e) {
                  alert('Network error. Please try again.')
                }
              }}
            >
              Complete setup
            </Button>
          </div>
        </div>
      )}
      {/* Header with Navigation */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Customer Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back{userEmail ? `, ${userEmail.split('@')[0]}` : ''}! Here's your Aura MMA overview.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/membership')}
            className="hidden sm:flex"
          >
            <Crown className="h-4 w-4 mr-2" />
            Manage Plan
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/family')}
            className="hidden sm:flex"
          >
            Family
          </Button>
          <Button
            variant="outline"
            onClick={() => router.push('/dashboard/payment-methods')}
            className="hidden sm:flex"
          >
            <CreditCard className="h-4 w-4 mr-2" />
            Payment Methods
          </Button>
          <Button variant="outline" onClick={handleLogout}>
            <LogOut className="h-4 w-4 mr-2" />
            Logout
          </Button>
        </div>
      </div>

      {/* Mobile Navigation */}
      <div className="flex gap-2 sm:hidden">
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard/membership')}
          className="flex-1"
        >
          <Crown className="h-4 w-4 mr-2" />
          Manage Plan
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard/family')}
          className="flex-1"
        >
          Family
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push('/dashboard/payment-methods')}
          className="flex-1"
        >
          <CreditCard className="h-4 w-4 mr-2" />
          Payment
        </Button>
      </div>

      {/* Membership Status Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                {membershipData && getMembershipDisplayName(membershipData.type)}
              </CardTitle>
              <CardDescription>Your current membership details</CardDescription>
            </div>
            <Badge variant={membershipData ? getStatusBadgeVariant(membershipData.status) : 'secondary'}>
              {membershipData?.status || 'Loading...'}
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3">
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Monthly Price</p>
              <p className="text-2xl font-bold">£{membershipData?.price || 0}/month</p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Next Billing</p>
              <p className="text-lg font-semibold">
                {membershipData?.nextBilling ? new Date(membershipData.nextBilling).toLocaleDateString() : 'N/A'}
              </p>
            </div>
            <div className="space-y-2">
              <p className="text-sm font-medium text-muted-foreground">Member Since</p>
              <p className="text-lg font-semibold">
                {userData?.memberSince ? new Date(userData.memberSince).toLocaleDateString('en-GB', { 
                  year: 'numeric', 
                  month: 'long' 
                }) : 'N/A'}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Main Content Tabs */}
        <Tabs defaultValue="classes" className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 h-auto">
          <TabsTrigger value="classes" className="text-xs lg:text-sm">Timetable</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs lg:text-sm">Payments</TabsTrigger>
          <TabsTrigger value="access" className="text-xs lg:text-sm">Access</TabsTrigger>
        </TabsList>

        {/* Class Timetable Tab */}
        <TabsContent value="classes" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Available Classes
              </CardTitle>
              <CardDescription>
                Drop-in classes available with your membership - no booking required!
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4">
                {upcomingClasses.map((classItem) => (
                  <div
                    key={classItem.id}
                    className="flex items-center justify-between p-4 border rounded-lg hover:shadow-md transition-shadow"
                  >
                    <div className="space-y-1">
                      <h4 className="font-semibold">{classItem.name}</h4>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-4 w-4" />
                          {classItem.time}
                        </span>
                        <span className="flex items-center gap-1">
                          <MapPin className="h-4 w-4" />
                          {classItem.location}
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="h-4 w-4" />
                          Max {classItem.maxParticipants}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        Instructor: {classItem.instructor}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant="outline">Drop-in</Badge>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment History Tab */}
        <TabsContent value="payments" className="space-y-6">
          {members.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {members.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedMemberId(m.id)}
                  className={`px-3 py-1 rounded-full border ${selectedMemberId === m.id ? 'bg-white text-black' : 'border-white/20 text-white'}`}
                >
                  {m.name}
                </button>
              ))}
            </div>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Payment History
              </CardTitle>
              <CardDescription>
                Your recent payments and billing information
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {paymentHistory
                  .filter(p => {
                    if (selectedMemberId === 'ALL') return true
                    const tagged = (p.description || '').match(/\[member:([^\]]+)\]/)
                    const taggedId = tagged?.[1]
                    const effectiveId = p.memberId || taggedId
                    return effectiveId === selectedMemberId
                  })
                  .map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{payment.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(payment.date).toLocaleDateString()}
                      </p>
                      <p className="text-[10px] text-muted-foreground/70">
                        DEBUG: memberId={<>{payment.memberId || ((payment.description || '').match(/\[member:([^\]]+)\]/)?.[1] || 'none')}</>} selected={selectedMemberId}
                      </p>
                    </div>
                    <div className="text-right space-y-1">
                      <p className="font-semibold">£{payment.amount}</p>
                      <Badge variant={payment.status === 'CONFIRMED' ? 'default' : 'destructive'}>
                        {payment.status}
                      </Badge>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-6 pt-4 border-t">
                <Button variant="outline" className="w-full">
                  Download Payment History
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Access Permissions Tab */}
        <TabsContent value="access" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Your Accessible Classes</CardTitle>
              <CardDescription>
                Classes you can attend with your current membership
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {upcomingClasses.filter(classItem => classItem.canAccess).length > 0 ? (
                  <div className="grid gap-3">
                    {upcomingClasses.filter(classItem => classItem.canAccess).map((classItem) => (
                      <div
                        key={classItem.id}
                        className="flex items-center justify-between p-3 border rounded-lg bg-green-500/10 border-green-500/20"
                      >
                        <div>
                          <h4 className="font-medium text-white">{classItem.name}</h4>
                          <p className="text-sm text-white/70">
                            {classItem.time} • {classItem.location} • {classItem.instructor}
                          </p>
                        </div>
                        <Badge variant="default" className="bg-green-500 text-white">
                          Included
                        </Badge>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-white/70">No accessible classes found.</p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Membership Benefits</CardTitle>
              <CardDescription>
                Additional services included with your plan
              </CardDescription>
            </CardHeader>
            <CardContent>
              {membershipData?.accessPermissions && (
                <div className="space-y-4">
                  <div>
                    <h4 className="font-semibold mb-2">Martial Arts Access</h4>
                    <div className="flex flex-wrap gap-2">
                      {membershipData.accessPermissions.martialArts?.map((art: string) => (
                        <Badge key={art} variant="outline">
                          {art.toUpperCase()}
                        </Badge>
                      ))}
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="flex items-center justify-between">
                      <span>Equipment Access</span>
                      <Badge variant="default">
                        Included
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Changing Facilities</span>
                      <Badge variant="default">
                        Included
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Personal Training</span>
                      <Badge variant={membershipData.accessPermissions.personalTraining ? 'default' : 'secondary'}>
                        {membershipData.accessPermissions.personalTraining ? 'Included' : 'Not Included'}
                      </Badge>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Women's Classes</span>
                      <Badge variant={membershipData.accessPermissions.womensClasses ? 'default' : 'secondary'}>
                        {membershipData.accessPermissions.womensClasses ? 'Included' : 'Not Included'}
                      </Badge>
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  )
}

export default function CustomerDashboard() {
  return (
    <Suspense fallback={<div>Loading...</div>}>
      <DashboardContent />
    </Suspense>
  )
} 