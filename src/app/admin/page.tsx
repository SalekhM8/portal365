'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState } from 'react'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Progress } from '@/components/ui/progress'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { 
  AlertTriangle, 
  TrendingUp, 
  Users, 
  CreditCard, 
  Settings, 
  Eye,
  ArrowUpRight,
  ArrowDownRight,
  CheckCircle,
  Search,
  Filter,
  Download,
  UserPlus,
  Calendar,
  Building2,
  PoundSterling,
  Clock,
  Activity,
  BarChart3,
  FileText,
  MapPin,
  Phone,
  Mail,
  AlertCircle,
  LogOut,
  X
} from 'lucide-react'

interface VATStatus {
  entityId: string
  entityName: string
  currentRevenue: number
  vatThreshold: number
  headroom: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  monthlyAverage: number
  projectedYearEnd: number
  customerCount: number
  avgPaymentValue: number
}

interface CustomerDetail {
  id: string
  name: string
  email: string
  phone: string
  membershipType: string
  status: string
  joinDate: string
  lastPayment: string
  totalPaid: number
  routedEntity: string
  nextBilling: string
  emergencyContact: {
    name: string
    phone: string
    relationship: string
  }
  accessHistory: {
    lastAccess: string
    totalVisits: number
    avgWeeklyVisits: number
  }
}

interface PaymentDetail {
  id: string
  customerName: string
  customerId: string
  amount: number
  routedToEntity: string
  routingReason: string
  timestamp: string
  status: string
  goCardlessId: string
  retryCount: number
  processingTime: number
  confidence: string
  membershipType: string
}

interface BusinessMetrics {
  totalRevenue: number
  monthlyRecurring: number
  churnRate: number
  acquisitionRate: number
  avgLifetimeValue: number
  paymentSuccessRate: number
  routingEfficiency: number
}

interface AnalyticsData {
  membershipCLV: {
    FULL_ADULT?: number
    WEEKEND_ADULT?: number
    PERSONAL_TRAINING?: number
    WOMENS_CLASSES?: number
    WELLNESS_PACKAGE?: number
    [key: string]: number | undefined
  }
  acquisitionDetails: {
    thisMonth: number
    lastMonth: number
    growthRate: number
  }
  operationalMetrics: {
    autoRoutingRate: number
    manualOverrideRate: number
    avgDecisionTime: number
  }
}

