'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
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
  X,
  Key
} from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'

const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)

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
  subscriptionStatus: string
  membershipStatus: string
  cancelAtPeriodEnd: boolean
  joinDate: string
  lastPayment: string
  totalPaid: number
  routedEntity: string
  nextBilling: string
  startsOn?: string
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
  totalMembers?: number
  payouts?: {
    last?: { amount: number; currency: string; arrivalDate: string | null }
    upcoming?: { amount: number; currency: string; arrivalDate: string | null }
  }
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

function AdminDashboardContent() {
  const { data: session, status } = useSession() // ✅ ENABLE real session management
  const searchParams = useSearchParams()
  const router = useRouter()
  const [vatStatus, setVatStatus] = useState<VATStatus[]>([])
  const [customers, setCustomers] = useState<CustomerDetail[]>([])
  const [payments, setPayments] = useState<PaymentDetail[]>([])
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetrics | null>(null)
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null) // 🚀 NEW: Real analytics data
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('overview')
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
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false)
  const [showResetSuccess, setShowResetSuccess] = useState(false)
  const [resetPasswordResult, setResetPasswordResult] = useState<{
    tempPassword: string;
    customerEmail: string;
    customerName: string;
  } | null>(null)
  
  // 🚀 NEW: Membership management states
  const [membershipAction, setMembershipAction] = useState<'pause' | 'resume' | 'cancel' | null>(null)
  const [membershipActionLoading, setMembershipActionLoading] = useState(false)
  const [membershipActionReason, setMembershipActionReason] = useState('')
  const [cancelationType, setCancelationType] = useState<'immediate' | 'end_of_period'>('end_of_period')
  const [pauseBehavior, setPauseBehavior] = useState<'void' | 'keep_as_draft' | 'mark_uncollectible'>('void')
  const [showMembershipActionModal, setShowMembershipActionModal] = useState(false)
  // Dismissed To-Do items (client-side only)
  const [dismissedTodoIds, setDismissedTodoIds] = useState<string[]>([])

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
    
    // Load dismissed To‑Do ids from localStorage
    try {
      const saved = localStorage.getItem('portal365.admin.dismissedTodos')
      if (saved) setDismissedTodoIds(JSON.parse(saved))
    } catch {}

    // Initialize tab from URL (?tab=...)
    const tab = searchParams.get('tab')
    if (tab && ['overview','customers','payments','vat-monitor','analytics','settings'].includes(tab)) {
      setActiveTab(tab)
    }

    fetchAdminData()
  }, [session, status])

  // Push tab changes into URL for back/forward support
  useEffect(() => {
    const current = searchParams.get('tab') || 'overview'
    if (activeTab !== current) {
      const params = new URLSearchParams(Array.from(searchParams.entries()))
      params.set('tab', activeTab)
      router.push(`/admin?${params.toString()}`, { scroll: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab])

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

  const dismissTodo = (paymentId: string) => {
    setDismissedTodoIds((prev) => {
      const next = Array.from(new Set([...(prev || []), paymentId]))
      try { localStorage.setItem('portal365.admin.dismissedTodos', JSON.stringify(next)) } catch {}
      return next
    })
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

  const handleRetryLatestInvoice = async (customerId: string) => {
    if (!confirm('Retry the latest open invoice for this customer?')) return
    const resp = await fetch(`/api/admin/customers/${customerId}/retry-invoice`, { method: 'POST' })
    const json = await resp.json()
    if (resp.ok) alert('Invoice retry requested. Status: ' + json.invoice?.status)
    else alert('Retry failed: ' + (json.error || 'Unknown error'))
  }

  const openCustomerModal = (customerId: string) => {
    const cust = customers.find(c => c.id === customerId)
    if (cust) setSelectedCustomer(cust)
    else alert('Customer details not available.')
  }

  const openCancelFromTodo = (customerId: string) => {
    const cust = customers.find(c => c.id === customerId)
    if (!cust) {
      alert('Customer details not available.')
      return
    }
    setSelectedCustomer(cust)
    setMembershipAction('cancel')
    setMembershipActionReason('Cancelled from To-Do panel')
    setShowMembershipActionModal(true)
  }

  const handleRemovePendingSignup = async (customerId: string) => {
    if (!confirm('Remove this abandoned signup? This will delete the pending subscription and related pending/failed payments.')) {
      return
    }
    try {
      const resp = await fetch(`/api/admin/customers/${customerId}/void-signup`, { method: 'POST' })
      const json = await resp.json()
      if (resp.ok) {
        alert('Abandoned signup removed')
        setSelectedCustomer(null)
        await fetchAdminData()
      } else {
        alert('Remove failed: ' + (json?.error || 'Unknown error'))
      }
    } catch (e) {
      alert('Network error while removing signup')
    }
  }

  const handlePasswordReset = async (customerId: string) => {
    if (!confirm('Are you sure you want to reset this customer\'s password? They will need to use the new temporary password to log in.')) {
      return
    }

    setResetPasswordLoading(true)
    
    try {
      const response = await fetch('/api/admin/customers/reset-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ customerId })
      })

      const result = await response.json()

      if (result.success) {
        setResetPasswordResult({
          tempPassword: result.tempPassword,
          customerEmail: result.customerEmail,
          customerName: result.customerName
        })
        setShowResetSuccess(true)
        console.log('✅ Password reset successful')
      } else {
        alert('Password reset failed: ' + result.error)
      }
    } catch (error) {
      console.error('❌ Password reset error:', error)
      alert('Network error during password reset')
    } finally {
      setResetPasswordLoading(false)
    }
  }

  // 🚀 NEW: Membership management functions
  const handleMembershipAction = async () => {
    if (!selectedCustomer || !membershipAction) return

    if (!membershipActionReason.trim() || membershipActionReason.trim().length < 5) {
      alert('Please provide a reason (minimum 5 characters)')
      return
    }

    const confirmMessage = {
      pause: 'Are you sure you want to PAUSE this customer\'s membership? They will lose access immediately.',
      resume: 'Are you sure you want to RESUME this customer\'s membership? Billing will restart.',
      cancel: cancelationType === 'immediate' 
        ? 'Are you sure you want to IMMEDIATELY CANCEL this membership? This cannot be undone.'
        : 'Are you sure you want to schedule this membership for CANCELLATION at period end?'
    }

    if (!confirm(confirmMessage[membershipAction])) {
      return
    }

    setMembershipActionLoading(true)

    try {
      const endpoint = `/api/admin/customers/${selectedCustomer.id}/${membershipAction}-membership`
      const requestBody: any = { reason: membershipActionReason.trim() }

      // Add action-specific parameters
      if (membershipAction === 'pause') {
        requestBody.pauseBehavior = pauseBehavior
      } else if (membershipAction === 'cancel') {
        requestBody.cancelationType = cancelationType
        requestBody.prorate = true
      } else if (membershipAction === 'resume') {
        requestBody.resumeImmediately = true
      }

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody)
      })

      const result = await response.json()

      if (result.success) {
        // ✅ INDUSTRY STANDARD: Optimistic update with immediate DB refresh

        
        // Determine expected status based on action
        const expectedStatus = membershipAction === 'pause' ? 'PAUSED' : 
                              membershipAction === 'resume' ? 'ACTIVE' : 'CANCELLED'
        
        // Optimistically update the customer list immediately

        const updatedCustomers = customers.map(customer => 
          customer.id === selectedCustomer.id 
            ? { ...customer, status: expectedStatus, subscriptionStatus: expectedStatus }
            : customer
        )
        console.log(`📊 Updated customers array:`, updatedCustomers.find(c => c.id === selectedCustomer.id))
        console.log(`🔍 Current status filter: "${statusFilter}"`)
        console.log(`🔍 Will customer be visible after filter? Expected status "${expectedStatus}" matches filter "${statusFilter}":`, statusFilter === 'all' || expectedStatus === statusFilter)
        setCustomers(updatedCustomers)
        
        // Update selected customer immediately
        const optimisticCustomer = { 
          ...selectedCustomer, 
          status: expectedStatus, 
          subscriptionStatus: expectedStatus 
        }
        setSelectedCustomer(optimisticCustomer)
        
        // Background refresh to sync with database
        setTimeout(async () => {
          await fetchAdminData()
        }, 500)
        
        alert(`✅ ${membershipAction.toUpperCase()} successful: ${result.message}`)
        
        // Close modals and reset state
        setShowMembershipActionModal(false)
        setMembershipAction(null)
        setMembershipActionReason('')
        
        console.log(`✅ Membership ${membershipAction} successful for ${selectedCustomer.email}`)
      } else {
        alert(`❌ ${membershipAction.toUpperCase()} failed: ${result.error}`)
      }
    } catch (error) {
      console.error(`❌ Membership ${membershipAction} error:`, error)
      alert(`Network error during ${membershipAction} operation`)
    } finally {
      setMembershipActionLoading(false)
    }
  }

  const openMembershipActionModal = (action: 'pause' | 'resume' | 'cancel') => {
    setMembershipAction(action)
    setMembershipActionReason('')
    setShowMembershipActionModal(true)
  }

  // Filter functions
  const filteredCustomers = customers.filter(customer => {
    const matchesSearch = customer.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                         customer.email.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || customer.status === statusFilter
    const matchesPlan = planFilter === 'all' || customer.membershipType === planFilter
    return matchesSearch && matchesStatus && matchesPlan
  })

  const filteredPayments = payments.filter(payment => {
    const matchesSearch = payment.customerName.toLowerCase().includes(searchTerm.toLowerCase())
    const matchesStatus = statusFilter === 'all' || payment.status === statusFilter
    return matchesSearch && matchesStatus
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
      case 'PAUSED': return 'outline'
      case 'CANCELLED': return 'destructive'
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
      <div className="grid grid-cols-2 gap-3 sm:gap-4 md:gap-6 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Revenue</CardTitle>
            <PoundSterling className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">
              £{businessMetrics?.totalRevenue.toLocaleString()}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              <span className="text-green-600">+12.3%</span> from last month
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Monthly Recurring</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">£{businessMetrics?.monthlyRecurring.toLocaleString()}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              <span className="text-green-600">+8.7%</span> MRR growth
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Total Members</CardTitle>
            <Users className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">{businessMetrics?.totalMembers ?? 0}</div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              Churn rate: <span className="text-red-600">{businessMetrics?.churnRate}%</span>
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-1 sm:pb-2">
            <CardTitle className="text-xs sm:text-sm font-medium">Payouts</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              <div>
                <div className="text-[10px] sm:text-xs text-white/60 tracking-wide uppercase">Last payout</div>
                <div className="text-lg sm:text-xl font-semibold text-white">{businessMetrics?.payouts?.last ? `£${businessMetrics.payouts.last.amount}` : '—'}</div>
                <div className="text-[10px] sm:text-xs text-white/60">{businessMetrics?.payouts?.last?.arrivalDate || ''}</div>
              </div>
              <div className="border-t border-white/10 pt-2">
                <div className="text-[10px] sm:text-xs text-white/60 tracking-wide uppercase">Upcoming</div>
                <div className="text-lg sm:text-xl font-semibold text-white">{businessMetrics?.payouts?.upcoming ? `£${businessMetrics.payouts.upcoming.amount}` : '—'}</div>
                <div className="text-[10px] sm:text-xs text-white/60">{businessMetrics?.payouts?.upcoming?.arrivalDate || 'Estimated'}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Content Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
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
          {/* Mobile: tab switcher to reduce scrolling */}
          <div className="md:hidden">
            <Card>
              <CardHeader>
                <CardTitle>Overview</CardTitle>
                <CardDescription>Quick access</CardDescription>
                <Tabs defaultValue="todo" className="mt-3">
                  <TabsList className="grid w-full grid-cols-2 h-auto">
                    <TabsTrigger value="todo" className="text-xs">To‑Do</TabsTrigger>
                    <TabsTrigger value="activity" className="text-xs">Recent</TabsTrigger>
                  </TabsList>
                  <TabsContent value="todo" className="mt-4">
                    <div className="space-y-4">
                      {(() => {
                        const failed = [...payments]
                          .filter(p => p.status === 'FAILED' || p.status === 'INCOMPLETE_SIGNUP')
                          .filter(p => !dismissedTodoIds.includes(p.id))
                          .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                          .slice(0, 10)
                        if (failed.length === 0) {
                          return (
                            <div className="text-sm text-muted-foreground">No failed payments. You're all set.</div>
                          )
                        }
                        return failed.map((p) => (
                          <div key={p.id} className="border border-white/10 rounded p-3 bg-white/5">
                            <div className="flex items-start justify-between gap-3">
                              <div onClick={() => openCustomerModal(p.customerId)} className="cursor-pointer">
                                <p className="text-sm font-medium text-white">{p.customerName}</p>
                                <p className="text-xs text-white/70">£{p.amount} • {p.membershipType} • {new Date(p.timestamp).toLocaleString()}</p>
                                <div className="mt-1">
                                  <Badge variant={getStatusBadgeVariant(p.status === 'INCOMPLETE_SIGNUP' ? 'PENDING_PAYMENT' : 'FAILED')}>
                                    {p.status === 'INCOMPLETE_SIGNUP' ? 'ABANDONED SIGNUP' : 'FAILED'}
                                  </Badge>
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">Actions ▾</Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent className="bg-black border-white/20">
                                    <DropdownMenuItem onClick={() => handleRetryLatestInvoice(p.customerId)}>Retry</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openCustomerModal(p.customerId)}>Contact</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => dismissTodo(p.id)}>Remove</DropdownMenuItem>
                                    <DropdownMenuItem onClick={() => openCancelFromTodo(p.customerId)} variant="destructive">Cancel Membership</DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                        ))
                      })()}
                    </div>
                  </TabsContent>
                  <TabsContent value="activity" className="mt-4">
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
                                <div className="text-sm font-semibold text-muted-foreground">{activity.amount}</div>
                              )}
                            </div>
                          )
                        }) : (
                          <div className="text-center text-muted-foreground">
                            <p className="text-sm">No recent activity</p>
                          </div>
                        )}
                    </div>
                  </TabsContent>
                </Tabs>
              </CardHeader>
            </Card>
          </div>

          {/* Desktop/tablet: two-column view */}
          <div className="hidden md:grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>To‑Do</CardTitle>
                <CardDescription>Payments that need attention (recent failures)</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  {(() => {
                    const failed = [...payments]
                      .filter(p => p.status === 'FAILED' || p.status === 'INCOMPLETE_SIGNUP')
                      .filter(p => !dismissedTodoIds.includes(p.id))
                      .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                      .slice(0, 10)
                    if (failed.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground">No failed payments. You're all set.</div>
                      )
                    }
                    return failed.map((p) => (
                      <div key={p.id} className="border border-white/10 rounded p-3 bg-white/5">
                        <div className="flex items-start justify-between gap-3">
                          <div onClick={() => openCustomerModal(p.customerId)} className="cursor-pointer">
                            <p className="text-sm font-medium text-white">{p.customerName}</p>
                            <p className="text-xs text-white/70">£{p.amount} • {p.membershipType} • {new Date(p.timestamp).toLocaleString()}</p>
                            <div className="mt-1">
                              <Badge variant={getStatusBadgeVariant(p.status === 'INCOMPLETE_SIGNUP' ? 'PENDING_PAYMENT' : 'FAILED')}>
                                {p.status === 'INCOMPLETE_SIGNUP' ? 'ABANDONED SIGNUP' : 'FAILED'}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">Actions ▾</Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="bg-black border-white/20">
                                <DropdownMenuItem onClick={() => handleRetryLatestInvoice(p.customerId)}>Retry</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openCustomerModal(p.customerId)}>Contact</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => dismissTodo(p.id)}>Remove</DropdownMenuItem>
                                <DropdownMenuItem onClick={() => openCancelFromTodo(p.customerId)} variant="destructive">Cancel Membership</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    ))
                  })()}
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
                        <div key={index} className="flex items-center space-x-3 cursor-pointer" onClick={() => {
                          const cust = customers.find(c => c.id === activity.userId)
                          if (cust) setSelectedCustomer(cust)
                        }}>
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
                  <SelectItem value="PAUSED">Paused</SelectItem>
                  <SelectItem value="CANCELLED">Cancelled</SelectItem>
                  <SelectItem value="PENDING_PAYMENT">Pending Payment</SelectItem>
                  <SelectItem value="SUSPENDED">Suspended</SelectItem>
                </SelectContent>
              </Select>
              <Select value={planFilter} onValueChange={setPlanFilter}>
                <SelectTrigger className="w-52">
                  <SelectValue placeholder="Filter by plan" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Plans</SelectItem>
                  <SelectItem value="FULL_ADULT">Full Adult</SelectItem>
                  <SelectItem value="WEEKEND_ADULT">Weekend Adult</SelectItem>
                  <SelectItem value="KIDS_UNLIMITED_UNDER14">Kids Unlimited U14</SelectItem>
                  <SelectItem value="KIDS_WEEKEND_UNDER14">Kids Weekend U14</SelectItem>
                  <SelectItem value="MASTERS">Masters (30+)</SelectItem>
                  <SelectItem value="WOMENS_CLASSES">Women's Classes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-wrap gap-2">
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
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Customer</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Membership</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Total Paid</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Status</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Routed Entity</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Next Billing</th>
                      <th className="text-left p-4 font-medium text-white">Activity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="border-b border-white/10 hover:bg-white/5 cursor-pointer" onClick={() => setSelectedCustomer(customer)}>
                        <td className="p-4 border-r border-white/5">
                          <div>
                            <p className="font-medium text-white">{customer.name}</p>
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <Mail className="h-3 w-3" />
                              <span>{customer.email}</span>
                            </div>
                            <div className="flex items-center gap-2 text-sm text-white/60">
                              <Phone className="h-3 w-3" />
                              <span>{customer.phone}</span>
                            </div>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <Badge variant="outline" className="border-white/20 text-white">{customer.membershipType}</Badge>
                          <p className="text-sm text-white/60 mt-1">
                            Joined {new Date(customer.joinDate).toLocaleDateString()}
                          </p>
                          {customer.startsOn && (
                            <div className="mt-1">
                              <Badge variant="secondary" className="text-xs">Starts on {new Date(customer.startsOn).toLocaleDateString()}</Badge>
                            </div>
                          )}
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <p className="font-semibold text-white">£{customer.totalPaid}</p>
                          <p className="text-sm text-white/60">Last: {new Date(customer.lastPayment).toLocaleDateString()}</p>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="space-y-1">
                            <Badge variant={getStatusBadgeVariant(customer.status)}>
                              {customer.status}
                            </Badge>
                            {customer.cancelAtPeriodEnd && (
                              <Badge variant="destructive" className="text-xs">
                                Ending Soon
                              </Badge>
                            )}
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-white/60" />
                            <span className="text-sm text-white">{customer.routedEntity}</span>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <p className="font-semibold text-white">£{customer.totalPaid}</p>
                          <p className="text-sm text-white/60">
                            Last: {new Date(customer.lastPayment).toLocaleDateString()}
                          </p>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="flex items-center gap-2">
                            <Calendar className="h-4 w-4 text-white/60" />
                            <span className="text-sm text-white">{new Date(customer.nextBilling).toLocaleDateString()}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <div className="text-sm">
                            <p className="text-white">{typeof customer.accessHistory.totalVisits === 'string' ? customer.accessHistory.totalVisits : `${customer.accessHistory.totalVisits} visits`}</p>
                            <p className="text-white/60">
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
                  <thead className="bg-white/5 border-b border-white/10">
                    <tr>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Customer & Payment</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Amount & Type</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Routed To</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Status & Processing</th>
                      <th className="text-left p-4 font-medium text-white">Routing Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="border-b border-white/10 hover:bg-white/5 cursor-pointer"
                        onClick={() => {
                          const cust = customers.find(c => c.id === payment.customerId)
                          if (cust) {
                            setSelectedCustomer(cust)
                          } else {
                            alert('Customer details not available for this payment.')
                          }
                        }}
                      >
                        <td className="p-4 border-r border-white/5">
                          <div>
                            <p className="font-medium text-white">{payment.customerName}</p>
                            <p className="text-sm text-white/60">
                              {new Date(payment.timestamp).toLocaleString()}
                            </p>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div>
                            <p className="font-semibold text-white">£{payment.amount}</p>
                            <Badge variant="outline" className="text-xs border-white/20 text-white">
                              {payment.membershipType}
                            </Badge>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="flex items-center gap-2">
                            <Building2 className="h-4 w-4 text-white/60" />
                            <span className="text-sm text-white">{payment.routedToEntity}</span>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="space-y-1">
                            <Badge variant={getStatusBadgeVariant(payment.status)}>
                              {payment.status}
                            </Badge>
                            <div className="text-xs text-white/60">
                              <p>Processed in {payment.processingTime}s</p>
                              {payment.retryCount > 0 && (
                                <p className="text-red-400">Retries: {payment.retryCount}</p>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <div className="text-sm space-y-1">
                            <Badge variant={payment.confidence === 'HIGH' ? 'default' : 'secondary'} className="text-xs">
                              {payment.confidence} confidence
                            </Badge>
                            <p className="text-white/60 text-xs">
                              {payment.routingReason}
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
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 text-white">Customer Details</h3>
            <div className="grid gap-4">
              <div className="space-y-3">
                <div className="border-b border-white/10 pb-2">
                  <p className="text-white"><strong className="text-white/90">Name:</strong> {selectedCustomer.name}</p>
                  <p className="text-white"><strong className="text-white/90">Email:</strong> {selectedCustomer.email}</p>
                  <p className="text-white"><strong className="text-white/90">Phone:</strong> {selectedCustomer.phone}</p>
                  {selectedCustomer.phone && (
                    <div className="flex gap-2 mt-2">
                      <Button variant="outline" asChild>
                        <a href={`tel:${selectedCustomer.phone}`}>Call</a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`sms:${selectedCustomer.phone}`}>SMS</a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`https://wa.me/${selectedCustomer.phone.replace(/\D/g,'')}`} target="_blank">WhatsApp</a>
                      </Button>
                      <Button variant="outline" asChild>
                        <a href={`mailto:${selectedCustomer.email}`}>Email</a>
                      </Button>
                    </div>
                  )}
                </div>
                <div className="border-b border-white/10 pb-2">
                  <p className="text-white"><strong className="text-white/90">Membership Type:</strong> {selectedCustomer.membershipType}</p>
                  <p className="text-white"><strong className="text-white/90">Status:</strong> {selectedCustomer.status}</p>
                  <p className="text-white"><strong className="text-white/90">Join Date:</strong> {new Date(selectedCustomer.joinDate).toLocaleDateString()}</p>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <p className="text-white"><strong className="text-white/90">Last Payment:</strong> {new Date(selectedCustomer.lastPayment).toLocaleDateString()}</p>
                  <p className="text-white"><strong className="text-white/90">Total Paid:</strong> £{selectedCustomer.totalPaid}</p>
                  <p className="text-white"><strong className="text-white/90">Next Billing:</strong> {new Date(selectedCustomer.nextBilling).toLocaleDateString()}</p>
                  <div className="flex gap-2 mt-3">
                    {selectedCustomer.status === 'PENDING_PAYMENT' && (selectedCustomer.totalPaid || 0) === 0 ? (
                      <Button
                        variant="outline"
                        onClick={async () => {
                          await handleRemovePendingSignup(selectedCustomer.id)
                        }}
                        className="border-red-500/20 text-red-400 hover:bg-red-500/10"
                      >
                        Remove Abandoned Signup
                      </Button>
                    ) : (
                      <>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!confirm('Retry the latest open invoice for this customer?')) return
                        const resp = await fetch(`/api/admin/customers/${selectedCustomer.id}/retry-invoice`, { method: 'POST' })
                        const json = await resp.json()
                        if (resp.ok) alert('Invoice retry requested. Status: ' + json.invoice.status)
                        else alert('Retry failed: ' + (json.error || 'Unknown error'))
                      }}
                    >
                      Retry Payment
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        if (!confirm('Void the latest open invoice for this customer? This cannot be undone.')) return
                        const resp = await fetch(`/api/admin/customers/${selectedCustomer.id}/void-invoice`, { method: 'POST' })
                        const json = await resp.json()
                        if (resp.ok) alert('Invoice voided. Status: ' + json.invoice.status)
                        else alert('Void failed: ' + (json.error || 'Unknown error'))
                      }}
                      className="border-red-500/20 text-red-400 hover:bg-red-500/10"
                    >
                      Void Invoice
                    </Button>
                      </>
                    )}
                  </div>
                </div>
                <div className="border-b border-white/10 pb-2">
                  <p className="text-white"><strong className="text-white/90">Routed Entity:</strong> {selectedCustomer.routedEntity}</p>
                </div>
                <div>
                  <p className="text-white"><strong className="text-white/90">Emergency Contact:</strong> {selectedCustomer.emergencyContact?.name} ({selectedCustomer.emergencyContact?.relationship})</p>
                  {/* Guardian details if captured during U16 registration */}
                  {selectedCustomer?.emergencyContact && (selectedCustomer as any).emergencyContact?.guardian && (
                    <p className="text-white"><strong className="text-white/90">Guardian:</strong> {(selectedCustomer as any).emergencyContact.guardian.name} — {(selectedCustomer as any).emergencyContact.guardian.phone}</p>
                  )}
                  <p className="text-white"><strong className="text-white/90">Access History:</strong> {selectedCustomer.accessHistory?.totalVisits} visits, {selectedCustomer.accessHistory?.avgWeeklyVisits}/week avg</p>
                </div>
              </div>
            </div>
            {/* 🚀 NEW: Recent Payments (mini) */}
            <div className="border-t border-white/10 pt-4 mt-6">
              <h4 className="text-white font-semibold mb-3">Recent Payments</h4>
              <div className="bg-white/5 border border-white/10 rounded">
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                    <tr>
                      <th className="text-left p-2">Date</th>
                      <th className="text-left p-2">Amount</th>
                      <th className="text-left p-2">Status</th>
                      <th className="text-left p-2">Entity</th>
                    </tr>
                  </thead>
                  <tbody>
                    {payments.filter(p => p.customerId === selectedCustomer.id).slice(0, 6).map((p) => (
                      <tr key={p.id} className="border-t border-white/10">
                        <td className="p-2">{new Date(p.timestamp).toLocaleDateString()}</td>
                        <td className="p-2">£{p.amount}</td>
                        <td className="p-2"><Badge variant={getStatusBadgeVariant(p.status)}>{p.status}</Badge></td>
                        <td className="p-2">{p.routedToEntity}</td>
                      </tr>
                    ))}
                    {payments.filter(p => p.customerId === selectedCustomer.id).length === 0 && (
                      <tr>
                        <td className="p-3 text-white/60" colSpan={4}>No payments yet.</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="mt-2 text-right">
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearchTerm(selectedCustomer.name)
                    setActiveTab('payments')
                    setSelectedCustomer(null)
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                  }}
                  className="border-white/20 text-white hover:bg-white/10"
                >
                  View all payments
                </Button>
              </div>
            </div>

            {/* 🚀 NEW: Membership Management Actions */}
            <div className="border-t border-white/10 pt-4 mt-6">
              <h4 className="text-white font-semibold mb-4">Membership Management</h4>
              <div className="grid grid-cols-2 gap-3">
                {/* Show current subscription status */}
                <div className="col-span-2 mb-2 p-2 bg-blue-500/10 rounded text-xs text-blue-300 flex justify-between items-center">
                  <span>
                    Subscription: {selectedCustomer.subscriptionStatus} | Membership: {selectedCustomer.membershipStatus}
                    {selectedCustomer.cancelAtPeriodEnd && ' | Scheduled for cancellation'}
                  </span>
                </div>
                
                {(selectedCustomer.subscriptionStatus === 'ACTIVE' || selectedCustomer.status === 'ACTIVE') && (
                  <>
                    <Button 
                      variant="outline" 
                      onClick={() => openMembershipActionModal('pause')}
                      className="border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/10"
                    >
                      Pause Membership
                    </Button>
                    <Button 
                      variant="outline" 
                      onClick={() => openMembershipActionModal('cancel')}
                      className="border-red-500/20 text-red-400 hover:bg-red-500/10"
                    >
                      Cancel Membership
                    </Button>
                  </>
                )}
                {(selectedCustomer.subscriptionStatus === 'PAUSED' || selectedCustomer.status === 'PAUSED') && (
                  <Button 
                    variant="outline" 
                    onClick={() => openMembershipActionModal('resume')}
                    className="border-green-500/20 text-green-400 hover:bg-green-500/10 col-span-2"
                  >
                    Resume Membership
                  </Button>
                )}
                {(selectedCustomer.subscriptionStatus === 'CANCELLED' || selectedCustomer.status === 'CANCELLED') && (
                  <div className="col-span-2 text-center text-white/60 py-2">
                    Membership has been cancelled
                  </div>
                )}
                {selectedCustomer.cancelAtPeriodEnd && (
                  <div className="col-span-2 text-center text-orange-400 py-2 text-sm">
                    ⚠️ Scheduled for cancellation at period end
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-2 mt-6 border-t border-white/10 pt-4">
              <Button 
                variant="outline" 
                onClick={() => handlePasswordReset(selectedCustomer.id)}
                disabled={resetPasswordLoading}
                className="border-blue-500/20 text-blue-400 hover:bg-blue-500/10"
              >
                {resetPasswordLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400 mr-2" />
                    Resetting...
                  </>
                ) : (
                  <>
                    <Key className="h-4 w-4 mr-2" />
                    Reset Password
                  </>
                )}
              </Button>
              <Button variant="outline" onClick={() => setSelectedCustomer(null)} className="bg-white text-black hover:bg-white/90">Close</Button>
            </div>
          </div>
        </div>
      )}

      {/* Password Reset Success Modal */}
      {showResetSuccess && resetPasswordResult && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <div className="text-center space-y-4">
              <div className="w-16 h-16 bg-green-500/10 rounded-full flex items-center justify-center mx-auto">
                <Key className="h-8 w-8 text-green-400" />
              </div>
              
              <div>
                <h3 className="text-xl font-bold text-white mb-2">Password Reset Successful</h3>
                <p className="text-white/70 text-sm mb-4">
                  A new temporary password has been generated for <strong>{resetPasswordResult.customerName}</strong>
                </p>
              </div>

              <div className="bg-red-500/10 border border-red-500/20 p-4 rounded-lg">
                <p className="text-sm text-red-300 mb-2">
                  <strong>Temporary Password:</strong>
                </p>
                <div className="bg-black/50 p-3 rounded border font-mono text-lg text-white text-center tracking-wider">
                  {resetPasswordResult.tempPassword}
                </div>
                <p className="text-xs text-red-300/80 mt-2">
                  ⚠️ This password will only be displayed once. Please provide it to the customer immediately.
                </p>
              </div>

              <div className="bg-white/5 border border-white/10 p-4 rounded-lg text-left">
                <p className="text-sm text-white/80 mb-2">
                  <strong>Instructions for customer:</strong>
                </p>
                <ul className="text-xs text-white/70 space-y-1 list-disc list-inside">
                  <li>Use this temporary password to log in at portal365.com</li>
                  <li>You will be prompted to set a new permanent password</li>
                  <li>Choose a strong password you can remember</li>
                  <li>Keep your new password secure</li>
                </ul>
              </div>

              <div className="flex gap-2">
                <Button
                  onClick={() => {
                    navigator.clipboard.writeText(resetPasswordResult.tempPassword)
                    alert('Password copied to clipboard!')
                  }}
                  className="flex-1 bg-white/10 border border-white/20 text-white hover:bg-white/20"
                >
                  Copy Password
                </Button>
                <Button
                  onClick={() => {
                    setShowResetSuccess(false)
                    setResetPasswordResult(null)
                  }}
                  className="flex-1 bg-white text-black hover:bg-white/90"
                >
                  Done
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Customer Modal */}
      {showAddCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-xl font-bold mb-4 text-white">Add New Customer</h3>
            {addCustomerError && (
              <Alert variant="destructive" className="mb-4 border-red-500/20 bg-red-500/10">
                <AlertDescription className="text-red-300">{addCustomerError}</AlertDescription>
              </Alert>
            )}
            <form onSubmit={handleAddCustomer} className="grid gap-4">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-firstName" className="text-white">First Name *</Label>
                  <Input 
                    id="add-firstName" 
                    placeholder="Enter first name" 
                    value={addCustomerData.firstName} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, firstName: e.target.value })}
                    required
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                  />
                </div>
                <div>
                  <Label htmlFor="add-lastName" className="text-white">Last Name *</Label>
                  <Input 
                    id="add-lastName" 
                    placeholder="Enter last name" 
                    value={addCustomerData.lastName} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, lastName: e.target.value })}
                    required
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-email" className="text-white">Email *</Label>
                  <Input 
                    id="add-email" 
                    type="email" 
                    placeholder="Enter customer email" 
                    value={addCustomerData.email} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, email: e.target.value })}
                    required
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                  />
                </div>
                <div>
                  <Label htmlFor="add-phone" className="text-white">Phone</Label>
                  <Input 
                    id="add-phone" 
                    placeholder="Enter customer phone" 
                    value={addCustomerData.phone} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, phone: e.target.value })}
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-membership" className="text-white">Membership Type *</Label>
                  <Select value={addCustomerData.membershipType} onValueChange={(value) => setAddCustomerData({ ...addCustomerData, membershipType: value })}>
                    <SelectTrigger id="add-membership" className="bg-white/5 border-white/20 text-white">
                      <SelectValue placeholder="Select membership type" className="text-white/50" />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-white/20">
                                        <SelectItem value="FULL_ADULT" className="text-white hover:bg-white/10">Full Adult Membership</SelectItem>
                  <SelectItem value="WEEKEND_ADULT" className="text-white hover:bg-white/10">Weekend Only Membership</SelectItem>
                  <SelectItem value="KIDS_UNLIMITED_UNDER14" className="text-white hover:bg-white/10">Kids Unlimited (Under 14s)</SelectItem>
                  <SelectItem value="KIDS_WEEKEND_UNDER14" className="text-white hover:bg-white/10">Kids Weekend (Under 14s)</SelectItem>
                  <SelectItem value="MASTERS" className="text-white hover:bg-white/10">Masters Program (30+)</SelectItem>
                  <SelectItem value="WOMENS_CLASSES" className="text-white hover:bg-white/10">Women's Classes</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="add-customPrice" className="text-white">Custom Monthly Price (£) *</Label>
                  <Input 
                    id="add-customPrice" 
                    type="number" 
                    step="0.01"
                    placeholder="e.g. 45.00" 
                    value={addCustomerData.customPrice} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, customPrice: e.target.value })}
                    required
                    className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                  />
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label htmlFor="add-startDate" className="text-white">Start Month *</Label>
                  <Select 
                    value={addCustomerData.startDate ? addCustomerData.startDate.substring(0, 7) : ''} 
                    onValueChange={(value) => setAddCustomerData({ ...addCustomerData, startDate: value + '-01' })}
                  >
                    <SelectTrigger id="add-startDate" className="bg-white/5 border-white/20 text-white">
                      <SelectValue placeholder="Select start month" className="text-white/50" />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-white/20">
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
                            <SelectItem key={yearMonth} value={yearMonth} className="text-white hover:bg-white/10">
                              {displayText}
                            </SelectItem>
                          )
                        }
                        return months
                      })()}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-white/60 mt-1">
                    Customer will be charged starting from the 1st of the selected month
                  </p>
                </div>
                <div>
                  <Label htmlFor="add-dateOfBirth" className="text-white">Date of Birth</Label>
                  <Input 
                    id="add-dateOfBirth" 
                    type="date"
                    value={addCustomerData.dateOfBirth} 
                    onChange={(e) => setAddCustomerData({ ...addCustomerData, dateOfBirth: e.target.value })}
                    className="bg-white/5 border-white/20 text-white"
                  />
                </div>
              </div>
              <div className="border-t border-white/10 pt-4">
                <h4 className="text-white font-semibold mb-4">Emergency Contact (Optional)</h4>
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <Label htmlFor="add-emergency-name" className="text-white">Contact Name</Label>
                    <Input 
                      id="add-emergency-name" 
                      placeholder="Contact name" 
                      value={addCustomerData.emergencyContact.name} 
                      onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, name: e.target.value } })}
                      className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="add-emergency-phone" className="text-white">Contact Phone</Label>
                    <Input 
                      id="add-emergency-phone" 
                      placeholder="Contact phone" 
                      value={addCustomerData.emergencyContact.phone} 
                      onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, phone: e.target.value } })}
                      className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                  <div>
                    <Label htmlFor="add-emergency-relationship" className="text-white">Relationship</Label>
                    <Input 
                      id="add-emergency-relationship" 
                      placeholder="e.g. Parent" 
                      value={addCustomerData.emergencyContact.relationship} 
                      onChange={(e) => setAddCustomerData({ ...addCustomerData, emergencyContact: { ...addCustomerData.emergencyContact, relationship: e.target.value } })}
                      className="bg-white/5 border-white/20 text-white placeholder:text-white/50"
                    />
                  </div>
                </div>
              </div>
            </form>
            <div className="flex justify-end mt-6 gap-2 border-t border-white/10 pt-4">
              <Button variant="outline" onClick={() => setShowAddCustomer(false)} className="border-white/20 text-white hover:bg-white/10">Cancel</Button>
              <Button onClick={handleAddCustomer} disabled={addCustomerLoading} className="bg-white text-black hover:bg-white/90">
                {addCustomerLoading ? 'Creating...' : 'Create & Setup Payment'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Payment Modal */}
      {showPaymentModal && paymentClientSecret && createdSubscriptionId && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-white">Setup Payment Method</h3>
            <p className="text-sm text-white/70 mb-4">
              Please have the customer enter their payment details to activate their membership.
            </p>
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-4">
              <div className="text-center">
                <p className="text-lg font-semibold text-white">£{addCustomerData.customPrice}/month</p>
                <p className="text-sm text-white/70">
                  {addCustomerData.membershipType.replace('_', ' ')}
                </p>
                <p className="text-xs text-white/60 mt-1">
                  First charge: {addCustomerData.startDate}
                </p>
              </div>
            </div>

            <Elements stripe={stripePromise} options={{ clientSecret: paymentClientSecret, appearance: { theme: 'stripe' } }}>
              <AdminSetupForm 
                subscriptionId={createdSubscriptionId}
                onSuccess={handlePaymentSuccess}
                onError={handlePaymentError}
              />
            </Elements>

            <div className="mt-4 text-center text-xs text-white/60 border-t border-white/10 pt-4">
              Customer membership will be activated after payment method is set up.
              No charge until {addCustomerData.startDate}.
            </div>
          </div>
        </div>
      )}

      {/* 🚀 NEW: Membership Action Modal */}
      {showMembershipActionModal && membershipAction && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-md w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-white">
              {membershipAction === 'pause' && 'Pause Membership'}
              {membershipAction === 'resume' && 'Resume Membership'}
              {membershipAction === 'cancel' && 'Cancel Membership'}
            </h3>
            
            <div className="bg-blue-500/10 border border-blue-500/20 p-4 rounded-lg mb-4">
              <p className="text-sm text-white/90">
                <strong>Customer:</strong> {selectedCustomer.name}
              </p>
              <p className="text-sm text-white/90">
                <strong>Membership:</strong> {selectedCustomer.membershipType}
              </p>
              <p className="text-sm text-white/90">
                <strong>Current Status:</strong> {selectedCustomer.status}
              </p>
            </div>

            {membershipAction === 'pause' && (
              <div className="mb-4">
                <Label htmlFor="pauseBehavior" className="text-white mb-2 block">Pause Behavior</Label>
                <Select value={pauseBehavior} onValueChange={(value: any) => setPauseBehavior(value)}>
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white/20">
                    <SelectItem value="void" className="text-white hover:bg-white/10">Void invoices (recommended)</SelectItem>
                    <SelectItem value="keep_as_draft" className="text-white hover:bg-white/10">Keep as draft</SelectItem>
                    <SelectItem value="mark_uncollectible" className="text-white hover:bg-white/10">Mark uncollectible</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-white/60 mt-1">
                  Void: Cancels pending invoices. Draft: Keeps for manual collection. Uncollectible: Marks as bad debt.
                </p>
              </div>
            )}

            {membershipAction === 'cancel' && (
              <div className="mb-4">
                <Label htmlFor="cancelationType" className="text-white mb-2 block">Cancellation Type</Label>
                <Select value={cancelationType} onValueChange={(value: any) => setCancelationType(value)}>
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white/20">
                    <SelectItem value="end_of_period" className="text-white hover:bg-white/10">End of billing period (recommended)</SelectItem>
                    <SelectItem value="immediate" className="text-white hover:bg-white/10">Immediate cancellation</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-white/60 mt-1">
                  {cancelationType === 'end_of_period' 
                    ? 'Customer keeps access until period ends, no refund required.' 
                    : 'Immediate loss of access, may require prorated refund.'}
                </p>
              </div>
            )}

            <div className="mb-4">
              <Label htmlFor="membershipReason" className="text-white mb-2 block">
                Reason <span className="text-red-400">*</span>
              </Label>
              <textarea
                id="membershipReason"
                placeholder={`Why are you ${membershipAction === 'cancel' ? 'cancelling' : membershipAction === 'pause' ? 'pausing' : 'resuming'} this membership?`}
                value={membershipActionReason}
                onChange={(e) => setMembershipActionReason(e.target.value)}
                className="w-full p-3 bg-white/5 border border-white/20 rounded text-white placeholder:text-white/50 min-h-[80px]"
                maxLength={500}
              />
              <p className="text-xs text-white/60 mt-1">
                {membershipActionReason.length}/500 characters (minimum 5 required)
              </p>
            </div>

            {membershipAction === 'cancel' && cancelationType === 'immediate' && (
              <div className="bg-red-500/10 border border-red-500/20 p-3 rounded-lg mb-4">
                <p className="text-red-300 text-sm font-medium">⚠️ Warning: Immediate Cancellation</p>
                <p className="text-red-300/80 text-xs mt-1">
                  This will immediately cancel the subscription and remove access. 
                  Consider if a prorated refund is needed.
                </p>
              </div>
            )}

            <div className="flex gap-2">
              <Button
                onClick={() => setShowMembershipActionModal(false)}
                variant="outline"
                className="flex-1 border-white/20 text-white hover:bg-white/10"
                disabled={membershipActionLoading}
              >
                Cancel
              </Button>
              <Button
                onClick={handleMembershipAction}
                disabled={membershipActionLoading || membershipActionReason.trim().length < 5}
                className={`flex-1 ${
                  membershipAction === 'pause' ? 'bg-yellow-600 hover:bg-yellow-700' :
                  membershipAction === 'resume' ? 'bg-green-600 hover:bg-green-700' :
                  'bg-red-600 hover:bg-red-700'
                } text-white`}
              >
                {membershipActionLoading ? (
                  <>
                    <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2" />
                    Processing...
                  </>
                ) : (
                  <>
                    {membershipAction === 'pause' && 'Pause Membership'}
                    {membershipAction === 'resume' && 'Resume Membership'}
                    {membershipAction === 'cancel' && `${cancelationType === 'immediate' ? 'Cancel Now' : 'Schedule Cancellation'}`}
                  </>
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
} 

export default function AdminDashboard() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-screen"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>}>
      <AdminDashboardContent />
    </Suspense>
  )
}

