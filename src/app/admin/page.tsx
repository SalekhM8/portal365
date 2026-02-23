'use client'

import { useSession } from 'next-auth/react'
import { useEffect, useState, Suspense, useCallback, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { signOut } from 'next-auth/react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
  Key,
  Loader2
} from 'lucide-react'
import { loadStripe } from '@stripe/stripe-js'
import { MEMBERSHIP_PLANS } from '@/config/memberships'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { PauseCalendar } from '@/components/pause-calendar'

// Stripe is loaded dynamically per-transaction based on account

function normalizeForWhatsApp(raw: string): string {
  if (!raw) return ''
  const digits = String(raw).replace(/\D/g, '')
  if (digits.startsWith('00')) return digits.slice(2)
  if (digits.startsWith('44')) return digits
  if (digits.startsWith('0')) return `44${digits.slice(1)}`
  return digits
}

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
  account?: string
  name: string
  email: string
  phone: string
  dateOfBirth: string | null
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
  pauseScheduleLabel?: string
  emergencyContact: {
    name: string
    phone: string
    relationship: string
    addressInfo?: {
      address?: string
      postcode?: string
    }
  }
  familyContext?: {
    isChild: boolean
    familyGroupId: string | null
    parentId: string | null
    parentName: string | null
    parentEmail: string | null
    parentPhone: string | null
  }
  accessHistory: {
    lastAccess: string
    totalVisits: number
    avgWeeklyVisits: number
  }
}

