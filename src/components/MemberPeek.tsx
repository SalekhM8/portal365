'use client'

import { useEffect, useState } from 'react'
import PhotoCapture from '@/components/PhotoCapture'

type Peek = {
  id: string; name: string; photo: string | null; pin: string | null
  plan: string | null; status: string; packageEnd: string | null
  phone: string | null; email: string | null; dateOfBirth: string | null
  address: string | null; postcode: string | null
  emergency: { name: string; phone: string | null; relationship: string | null } | null
}
const planLabel = (p: string | null) => (p || '—').replace(/^MIG_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
const pillCls = (s: string) =>
  s === 'ACTIVE' || s === 'TRIALING' ? 'bg-green-100 text-green-800'
  : s === 'PAST_DUE' ? 'bg-amber-100 text-amber-800'
  : s === 'PAUSED' ? 'bg-zinc-200 text-zinc-700' : 'bg-red-100 text-red-800'

/** Click-through member panel for check-in lists (reception Today + wall screen). */
export default function MemberPeek({ userId, onClose }: { userId: string; onClose: () => void }) {
  const [m, setM] = useState<Peek | null>(null)
  const [err, setErr] = useState('')
  const [camera, setCamera] = useState(false)

  useEffect(() => {
    fetch(`/api/reception/member?userId=${userId}`).then(r => r.json())
      .then(j => j.member ? setM(j.member) : setErr(j.error || 'Not found'))
      .catch(() => setErr('Failed to load'))
  }, [userId])

  const deletePhoto = async () => {
    if (!m?.photo || !confirm('Delete this photo?')) return
    const r = await fetch('/api/reception/photo', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId }) })
    if (r.ok) setM(p => p ? { ...p, photo: null } : p)
  }

  return (
    <div className="fixed inset-0 z-[70] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 text-zinc-900" onClick={e => e.stopPropagation()}>
        {err && <p className="text-sm text-red-700">{err}</p>}
        {!m && !err && <p className="text-sm text-zinc-400 py-8 text-center">Loading…</p>}
        {m && (
          <>
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-full bg-zinc-100 grid place-items-center text-lg font-semibold text-zinc-500 overflow-hidden shrink-0">
                {m.photo ? <img src={m.photo} alt="" className="h-full w-full object-cover" /> : m.name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="text-lg font-semibold tracking-tight truncate">{m.name}</h3>
                <p className="text-sm text-zinc-500">{planLabel(m.plan)}{m.packageEnd ? ` · ends ${m.packageEnd}` : ''}</p>
              </div>
              <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${pillCls(m.status)}`}>{m.status.replace('_', ' ')}</span>
            </div>
            <div className="flex gap-3 mt-3 mb-4">
              <button onClick={() => setCamera(true)} className="text-xs font-medium text-zinc-600 hover:text-zinc-900 underline">{m.photo ? 'Retake photo' : 'Add photo'}</button>
              {m.photo && <button onClick={deletePhoto} className="text-xs font-medium text-red-500 hover:text-red-700 underline">Delete photo</button>}
            </div>
            <div className="divide-y divide-zinc-100 text-sm">
              {[
                ['PIN', m.pin],
                ['Phone', m.phone],
                ['Email', m.email],
                ['Date of birth', m.dateOfBirth],
                ['Address', [m.address, m.postcode].filter(Boolean).join(', ') || null],
                ['Emergency', m.emergency ? `${m.emergency.name}${m.emergency.relationship ? ` (${m.emergency.relationship})` : ''}${m.emergency.phone ? ` · ${m.emergency.phone}` : ''}` : null],
              ].map(([label, value]) => (
                <div key={label as string} className="flex py-2 gap-3">
                  <span className="w-28 shrink-0 text-zinc-400">{label}</span>
                  <span className="text-zinc-800 break-words min-w-0">{value || '—'}</span>
                </div>
              ))}
            </div>
            <button onClick={onClose} className="mt-4 w-full h-10 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Close</button>
          </>
        )}
      </div>
      {camera && m && (
        <div onClick={e => e.stopPropagation()}>
          <PhotoCapture userId={m.id} name={m.name} onClose={() => setCamera(false)} onSaved={(d) => setM(p => p ? { ...p, photo: d } : p)} />
        </div>
      )}
    </div>
  )
}
