import useSWR from 'swr'

interface MembershipData {
  type: string
  status: string
  price: number
  nextBilling: string
  accessPermissions: any
  scheduleAccess?: { 
    timezone?: string
    allowedWindows?: Array<{ days: string[]; start: string; end: string }> 
  }
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

interface DashboardData {
  user: any
  membership: MembershipData | null
  payments: PaymentData[]
  members: Array<{ id: string; name: string }>
  classes: ClassData[]
}

export function useCustomerDashboard(email?: string) {
  const url = email 
    ? `/api/customers/dashboard?email=${encodeURIComponent(email)}` 
    : '/api/customers/dashboard'

  const { data, error, isLoading, mutate } = useSWR<DashboardData>(
    url,
    {
      revalidateOnFocus: false,
      dedupingInterval: 5000,
    }
  )

  return {
    user: data?.user,
    membership: data?.membership,
    payments: data?.payments || [],
    members: data?.members || [],
    classes: data?.classes || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function useCustomerMembership() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/customers/membership',
    {
      revalidateOnFocus: false,
    }
  )

  return {
    membership: data?.membership,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function useFamilyMembers() {
  const { data, error, isLoading, mutate } = useSWR(
    '/api/customers/family',
    {
      revalidateOnFocus: false,
    }
  )

  return {
    children: data?.children || [],
    parentHasPaymentMethod: data?.parentHasPaymentMethod || false,
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function useClasses() {
  const { data, error, isLoading, mutate } = useSWR<{ classes: any[] }>(
    '/api/classes',
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000, // Classes don't change often
    }
  )

  return {
    classes: data?.classes || [],
    isLoading,
    isError: error,
    refresh: mutate,
  }
}

export function usePlansByBusiness(businessId: string) {
  const { data, error, isLoading } = useSWR(
    businessId ? `/api/plans?business=${businessId}` : null,
    {
      revalidateOnFocus: false,
      dedupingInterval: 60000,
    }
  )

  return {
    plans: data?.plans || [],
    isLoading,
    isError: error,
  }
}

