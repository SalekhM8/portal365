'use client'

import { SWRConfig } from 'swr'
import { ReactNode } from 'react'

// Global fetcher for SWR
const fetcher = async (url: string) => {
  const res = await fetch(url)
  if (!res.ok) {
    const error = new Error('An error occurred while fetching the data.')
    throw error
  }
  return res.json()
}

interface SWRProviderProps {
  children: ReactNode
}

export function SWRProvider({ children }: SWRProviderProps) {
  return (
    <SWRConfig
      value={{
        fetcher,
        // Keep data fresh but don't refetch on every focus
        revalidateOnFocus: false,
        // Revalidate on reconnect
        revalidateOnReconnect: true,
        // Keep previous data while revalidating
        keepPreviousData: true,
        // Dedupe requests within 2 seconds
        dedupingInterval: 2000,
        // Don't retry on error (prevents hammering failed endpoints)
        shouldRetryOnError: false,
        // Cache data for 5 minutes by default
        refreshInterval: 0, // Manual refresh only
        // Error retry count
        errorRetryCount: 2,
      }}
    >
      {children}
    </SWRConfig>
  )
}