interface FamilyDetail {
  familyId: string
  familyName: string
  membersCount: number
  parent: {
    id: string
    name: string
    email: string
    phone: string
  }
  members: Array<{
    id: string
    name: string
    email: string
    phone: string
    role: 'PARENT' | 'CHILD'
    membershipType: string
    membershipStatus: string
    userStatus: string
    nextBilling: string | null
  }>
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
  monthlyRecurringLastMonth?: number
  monthlyRecurringPrevMonth?: number
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
  const [families, setFamilies] = useState<FamilyDetail[]>([])
  const [payments, setPayments] = useState<PaymentDetail[]>([])
  const [paymentsPage, setPaymentsPage] = useState(1)
  const [paymentsHasMore, setPaymentsHasMore] = useState(true)
  const [paymentsLoadingMore, setPaymentsLoadingMore] = useState(false)
  const [paymentsCustomerFilter, setPaymentsCustomerFilter] = useState<string | null>(null)
  const [paymentsTotalCount, setPaymentsTotalCount] = useState(0)
  const [businessMetrics, setBusinessMetrics] = useState<BusinessMetrics | null>(null)
  const [recentActivity, setRecentActivity] = useState<any[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [revenueMonths, setRevenueMonths] = useState<Array<{ month: string; totalNet: number; charges: number; refunds: number }>>([])
  const [revenueAccount, setRevenueAccount] = useState<'SU'|'IQ'|'AURA'|'ALL'>('AURA')
  const [revenueLoading, setRevenueLoading] = useState(false)
  const [revenueUpdatedAt, setRevenueUpdatedAt] = useState<string | null>(null)
  const revenueAbortRef = useRef<AbortController | null>(null)
  const [loading, setLoading] = useState(false)
  const [initialLoadDone, setInitialLoadDone] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [planFilter, setPlanFilter] = useState('all')
  const [activeTab, setActiveTab] = useState('overview')
  const [selectedCustomer, setSelectedCustomer] = useState<CustomerDetail | null>(null)
  const [memberMemberships, setMemberMemberships] = useState<Array<{ userId: string; memberName: string; membershipType: string; status: string; nextBilling: string | null; subscriptionId: string | null; cancelAtPeriodEnd: boolean }>>([])
  const [membershipsLoading, setMembershipsLoading] = useState(false)
  const [customerPayments, setCustomerPayments] = useState<Array<{ id: string; amount: number; currency: string; status: string; description: string; failureReason: string | null; stripeInvoiceId: string | null; createdAt: string; processedAt: string | null; routedEntity: string }>>([])
  const [customerPaymentsLoading, setCustomerPaymentsLoading] = useState(false)
  const [openPill, setOpenPill] = useState<'personal'|'contact'|'payments'|'management'|null>('personal')
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
  const [paymentPublishableKey, setPaymentPublishableKey] = useState('')
  const [createdSubscriptionId, setCreatedSubscriptionId] = useState('')
  const [resetPasswordLoading, setResetPasswordLoading] = useState(false)
  const [paymentsTodo, setPaymentsTodo] = useState<any[]>([])
  const [showResetSuccess, setShowResetSuccess] = useState(false)
  const [todoLimitMobile, setTodoLimitMobile] = useState(10)
  const [todoLimitDesktop, setTodoLimitDesktop] = useState(10)
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
  // Pause scheduling
  const [pauseMode, setPauseMode] = useState<'immediate' | 'schedule'>('immediate')
  const [pauseStartMonth, setPauseStartMonth] = useState<string>('') // YYYY-MM
  const [pauseEndMonth, setPauseEndMonth] = useState<string>('')     // YYYY-MM
  // NEW: Beautiful calendar-based pause scheduling
  const [showPauseCalendar, setShowPauseCalendar] = useState(false)
  // Dismissed To-Do items (client-side only)
  const [dismissedTodoIds, setDismissedTodoIds] = useState<string[]>([])
  // NEW: Change Plan modal state
  const [showChangePlanModal, setShowChangePlanModal] = useState(false)
  const [newPlanKey, setNewPlanKey] = useState<string>('FULL_ADULT')
  const [effectiveMode, setEffectiveMode] = useState<'now' | 'period_end'>('now')
  const [settlementMode, setSettlementMode] = useState<'defer' | 'charge_now'>('defer')
  const [availablePlans, setAvailablePlans] = useState<Array<{key: string, displayName: string, monthlyPrice: number, migrationOnly?: boolean}>>([])
  const [plansLoading, setPlansLoading] = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [changeLoading, setChangeLoading] = useState(false)

  // 🚀 OPTIMISTIC UPDATE HELPERS - Update UI instantly without full reload
  const updateCustomerInState = useCallback((customerId: string, updates: Partial<CustomerDetail>) => {
    setCustomers(prev => prev.map(c => 
      c.id === customerId ? { ...c, ...updates } : c
    ))
  }, [])

  const removeCustomerFromState = useCallback((customerId: string) => {
    setCustomers(prev => prev.filter(c => c.id !== customerId))
  }, [])

  const addPaymentToState = useCallback((payment: PaymentDetail) => {
    setPayments(prev => [payment, ...prev])
  }, [])

  // Track last fetch time to prevent refetch on tab switch (persists across remounts!)
  const lastFetchTimeRef = useRef<number>(0)
  const CACHE_DURATION_MS = 30000 // 30 seconds - don't refetch within this window

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
    if (tab && ['overview','customers','families','payments','analytics'].includes(tab)) {
      setActiveTab(tab)
    }

    // Only fetch if we haven't fetched recently (prevents refetch on tab switch!)
    // Check sessionStorage for cross-remount persistence
    const lastFetchStr = sessionStorage.getItem('portal365.admin.lastFetch')
    const lastFetch = lastFetchStr ? parseInt(lastFetchStr, 10) : 0
    const now = Date.now()
    
    // Check if we have cached data in sessionStorage
    const cachedData = sessionStorage.getItem('portal365.admin.cachedData')
    
    if (now - lastFetch > CACHE_DURATION_MS || !cachedData) {
      // Cache expired or no cached data - fetch fresh
      sessionStorage.setItem('portal365.admin.lastFetch', String(now))
      lastFetchTimeRef.current = now
      setLoading(true)
      fetchAdminData()
    } else if (cachedData && !initialLoadDone) {
      // Use cached data - no loading spinner!
      try {
        const data = JSON.parse(cachedData)
        setVatStatus(data.vatStatus || [])
        setCustomers(data.customers || [])
        setFamilies(data.families || [])
        setPayments(data.payments || [])
        setBusinessMetrics(data.metrics || null)
        setRecentActivity(data.recentActivity || [])
        setAnalytics(data.analytics || null)
        setPaymentsTodo(data.payments_todo || [])
        setInitialLoadDone(true)
      } catch (e) {
        // Cache corrupted - fetch fresh
        fetchAdminData()
      }
    }
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

  const loadRevenueMonths = useCallback(async (account: 'SU' | 'IQ' | 'AURA' | 'ALL') => {
    try {
      revenueAbortRef.current?.abort()
      const controller = new AbortController()
      revenueAbortRef.current = controller
      setRevenueLoading(true)
      const res = await fetch(`/api/admin/analytics/revenue?months=12&account=${account}`, {
        cache: 'no-store',
        signal: controller.signal
      })
      const j = await res.json()
      if (j?.ok && Array.isArray(j.months)) {
        setRevenueMonths(j.months)
        setRevenueUpdatedAt(j.updatedAt ?? null)
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return
      console.error('Failed to load revenue analytics', err)
    } finally {
      setRevenueLoading(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'analytics') {
      loadRevenueMonths(revenueAccount)
    }
  }, [activeTab, revenueAccount, loadRevenueMonths])

  useEffect(() => {
    return () => revenueAbortRef.current?.abort()
  }, [])

  const formatMoney = (value: number) =>
    `£${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const formatUpdatedAgo = (iso: string | null) => {
    if (!iso) return null
    const diff = Date.now() - new Date(iso).getTime()
    if (diff < 60000) return 'just now'
    if (diff < 3600000) return `${Math.round(diff / 60000)} min ago`
    if (diff < 86400000) return `${Math.round(diff / 3600000)} hr ago`
    return new Date(iso).toLocaleDateString()
  }

  const revenueSyncLabel = formatUpdatedAgo(revenueUpdatedAt)

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
      setFamilies(Array.isArray(data.families) ? data.families : [])
      // Use full payments for Payments tab
      setPayments(Array.isArray(data.payments) ? data.payments : [])
      // Set pagination info from dashboard response
      if (data.paymentsPagination) {
        setPaymentsPage(data.paymentsPagination.page || 1)
        setPaymentsHasMore(data.paymentsPagination.hasMore ?? true)
        setPaymentsTotalCount(data.paymentsPagination.totalCount || 0)
        setPaymentsCustomerFilter(null) // Reset customer filter on full refresh
        setPaymentsServerFiltered(false) // Reset server-filtered flag
      }
      setPaymentsTodo(Array.isArray(data.payments_todo) ? data.payments_todo : [])
      setBusinessMetrics(data.metrics)
      setRecentActivity(data.recentActivity)
      setAnalytics(data.analytics)
      setInitialLoadDone(true)
      
      // 🚀 Cache data to prevent reload on tab switch
      try {
        sessionStorage.setItem('portal365.admin.cachedData', JSON.stringify({
          vatStatus: data.vatStatus,
          customers: data.customers,
          families: data.families,
          payments: data.payments,
          metrics: data.metrics,
          recentActivity: data.recentActivity,
          analytics: data.analytics,
          payments_todo: data.payments_todo
        }))
        sessionStorage.setItem('portal365.admin.lastFetch', String(Date.now()))
      } catch (e) {
        console.warn('Failed to cache admin data:', e)
      }
      
      console.log(`✅ Real admin data loaded: ${data.customers.length} customers, ${(data.payments||[]).length} payments`)
      
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
        setPaymentPublishableKey(result.subscription.publishableKey || process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!)
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
    setPaymentPublishableKey('')
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
    if (cust) {
      setCustomerPayments([])
      setSelectedCustomer(cust)
      fetchCustomerPayments(cust.id)
    }
    else alert('Customer details not available.')
  }

  const openCancelFromTodo = (customerId: string) => {
    const cust = customers.find(c => c.id === customerId)
    if (!cust) {
      alert('Customer details not available.')
      return
    }
    setCustomerPayments([])
    setSelectedCustomer(cust)
    fetchCustomerPayments(cust.id)
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

  const [resolveInvoiceTarget, setResolveInvoiceTarget] = useState<any | null>(null)
  const [resolveLoading, setResolveLoading] = useState(false)
  const [resolveLoadingAction, setResolveLoadingAction] = useState<'mark' | 'void' | null>(null)

  const openResolveInvoice = (payment: any) => {
    if (!payment?.invoiceId) {
      alert('No Stripe invoice attached to this payment.')
      return
    }
    setResolveInvoiceTarget(payment)
  }

  const closeResolveDialog = (open: boolean) => {
    if (open) return
    if (resolveLoading) return
    setResolveInvoiceTarget(null)
  }

  const handleMarkInvoicePaid = async () => {
    if (!resolveInvoiceTarget) return
    setResolveLoading(true)
    setResolveLoadingAction('mark')
    try {
      const res = await fetch('/api/admin/payments/mark-invoice-paid', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: resolveInvoiceTarget.invoiceId })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to mark invoice paid')
      }
      alert('Invoice marked as paid outside Stripe.')
      setResolveInvoiceTarget(null)
      await fetchAdminData()
    } catch (error: any) {
      alert(error?.message || 'Unable to mark invoice paid')
    } finally {
      setResolveLoading(false)
      setResolveLoadingAction(null)
    }
  }

  const handleVoidInvoice = async () => {
    if (!resolveInvoiceTarget) return
    setResolveLoading(true)
    setResolveLoadingAction('void')
    try {
      const res = await fetch('/api/admin/payments/void-open-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invoiceId: resolveInvoiceTarget.invoiceId, customerId: resolveInvoiceTarget.customerId })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || 'Failed to void invoice in Stripe')
      }
      alert('Invoice voided and retries stopped.')
      setResolveInvoiceTarget(null)
      await fetchAdminData()
    } catch (error: any) {
      alert(error?.message || 'Unable to void invoice')
    } finally {
      setResolveLoading(false)
      setResolveLoadingAction(null)
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
      pause: pauseMode === 'schedule'
        ? 'Schedule a pause for the selected months? (Automation will apply before month start)'
        : 'Are you sure you want to PAUSE this customer\'s membership? They will lose access immediately.',
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
      let endpoint = `/api/admin/customers/${selectedCustomer.id}/${membershipAction}-membership`
      const requestBody: any = { reason: membershipActionReason.trim() }

      // Add action-specific parameters
      if (membershipAction === 'pause') {
        if (pauseMode === 'schedule') {
          // Call schedule endpoint instead of immediate pause
          endpoint = `/api/admin/customers/${selectedCustomer.id}/pause-membership/schedule`
          if (!pauseStartMonth || !pauseEndMonth) {
            // Support open-ended: only start required
            const isOpenEnded = !!(window as any).__pauseOpenEnded
            if (!isOpenEnded) {
              alert('Please select start and end months (YYYY-MM) or choose open-ended')
              setMembershipActionLoading(false)
              return
            }
          }
          requestBody.pauseBehavior = pauseBehavior
          requestBody.startMonth = pauseStartMonth
          if ((window as any).__pauseOpenEnded) {
            requestBody.openEnded = true
          } else {
            requestBody.endMonth = pauseEndMonth
          }
        } else {
          requestBody.pauseBehavior = pauseBehavior
        }
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
        const expectedStatus = membershipAction === 'pause' && pauseMode === 'immediate' ? 'PAUSED' : 
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
        
        alert(`✅ ${membershipAction === 'pause' && pauseMode === 'schedule' ? 'PAUSE SCHEDULED' : membershipAction.toUpperCase()} successful: ${result.message || ''}`)
        
        // Close modals and reset state
        setShowMembershipActionModal(false)
        setMembershipAction(null)
        setMembershipActionReason('')
        setPauseMode('immediate')
        setPauseStartMonth('')
        setPauseEndMonth('')
        
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

  const fetchCustomerMemberships = async (customerId: string) => {
    try {
      setMembershipsLoading(true)
      const resp = await fetch(`/api/admin/customers/${customerId}/memberships`)
      const json = await resp.json()
      if (resp.ok && json?.members) {
        setMemberMemberships(json.members)
      } else {
        setMemberMemberships([])
      }
    } catch {
      setMemberMemberships([])
    } finally {
      setMembershipsLoading(false)
    }
  }

  // Fetch ALL payments for a specific customer (no limit - for complete history)
  const fetchCustomerPayments = async (customerId: string) => {
    try {
      setCustomerPaymentsLoading(true)
      const resp = await fetch(`/api/admin/customers/${customerId}/payments`)
      const json = await resp.json()
      if (resp.ok && json?.payments) {
        setCustomerPayments(json.payments)
      } else {
        setCustomerPayments([])
      }
    } catch {
      setCustomerPayments([])
    } finally {
      setCustomerPaymentsLoading(false)
    }
  }

  // Load more payments (for Payments Tab pagination)
  // Track if we've already loaded server-filtered results for current search
  const [paymentsServerFiltered, setPaymentsServerFiltered] = useState(false)
  
  const loadMorePayments = async () => {
    if (paymentsLoadingMore) return
    
    const hasSearchFilter = (searchTerm && searchTerm.trim()) || (statusFilter && statusFilter !== 'all')
    
    // If we have a search filter and haven't fetched from server yet, start fresh from page 1
    const isFirstServerFetch = hasSearchFilter && !paymentsServerFiltered
    const targetPage = isFirstServerFetch ? 1 : paymentsPage + 1
    
    // If no search filter and no more pages, nothing to do
    if (!hasSearchFilter && !paymentsHasMore && !isFirstServerFetch) return
    
    try {
      setPaymentsLoadingMore(true)
      const params = new URLSearchParams({ page: String(targetPage), limit: '50' })
      if (paymentsCustomerFilter) {
        params.set('customerId', paymentsCustomerFilter)
      }
      // Pass search term and status filter for proper pagination
      if (searchTerm && searchTerm.trim()) {
        params.set('search', searchTerm.trim())
      }
      if (statusFilter && statusFilter !== 'all') {
        params.set('status', statusFilter)
      }
      const resp = await fetch(`/api/admin/payments?${params}`)
      const json = await resp.json()
      if (resp.ok && json?.payments) {
        if (isFirstServerFetch) {
          // Replace results for first server-filtered fetch
          setPayments(json.payments)
          setPaymentsServerFiltered(true)
        } else {
          // Append for subsequent pages
          setPayments(prev => [...prev, ...json.payments])
        }
        setPaymentsPage(targetPage)
        setPaymentsHasMore(json.pagination?.hasMore ?? false)
        setPaymentsTotalCount(json.pagination?.totalCount ?? 0)
      }
    } catch (err) {
      console.error('Failed to load more payments:', err)
    } finally {
      setPaymentsLoadingMore(false)
    }
  }

  // Load all payments for a specific customer (for "View all payments" button)
  const loadPaymentsForCustomer = async (customerId: string, customerName: string) => {
    try {
      setPaymentsLoadingMore(true)
      setPaymentsCustomerFilter(customerId)
      setSearchTerm(customerName)
      const resp = await fetch(`/api/admin/payments?customerId=${customerId}&limit=100`)
      const json = await resp.json()
      if (resp.ok && json?.payments) {
        setPayments(json.payments)
        setPaymentsPage(1)
        setPaymentsHasMore(json.pagination?.hasMore ?? false)
        setPaymentsTotalCount(json.pagination?.totalCount ?? 0)
      }
    } catch (err) {
      console.error('Failed to load customer payments:', err)
    } finally {
      setPaymentsLoadingMore(false)
    }
  }

  // Clear customer filter (to go back to all payments)
  const clearPaymentsCustomerFilter = async () => {
    setPaymentsCustomerFilter(null)
    setSearchTerm('')
    setPaymentsServerFiltered(false)
    // Reload all payments from page 1
    try {
      setPaymentsLoadingMore(true)
      const resp = await fetch('/api/admin/payments?page=1&limit=50')
      const json = await resp.json()
      if (resp.ok && json?.payments) {
        setPayments(json.payments)
        setPaymentsPage(1)
        setPaymentsHasMore(json.pagination?.hasMore ?? false)
        setPaymentsTotalCount(json.pagination?.totalCount ?? 0)
      }
    } catch (err) {
      console.error('Failed to reload payments:', err)
    } finally {
      setPaymentsLoadingMore(false)
    }
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

  // Only show loading if actually fetching AND no data yet
  if (loading && customers.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-black">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white"></div>
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
      case 'REFUNDED': return 'destructive'
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
            Complete business oversight and customer management
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
          <Button 
            onClick={() => window.location.href = '/admin/packages'}
            variant="outline"
            className="flex items-center gap-2 text-xs lg:text-sm"
          >
            <Settings className="h-4 w-4" />
            <span className="hidden sm:inline">Package Management</span>
            <span className="sm:hidden">Packages</span>
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
            <CardTitle className="text-xs sm:text-sm font-medium">Last Month Revenue</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-xl sm:text-2xl font-bold">
              £{(
                (businessMetrics?.monthlyRecurringLastMonth ?? null) !== null
                  ? (businessMetrics?.monthlyRecurringLastMonth || 0)
                  : (businessMetrics?.monthlyRecurring || 0)
              ).toLocaleString()}
            </div>
            <p className="text-[10px] sm:text-xs text-muted-foreground">
              MTD: £{(businessMetrics?.monthlyRecurring || 0).toLocaleString()}
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
        <div className="flex justify-center w-full">
          <TabsList className="inline-grid grid-cols-2 lg:grid-cols-5 h-auto">
            <TabsTrigger value="overview" className="text-xs lg:text-sm px-6">Overview</TabsTrigger>
            <TabsTrigger value="customers" className="text-xs lg:text-sm px-6">Customers</TabsTrigger>
            <TabsTrigger value="families" className="text-xs lg:text-sm px-6">Families</TabsTrigger>
            <TabsTrigger value="payments" className="text-xs lg:text-sm px-6">Payments</TabsTrigger>
            <TabsTrigger value="analytics" className="text-xs lg:text-sm px-6">Analytics</TabsTrigger>
          </TabsList>
        </div>

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
                        const failed = [...paymentsTodo]
                          .filter(p => !dismissedTodoIds.includes(p.id))
                          .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                          .slice(0, todoLimitMobile)
                        if (failed.length === 0) {
                          return (
                            <div className="text-sm text-muted-foreground">No failed payments. You're all set.</div>
                          )
                        }
                        return (
                          <>
                          {failed.map((p, idx) => (
                          <div key={p.id} className="border border-white/10 rounded p-3 bg-white/5">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex items-start gap-3">
                                <span className="text-sm font-bold text-white/50 min-w-[24px]">{idx + 1}.</span>
                                <div onClick={() => openCustomerModal(p.customerId)} className="cursor-pointer">
                                  <p className="text-sm font-medium text-white">{p.customerName}</p>
                                  <p className="text-xs text-white/70">£{p.amount} • {p.membershipType} • {new Date(p.timestamp).toLocaleString()}</p>
                                  <div className="mt-1">
                                    <Badge variant={getStatusBadgeVariant(p.status === 'INCOMPLETE_SIGNUP' ? 'PENDING_PAYMENT' : 'FAILED')}>
                                      {p.status === 'INCOMPLETE_SIGNUP' ? 'NO PAYMENT METHOD ATTACHED' : 'FAILED'}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                              <div className="flex flex-col gap-2 shrink-0">
                                <DropdownMenu>
                                  <DropdownMenuTrigger asChild>
                                    <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">Actions ▾</Button>
                                  </DropdownMenuTrigger>
                                  <DropdownMenuContent className="bg-black border-white/20">
                                    {p.status !== 'INCOMPLETE_SIGNUP' && (
                                      <DropdownMenuItem onClick={() => handleRetryLatestInvoice(p.customerId)}>Retry</DropdownMenuItem>
                                    )}
                                    <DropdownMenuItem onClick={() => openCustomerModal(p.customerId)}>Contact</DropdownMenuItem>
                                {p.status === 'INCOMPLETE_SIGNUP' ? (
                                  <DropdownMenuItem onClick={async () => { await handleRemovePendingSignup(p.customerId) }}>Void</DropdownMenuItem>
                                ) : (
  <DropdownMenuItem onClick={() => openResolveInvoice(p)}>Resolve…</DropdownMenuItem>
                                )}
                                    {p.status !== 'INCOMPLETE_SIGNUP' && (
                                      <DropdownMenuItem onClick={() => openCancelFromTodo(p.customerId)} variant="destructive">Cancel Membership</DropdownMenuItem>
                                    )}
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              </div>
                            </div>
                          </div>
                          ))}
                          {failed.length >= todoLimitMobile && (
                            <div className="flex justify-center">
                              <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setTodoLimitMobile(l => l + 10)}>Show more</Button>
                            </div>
                          )}
                          </>
                        )
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
                    const failed = [...paymentsTodo]
                    .filter(p => !dismissedTodoIds.includes(p.id))
                      .sort((a,b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
                    .slice(0, todoLimitDesktop)
                    if (failed.length === 0) {
                      return (
                        <div className="text-sm text-muted-foreground">No failed payments. You're all set.</div>
                      )
                    }
                  return (
                    <>
                    {failed.map((p, idx) => (
                      <div key={p.id} className="border border-white/10 rounded p-3 bg-white/5">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-start gap-3">
                            <span className="text-sm font-bold text-white/50 min-w-[24px]">{idx + 1}.</span>
                            <div onClick={() => openCustomerModal(p.customerId)} className="cursor-pointer">
                              <p className="text-sm font-medium text-white">{p.customerName}</p>
                            <p className="text-xs text-white/70">£{p.amount} • {p.membershipType} • {new Date(p.timestamp).toLocaleString()}</p>
                            <div className="mt-1">
                              <Badge variant={getStatusBadgeVariant(p.status === 'INCOMPLETE_SIGNUP' ? 'PENDING_PAYMENT' : 'FAILED')}>
                                {p.status === 'INCOMPLETE_SIGNUP' ? 'NO PAYMENT METHOD ATTACHED' : 'FAILED'}
                              </Badge>
                              </div>
                            </div>
                          </div>
                          <div className="flex flex-col sm:flex-row gap-2 shrink-0">
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="outline" className="border-white/20 text-white hover:bg-white/10">Actions ▾</Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent className="bg-black border-white/20">
                                {p.status !== 'INCOMPLETE_SIGNUP' && (
                                  <DropdownMenuItem onClick={() => handleRetryLatestInvoice(p.customerId)}>Retry</DropdownMenuItem>
                                )}
                                <DropdownMenuItem onClick={() => openCustomerModal(p.customerId)}>Contact</DropdownMenuItem>
                                {p.status === 'INCOMPLETE_SIGNUP' ? (
                                  <DropdownMenuItem onClick={async () => { await handleRemovePendingSignup(p.customerId) }}>Void</DropdownMenuItem>
                                ) : (
                                  <DropdownMenuItem onClick={() => openResolveInvoice(p)}>Resolve</DropdownMenuItem>
                                )}
                                {p.status !== 'INCOMPLETE_SIGNUP' && (
                                  <DropdownMenuItem onClick={() => openCancelFromTodo(p.customerId)} variant="destructive">Cancel Membership</DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                    </div>
                  ))}
                  {failed.length >= todoLimitDesktop && (
                    <div className="flex justify-center">
                      <Button variant="outline" className="border-white/20 text-white hover:bg-white/10" onClick={() => setTodoLimitDesktop(l => l + 10)}>Show more</Button>
                    </div>
                  )}
                  </>
                  )
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
                          if (cust) {
                            setCustomerPayments([])
                            setSelectedCustomer(cust)
                            fetchCustomerPayments(cust.id)
                          }
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
                  onChange={(e) => { setSearchTerm(e.target.value); setPaymentsServerFiltered(false) }}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Export
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => {
                    const params = new URLSearchParams()
                    if (searchTerm) params.set('search', searchTerm)
                    if (statusFilter) params.set('status', statusFilter)
                    if (planFilter) params.set('plan', planFilter)
                    const url = `/api/admin/export/customers?format=xlsx&${params.toString()}`
                    if (typeof window !== 'undefined') window.location.href = url
                  }}>Excel (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    const params = new URLSearchParams()
                    if (searchTerm) params.set('search', searchTerm)
                    if (statusFilter) params.set('status', statusFilter)
                    if (planFilter) params.set('plan', planFilter)
                    const url = `/api/admin/export/customers?format=csv&${params.toString()}`
                    if (typeof window !== 'undefined') window.location.href = url
                  }}>CSV (.csv)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

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
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Account</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Last Paid</th>
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Status</th>
                      {/* Removed Routed Entity, Next Billing, Activity per client request */}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCustomers.map((customer) => (
                      <tr key={customer.id} className="border-b border-white/10 hover:bg-white/5 cursor-pointer" onClick={() => { setCustomerPayments([]); setSelectedCustomer(customer); fetchCustomerPayments(customer.id) }}>
                        <td className="p-4 border-r border-white/5">
                          <div>
                            <p className="font-medium text-white flex items-center gap-2">
                              {customer.name}
                              {customer.pauseScheduleLabel ? (
                                <span className="text-[11px] px-2 py-0.5 rounded-full bg-green-700/40 text-green-200 border border-green-600/40">
                                  pause scheduled: {customer.pauseScheduleLabel}
                                </span>
                              ) : null}
                            </p>
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
                          <Badge variant="secondary" className="text-xs">
                            {customer.account === 'AURA' ? 'AURA' : customer.account === 'IQ' ? 'IQ' : (customer.account === 'SU' ? 'SU' : '—')}
                          </Badge>
                        </td>
                        <td className="p-4 border-r border-white/5">
                          <p className="font-semibold text-white">{typeof customer.lastPayment === 'number' ? `£${customer.lastPayment}` : (customer.lastPayment ? `£${customer.lastPayment}` : 'N/A')}</p>
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
                        {/* Routed Entity, Next Billing, Activity columns removed from body */}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* Families Tab */}
        <TabsContent value="families" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Family Groups</CardTitle>
              <CardDescription>Parent-child membership overview for observability</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {families.length === 0 ? (
                <div className="text-sm text-white/70">No family groups found.</div>
              ) : (
                families.map((family) => (
                  <div key={family.familyId} className="border border-white/10 rounded-lg p-4 bg-white/5">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 mb-3">
                      <div>
                        <p className="text-white font-semibold">
                          {family.familyName || `${(family.parent.name || 'Family').split(' ').filter(Boolean).slice(-1)[0]} Family`}
                        </p>
                        <p className="text-xs text-white/60">Primary account: {family.parent.name}</p>
                        <p className="text-sm text-white/70">{family.parent.email} • {family.parent.phone || '—'}</p>
                      </div>
                      <Badge variant="outline" className="border-white/20 text-white w-fit">
                        {family.membersCount} member{family.membersCount === 1 ? '' : 's'}
                      </Badge>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="text-white/60 border-b border-white/10">
                          <tr>
                            <th className="text-left p-2">Member</th>
                            <th className="text-left p-2">Role</th>
                            <th className="text-left p-2">Plan</th>
                            <th className="text-left p-2">Status</th>
                            <th className="text-left p-2">Next Billing</th>
                          </tr>
                        </thead>
                        <tbody>
                          {family.members.map((member) => (
                            <tr
                              key={member.id}
                              className="border-b border-white/5 hover:bg-white/5 cursor-pointer"
                              onClick={() => openCustomerModal(member.id)}
                            >
                              <td className="p-2">
                                <p className="text-white">{member.name}</p>
                                <p className="text-xs text-white/60">{member.email}</p>
                              </td>
                              <td className="p-2">
                                <Badge variant="secondary" className="text-xs">{member.role}</Badge>
                              </td>
                              <td className="p-2 text-white/90">{member.membershipType || '—'}</td>
                              <td className="p-2">
                                <Badge variant={getStatusBadgeVariant(member.membershipStatus)}>{member.membershipStatus}</Badge>
                              </td>
                              <td className="p-2 text-white/80">{member.nextBilling ? new Date(member.nextBilling).toLocaleDateString() : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
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
                  onChange={(e) => { setSearchTerm(e.target.value); setPaymentsServerFiltered(false) }}
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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline">
                    <Download className="h-4 w-4 mr-2" />
                    Export Payments
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => {
                    const params = new URLSearchParams()
                    if (searchTerm) params.set('search', searchTerm)
                    if (statusFilter) params.set('status', statusFilter)
                    const url = `/api/admin/export/payments?format=xlsx&${params.toString()}`
                    if (typeof window !== 'undefined') window.location.href = url
                  }}>Excel (.xlsx)</DropdownMenuItem>
                  <DropdownMenuItem onClick={() => {
                    const params = new URLSearchParams()
                    if (searchTerm) params.set('search', searchTerm)
                    if (statusFilter) params.set('status', statusFilter)
                    const url = `/api/admin/export/payments?format=csv&${params.toString()}`
                    if (typeof window !== 'undefined') window.location.href = url
                  }}>CSV (.csv)</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
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
                      {/* Removed Routed To per client request */}
                      <th className="text-left p-4 font-medium text-white border-r border-white/10">Status & Processing</th>
                      <th className="text-left p-4 font-medium text-white">Refund</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredPayments.map((payment) => (
                      <tr
                        key={payment.id}
                        className="border-b border-white/10 hover:bg-white/5 cursor-pointer"
                        onClick={async () => {
                          const cust = customers.find(c => c.id === payment.customerId)
                          if (cust) {
                            setCustomerPayments([])
                            setSelectedCustomer(cust)
                            await Promise.all([
                              fetchCustomerMemberships(cust.id),
                              fetchCustomerPayments(cust.id)
                            ])
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
                        {/* Routed To column removed from body */}
                        <td className="p-4 border-r border-white/5">
                          <div className="space-y-1">
                            <Badge variant={getStatusBadgeVariant(payment.status)}>
                              {payment.status}{payment.status === 'FAILED' && (payment as any).failureReason ? ` (${(payment as any).failureReason})` : ''}
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
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              disabled={payment.status === 'REFUNDED'}
                              onClick={async (e) => {
                                e.stopPropagation()
                                const full = confirm(`Refund £${payment.amount} in full? Click Cancel to enter a partial amount.`)
                                let amount = payment.amount
                                if (!full) {
                                  const input = prompt('Enter partial refund amount (e.g., 5.50):', '')
                                  if (!input) return
                                  const val = Number(input)
                                  if (Number.isNaN(val) || val <= 0) { alert('Invalid amount'); return }
                                  amount = val
                                }
                                const resp = await fetch(`/api/admin/payments/${payment.id}/refund`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountPounds: full ? undefined : amount }) })
                                const json = await resp.json()
                                if (resp.ok) { alert('Refund processed'); await fetchAdminData() } else { alert('Refund failed: ' + (json.error || 'Unknown error')) }
                              }}
                              className="text-xs"
                            >
                              {payment.status === 'REFUNDED' ? 'Refunded' : 'Refund'}
                            </Button>
                            <Button
                              variant="outline"
                              onClick={async (e) => {
                                e.stopPropagation()
                                const full = confirm(`Create credit note for £${payment.amount} (full)? Click Cancel to enter a partial credit.`)
                                let amount = payment.amount
                                if (!full) {
                                  const input = prompt('Enter credit amount (e.g., 5.50):', '')
                                  if (!input) return
                                  const val = Number(input)
                                  if (Number.isNaN(val) || val <= 0) { alert('Invalid amount'); return }
                                  amount = val
                                }
                                const resp = await fetch(`/api/admin/payments/${payment.id}/credit-note`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ amountPounds: amount }) })
                                const json = await resp.json()
                                if (resp.ok) { alert('Credit note created. It will be applied to the next invoice.'); await fetchAdminData() } else { alert('Credit note failed: ' + (json.error || 'Unknown error')) }
                              }}
                              className="text-xs"
                            >
                              Credit Note
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {/* Load More / Pagination */}
              <div className="p-4 border-t border-white/10 flex items-center justify-between">
                <div className="text-sm text-white/60">
                  Showing {filteredPayments.length} of {paymentsTotalCount || payments.length} payments
                  {paymentsCustomerFilter && (
                    <span className="ml-2 text-blue-400">
                      (Filtered to: {searchTerm})
                      <button 
                        onClick={clearPaymentsCustomerFilter}
                        className="ml-2 text-red-400 hover:text-red-300 underline"
                      >
                        Clear filter
                      </button>
                    </span>
                  )}
                </div>
                {paymentsHasMore && (
                  <Button 
                    variant="outline" 
                    onClick={loadMorePayments}
                    disabled={paymentsLoadingMore}
                    className="border-white/20"
                  >
                    {paymentsLoadingMore ? 'Loading...' : 'Load More'}
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* VAT Monitor Tab */}
        {/* Business Analytics Tab */}
        <TabsContent value="analytics" className="space-y-6">
          {/* Monthly Revenue (Stripe Net) */}
      <Card className="mt-6 border border-white/15 bg-white/[0.03] backdrop-blur-xl shadow-2xl">
        <CardHeader>
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <CardTitle>Monthly Revenue (Stripe Net)</CardTitle>
              <CardDescription>Exact Stripe net volume per month (succeeded charges minus refunds)</CardDescription>
            </div>
            <div className="flex flex-col items-end gap-1 text-xs text-white/70">
              <div className="flex items-center gap-2">
                <span className="text-sm text-white/70">Account</span>
                <select
                  className="bg-black/40 border border-white/20 rounded px-2 py-1 text-sm text-white focus:outline-none focus:ring-2 focus:ring-white/40"
                  value={revenueAccount}
                  onChange={(e) => setRevenueAccount(e.target.value as any)}
                >
                  <option value="AURA">AURA</option>
                  <option value="SU">SU</option>
                  <option value="IQ">IQ</option>
                  <option value="ALL">All</option>
                </select>
              </div>
              <div className="text-[11px] text-white/60 min-h-[16px] flex items-center gap-1">
                {revenueLoading ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Refreshing…
                  </>
                ) : revenueSyncLabel ? (
                  <>Synced {revenueSyncLabel}</>
                ) : (
                  <>Awaiting sync…</>
                )}
              </div>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {revenueLoading && revenueMonths.length === 0 ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 6 }).map((_, idx) => (
                <div key={idx} className="flex items-center justify-between gap-4 animate-pulse">
                  <span className="h-4 w-20 rounded bg-white/10" />
                  <span className="h-4 w-24 rounded bg-white/10" />
                  <span className="h-4 w-24 rounded bg-white/10" />
                  <span className="h-4 w-24 rounded bg-white/10" />
                </div>
              ))}
            </div>
          ) : revenueMonths.length === 0 ? (
            <div className="p-6 text-white/70">No data yet.</div>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-white/10 bg-white/[0.02]">
              <table className="w-full text-sm text-white/90">
                <thead className="bg-white/[0.04]">
                  <tr className="text-left uppercase tracking-wide text-[11px] text-white/60">
                    <th className="py-3 px-4">Month</th>
                    <th className="py-3 px-4">Total Net</th>
                    <th className="py-3 px-4">Charges</th>
                    <th className="py-3 px-4">Refunds</th>
                  </tr>
                </thead>
                <tbody>
                  {revenueMonths.map((m) => (
                    <tr key={m.month} className="border-t border-white/5 hover:bg-white/[0.03] transition-colors">
                      <td className="py-3 px-4 font-medium text-white">{m.month}</td>
                      <td className="py-3 px-4">{formatMoney(m.totalNet || 0)}</td>
                      <td className="py-3 px-4">{formatMoney(m.charges || 0)}</td>
                      <td className="py-3 px-4 text-red-300">{formatMoney(m.refunds || 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
        </TabsContent>

        {/* Settings Tab */}
      </Tabs>

      {/* Customer Details Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-md w-full mx-4 max-h-[85vh] overflow-y-auto">
            <h3 className="text-2xl sm:text-3xl font-extrabold mb-4 text-white">Member Summary</h3>
            <div className="grid gap-3">
              {/* Summary first */}
              <div className="space-y-1">
                <p className="text-white text-base font-semibold">{selectedCustomer.name}</p>
                <p className="text-white/80 text-sm">
                  {selectedCustomer.membershipType} • {selectedCustomer.status}
                  {selectedCustomer.account && <> • {selectedCustomer.account}</>}
                </p>
                {selectedCustomer.familyContext?.isChild && (
                  <p className="text-xs text-blue-300">
                    Family member under {selectedCustomer.familyContext.parentName || 'parent account'}
                  </p>
                )}
                {selectedCustomer.phone && selectedCustomer.phone !== 'N/A' && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    <Button variant="outline" asChild className="rounded-full"><a href={`tel:${selectedCustomer.phone}`}>Call</a></Button>
                    <Button variant="outline" asChild className="rounded-full"><a href={`sms:${selectedCustomer.phone}`}>SMS</a></Button>
                    <Button variant="outline" asChild className="rounded-full"><a href={`https://api.whatsapp.com/send?phone=${normalizeForWhatsApp(selectedCustomer.phone)}`} target="_blank" rel="noopener noreferrer">WhatsApp</a></Button>
                    <Button variant="outline" asChild className="rounded-full"><a href={`mailto:${selectedCustomer.email}`}>Email</a></Button>
                  </div>
                )}
              </div>

              {/* Vertical collapsibles */}
              <div className="divide-y divide-white/10 border border-white/10 rounded">
                {/* Personal Information */}
    <button onClick={() => setOpenPill(openPill==='personal'? null:'personal')} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="text-white text-base sm:text-lg font-semibold">Personal Information</span>
                  <span className="text-white/60 text-xs">{openPill==='personal' ? '▾' : '▸'}</span>
                </button>
                {openPill==='personal' && (
                  <div className="px-3 pb-3 space-y-2">
                    <p className="text-white"><strong className="text-white/90">Date of Birth:</strong> {(selectedCustomer as any).dateOfBirth ? new Date((selectedCustomer as any).dateOfBirth).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}</p>
                  {(() => {
                      try {
                        const raw = (selectedCustomer as any)?.emergencyContact
                        const addrObj = typeof raw === 'string' ? JSON.parse(raw || '{}') : raw || {}
                        const addr = (addrObj as any)?.addressInfo?.address || (addrObj as any)?.address || null
                        const postcode = (addrObj as any)?.addressInfo?.postcode || (addrObj as any)?.postcode || null
                    return (
                      <>
                            <p className="text-white"><strong className="text-white/90">Address:</strong> {(addr && ((addr as any).address || (addr as any).line1 || addr)) || '—'}</p>
                            <p className="text-white"><strong className="text-white/90">Post Code:</strong> {postcode || '—'}</p>
                      </>
                    )
                      } catch { return null }
                  })()}
                    <p className="text-white"><strong className="text-white/90">Email:</strong> {selectedCustomer.email}</p>
                    <p className="text-white"><strong className="text-white/90">Phone:</strong> {selectedCustomer.phone || '—'}</p>
                  <p className="text-white"><strong className="text-white/90">Join Date:</strong> {new Date(selectedCustomer.joinDate).toLocaleDateString()}</p>
                    {(() => {
                      const last = payments.find(p => p.customerId === selectedCustomer.id && p.status === 'CONFIRMED')
                      return (
                        <p className="text-white"><strong className="text-white/90">Last Payment:</strong> £{last ? Number(last.amount).toLocaleString() : '—'}</p>
                      )
                    })()}
                  <p className="text-white"><strong className="text-white/90">Next Billing:</strong> {new Date(selectedCustomer.nextBilling).toLocaleDateString()}</p>
                  </div>
                )}

                {/* Emergency Contact */}
    <button onClick={() => setOpenPill(openPill==='contact'? null:'contact')} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="text-white text-base sm:text-lg font-semibold">Emergency Contact</span>
                  <span className="text-white/60 text-xs">{openPill==='contact' ? '▾' : '▸'}</span>
                </button>
                {openPill==='contact' && (
                  <div className="px-3 pb-3 space-y-2">
                    {(() => {
                      try {
                        const raw = (selectedCustomer as any)?.emergencyContact
                        const ec = typeof raw === 'string' ? JSON.parse(raw || '{}') : (raw || {})
                        const name = (ec as any)?.name || '—'
                        const phone = (ec as any)?.phone || '—'
                        const relationship = (ec as any)?.relationship || '—'
                        return (
                          <>
                            <p className="text-white"><strong className="text-white/90">Name:</strong> {name}</p>
                            <p className="text-white"><strong className="text-white/90">Phone:</strong> {phone}</p>
                            <p className="text-white"><strong className="text-white/90">Relationship:</strong> {relationship}</p>
                          </>
                        )
                      } catch {
                        return (
                          <>
                            <p className="text-white"><strong className="text-white/90">Name:</strong> —</p>
                            <p className="text-white"><strong className="text-white/90">Phone:</strong> —</p>
                            <p className="text-white"><strong className="text-white/90">Relationship:</strong> —</p>
                          </>
                        )
                      }
                    })()}
                    </div>
                  )}

                {/* Recent Payments - Now fetches ALL payments for this customer */}
    <button onClick={() => setOpenPill(openPill==='payments'? null:'payments')} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="text-white text-base sm:text-lg font-semibold">Payments ({customerPaymentsLoading ? '...' : customerPayments.length})</span>
                  <span className="text-white/60 text-xs">{openPill==='payments' ? '▾' : '▸'}</span>
                </button>
                {openPill==='payments' && (
                  <div className="px-3 pb-2">
                {customerPaymentsLoading ? (
                  <div className="text-white/60 text-sm py-4 text-center">Loading payments...</div>
                ) : (
                <table className="w-full text-sm">
                  <thead className="text-white/60">
                        <tr><th className="text-left p-2">Date</th><th className="text-left p-2">Amount</th><th className="text-left p-2">Status</th></tr>
                  </thead>
                  <tbody>
                    {customerPayments.slice(0, 10).map((p) => (
                      <tr key={p.id} className="border-t border-white/10">
                        <td className="p-2">{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td className="p-2">£{p.amount}</td>
                        <td className="p-2"><Badge variant={getStatusBadgeVariant(p.status)}>{p.status}</Badge></td>
                      </tr>
                    ))}
                    {customerPayments.length === 0 && (
                          <tr><td className="p-3 text-white/60" colSpan={3}>No payments yet.</td></tr>
                    )}
                  </tbody>
                </table>
                )}
                {customerPayments.length > 10 && (
                  <div className="text-white/50 text-xs mt-1">Showing 10 of {customerPayments.length} payments</div>
                )}
              <div className="mt-2 text-right">
                      <Button variant="outline" onClick={async () => { 
                        await loadPaymentsForCustomer(selectedCustomer.id, selectedCustomer.name)
                        setActiveTab('payments')
                        setSelectedCustomer(null)
                        window.scrollTo({ top: 0, behavior: 'smooth' }) 
                      }} className="border-white/20 text-white hover:bg-white/10">View all payments</Button>
              </div>
            </div>
                )}

                {/* Membership Management */}
    <button onClick={() => setOpenPill(openPill==='management'? null:'management')} className="w-full flex items-center justify-between px-3 py-2 text-left">
                  <span className="text-white text-base sm:text-lg font-semibold">Membership Management</span>
                  <span className="text-white/60 text-xs">{openPill==='management' ? '▾' : '▸'}</span>
                </button>
                {openPill==='management' && (
                  <div className="px-3 pb-3 space-y-3">
                    <div className="p-2 bg-blue-500/10 rounded text-xs text-blue-300">Subscription: {selectedCustomer.subscriptionStatus} • Membership: {selectedCustomer.membershipStatus}{selectedCustomer.cancelAtPeriodEnd && ' • Scheduled for cancellation'}</div>
                {(selectedCustomer.subscriptionStatus === 'ACTIVE' || selectedCustomer.status === 'ACTIVE') && (
          <div className="flex flex-col gap-2">
                        <Button variant="outline" onClick={() => openMembershipActionModal('pause')} className="border-yellow-500/20 text-yellow-400 hover:bg-yellow-500/10">Pause</Button>
                        <Button variant="outline" onClick={() => openMembershipActionModal('cancel')} className="border-red-500/20 text-red-400 hover:bg-red-500/10">Cancel</Button>
                      </div>
                )}
                {(selectedCustomer.subscriptionStatus === 'PAUSED' || selectedCustomer.status === 'PAUSED') && (
          <Button variant="outline" onClick={() => openMembershipActionModal('resume')} className="border-green-500/20 text-green-400 hover:bg-green-500/10 w-full">Resume</Button>
                    )}
                    {selectedCustomer.cancelAtPeriodEnd && (<div className="text-orange-400 text-xs">⚠️ Scheduled for cancellation at period end</div>)}
                    {/* Admin tools moved here */}
        <div className="flex flex-col gap-2">
          <Button variant="outline" onClick={async () => { if (!confirm('Delete this account? Only allowed when no active/trial/paused/past_due subs, no paid invoices, no confirmed payments.')) return; const resp = await fetch(`/api/admin/customers/${selectedCustomer.id}/delete`, { method: 'POST' }); const json = await resp.json(); if (resp.ok) { alert('Account deleted'); setSelectedCustomer(null); await fetchAdminData() } else { alert('Delete blocked: ' + (json.error || 'Unknown reason')) } }} className="border-red-500/20 text-red-400 hover:bg-red-500/10 w-full">Delete Account</Button>
          <Button variant="outline" onClick={async () => {
            setShowChangePlanModal(true)
            // Fetch all plans including migration-only ones
            if (availablePlans.length === 0) {
              setPlansLoading(true)
              try {
                const res = await fetch('/api/admin/plans')
                const data = await res.json()
                if (data?.plans) {
                  setAvailablePlans(data.plans.filter((p: any) => p.active))
                } else {
                  // Fallback to static config
                  setAvailablePlans(Object.values(MEMBERSHIP_PLANS).map(p => ({ key: p.key, displayName: p.displayName, monthlyPrice: p.monthlyPrice })))
                }
              } catch {
                setAvailablePlans(Object.values(MEMBERSHIP_PLANS).map(p => ({ key: p.key, displayName: p.displayName, monthlyPrice: p.monthlyPrice })))
              } finally {
                setPlansLoading(false)
              }
            }
          }} className="border-white/20 text-white hover:bg-white/10 w-full">Change Plan (Admin)</Button>
          <Button variant="outline" onClick={() => handlePasswordReset(selectedCustomer.id)} disabled={resetPasswordLoading} className="border-blue-500/20 text-blue-400 hover:bg-blue-500/10 w-full">{resetPasswordLoading ? 'Resetting…' : 'Reset Password'}</Button>
                  </div>
                  </div>
                )}
            </div>

              {/* Close button aligned bottom */}
              <div className="flex justify-end items-center gap-2 mt-4">
              <Button variant="outline" onClick={() => setSelectedCustomer(null)} className="bg-white text-black hover:bg-white/90">Close</Button>
              </div>
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

            <Elements stripe={paymentPublishableKey ? loadStripe(paymentPublishableKey) : null} options={{ clientSecret: paymentClientSecret, appearance: { theme: 'stripe' } }}>
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
                <Label className="text-white mb-2 block">Pause Mode</Label>
                <div className="flex gap-2 mb-4">
                  <Button
                    variant={pauseMode === 'immediate' ? 'default' : 'outline'}
                    className={pauseMode === 'immediate' ? '' : 'border-white/20 text-white'}
                    onClick={() => setPauseMode('immediate')}
                  >
                    Pause now
                  </Button>
                  <Button
                    variant={pauseMode === 'schedule' ? 'default' : 'outline'}
                    className={pauseMode === 'schedule' ? '' : 'border-white/20 text-white'}
                    onClick={() => {
                      setPauseMode('schedule')
                      setShowMembershipActionModal(false)
                      setShowPauseCalendar(true)
                    }}
                  >
                    📅 Schedule Dates
                  </Button>
                </div>

                {pauseMode === 'immediate' && (
                  <>
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
                  </>
                )}
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

      {/* 🚀 NEW: Change Plan (Admin) Modal */}
      {showChangePlanModal && selectedCustomer && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-black border border-white/20 p-6 rounded-lg shadow-xl max-w-lg w-full mx-4">
            <h3 className="text-xl font-bold mb-4 text-white">Change Customer Plan</h3>
            <div className="space-y-4">
              <div className="bg-white/5 border border-white/10 p-3 rounded">
                <p className="text-sm text-white/80"><strong>Customer:</strong> {selectedCustomer.name}</p>
                <p className="text-sm text-white/80"><strong>Current Plan:</strong> {selectedCustomer.membershipType}</p>
                <p className="text-sm text-white/80"><strong>Next Billing:</strong> {new Date(selectedCustomer.nextBilling).toLocaleDateString()}</p>
              </div>
              <div>
                <Label className="text-white mb-2 block">New Plan</Label>
                <Select value={newPlanKey} onValueChange={setNewPlanKey}>
                  <SelectTrigger className="bg-white/5 border-white/20 text-white">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="bg-black border-white/20 max-h-[300px]">
                    {plansLoading ? (
                      <SelectItem value="_loading" disabled className="text-white/50">Loading plans...</SelectItem>
                    ) : availablePlans.length > 0 ? (
                      availablePlans.map((plan) => (
                        <SelectItem key={plan.key} value={plan.key} className="text-white hover:bg-white/10">
                          {plan.displayName} (£{plan.monthlyPrice}/mo){plan.migrationOnly ? ' [Migration]' : ''}
                        </SelectItem>
                      ))
                    ) : (
                      Object.entries(MEMBERSHIP_PLANS).map(([key, plan]) => (
                        <SelectItem key={key} value={key} className="text-white hover:bg-white/10">
                          {plan.displayName} (£{plan.monthlyPrice}/mo)
                        </SelectItem>
                      ))
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-white mb-2 block">Effective</Label>
                <div className="flex gap-2">
                  <Button variant={effectiveMode==='now'?'default':'outline'} className={effectiveMode==='now'?'':'border-white/20 text-white'} onClick={() => setEffectiveMode('now')}>Start now</Button>
                  <Button variant={effectiveMode==='period_end'?'default':'outline'} className={effectiveMode==='period_end'?'':'border-white/20 text-white'} onClick={() => setEffectiveMode('period_end')}>Start on next billing date</Button>
                </div>
                <p className="text-xs text-white/60 mt-1">Start now flips access immediately; period-end switches access on the 1st.</p>
              </div>
              {effectiveMode === 'now' && (
                <div>
                  <Label className="text-white mb-2 block">Settlement</Label>
                  <div className="flex gap-2">
                    <Button variant={settlementMode==='defer'?'default':'outline'} className={settlementMode==='defer'?'':'border-white/20 text-white'} onClick={() => setSettlementMode('defer')}>Defer to next invoice</Button>
                    <Button variant={settlementMode==='charge_now'?'default':'outline'} className={settlementMode==='charge_now'?'':'border-white/20 text-white'} onClick={() => setSettlementMode('charge_now')}>Charge now</Button>
                  </div>
                  <p className="text-xs text-white/60 mt-1">If the user is in trial, we will charge/refund the exact delta now.</p>
                </div>
              )}
              <div>
                <Button
                  variant="outline"
                  className="border-white/20 text-white"
                  onClick={async () => {
                    if (!selectedCustomer) return
                    setPreviewLoading(true)
                    try {
                      const resp = await fetch(`/api/admin/customers/${selectedCustomer.id}/change-plan/preview`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newMembershipType: newPlanKey })
                      })
                      const json = await resp.json()
                      setPreview(json.preview || null)
                    } finally { setPreviewLoading(false) }
                  }}
                >
                  {previewLoading ? 'Calculating…' : 'Preview change'}
                </Button>
              </div>
              {preview && (
                <div className="bg-blue-500/10 border border-blue-500/20 p-3 rounded">
                  <p className="text-sm text-white/80"><strong>Stripe status:</strong> {preview.stripeStatus}</p>
                  <p className="text-sm text-white/80"><strong>Next billing:</strong> {preview.nextBillingDate}</p>
                  <p className="text-sm text-white/80"><strong>Current → New:</strong> £{preview.currentMonthly} → £{preview.newMonthly}</p>
                  {preview.deltaNow !== undefined && (
                    <p className="text-sm text-white/80"><strong>Delta now (trial):</strong> £{Number(preview.deltaNow).toFixed(2)}</p>
                  )}
                  {preview.upcomingPreviewTotal !== undefined && preview.upcomingPreviewTotal !== null && (
                    <p className="text-sm text-white/80"><strong>Upcoming preview total (active):</strong> £{Number(preview.upcomingPreviewTotal).toFixed(2)}</p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button variant="outline" className="flex-1 border-white/20 text-white" onClick={() => setShowChangePlanModal(false)}>Cancel</Button>
                <Button className="flex-1" onClick={async () => {
                  if (!selectedCustomer) return
                  setChangeLoading(true)
                  try {
                    const resp = await fetch(`/api/admin/customers/${selectedCustomer.id}/change-plan`, {
                      method: 'POST', headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify({ newMembershipType: newPlanKey, effective: effectiveMode, settlement: settlementMode })
                    })
                    const json = await resp.json()
                    if (resp.ok && json.success) {
                      alert('Plan changed successfully')
                      setShowChangePlanModal(false)
                      fetchAdminData()
                    } else {
                      alert('Plan change failed: ' + (json.error || 'Unknown error'))
                    }
                  } finally { setChangeLoading(false) }
                }} disabled={changeLoading}>
                  {changeLoading ? 'Applying…' : 'Apply change'}
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

  <Dialog open={!!resolveInvoiceTarget} onOpenChange={closeResolveDialog}>
    <DialogContent className="bg-black border-white/20 text-white max-w-lg">
      <DialogHeader>
        <DialogTitle>Resolve failed invoice</DialogTitle>
        <DialogDescription className="text-white/70">
          {resolveInvoiceTarget ? (
            <>
              {resolveInvoiceTarget.customerName} • £{resolveInvoiceTarget.amount} • {resolveInvoiceTarget.membershipType}
              <br />
              Invoice ID: {resolveInvoiceTarget.invoiceId}
            </>
          ) : (
            'Choose how you want to resolve this invoice.'
          )}
        </DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div className="border border-white/10 rounded-lg p-4 bg-white/5">
          <p className="font-semibold text-white">Mark Paid</p>
          <p className="text-sm text-white/70">
            You collected payment outside Stripe (cash/bank transfer). This marks the invoice paid so the member stays active and future renewals continue.
          </p>
          <Button className="mt-3 w-full" disabled={resolveLoading} onClick={handleMarkInvoicePaid}>
            {resolveLoadingAction === 'mark' ? 'Processing…' : 'Mark as Paid'}
          </Button>
        </div>
        <div className="border border-white/10 rounded-lg p-4 bg-white/5">
          <p className="font-semibold text-white">Void / Forgive</p>
          <p className="text-sm text-white/70">
            Stop Stripe retries for this invoice (member not paying / admin error). The subscription remains active, so the next month will still bill unless you cancel it.
          </p>
          <Button variant="outline" className="mt-3 w-full border-white/30 text-red-300 hover:bg-white/10" disabled={resolveLoading} onClick={handleVoidInvoice}>
            {resolveLoadingAction === 'void' ? 'Processing…' : 'Void Invoice'}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>

      {/* 🗓️ NEW: Beautiful Calendar-based Pause Scheduler */}
      {selectedCustomer && (
        <PauseCalendar
          customerId={selectedCustomer.id}
          customerName={selectedCustomer.name}
          monthlyPrice={
            (() => {
              const plan = Object.values(MEMBERSHIP_PLANS).find(p => p.key === selectedCustomer.membershipType)
              return plan?.monthlyPrice || 50
            })()
          }
          membershipType={selectedCustomer.membershipType}
          isOpen={showPauseCalendar}
          onClose={() => setShowPauseCalendar(false)}
          onPauseCreated={() => {
            fetchAdminData()
            setShowPauseCalendar(false)
          }}
        />
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