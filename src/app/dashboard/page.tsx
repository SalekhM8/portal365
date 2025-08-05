'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Calendar, CreditCard, User, Clock, MapPin, Users, LogOut } from 'lucide-react'

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
}

interface ClassData {
  id: string
  name: string
  instructor: string
  time: string
  location: string
  duration: number
  canAccess: boolean
}

function DashboardContent() {
  const searchParams = useSearchParams()
  const userEmail = searchParams.get('email')
  const [loading, setLoading] = useState(true)
  const [membershipData, setMembershipData] = useState<MembershipData | null>(null)
  const [paymentHistory, setPaymentHistory] = useState<PaymentData[]>([])
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
      setPaymentHistory(data.paymentHistory)
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
      'WEEKEND_ADULT': 'Weekend Membership',
      'WEEKEND_UNDER18': 'Weekend Youth',
      'FULL_ADULT': 'Full Access Membership',
      'FULL_UNDER18': 'Full Youth Access',
      'PERSONAL_TRAINING': 'Personal Training',
      'WOMENS_CLASSES': "Women's Classes",
      'WELLNESS_PACKAGE': 'Wellness Package'
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
    <div className="container mx-auto p-6 space-y-8">
      {/* Header with Logout */}
      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Customer Dashboard</h1>
          <p className="text-muted-foreground">
            Welcome back{userEmail ? `, ${userEmail.split('@')[0]}` : ''}! Here's your Aura MMA overview.
          </p>
        </div>
        <Button variant="outline" onClick={handleLogout} className="flex items-center gap-2">
          <LogOut className="h-4 w-4" />
          Logout
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
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="classes">Class Timetable</TabsTrigger>
          <TabsTrigger value="payments">Payment History</TabsTrigger>
          <TabsTrigger value="access">Access Permissions</TabsTrigger>
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
                {paymentHistory.map((payment) => (
                  <div
                    key={payment.id}
                    className="flex items-center justify-between p-4 border rounded-lg"
                  >
                    <div className="space-y-1">
                      <p className="font-medium">{payment.description}</p>
                      <p className="text-sm text-muted-foreground">
                        {new Date(payment.date).toLocaleDateString()}
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
              <CardTitle>Access Permissions</CardTitle>
              <CardDescription>
                What your membership includes
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
                    <div className="flex items-center justify-between">
                      <span>Wellness Services</span>
                      <Badge variant={membershipData.accessPermissions.wellness ? 'default' : 'secondary'}>
                        {membershipData.accessPermissions.wellness ? 'Included' : 'Not Included'}
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