function AdminSetupForm({ subscriptionId, onSuccess, onError }: { subscriptionId: string; onSuccess: () => void; onError: (e: string) => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!stripe || !elements) return
    setIsProcessing(true)
    setError(null)
    try {
      const result = await stripe.confirmSetup({
        elements,
        confirmParams: { return_url: window.location.href },
        redirect: 'if_required'
      })
      if (result.error) {
        setError(result.error.message || 'Failed to set up payment method')
        onError(result.error.message || 'Failed to set up payment method')
        setIsProcessing(false)
        return
      }

      const setupIntentId = result.setupIntent?.id
      if (setupIntentId) {
        const resp = await fetch('/api/confirm-payment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ setupIntentId, subscriptionId })
        })
        const json = await resp.json()
        if (resp.ok && json.success) {
          onSuccess()
        } else {
          const msg = json?.error || 'Payment confirmation failed'
          setError(msg)
          onError(msg)
        }
      } else {
        setError('Missing setup intent id')
        onError('Missing setup intent id')
      }
    } catch (err) {
      setError('Unexpected error during setup')
      onError('Unexpected error during setup')
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="bg-white/5 border border-white/10 p-4 rounded-lg">
        <PaymentElement />
      </div>
      {error && (
        <Alert variant="destructive" className="border-red-500/20 bg-red-500/10">
          <AlertDescription className="text-red-300">{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Button type="submit" disabled={!stripe || isProcessing} className="w-full bg-white text-black hover:bg-white/90">
          {isProcessing ? 'Processing…' : 'Complete Payment Setup'}
        </Button>
        <Button type="button" variant="outline" onClick={() => window.history.back()} className="w-full border-white/20 text-white hover:bg-white/10">
          Cancel
        </Button>
      </div>
    </form>
  )
}