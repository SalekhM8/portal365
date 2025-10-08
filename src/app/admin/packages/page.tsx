'use client'

import { useEffect, useState, Suspense } from 'react'
import { useRouter } from 'next/navigation'
import { getSession } from 'next-auth/react'
import { MEMBERSHIP_PLANS } from '@/config/memberships'
import { isPlansAdminEnabled } from '@/lib/flags'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ArrowLeft } from 'lucide-react'

function PackagesContent() {
  const router = useRouter()
  const [authorized, setAuthorized] = useState(false)
  const [authChecked, setAuthChecked] = useState(false)
  const [plans, setPlans] = useState<any[]>([])
  const [creating, setCreating] = useState(false)
  const [newPlan, setNewPlan] = useState({ key: '', name: '', displayName: '', description: '', monthlyPrice: '' })
  const [newWindows, setNewWindows] = useState<Array<{ days: string[]; start: string; end: string }>>([])
  const [newVisibility, setNewVisibility] = useState<string[]>([])
  const DAY_OPTIONS = ['mon','tue','wed','thu','fri','sat','sun']
  const [newFeatures, setNewFeatures] = useState<string[]>([])
  const [editingKey, setEditingKey] = useState<string | null>(null)
  const [editDraft, setEditDraft] = useState<any | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)

  useEffect(() => {
    // Lightweight RBAC gate: allow ADMIN or SUPER_ADMIN
    getSession().then((session: any) => {
      const role = session?.user?.role
      if (role === 'ADMIN' || role === 'SUPER_ADMIN') {
        setAuthorized(true)
      } else {
        router.replace('/auth/signin')
      }
      setAuthChecked(true)
    })
  }, [router])

  useEffect(() => {
    const load = async () => {
      if (!authorized) return
      if (isPlansAdminEnabled()) {
        try {
          const res = await fetch('/api/admin/plans', { cache: 'no-store' })
          const data = await res.json()
          if (data?.plans) {
            setPlans(data.plans)
            return
          }
        } catch {}
      }
      // Fallback to config: mark as active for display
      setPlans((Object.values(MEMBERSHIP_PLANS) as any[]).map(p => ({ ...p, active: true })))
    }
    load()
  }, [authorized])

  return (
    <div className="container mx-auto p-4 lg:p-6 space-y-6">
      {!authChecked ? (
        <div className="text-sm text-white/70">Checking permissions...</div>
      ) : null}
      <div className="space-y-1">
        <div>
          <Button variant="ghost" onClick={() => router.push('/admin')} className="mb-2">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Dashboard
          </Button>
        </div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">Package Management</h1>
        {!isPlansAdminEnabled() ? (
          <p className="text-sm lg:text-base text-muted-foreground">Read-only preview</p>
        ) : null}
      </div>

      {isPlansAdminEnabled() && (
        <Card className="bg-white/5 border-white/10">
          <CardHeader>
            <CardTitle className="text-white text-lg">Create New Plan</CardTitle>
            <CardDescription className="text-white/70">Minimal fields; price does not auto-migrate existing members</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            <div>
              <Label className="text-white/80">Key</Label>
              <Input value={newPlan.key} onChange={e => setNewPlan(p => ({ ...p, key: e.target.value }))} className="bg-white/5 border-white/10 text-white" placeholder="FULL_ADULT" />
            </div>
            <div>
              <Label className="text-white/80">Monthly Price (£)</Label>
              <Input type="number" step="0.01" value={newPlan.monthlyPrice} onChange={e => setNewPlan(p => ({ ...p, monthlyPrice: e.target.value }))} className="bg-white/5 border-white/10 text-white" placeholder="75" />
            </div>
            <div>
              <Label className="text-white/80">Name</Label>
              <Input value={newPlan.name} onChange={e => setNewPlan(p => ({ ...p, name: e.target.value }))} className="bg-white/5 border-white/10 text-white" placeholder="Full Adult Access" />
            </div>
            <div>
              <Label className="text-white/80">Display Name</Label>
              <Input value={newPlan.displayName} onChange={e => setNewPlan(p => ({ ...p, displayName: e.target.value }))} className="bg-white/5 border-white/10 text-white" placeholder="Full Access" />
            </div>
            <div className="md:col-span-2">
              <Label className="text-white/80">Description</Label>
              <Input value={newPlan.description} onChange={e => setNewPlan(p => ({ ...p, description: e.target.value }))} className="bg-white/5 border-white/10 text-white" placeholder="Complete training freedom" />
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label className="text-white/80">Visibility</Label>
              <div className="flex gap-3 text-white/80 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newVisibility.includes('aura_mma')} onChange={e => setNewVisibility(v => e.target.checked ? Array.from(new Set([...v, 'aura_mma'])) : v.filter(x => x !== 'aura_mma'))} /> Aura MMA (men)
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={newVisibility.includes('aura_womens')} onChange={e => setNewVisibility(v => e.target.checked ? Array.from(new Set([...v, 'aura_womens'])) : v.filter(x => x !== 'aura_womens'))} /> Women’s Striking
                </label>
              </div>
            </div>
            <div className="md:col-span-2 space-y-3">
              <Label className="text-white/80">Training Windows</Label>
              <div className="flex flex-wrap gap-2 text-white/80 text-xs">
                <Button type="button" variant="outline" size="sm" onClick={() => setNewWindows([{ days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '24:00' }])}>Anytime</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNewWindows([{ days: ['sat','sun'], start: '00:00', end: '24:00' }])}>Weekends</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setNewWindows([{ days: ['mon','tue','wed','thu','fri'], start: '00:00', end: '24:00' }])}>Weekdays</Button>
              </div>
              <div className="space-y-2">
                {newWindows.map((w, idx) => (
                  <div key={idx} className="space-y-2">
                    <div className="flex flex-wrap gap-2">
                      {DAY_OPTIONS.map(d => {
                        const active = w.days.includes(d)
                        return (
                          <Button key={d} type="button" size="sm" variant={active ? 'default' : 'outline'} onClick={() => setNewWindows(arr => { const copy = [...arr]; const set = new Set(copy[idx].days); active ? set.delete(d) : set.add(d); copy[idx] = { ...copy[idx], days: Array.from(set) }; return copy })}>
                            {d.toUpperCase()}
                          </Button>
                        )
                      })}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Input placeholder="start HH:mm" value={w.start} onChange={e => setNewWindows(arr => { const copy = [...arr]; copy[idx] = { ...copy[idx], start: e.target.value }; return copy })} className="bg-white/5 border-white/10 text-white" />
                      <div className="flex gap-2">
                        <Input placeholder="end HH:mm" value={w.end} onChange={e => setNewWindows(arr => { const copy = [...arr]; copy[idx] = { ...copy[idx], end: e.target.value }; return copy })} className="bg-white/5 border-white/10 text-white" />
                        <Button type="button" size="sm" variant="outline" onClick={() => setNewWindows(arr => arr.filter((_,i) => i!==idx))}>Remove</Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
              <Button type="button" variant="outline" size="sm" onClick={() => setNewWindows(arr => [...arr, { days: ['mon'], start: '00:00', end: '24:00' }])}>Add Window</Button>
            </div>
            <div className="md:col-span-2 space-y-2">
              <Label className="text-white/80">Features</Label>
              <div className="space-y-2">
                {newFeatures.map((f, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input value={f} onChange={e => setNewFeatures(arr => { const copy = [...arr]; copy[idx] = e.target.value; return copy })} className="bg-white/5 border-white/10 text-white" placeholder="e.g., 7 days/week access" />
                    <Button type="button" size="sm" variant="outline" onClick={() => setNewFeatures(arr => arr.filter((_,i) => i!==idx))}>Remove</Button>
                  </div>
                ))}
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => setNewFeatures(arr => [...arr, ''])}>Add Feature</Button>
            </div>
            <div className="md:col-span-2 flex gap-2">
              <Button disabled={creating} onClick={async () => {
                try {
                  setCreating(true)
                  const res = await fetch('/api/admin/plans', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      key: newPlan.key.trim(),
                      name: newPlan.name.trim(),
                      displayName: newPlan.displayName.trim(),
                      description: newPlan.description.trim(),
                      monthlyPrice: Number(newPlan.monthlyPrice),
                      features: newFeatures.filter(Boolean),
                      schedulePolicy: { timezone: 'Europe/London', allowedWindows: (newWindows.length ? newWindows : [{ days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '24:00' }]) },
                      preferredEntities: newVisibility,
                      active: true
                    })
                  })
                  const data = await res.json()
                  if (data?.success) {
                    setPlans(prev => [...prev, { ...data.plan, monthlyPrice: Number(data.plan.monthlyPrice), features: newFeatures.filter(Boolean), schedulePolicy: { timezone: 'Europe/London', allowedWindows: (newWindows.length ? newWindows : [{ days: ['mon','tue','wed','thu','fri','sat','sun'], start: '00:00', end: '24:00' }]) }, preferredEntities: newVisibility }])
                    setNewPlan({ key: '', name: '', displayName: '', description: '', monthlyPrice: '' })
                    setNewWindows([])
                    setNewVisibility([])
                    setNewFeatures([])
                  }
                } finally {
                  setCreating(false)
                }
              }}>Create Plan</Button>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {plans.map((plan) => (
          <Card key={plan.key} className="bg-white/5 border-white/10">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="text-white">{plan.displayName}</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge className={`border-white/10 ${plan.active ? 'bg-green-500/20 text-green-200' : 'bg-white/10 text-white'}`}>{plan.active ? 'Active' : 'Archived'}</Badge>
                  <Badge className="bg-white/10 text-white border-white/10">£{plan.monthlyPrice}/mo</Badge>
                </div>
              </div>
              <CardDescription className="text-white/70">{plan.description}</CardDescription>
            </CardHeader>
            <CardContent className="text-sm text-white/80 space-y-3">
              {editingKey !== plan.key ? (
                <>
                  <div>
                    <div className="text-white/60 text-xs uppercase mb-1">Key</div>
                    <div className="font-mono text-xs">{plan.key}</div>
                  </div>
                  <div>
                    <div className="text-white/60 text-xs uppercase mb-1">Features</div>
                    <ul className="list-disc list-inside space-y-1">
                      {(Array.isArray(plan.features) ? plan.features : []).map((f: string, idx: number) => (
                        <li key={idx}>{f}</li>
                      ))}
                    </ul>
                  </div>
                    <div className="flex gap-2 pt-2">
                    {isPlansAdminEnabled() && (
                      <Button size="sm" variant="outline" onClick={() => {
                        setEditingKey(plan.key)
                        const windows = (plan?.schedulePolicy?.allowedWindows || [])
                        setEditDraft({
                          key: plan.key,
                          displayName: plan.displayName,
                          name: plan.name || plan.displayName,
                          description: plan.description || '',
                          monthlyPrice: String(plan.monthlyPrice),
                          active: !!plan.active,
                          windows: windows.map((w: any) => ({ days: (w.days || []).join(','), start: w.start, end: w.end })),
                          preferredEntities: Array.isArray(plan.preferredEntities) ? plan.preferredEntities : []
                        })
                      }}>Edit</Button>
                    )}
                    <Button size="sm" onClick={() => router.push(`/admin/packages/${encodeURIComponent(plan.key)}`)}>View details</Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="grid gap-3">
                    <div className="grid md:grid-cols-2 gap-3">
                      <div>
                        <Label className="text-white/80">Display Name</Label>
                        <Input value={editDraft.displayName} onChange={e => setEditDraft((d: any) => ({ ...d, displayName: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                      </div>
                      <div>
                        <Label className="text-white/80">Monthly Price (£)</Label>
                        <Input type="number" step="0.01" value={editDraft.monthlyPrice} onChange={e => setEditDraft((d: any) => ({ ...d, monthlyPrice: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                      </div>
                    </div>
                    <div>
                      <Label className="text-white/80">Features</Label>
                      <div className="space-y-2">
                        {(editDraft.features || []).map((f: string, idx: number) => (
                          <div key={idx} className="flex gap-2">
                            <Input value={f} onChange={e => setEditDraft((d: any) => { const arr = [...(d.features || [])]; arr[idx] = e.target.value; return { ...d, features: arr } })} className="bg-white/5 border-white/10 text-white" placeholder="Feature text" />
                            <Button size="sm" variant="outline" onClick={() => setEditDraft((d: any) => ({ ...d, features: (d.features || []).filter((_: any, i: number) => i !== idx) }))}>Remove</Button>
                          </div>
                        ))}
                        <Button size="sm" variant="outline" onClick={() => setEditDraft((d: any) => ({ ...d, features: [...(d.features || []), ''] }))}>Add Feature</Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-white/80">Description</Label>
                      <Input value={editDraft.description} onChange={e => setEditDraft((d: any) => ({ ...d, description: e.target.value }))} className="bg-white/5 border-white/10 text-white" />
                    </div>
                    <div>
                      <Label className="text-white/80">Allowed Windows (days,start,end)</Label>
                      <div className="space-y-2">
                        {editDraft.windows.map((w: any, idx: number) => (
                          <div key={idx} className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {DAY_OPTIONS.map(d => {
                                const have = Array.isArray(w.days) ? w.days.includes(d) : String(w.days || '').split(',').includes(d)
                                return (
                                  <Button key={d} size="sm" variant={have ? 'default' : 'outline'} onClick={() => setEditDraft((draft: any) => {
                                    const arr = [...draft.windows]
                                    const daysArr = Array.isArray(arr[idx].days) ? [...arr[idx].days] : String(arr[idx].days || '').split(',').filter(Boolean)
                                    const set = new Set(daysArr)
                                    have ? set.delete(d) : set.add(d)
                                    arr[idx] = { ...arr[idx], days: Array.from(set) }
                                    return { ...draft, windows: arr }
                                  })}>
                                    {d.toUpperCase()}
                                  </Button>
                                )
                              })}
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <Input placeholder="HH:mm" value={w.start} onChange={e => setEditDraft((d: any) => { const arr = [...d.windows]; arr[idx] = { ...arr[idx], start: e.target.value }; return { ...d, windows: arr } })} className="bg-white/5 border-white/10 text-white" />
                              <div className="flex gap-2">
                                <Input placeholder="HH:mm" value={w.end} onChange={e => setEditDraft((d: any) => { const arr = [...d.windows]; arr[idx] = { ...arr[idx], end: e.target.value }; return { ...d, windows: arr } })} className="bg-white/5 border-white/10 text-white" />
                                <Button size="sm" variant="outline" onClick={() => setEditDraft((d: any) => ({ ...d, windows: d.windows.filter((_: any, i: number) => i !== idx) }))}>Remove</Button>
                              </div>
                            </div>
                          </div>
                        ))}
                        <Button size="sm" variant="outline" onClick={() => setEditDraft((d: any) => ({ ...d, windows: [...d.windows, { days: 'mon', start: '00:00', end: '24:00' }] }))}>Add Window</Button>
                      </div>
                    </div>
                    <div>
                      <Label className="text-white/80">Visibility</Label>
                      <div className="flex gap-3 text-white/80 text-sm">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.preferredEntities.includes('aura_mma')} onChange={e => setEditDraft((d: any) => ({ ...d, preferredEntities: e.target.checked ? Array.from(new Set([...(d.preferredEntities||[]), 'aura_mma'])) : (d.preferredEntities||[]).filter((x: string) => x !== 'aura_mma') }))} /> Aura MMA</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={editDraft.preferredEntities.includes('aura_womens')} onChange={e => setEditDraft((d: any) => ({ ...d, preferredEntities: e.target.checked ? Array.from(new Set([...(d.preferredEntities||[]), 'aura_womens'])) : (d.preferredEntities||[]).filter((x: string) => x !== 'aura_womens') }))} /> Women’s Striking</label>
                      </div>
                    </div>
                    <div className="flex gap-2 pt-2">
                      <Button disabled={savingEdit} onClick={async () => {
                        try {
                          setSavingEdit(true)
                          const schedulePolicy = {
                            timezone: 'Europe/London',
                            allowedWindows: (editDraft.windows || []).map((w: any) => ({ days: String(w.days || '').split(',').map((s: string) => s.trim()).filter(Boolean), start: w.start, end: w.end }))
                          }
                          const res = await fetch('/api/admin/plans', {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ key: plan.key, update: {
                              displayName: editDraft.displayName,
                              description: editDraft.description,
                              monthlyPrice: Number(editDraft.monthlyPrice),
                              schedulePolicy,
                              preferredEntities: editDraft.preferredEntities,
                              features: (editDraft.features || []).filter((s: string) => !!s)
                            } })
                          })
                          const data = await res.json()
                          if (data?.success) {
                            setPlans(prev => prev.map(p => p.key === plan.key ? { ...p, displayName: editDraft.displayName, description: editDraft.description, monthlyPrice: Number(editDraft.monthlyPrice), schedulePolicy, preferredEntities: editDraft.preferredEntities, features: (editDraft.features || []).filter((s: string) => !!s) } : p))
                            setEditingKey(null)
                            setEditDraft(null)
                          }
                        } finally {
                          setSavingEdit(false)
                        }
                      }}>Save</Button>
                      <Button variant="outline" onClick={() => { setEditingKey(null); setEditDraft(null) }}>Cancel</Button>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}

export default function PackagesPage() {
  return (
    <Suspense fallback={<div className="container mx-auto p-4">Loading...</div>}>
      <PackagesContent />
    </Suspense>
  )
}


