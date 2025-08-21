'use client'

import { useEffect, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Loader2, Users, PlusCircle, Crown, CheckCircle2 } from 'lucide-react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'

export default function FamilyPage() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [children, setChildren] = useState<any[]>([])

  // Add child form
  const [addOpen, setAddOpen] = useState(false)
  const [childFirst, setChildFirst] = useState('')
  const [childLast, setChildLast] = useState('')
  const [childDob, setChildDob] = useState('')
  const [childPlan, setChildPlan] = useState('KIDS_UNLIMITED_UNDER14')
  const [saving, setSaving] = useState(false)
  const [changingId, setChangingId] = useState<string | null>(null)
  const [newPlan, setNewPlan] = useState<string>('KIDS_UNLIMITED_UNDER14')

  useEffect(() => {
    if (status === 'loading') return
    if (!session) {
      router.push('/auth/signin')
      return
    }
    fetchChildren()
  }, [session, status])

  const fetchChildren = async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/customers/family')
      const data = await res.json()
      if (res.ok && data.success) {
        setChildren(data.children || [])
      } else {
        setError(data.error || 'Failed to load family')
      }
    } catch {
      setError('Network error')
    } finally {
      setLoading(false)
    }
  }

  const addChild = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch('/api/customers/family', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ firstName: childFirst, lastName: childLast, dateOfBirth: childDob, membershipType: childPlan })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        setAddOpen(false)
        setChildFirst('')
        setChildLast('')
        setChildDob('')
        setChildPlan('KIDS_UNLIMITED_UNDER14')
        await fetchChildren()
      } else {
        setError(data.error || 'Failed to add child')
      }
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  const activateChild = async (childId: string) => {
    if (!confirm('Activate this child membership using your saved payment method?')) return
    try {
      const res = await fetch('/api/customers/family/activate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ childId })
      })
      const data = await res.json()
      if (res.ok && data.success) {
        // If no PM exists, backend may still return a SetupIntent depending on payer state
        if (data.clientSecret) {
          // Redirect to payment methods to collect PM, then retry activate
          alert('Please add a payment method first, then retry activation.')
          window.location.href = '/dashboard/payment-methods'
          return
        }
        alert('Activation started. Complete any required payment authentication if prompted.')
        await fetchChildren()
      } else {
        alert('Activation failed: ' + (data.error || 'Unknown error'))
      }
    } catch {
      alert('Network error during activation')
    }
  }

  const changePlan = async (childId: string, plan: string) => {
    setChangingId(childId)
    try {
      const res = await fetch(`/api/customers/family/${childId}/change-plan`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newMembershipType: plan })
      })
      const data = await res.json()
      if (res.ok && data.success) await fetchChildren()
      else alert('Change plan failed: ' + (data.error || 'Unknown error'))
    } catch { alert('Network error during change plan') }
    finally { setChangingId(null) }
  }

  const pauseChild = async (childId: string) => {
    if (!confirm('Pause this child membership now?')) return
    const res = await fetch(`/api/customers/family/${childId}/pause`, { method: 'POST' })
    const data = await res.json()
    if (res.ok && data.success) await fetchChildren()
    else alert('Pause failed: ' + (data.error || 'Unknown error'))
  }

  const resumeChild = async (childId: string) => {
    if (!confirm('Resume this child membership now?')) return
    const res = await fetch(`/api/customers/family/${childId}/resume`, { method: 'POST' })
    const data = await res.json()
    if (res.ok && data.success) await fetchChildren()
    else alert('Resume failed: ' + (data.error || 'Unknown error'))
  }

  const cancelChild = async (childId: string, type: 'immediate' | 'end_of_period') => {
    const msg = type === 'immediate' ? 'Cancel immediately? This cannot be undone.' : 'Schedule cancellation at period end?'
    if (!confirm(msg)) return
    const res = await fetch(`/api/customers/family/${childId}/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cancelationType: type }) })
    const data = await res.json()
    if (res.ok && data.success) await fetchChildren()
    else alert('Cancel failed: ' + (data.error || 'Unknown error'))
  }

  if (loading) {
    return (
      <div className="container mx-auto p-6 max-w-4xl">
        <div className="text-center">
          <Loader2 className="h-8 w-8 animate-spin mx-auto" />
          <p className="mt-2 text-muted-foreground">Loading family...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto p-6 max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <Users className="h-5 w-5" />
        <h1 className="text-2xl font-bold">Family Memberships</h1>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Dependents</CardTitle>
              <CardDescription>Manage your children’s memberships</CardDescription>
            </div>
            <Button onClick={() => setAddOpen(!addOpen)} variant="outline">
              <PlusCircle className="h-4 w-4 mr-2" /> Add Child
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {addOpen && (
            <div className="border p-4 rounded-lg mb-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label>First Name</Label>
                  <Input value={childFirst} onChange={(e) => setChildFirst(e.target.value)} />
                </div>
                <div>
                  <Label>Last Name</Label>
                  <Input value={childLast} onChange={(e) => setChildLast(e.target.value)} />
                </div>
                <div>
                  <Label>Date of Birth</Label>
                  <Input type="date" value={childDob} onChange={(e) => setChildDob(e.target.value)} />
                </div>
                <div>
                  <Label>Plan</Label>
                  <Select value={childPlan} onValueChange={setChildPlan}>
                    <SelectTrigger>
                      <SelectValue placeholder="Select a plan" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="KIDS_UNLIMITED_UNDER14">{MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.displayName}</SelectItem>
                      <SelectItem value="KIDS_WEEKEND_UNDER14">{MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.displayName}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button onClick={addChild} disabled={saving}>{saving ? 'Saving...' : 'Add Child'}</Button>
              </div>
            </div>
          )}

          <div className="grid gap-3">
            {children.length === 0 ? (
              <p className="text-muted-foreground">No dependents yet.</p>
            ) : (
              children.map((c) => (
                <div key={c.childId} className="p-3 border rounded-lg space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold">{c.childName}</p>
                      <p className="text-sm text-muted-foreground">{c.membershipType} • Next billing {new Date(c.nextBilling).toLocaleDateString()}</p>
                    </div>
                    <div className="flex gap-2">
                      {c.status === 'PENDING_PAYMENT' ? (
                        <Button onClick={() => activateChild(c.childId)}>
                          <Crown className="h-4 w-4 mr-2" /> Activate
                        </Button>
                      ) : (
                        <Button variant="outline" disabled>
                          <CheckCircle2 className="h-4 w-4 mr-2" /> {c.status}
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Change plan */}
                  <div className="flex items-center gap-2">
                    <Select value={newPlan} onValueChange={setNewPlan}>
                      <SelectTrigger className="w-72">
                        <SelectValue placeholder="Select new plan" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="KIDS_UNLIMITED_UNDER14">{MEMBERSHIP_PLANS.KIDS_UNLIMITED_UNDER14.displayName}</SelectItem>
                        <SelectItem value="KIDS_WEEKEND_UNDER14">{MEMBERSHIP_PLANS.KIDS_WEEKEND_UNDER14.displayName}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button onClick={() => changePlan(c.childId, newPlan)} disabled={changingId === c.childId} variant="outline">
                      {changingId === c.childId ? 'Changing…' : 'Change Plan'}
                    </Button>
                  </div>

                  {/* Pause/Resume/Cancel */}
                  <div className="flex flex-wrap gap-2">
                    {c.status === 'ACTIVE' && (
                      <Button variant="outline" onClick={() => pauseChild(c.childId)}>Pause</Button>
                    )}
                    {c.status === 'PAUSED' && (
                      <Button variant="outline" onClick={() => resumeChild(c.childId)}>Resume</Button>
                    )}
                    {c.status !== 'CANCELLED' && (
                      <>
                        <Button variant="outline" onClick={() => cancelChild(c.childId, 'end_of_period')}>Cancel at Period End</Button>
                        <Button variant="outline" onClick={() => cancelChild(c.childId, 'immediate')} className="border-red-500/20 text-red-400 hover:bg-red-500/10">Cancel Now</Button>
                      </>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}


