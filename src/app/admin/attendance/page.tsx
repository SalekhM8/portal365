'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import MemberPeek from '@/components/MemberPeek'

type Entry = { userId?: string; time: string; name: string; status: string; plan?: string | null; outsidePlanDays?: string | null }
const planLabel = (p: string | null | undefined) => (p || '—').replace(/^MIG_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
const badge = (s: string) =>
  s === 'ACTIVE' || s === 'TRIALING' ? 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
  : s === 'PAST_DUE' ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
  : 'bg-slate-500/15 text-slate-400 border-slate-500/30'

export default function AdminAttendancePage() {
  const router = useRouter()
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [data, setData] = useState<{ count: number; entries: Entry[] } | null>(null)
  const [denied, setDenied] = useState(false)
  const [windowH, setWindowH] = useState<number | null>(null)
  const [peek, setPeek] = useState<string | null>(null)

  const load = useCallback(() => {
    fetch(`/api/reception/attendance?date=${date}`).then(async r => {
      if (r.status === 403 || r.status === 401) { setDenied(true); return }
      setData(await r.json())
    }).catch(() => {})
  }, [date])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])

  if (denied) return <main className="min-h-screen bg-black text-white/60 grid place-items-center">Admin access required</main>
  const today = date === new Date().toLocaleDateString('sv-SE')
  const cutoff = windowH ? Date.now() - windowH * 3600_000 : null
  const shown = (data?.entries || []).filter(e => !cutoff || new Date(e.time).getTime() >= cutoff)
  return (
    <main className="min-h-screen bg-black text-white px-6 py-8">
      <div className="max-w-3xl mx-auto">
        <button onClick={() => router.push('/admin')} className="text-white/40 hover:text-white text-sm mb-6">← Back to admin</button>
        <div className="flex items-end justify-between mb-4">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Attendance</h1>
            <p className="text-white/40 text-sm mt-1">{windowH ? `Last ${windowH}h` : today ? 'Today' : date} · <span className="text-white font-semibold">{data ? shown.length : '—'} checked in</span></p>
          </div>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="bg-white/5 border border-white/15 rounded-lg px-3 py-2 text-sm [color-scheme:dark]" />
        </div>
        <div className="flex gap-1.5 mb-5">
          {([[1, 'Last hour'], [2, 'Last 2h'], [3, 'Last 3h'], [null, 'All day']] as const).map(([h, label]) => (
            <button key={label} onClick={() => setWindowH(h as number | null)} disabled={!today && h !== null}
              className={`px-3 py-1 rounded-full text-xs border transition ${windowH === h ? 'bg-white text-black border-white' : 'text-white/50 border-white/15 hover:text-white disabled:opacity-30'}`}>
              {label}
            </button>
          ))}
        </div>
        <div className="space-y-1.5">
          {shown.map((e, i) => (
            <div key={i} onClick={() => e.userId && setPeek(e.userId)} className="flex items-center gap-4 px-4 py-3 rounded-lg bg-white/[0.04] border border-white/[0.07] cursor-pointer hover:bg-white/[0.07]">
              <span className="text-white/40 text-sm tabular-nums w-12">{new Date(e.time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}</span>
              <span className="flex-1 min-w-0">
                <span className="block truncate">{e.name}</span>
                {e.outsidePlanDays && <span className="text-[11px] text-red-300 bg-red-500/15 border border-red-500/30 rounded px-1.5 py-0.5">Not a plan day · {planLabel(e.plan)}</span>}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded border ${badge(e.status)}`}>{e.status}</span>
            </div>
          ))}
          {data && shown.length === 0 && <p className="text-white/25 text-center py-16">No check-ins {windowH ? `in the last ${windowH}h` : today ? 'yet today' : 'on this day'}</p>}
        </div>
      </div>
      {peek && <MemberPeek userId={peek} onClose={() => setPeek(null)} />}
    </main>
  )
}
