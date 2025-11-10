'use client'

import { useEffect, useMemo, useState } from 'react'
import { loadStripe } from '@stripe/stripe-js'
import { Elements, PaymentElement, useStripe, useElements } from '@stripe/react-stripe-js'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { inferPlanKeyFromDescription, normalizePlanKey } from './planMap'

type Row = {
  mode: string
  stripeCustomerId: string
  email: string | null
  hasInvoiceDefault?: boolean
  hasAnyPm?: boolean
  suggestedPmId?: string | null
  suggestedPmBrand?: string | null
  suggestedPmLast4?: string | null
  lastChargeAmount: number | null
  lastChargeAt: number | null
  currency: string | null
  lastChargeDescription: string | null
  inferredNextBillISO: string | null
}

export default function IQMigrationPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [clientSecret, setClientSecret] = useState<string | null>(null)
  const [currentCustomer, setCurrentCustomer] = useState<string | null>(null)
  const [hostedLink, setHostedLink] = useState<string | null>(null)

  const iqPk = process.env.NEXT_PUBLIC_STRIPE_IQ_PUBLISHABLE_KEY as string
  const stripePromise = useMemo(() => (iqPk ? loadStripe(iqPk) : null), [iqPk])

  useEffect(() => {
    ;(async () => {
      try {
        setLoading(true)
        const res = await fetch('/api/admin/import-stripe-customers?account=IQ&limit=50', { cache: 'no-store' })
        const json = await res.json()
        if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to load preview')
        setRows(json.rows as Row[])
      } catch (e: any) {
        setError(e?.message || 'Failed to load')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  async function startPmUpdate(customerId: string) {
    try {
      setError(null)
      setHostedLink(null)
      setCurrentCustomer(customerId)
      const res = await fetch('/api/admin/payment-methods/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'IQ', stripeCustomerId: customerId })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to create setup intent')
      setClientSecret(json.clientSecret)
    } catch (e: any) {
      setError(e?.message || 'Failed to start PM update')
    }
  }

  async function copyPaymentLink(customerId: string) {
    try {
      setError(null)
      const res = await fetch('/api/admin/invoices/action-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'IQ', stripeCustomerId: customerId })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'No hosted link')
      setHostedLink(json.hostedInvoiceUrl)
      await navigator.clipboard.writeText(json.hostedInvoiceUrl)
    } catch (e: any) {
      setError(e?.message || 'Failed to fetch payment link')
    }
  }

  async function createCanary() {
    try {
      setError(null)
      const candidates = rows
        // Allow fallback: if next date is missing, backend will default to 1st of next month
        .filter(r => (r.hasAnyPm || r.suggestedPmId))
        .slice(0, 10)
        .map(r => {
          const plan = inferPlanKeyFromDescription(r.lastChargeDescription)
          const planKey = plan ? normalizePlanKey(plan.planKey) : 'FULL_ADULT'
          return {
            stripeCustomerId: r.stripeCustomerId,
            email: r.email,
            planKey,
            trialEndISO: r.inferredNextBillISO,
            suggestedPmId: r.suggestedPmId
          }
        })
      const res = await fetch('/api/admin/migrations/create-subscriptions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: candidates })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to create canary')
      alert('Canary created. Review results in console.'); console.log(json)
    } catch (e: any) {
      setError(e?.message || 'Failed to create canary')
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-bold">IQ Migration – Preview</h1>

      {loading && <p>Loading...</p>}
      {error && <p className="text-red-500">{error}</p>}

      {!loading && rows.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Members (first 50)</CardTitle>
              <Button onClick={createCanary}>Create subscriptions (canary 10)</Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {rows.map((r) => (
              <div key={r.stripeCustomerId} className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 border-b pb-3">
                <div className="text-sm">
                  <div className="font-medium">{r.email || r.stripeCustomerId}</div>
                  <div className="text-muted-foreground">
                    {r.lastChargeDescription || '—'} · {(r.lastChargeAmount ? `£${(r.lastChargeAmount/100).toFixed(2)}` : '£0.00')} · Next: {r.inferredNextBillISO ? new Date(r.inferredNextBillISO).toLocaleDateString('en-GB') : 'N/A'} · PM: {(r.hasAnyPm || r.suggestedPmId) ? `present${r.suggestedPmLast4 ? ` (will use ${r.suggestedPmBrand || ''} •••• ${r.suggestedPmLast4})` : ''}` : 'missing'}{r.hasInvoiceDefault ? '' : ' (no invoice default)'}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => copyPaymentLink(r.stripeCustomerId)}>Copy payment link</Button>
                  <Button onClick={() => startPmUpdate(r.stripeCustomerId)}>Update card</Button>
                </div>
              </div>
            ))}
            {hostedLink && (
              <div className="text-sm">Hosted link copied: <a className="underline" href={hostedLink} target="_blank" rel="noreferrer">open</a></div>
            )}
          </CardContent>
        </Card>
      )}

      {clientSecret && stripePromise && currentCustomer && (
        <Card>
          <CardHeader>
            <CardTitle>Enter new card for {currentCustomer}</CardTitle>
          </CardHeader>
          <CardContent>
            <Elements stripe={stripePromise} options={{ clientSecret }}>
              <PmForm customerId={currentCustomer} onDone={() => { setClientSecret(null); setCurrentCustomer(null) }} onError={setError} />
            </Elements>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function PmForm({ customerId, onDone, onError }: { customerId: string; onDone: () => void; onError: (s: string|null) => void }) {
  const stripe = useStripe()
  const elements = useElements()
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!stripe || !elements) return
    setSubmitting(true)
    try {
      const result = await stripe.confirmSetup({ elements, redirect: 'if_required' })
      if (result.error) throw new Error(result.error.message || 'Setup failed')
      const setupIntentId = result.setupIntent?.id
      if (!setupIntentId) throw new Error('Missing setup intent id')
      const res = await fetch('/api/admin/payment-methods/finalize', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ account: 'IQ', setupIntentId, stripeCustomerId: customerId })
      })
      const json = await res.json()
      if (!res.ok || !json?.success) throw new Error(json?.error || 'Failed to finalize')
      onDone()
    } catch (e: any) {
      onError(e?.message || 'Failed to update card')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <PaymentElement />
      <Button type="submit" disabled={!stripe || submitting}>{submitting ? 'Saving…' : 'Save card'}</Button>
    </form>
  )
}