export default function AdminDashboard() {
  const { data: session, status } = useSession() // ✅ ENABLE real session management
  const [vatStatus, setVatStatus] = useState<VATStatus[]>([])
  const [customers, setCustomers] = useState<CustomerDetail[]>([])
  const [payments, setPayments] = useState<PaymentDetail[]>([])
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetrics | null>(null)
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null) // 🚀 NEW: Real analytics data
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [entityFilter, setEntityFilter] = useState('all')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null)
  const [showAddCustomer, setShowAddCustomer] = useState(false)
  const [addCustomerData, setAddCustomerData] = useState({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    membershipType: '',
    customPrice: '',
    startDate: '',
    emergencyContact: {
      name: '',
      phone: '',
      relationship: ''
    }
  })
  const [addCustomerLoading, setAddCustomerLoading] = useState(false)
  const [addCustomerError, setAddCustomerError] = useState('')
  const [showPaymentModal, setShowPaymentModal] = useState(false)
  const [paymentClientSecret, setPaymentClientSecret] = useState('')
  const [createdSubscriptionId, setCreatedSubscriptionId] = useState('')

  useEffect(() => {
    // ✅ ADD authentication check
    if (status === 'loading') return
    
    if (!session) {
      window.location.href = '/auth/signin'
      return
    }
    
    // ✅ ADD role check (keeping your hasPermission pattern)
    const user = session?.user as any
    if (!user || (user.role !== 'ADMIN' && user.role !== 'SUPER_ADMIN')) {
      window.location.href = '/dashboard'
      return
    }
    
    fetchAdminData()
  }, [session, status])

  const fetchAdminData = async () => {
    try {
      setLoading(true)
      
      // ✅ REPLACE hardcoded data with real API call
      console.log('🔍 Fetching real admin dashboard data...')
      
      const response = await fetch('/api/admin/dashboard', {
        headers: {
          'Content-Type': 'application/json'
        }
      })
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }
      
      const data = await response.json()
      
      // ✅ KEEP your existing state setters (no changes to UI logic)
      setVatStatus(data.vatStatus)
      setCustomers(data.customers)
      setPayments(data.payments)
      setBusinessMetrics(data.metrics)
      setRecentActivity(data.recentActivity)
      setAnalytics(data.analytics) // 🚀 NEW: Real analytics data
      
      console.log(`✅ Real admin data loaded: ${data.customers.length} customers, ${data.payments.length} payments`)
      
    } catch (error) {
      console.error('❌ Error fetching real admin data:', error)
      // ✅ KEEP your existing error handling pattern
      setLoading(false)
    } finally {
      setLoading(false)
    }
  }

  const handleAddCustomer = async (e: React.FormEvent) => {
    e.preventDefault()
    setAddCustomerLoading(true)
    setAddCustomerError('')

    try {
      const response = await fetch('/api/admin/customers/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          firstName: addCustomerData.firstName,
          lastName: addCustomerData.lastName,
          email: addCustomerData.email,
          phone: addCustomerData.phone,
          dateOfBirth: addCustomerData.dateOfBirth,
          membershipType: addCustomerData.membershipType,
          customPrice: parseFloat(addCustomerData.customPrice),
          startDate: addCustomerData.startDate,
          emergencyContact: addCustomerData.emergencyContact.name ? addCustomerData.emergencyContact : undefined
        })
      })

      const result = await response.json()

      if (result.success && result.subscription?.clientSecret) {
        // Customer created successfully, now collect payment
        setPaymentClientSecret(result.subscription.clientSecret)
        setCreatedSubscriptionId(result.subscription.id)
        setShowAddCustomer(false)
        setShowPaymentModal(true)
        
        console.log('✅ Admin customer created, opening payment modal')
      } else {
        setAddCustomerError(result.error || 'Failed to create customer')
      }
    } catch (error) {
      setAddCustomerError('Network error. Please try again.')
      console.error('❌ Admin customer creation error:', error)
    } finally {
      setAddCustomerLoading(false)
    }
  }

  const handlePaymentSuccess = () => {
    setShowPaymentModal(false)
    setPaymentClientSecret('')
    setCreatedSubscriptionId('')
    
    // Reset form
    setAddCustomerData({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
      dateOfBirth: '',
      membershipType: '',
      customPrice: '',
      startDate: '',
      emergencyContact: { name: '', phone: '', relationship: '' }
    })
    
    // Refresh customer list
    fetchAdminData()
    
    alert('Customer created successfully!')
  }

  const handlePaymentError = (error: string) => {
    console.error('❌ Payment setup error:', error)
    alert('Payment setup failed: ' + error)
  }

  // Filter functions
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || customer.status === statusFilter
    const matchesEntity = entityFilter === 'all' || customer.routedEntity.includes(entityFilter)
    return matchesSearch && matchesStatus && matchesEntity
  })

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = payment.customerName.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || payment.status === statusFilter
    const matchesEntity = entityFilter === 'all' || payment.routedToEntity.includes(entityFilter)
    return matchesSearch && matchesStatus && matchesEntity
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
      </div>
    )
  }

  const getRiskBadgeVariant = (risk: string) => {
    switch (risk) {
      case 'CRITICAL': return 'destructive'
      case 'HIGH': return 'destructive'
      case 'MEDIUM': return 'default'
      case 'LOW': return 'secondary'
      default: return 'secondary'
    }
  }

  const getStatusBadgeVariant = (status: string) => {
    switch (status) {
      case 'ACTIVE': return 'default'
      case 'PENDING_PAYMENT': return 'destructive'
      case 'SUSPENDED': return 'secondary'
      case 'CONFIRMED': return 'default'
      case 'FAILED': return 'destructive'
      case 'PROCESSING': return 'outline'
      default: return 'secondary'
    }
  }

  const getVATProgress = (current: number, threshold: number) => {
    return (current / threshold) * 100
  }

  // 🚀 NEW: Get icon component for activity type
  const getActivityIcon = (iconName: string) => {
    switch (iconName) {
      case 'UserPlus': return UserPlus
      case 'CreditCard': return CreditCard
      case 'AlertCircle': return AlertCircle
      case 'TrendingUp': return TrendingUp
      case 'CheckCircle': return CheckCircle
      case 'X': return X
      case 'AlertTriangle': return AlertTriangle
      default: return Activity
    }
  }

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-center gap-4">
        <div className="space-y-2">
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Portal365 Management Dashboard</h1>
          <p className="text-sm lg:text-base text-muted-foreground">
            Complete business oversight, customer management, and VAT optimization
          </p>
        </div>
        <div className="flex items-center gap-2 lg:gap-3">
          <Button 
            onClick={() => window.location.href = '/admin/classes'}
            variant="outline" 
            className="flex items-center gap-2 text-xs lg:text-sm"
          >
            <Calendar className="h-4 w-4" />
            <span className="hidden sm:inline">Manage Classes</span>
            <span className="sm:hidden">Classes</span>
          </Button>
          <Button onClick={() => signOut()} variant="outline" className="flex items-center gap-2 text-xs lg:text-sm">
            <LogOut className="h-4 w-4" />
            <span className="hidden sm:inline">Log Out</span>
            <span className="sm:hidden">Logout</span>
          </Button>
        </div>
      </div>

      {/* Critical Alerts */}
      {vatStatus.some(entity => entity.riskLevel === 'CRITICAL' || entity.riskLevel === 'HIGH') && (
        <Alert className="border-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            <strong>VAT Alert:</strong> {vatStatus.filter(e => e.riskLevel === 'HIGH' || e.riskLevel === 'CRITICAL').length} entities approaching VAT threshold. 
            Aura MMA projected to exceed £90k by March 2024.
          </AlertDescription>
        </Alert>
      )}

      {/* Enhanced Key Metrics */}
      <div className="grid gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Revenue</CardTitle>
            <PoundSterling className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              £{businessMetrics?.totalRevenue.toLocaleString()}
            </div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">+12.3%</span> from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Monthly Recurring</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">£{businessMetrics?.monthlyRecurring.toLocaleString()}</div>
            <p className="text-xs text-muted-foreground">
              <span className="text-green-600">+8.7%</span> MRR growth
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{vatStatus.reduce((sum, entity) => sum + entity.customerCount, 0)}</div>
            <p className="text-xs text-muted-foreground">
              Churn rate: <span className="text-red-600">{businessMetrics?.churnRate}%</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Payment Success</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{businessMetrics?.paymentSuccessRate}%</div>
            <p className="text-xs text-muted-foreground">
              Routing efficiency: {businessMetrics?.routingEfficiency}%
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 lg:grid-cols-6 h-auto">
          <TabsTrigger value="overview" className="text-xs lg:text-sm">Overview</TabsTrigger>
          <TabsTrigger value="customers" className="text-xs lg:text-sm">Customers</TabsTrigger>
          <TabsTrigger value="payments" className="text-xs lg:text-sm">Payments</TabsTrigger>
          <TabsTrigger value="vat-monitor" className="text-xs lg:text-sm">VAT</TabsTrigger>
          <TabsTrigger value="analytics" className="text-xs lg:text-sm">Analytics</TabsTrigger>
          <TabsTrigger value="settings" className="text-xs lg:text-sm">Settings</TabsTrigger>
        </TabsList>

        {/* Overview Tab */}
        <TabsContent value="overview" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Business Entity Performance</CardTitle>
                <CardDescription>Revenue and customer distribution across entities</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {vatStatus.map((entity) => (
                    <div key={entity.entityId} className="space-y-2">
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="font-medium">{entity.entityName}</h4>
                          <p className="text-sm text-muted-foreground">
                            {entity.customerCount} customers • Avg £{entity.avgPaymentValue}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="font-semibold">£{entity.currentRevenue.toLocaleString()}</p>
                          <Badge variant={getRiskBadgeVariant(entity.riskLevel)} className="text-xs">
                            {entity.riskLevel}
                          </Badge>
                        </div>
                      </div>
                      <Progress value={getVATProgress(entity.currentRevenue, entity.vatThreshold)} className="h-2" />
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Recent Activity</CardTitle>
                <CardDescription>Latest customer and payment activity</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {recentActivity.length > 0 ? recentActivity.map((activity, index) => {
                      const IconComponent = getActivityIcon(activity.icon)
                      
                      return (
                        <div key={index} className="flex items-center space-x-3">
                          <IconComponent className={`h-4 w-4 ${activity.color}`} />
                          <div className="flex-1">
                            <p className="text-sm font-medium">{activity.message}</p>
                            <p className="text-xs text-muted-foreground">{activity.detail}</p>
                          </div>
                          {activity.amount && (
                            <div className="text-sm font-semibold text-muted-foreground">
                              {activity.amount}
                            </div>
                          )}
                        </div>
                      )
                    }) : (
                      <div className="text-center text-muted-foreground">
                        <p className="text-sm">No recent activity</p>
                      </div>
                    )}
                  </div>
                </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Customer Management Tab */}
        <TabsContent value="customers" className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex gap-4 items-center flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search customers..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="ACTIVE">Active</SelectItem>
                  <SelectItem value="PENDING_PAYMENT">Pending Payment</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={entityFilter} onValueChange={setEntityFilter}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Filter by entity" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Entities</SelectItem>
                  <SelectItem value="Aura MMA">Aura MMA</SelectItem>
                  <SelectItem value="Aura Tuition">Aura Tuition</SelectItem>
                  <SelectItem value="Aura Women's">Aura Women's Gym</SelectItem>
                  <SelectItem value="Aura Wellness">Aura Wellness</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
              <Button onClick={() => setShowAddCustomer(true)}>
                <UserPlus className="h-4 w-4 mr-2" />
                Add Customer
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-4 font-medium">Customer</th>
                      <th className="text-left p-4 font-medium">Membership</th>
                      <th className="text-left p-4 font-medium">Status</th>
                      <th className="text-left p-4 font-medium">Routed Entity</th>
                      <th className="text-left p-4 font-medium">Total Paid</th>
                      <th className="text-left p-4 font-medium">Next Billing</th>
                      <th className="text-left p-4 font-medium">Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="border-b hover:bg-muted/25 cursor-pointer" onClick={() => setSelectedCustomer(customer)}>
                        <td className="p-4">
                          <div>
                            <p className="font-medium">{customer.name}</p>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Mail className="h-3 w-3" />
                              <span>{customer.email}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                              <Phone className="h-3 w-3" />
                              <span>{customer.phone}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <Badge variant="outline">{customer.membershipType}</Badge>
                          <p className="text-sm text-muted-foreground mt-1">
                            Joined {new Date(customer.joinDate).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="p-4">
                          <Badge variant={getStatusBadgeVariant(customer.status)}>
                            {customer.status}
                          </Badge>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{customer.routedEntity}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <p className="font-semibold">£{customer.totalPaid}</p>
                          <p className="text-sm text-muted-foreground">
                            Last: {new Date(customer.lastPayment).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{new Date(customer.nextBilling).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-sm">
                            <p>{typeof customer.accessHistory.totalVisits === 'string' ? customer.accessHistory.totalVisits : `${customer.accessHistory.totalVisits} visits`}</p>
                            <p className="text-muted-foreground">
                              {typeof customer.accessHistory.avgWeeklyVisits === 'string' ? customer.accessHistory.avgWeeklyVisits : `${customer.accessHistory.avgWeeklyVisits}/week avg`}
                            </p>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Payment Details Tab */}
        <TabsContent value="payments" className="space-y-6">
          <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
            <div className="flex gap-4 items-center flex-1">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                <Input
                  placeholder="Search payments..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-10 w-64"
                />
              </div>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Filter by status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                  <SelectItem value="FAILED">Failed</SelectItem>
                  <SelectItem value="PROCESSING">Processing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-2">
              <Button variant="outline">
                <Download className="h-4 w-4 mr-2" />
                Export Payments
              </Button>
              <Button variant="outline">
                <FileText className="h-4 w-4 mr-2" />
                Audit Report
              </Button>
            </div>
          </div>

          <Card>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-muted/50">
                    <tr>
                      <th className="text-left p-4 font-medium">Customer & Payment</th>
                      <th className="text-left p-4 font-medium">Amount & Type</th>
                      <th className="text-left p-4 font-medium">Routed To</th>
                      <th className="text-left p-4 font-medium">Status & Processing</th>
                      <th className="text-left p-4 font-medium">Routing Details</th>
                      <th className="text-left p-4 font-medium">GoCardless</th>
                      <th className="text-left p-4 font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((payment) => (
                      <tr key={payment.id} className="border-b hover:bg-muted/25">
                        <td className="p-4">
                          <div>
                            <p className="font-medium">{payment.customerName}</p>
                            <p className="text-sm text-muted-foreground">
                              {new Date(payment.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </td>
                        <td className="p-4">
                          <div>
                            <p className="font-semibold">£{payment.amount}</p>
                            <Badge variant="outline" className="text-xs">
                              {payment.membershipType}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm">{payment.routedToEntity}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="space-y-1">
                            <Badge variant={getStatusBadgeVariant(payment.status)}>
                              {payment.status}
                            </Badge>
                            <div className="text-xs text-muted-foreground">
                              <p>Processed in {payment.processingTime}s</p>
                              {payment.retryCount > 0 && (
                                <p className="text-red-600">Retries: {payment.retryCount}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-sm space-y-1">
                            <Badge variant={payment.confidence === 'HIGH' ? 'default' : 'secondary'} className="text-xs">
                              {payment.confidence} confidence
                            </Badge>
                            <p className="text-muted-foreground text-xs">
                              {payment.routingReason}
                            </p>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-xs text-muted-foreground">
                            <p className="font-mono">{payment.goCardlessId}</p>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="flex gap-2">
                            <Button variant="ghost" size="sm">
                              <Eye className="h-4 w-4" />
                            </Button>
                            {payment.status === 'FAILED' && (
                              <Button variant="ghost" size="sm" className="text-blue-600">
                                Retry
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VAT Monitor Tab */}
        <TabsContent value="vat-monitor" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Real-time VAT Monitoring</CardTitle>
              <CardDescription>
                Current VAT year progress for all business entities
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {vatStatus.map((entity) => (
                  <div key={entity.entityId} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <h4 className="font-semibold">{entity.entityName}</h4>
                        <p className="text-sm text-muted-foreground">
                          £{entity.currentRevenue.toLocaleString()} / £{entity.vatThreshold.toLocaleString()} 
                          • {entity.customerCount} customers
                        </p>
                      </div>
                      <div className="text-right space-y-1">
                        <Badge variant={getRiskBadgeVariant(entity.riskLevel)}>
                          {entity.riskLevel} RISK
                        </Badge>
                        <p className="text-sm text-muted-foreground">
                          £{entity.headroom.toLocaleString()} headroom
                        </p>
                      </div>
                    </div>
                    
                    <Progress 
                      value={getVATProgress(entity.currentRevenue, entity.vatThreshold)}
                      className="h-3"
                    />
                    
                    <div className="grid grid-cols-3 gap-4 text-xs text-muted-foreground">
                      <div>
                        <span>Monthly avg:</span>
                        <p className="font-medium">£{entity.monthlyAverage.toLocaleString()}</p>
                      </div>
                      <div>
                        <span>Projected year-end:</span>
                        <p className="font-medium">£{entity.projectedYearEnd.toLocaleString()}</p>
                      </div>
                      <div>
                        <span>Avg payment:</span>
                        <p className="font-medium">£{entity.avgPaymentValue}</p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Business Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          <div className="grid gap-6 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Customer Lifetime Value</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">£{businessMetrics?.avgLifetimeValue || 0}</div>
                <p className="text-sm text-muted-foreground">Average across all memberships</p>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Full Memberships</span>
                    <span>£{analytics?.membershipCLV?.FULL_ADULT || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Weekend Memberships</span>
                    <span>£{analytics?.membershipCLV?.WEEKEND_ADULT || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Personal Training</span>
                    <span>£{analytics?.membershipCLV?.PERSONAL_TRAINING || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Women's Classes</span>
                    <span>£{analytics?.membershipCLV?.WOMENS_CLASSES || 0}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Wellness Package</span>
                    <span>£{analytics?.membershipCLV?.WELLNESS_PACKAGE || 0}</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Member Acquisition</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(businessMetrics?.acquisitionRate || 0)}%</div>
                <p className="text-sm text-muted-foreground">Monthly growth rate</p>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>This month</span>
                    <span>+{analytics?.acquisitionDetails?.thisMonth || 0} members</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Last month</span>
                    <span>+{analytics?.acquisitionDetails?.lastMonth || 0} members</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Growth rate</span>
                    <span>{Math.round(analytics?.acquisitionDetails?.growthRate || 0)}%</span>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Operational Efficiency</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{Math.round(businessMetrics?.routingEfficiency || 0)}%</div>
                <p className="text-sm text-muted-foreground">VAT routing accuracy</p>
                <div className="mt-4 space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Auto-routing</span>
                    <span>{analytics?.operationalMetrics?.autoRoutingRate || 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Manual override</span>
                    <span>{analytics?.operationalMetrics?.manualOverrideRate || 0}%</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span>Avg decision time</span>
                    <span>{analytics?.operationalMetrics?.avgDecisionTime || 1.2} seconds</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>VAT Routing Configuration</CardTitle>
              <CardDescription>
                Configure automatic payment routing parameters and thresholds
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="grid gap-6 md:grid-cols-2">
                <div className="space-y-4">
                  <h4 className="font-medium">Safety Thresholds</h4>
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <Label>Warning Level</Label>
                      <Input className="w-32" defaultValue="80000" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Stop Routing Level</Label>
                      <Input className="w-32" defaultValue="85000" />
                    </div>
                    <div className="flex items-center justify-between">
                      <Label>Critical Level</Label>
                      <Input className="w-32" defaultValue="88000" />
                    </div>
                  </div>
                </div>

                <div className="space-y-4">
                  <h4 className="font-medium">Routing Preferences</h4>
                  <div className="space-y-3">
                    <div className="flex justify-between items-center">
                      <span>Service-based routing</span>
                      <Badge variant="default">Enabled</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Load balancing</span>
                      <Badge variant="default">Enabled</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Manual override alerts</span>
                      <Badge variant="default">Enabled</Badge>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Risk assessment</span>
                      <Badge variant="default">Auto</Badge>
                    </div>
                  </div>
                </div>
              </div>

              <div className="pt-4 border-t">
                <div className="flex gap-3">
                  <Button>
                    <Settings className="h-4 w-4 mr-2" />
                    Save Configuration
                  </Button>
                  <Button variant="outline">
                    Reset to Defaults
                  </Button>
                  <Button variant="outline">
                    Export Settings
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Customer Details Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Customer Details</h3>
            <div className="grid gap-4">
              <div>
                <p><strong>Name:</strong> {selectedCustomer.name}</p>
                <p><strong>Email:</strong> {selectedCustomer.email}</p>
                <p><strong>Phone:</strong> {selectedCustomer.phone}</p>
                <p><strong>Membership Type:</strong> {selectedCustomer.membershipType}</p>
                <p><strong>Status:</strong> {selectedCustomer.status}</p>
                <p><strong>Join Date:</strong> {new Date(selectedCustomer.joinDate).toLocaleDateString()}</p>
                <p><strong>Last Payment:</strong> {new Date(selectedCustomer.lastPayment).toLocaleDateString()}</p>
                <p><strong>Total Paid:</strong> £{selectedCustomer.totalPaid}</p>
                <p><strong>Routed Entity:</strong> {selectedCustomer.routedEntity}</p>
                <p><strong>Next Billing:</strong> {new Date(selectedCustomer.nextBilling).toLocaleDateString()}</p>
                <p><strong>Emergency Contact:</strong> {selectedCustomer.emergencyContact?.name} ({selectedCustomer.emergencyContact?.relationship})</p>
                <p><strong>Access History:</strong> {selectedCustomer.accessHistory?.totalVisits} visits, {selectedCustomer.accessHistory?.avgWeeklyVisits}/week avg</p>
              </div>
            </div>
            <div className="flex justify-end mt-6">
              <Button variant="outline" onClick={() => setSelectedCustomer(null)}>Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4">Add New Customer</h3>
            {addCustomerError && (
              <Alert variant="destructive" className="mb-4">
                <AlertDescription>{addCustomerError}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleAddCustomer} className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-firstName">First Name *</Label>
                  <Input 
                    id="add-firstName" 
                    placeholder="Enter first name" 
                    value={addCustomerData.firstName} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, firstName: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="add-lastName">Last Name *</Label>
                  <Input 
                    id="add-lastName" 
                    placeholder="Enter last name" 
                    value={addCustomerData.lastName} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, lastName: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-email">Email *</Label>
                  <Input 
                    id="add-email" 
                    type="email" 
                    placeholder="Enter customer email" 
                    value={addCustomerData.email} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, email: e.target.value })}
                    required
                  />
                </div>
                <div>
                  <Label htmlFor="add-phone">Phone</Label>
                  <Input 
                    id="add-phone" 
                    placeholder="Enter customer phone" 
                    value={addCustomerData.phone} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, phone: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-membership">Membership Type *</Label>
                  <Select value={addCustomerData.membershipType} onValueChange={(value) => setAddCustomerData({ ...addCustomerData, membershipType: value })}>
                    <SelectTrigger id="add-membership">
                      <SelectValue placeholder="Select membership type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_ADULT">Full Adult Membership</SelectItem>
                      <SelectItem value="WEEKEND_ADULT">Weekend Adult Membership</SelectItem>
                      <SelectItem value="FULL_UNDER18">Full Youth Membership</SelectItem>
                      <SelectItem value="WEEKEND_UNDER18">Weekend Youth Membership</SelectItem>
                      <SelectItem value="MASTERS">Masters Program (30+)</SelectItem>
                      <SelectItem value="WOMENS_CLASSES">Women's Classes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="add-customPrice">Custom Monthly Price (£) *</Label>
                  <Input 
                    id="add-customPrice" 
                    type="number" 
                    step="0.01"
                    placeholder="e.g. 45.00" 
                    value={addCustomerData.customPrice} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, customPrice: e.target.value })}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-startDate">Start Month *</Label>
                  <Select 
                    value={addCustomerData.startDate ? addCustomerData.startDate.substring(0, 7) : ''} 
                    onValueChange={(value) => setAddCustomerData({ ...addCustomerData, startDate: value + '-01' })}
                  >
                    <SelectTrigger id="add-startDate">
                      <SelectValue placeholder="Select start month" />
                    </SelectTrigger>
                    <SelectContent>
                      {(() => {
                        const months = []
                        const currentDate = new Date()
                        for (let i = 0; i < 12; i++) {
                          const futureDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + i + 1, 1)
                          const yearMonth = futureDate.toISOString().substring(0, 7)
                          const displayText = futureDate.toLocaleDateString('en-GB', { 
                            year: 'numeric', 
                            month: 'long' 
                          })
                          months.push(
                            <SelectItem key={yearMonth} value={yearMonth}>
                              {displayText}
                            </SelectItem>
                          )
                        }
                        return months
                      })()}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground mt-1">
                    Customer will be charged starting from the 1st of the selected month
                  </p>
                </div>
                <div>
                  <Label htmlFor="add-dateOfBirth">Date of Birth</Label>
                  <Input 
                    id="add-dateOfBirth" 
                    type="date"
                    value={addCustomerData.dateOfBirth} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, dateOfBirth: e.target.value })}
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <Label htmlFor="add-emergency-name">Emergency Contact Name</Label>
                  <Input 
                    id="add-emergency-name" 
                    placeholder="Contact name" 
                    value={addCustomerData.emergencyContact.name} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, name: e.target.value } })} 
                  />
                </div>
                <div>
                  <Label htmlFor="add-emergency-phone">Emergency Contact Phone</Label>
                  <Input 
                    id="add-emergency-phone" 
                    placeholder="Contact phone" 
                    value={addCustomerData.emergencyContact.phone} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, phone: e.target.value } })} 
                  />
                </div>
                <div>
                  <Label htmlFor="add-emergency-relationship">Relationship</Label>
                  <Input 
                    id="add-emergency-relationship" 
                    placeholder="e.g. Parent" 
                    value={addCustomerData.emergencyContact.relationship} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, relationship: e.target.value } })} 
                  />
                </div>
              </div>
            </form>
            <div className="flex justify-end mt-6 gap-2">
              <Button variant="outline" onClick={() => setShowAddCustomer(false)}>Cancel</Button>
              <Button onClick={handleAddCustomer} disabled={addCustomerLoading}>
                {addCustomerLoading ? 'Creating...' : 'Create & Setup Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && paymentClientSecret && createdSubscriptionId && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md w-full">
            <h3 className="text-xl font-bold mb-4">Setup Payment Method</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Please have the customer enter their payment details to activate their membership.
            </p>
            
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-4">
              <div className="text-center">
                <p className="text-lg font-semibold">£{addCustomerData.customPrice}/month</p>
                <p className="text-sm text-muted-foreground">
                  {addCustomerData.membershipType.replace('_', ' ')}
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                  First charge: {addCustomerData.startDate}
                </p>
              </div>
            </div>

            <div className="space-y-4">
              <div className="bg-gray-50 p-4 rounded-lg">
                <p className="text-sm font-medium mb-2">Payment Method Setup</p>
                <p className="text-xs text-muted-foreground">
                  This would normally integrate with Stripe Elements for secure card collection.
                  For demo purposes, we'll simulate payment method setup.
                </p>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="demo-card">Card Number (Demo)</Label>
                <Input 
                  id="demo-card" 
                  placeholder="4242 4242 4242 4242"
                  className="font-mono"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label htmlFor="demo-expiry">Expiry</Label>
                  <Input id="demo-expiry" placeholder="MM/YY" />
                </div>
                <div>
                  <Label htmlFor="demo-cvc">CVC</Label>
                  <Input id="demo-cvc" placeholder="123" />
                </div>
              </div>
            </div>

            <div className="mt-6 space-y-2">
              <Button
                onClick={async () => {
                  try {
                    // Simulate payment method setup
                    const response = await fetch('/api/confirm-payment', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({
                        setupIntentId: paymentClientSecret.replace('seti_', '').split('_secret')[0],
                        subscriptionId: createdSubscriptionId
                      })
                    })
                    
                    const result = await response.json()
                    
                    if (result.success) {
                      handlePaymentSuccess()
                    } else {
                      handlePaymentError(result.error || 'Payment setup failed')
                    }
                  } catch (error) {
                    handlePaymentError('Network error during payment setup')
                  }
                }}
                className="w-full"
              >
                Complete Payment Setup
              </Button>
              
              <Button
                variant="outline"
                onClick={() => setShowPaymentModal(false)}
                className="w-full"
              >
                Cancel
              </Button>
            </div>
            
            <div className="mt-4 text-center text-xs text-muted-foreground">
              Customer membership will be activated after payment method is set up.
              No charge until {addCustomerData.startDate}.
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 