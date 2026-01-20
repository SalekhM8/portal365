import useSWR from 'swr'

// Types
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
  }
}

interface PaymentDetail {
  id: string
  amount: number
  currency: string
  status: string
  date: string
  description: string
  member: string
  memberEmail: string
  entity: string
}

interface DashboardMetrics {
  totalRevenue: number
  revenueChange: number
  lastMonthRevenue: number
  monthToDateRevenue: number
  totalMembers: number
  activeMembers: number
  lastPayoutAmount: number
  lastPayoutDate: string | null
  monthlyChange: number
}

// Custom hooks with SWR caching

export function useVATStatus() {
  const { data, error, isLoading, mutate } = useSWR<{ entities: VATStatus[] }>(
    '/api/admin/vat-status',
    {
      refreshInterval: 60000, // Refresh VAT status every minute
    }
  )

  return {
    vatEntities: data?.entities || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function useCustomers(search?: string, status?: string, plan?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status && status !== 'all') params.set('status', status)
  if (plan && plan !== 'all') params.set('plan', plan)
  
  const queryString = params.toString()
  const url = `/api/admin/customers${queryString ? `?${queryString}` : ''}`

  const { data, error, isLoading, mutate } = useSWR<{ customers: CustomerDetail[] }>(
    url,
    {
      keepPreviousData: true, // Keep old data while filtering
    }
  )

  return {
    customers: data?.customers || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function usePayments(search?: string, status?: string) {
  const params = new URLSearchParams()
  if (search) params.set('search', search)
  if (status && status !== 'all') params.set('status', status)
  
  const queryString = params.toString()
  const url = `/api/admin/payments${queryString ? `?${queryString}` : ''}`

  const { data, error, isLoading, mutate } = useSWR<{ payments: PaymentDetail[] }>(
    url,
    {
      keepPreviousData: true,
    }
  )

  return {
    payments: data?.payments || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function useDashboardMetrics() {
  const { data, error, isLoading, mutate } = useSWR<DashboardMetrics>(
    '/api/admin/dashboard',
    {
      refreshInterval: 30000, // Refresh metrics every 30 seconds
    }
  )

  return {
    metrics: data,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function usePlans() {
  const { data, error, isLoading, mutate } = useSWR<{ plans: any[] }>(
    '/api/plans',
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Plans don't change often
    }
  )

  return {
    plans: data?.plans || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

// Analytics hooks
export function useRevenueAnalytics(period: string = '30d') {
  const { data, error, isLoading, mutate } = useSWR(
    `/api/admin/analytics/revenue?period=${period}`,
    {
      refreshInterval: 60000,
    }
  )

  return {
    analytics: data,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

