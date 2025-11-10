"use client"
import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'

export default function AdminFamilyCreatePage() {
  const [parentEmail, setParentEmail] = useState('')
  const [childFirstName, setChildFirstName] = useState('')
  const [childLastName, setChildLastName] = useState('')
  const [planKey, setPlanKey] = useState('KIDS_UNLIMITED_UNDER14')
  const [account, setAccount] = useState<'SU'|'IQ'>('IQ')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string|undefined>()

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setMsg(undefined)
    try {
      const res = await fetch('/api/admin/family/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentEmail, childFirstName, childLastName, planKey, account })
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error || 'Failed')
      setMsg(`Created child user ${json.childUserId}, subscription ${json.stripeSubscriptionId}`)
    } catch (e:any) {
      setMsg(`Error: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="max-w-2xl m-6">
      <CardHeader>
        <CardTitle>Add family member (admin)</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <label className="block text-sm mb-1">Parent email</label>
            <Input value={parentEmail} onChange={e=>setParentEmail(e.target.value)} placeholder="parent@example.com" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Child first name</label>
              <Input value={childFirstName} onChange={e=>setChildFirstName(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm mb-1">Child last name</label>
              <Input value={childLastName} onChange={e=>setChildLastName(e.target.value)} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm mb-1">Plan</label>
              <select className="border rounded p-2 w-full" value={planKey} onChange={e=>setPlanKey(e.target.value)}>
                <option value="KIDS_UNLIMITED_UNDER14">Kids Unlimited (Under 14s)</option>
                <option value="KIDS_WEEKEND_UNDER14">Kids Weekend (Under 14s)</option>
                <option value="FULL_ADULT">Full Adult</option>
                <option value="WEEKEND_ADULT">Weekend Adult</option>
                <option value="WOMENS_CLASSES">Women’s Classes</option>
              </select>
            </div>
            <div>
              <label className="block text-sm mb-1">Stripe account</label>
              <select className="border rounded p-2 w-full" value={account} onChange={e=>setAccount(e.target.value as any)}>
                <option value="SU">Sporting U</option>
                <option value="IQ">IQ Learning Centre</option>
              </select>
            </div>
          </div>
          <div className="pt-3">
            <Button type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create family member'}</Button>
          </div>
          {msg && <div className="text-sm mt-2">{msg}</div>}
        </form>
      </CardContent>
    </Card>
  )
}


