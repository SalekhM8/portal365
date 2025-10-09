'use client'

import { useEffect, useState } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, Users } from 'lucide-react'
import { useState as useReactState } from 'react'

export default function PlanMembersPage() {
  const router = useRouter()
  const routeParams = useParams() as { key?: string }
  const planKey = decodeURIComponent(routeParams.key || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [planName, setPlanName] = useState<string>('')
  const [members, setMembers] = useState<Array<{ id: string; name: string; email: string; status: string; joinedAt: string; nextBilling: string | null; lastPaidAt: string | null }>>([])
  const [search, setSearch] = useState('')

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch(`/api/admin/plans/${encodeURIComponent(planKey)}/members`, { cache: 'no-store' })
        const data = await res.json()
        if (!res.ok || !data?.success) {
          setError(data?.error || 'Failed to load members')
          return
        }
        setPlanName(data.planName || planKey)
        setMembers(data.members || [])
      } catch {
        setError('Network error')
      } finally {
        setLoading(false)
      }
    })()
  }, [planKey])

  const filtered = members.filter(m => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return m.name.toLowerCase().includes(q) || m.email.toLowerCase().includes(q)
  })

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6">
      <div>
        <Button variant="ghost" onClick={() => router.push('/admin/packages')} className="mb-2">
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Packages
        </Button>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight flex items-center gap-2">
          <Users className="h-5 w-5" /> {planName}
          <span className="text-sm font-normal text-white/60">({members.length})</span>
        </h1>
        <p className="text-sm text-muted-foreground">Members on this package</p>
      </div>

      <div className="flex items-center gap-3">
        <Input
          placeholder="Search by name or email"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-72"
        />
        <Button type="button" variant="outline" onClick={() => {
          const url = `/api/admin/export/plan-members?key=${encodeURIComponent(planKey)}&format=xlsx`
          if (typeof window !== 'undefined') window.location.href = url
        }}>Export Excel</Button>
        <Button type="button" variant="outline" onClick={() => {
          const url = `/api/admin/export/plan-members?key=${encodeURIComponent(planKey)}&format=csv`
          if (typeof window !== 'undefined') window.location.href = url
        }}>Export CSV</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-white text-base">Member list</CardTitle>
          <CardDescription className="text-white/70">Total: {members.length}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-white/70">Loading…</div>
          ) : error ? (
            <div className="p-6 text-red-300">{error}</div>
          ) : filtered.length === 0 ? (
            <div className="p-6 text-white/70">No members found</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-white/5 border-b border-white/10">
                  <tr>
                    <th className="text-left p-4 font-medium text-white border-r border-white/10">Name</th>
                    <th className="text-left p-4 font-medium text-white border-r border-white/10">Email</th>
                    <th className="text-left p-4 font-medium text-white border-r border-white/10">Status</th>
                    <th className="text-left p-4 font-medium text-white border-r border-white/10">Joined</th>
                    <th className="text-left p-4 font-medium text-white border-r border-white/10">Next Billing</th>
                    <th className="text-left p-4 font-medium text-white">Last Paid</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(m => (
                    <tr key={m.id} className="border-b border-white/10">
                      <td className="p-4 border-r border-white/5">{m.name}</td>
                      <td className="p-4 border-r border-white/5">{m.email}</td>
                      <td className="p-4 border-r border-white/5">{m.status}</td>
                      <td className="p-4 border-r border-white/5">{new Date(m.joinedAt).toLocaleDateString()}</td>
                      <td className="p-4 border-r border-white/5">{m.nextBilling ? new Date(m.nextBilling).toLocaleDateString() : 'N/A'}</td>
                      <td className="p-4">{m.lastPaidAt ? new Date(m.lastPaidAt).toLocaleDateString() : 'N/A'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}


