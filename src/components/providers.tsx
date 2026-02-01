'use client'

import { SessionProvider } from 'next-auth/react'
import { SWRProvider } from '@/lib/swr-config'

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider 
      // Disable session refetch on window focus - prevents reload on tab switch!
      refetchOnWindowFocus={false}
      // Only refetch session every 5 minutes instead of constantly
      refetchInterval={5 * 60}
    >
      <SWRProvider>
      {children}
      </SWRProvider>
    </SessionProvider>
  )
} 