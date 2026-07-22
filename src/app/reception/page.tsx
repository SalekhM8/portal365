'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn, signOut } from 'next-auth/react'

type Member = {
  id: string; name: string; photo: string | null; pin: string
  plan: string | null; price: number; status: string
  packageEnd?: string | null
  lastVisit: string | null; checkedInToday: string | null
}
type Entry = { time: string; name: string; photo: string | null; status: string }

const PILL: Record<string, { label: string; sub: string; cls: string; dot: string }> = {
  ACTIVE:    { label: 'Active',        sub: 'Good to go',                           cls: 'bg-green-100 text-green-800',   dot: 'bg-green-600' },
  TRIALING:  { label: 'Active',        sub: 'Good to go',                           cls: 'bg-green-100 text-green-800',   dot: 'bg-green-600' },
  PAST_DUE:  { label: 'Payment due',   sub: 'Let in — mention the failed payment',  cls: 'bg-amber-100 text-amber-800',   dot: 'bg-amber-500' },
  PAUSED:    { label: 'Paused',        sub: 'Membership is paused',                 cls: 'bg-zinc-200 text-zinc-700',     dot: 'bg-zinc-500' },
  CANCELLED: { label: 'Cancelled',     sub: 'No active membership',                 cls: 'bg-red-100 text-red-800',       dot: 'bg-red-600' },
  EXPIRED:   { label: 'Package ended', sub: 'Package term is over — renew at the desk', cls: 'bg-red-100 text-red-800',   dot: 'bg-red-600' },
  NONE:      { label: 'No membership', sub: 'Nothing on file',                      cls: 'bg-red-100 text-red-800',       dot: 'bg-red-600' },
}
const pill = (s: string) => PILL[s] || PILL.NONE
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const planLabel = (p: string | null) => (p || 'Unknown plan').replace(/^MIG_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())
const initials = (name: string) => name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()

function StatusPill({ status }: { status: string }) {
  const p = pill(status)
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${p.cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${p.dot}`} />{p.label}
    </span>
  )
}

function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/auralogo.png" alt="Aura" className="h-8 w-auto object-contain" />
}

export default function ReceptionPage() {
  const [authed, setAuthed] = useState<null | boolean>(null)
  const [tab, setTab] = useState<'checkin' | 'today'>('checkin')

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      const role = s?.user?.role
      setAuthed(!!role && ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'].includes(role))
    }).catch(() => setAuthed(false))
  }, [])

  if (authed === null) return <main className="min-h-screen bg-[#F7F7F8]" />
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <main className="min-h-screen bg-[#F7F7F8] text-zinc-900 flex flex-col items-center px-6 py-5">
      <header className="w-full max-w-2xl flex items-center justify-between mb-10">
        <div className="flex items-center gap-3">
          <Logo />
          <div className="leading-tight">
            <p className="font-semibold tracking-tight">Tracker</p>
            <p className="text-xs text-zinc-500">Reception</p>
          </div>
        </div>
        <div className="flex items-center rounded-xl bg-zinc-200/70 p-1">
          {(['checkin', 'today'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-4 py-1.5 rounded-lg text-sm font-medium transition ${tab === t ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}>
              {t === 'checkin' ? 'Check in' : 'Today'}
            </button>
          ))}
        </div>
        <button onClick={() => signOut({ callbackUrl: '/reception' })} className="text-sm text-zinc-400 hover:text-zinc-700 transition">Sign out</button>
      </header>
      {tab === 'checkin' ? <CheckIn /> : <Today />}
    </main>
  )
}

function Login({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState('')
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setErr('')
    const email = u.includes('@') ? u.trim() : `${u.trim()}@portal365.local`
    const res = await signIn('credentials', { email, password: p, redirect: false })
    setBusy(false)
    if (res?.ok) onDone(); else setErr('That login didn’t work — check the username and password.')
  }
  return (
    <main className="min-h-screen bg-[#F7F7F8] flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white border border-zinc-200 rounded-2xl shadow-sm p-8">
        <Logo />
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 mt-6">Tracker</h1>
        <p className="text-sm text-zinc-500 mt-1 mb-7">Sign in to the reception desk</p>
        <label className="block text-sm font-medium text-zinc-700 mb-1.5">Username</label>
        <input value={u} onChange={e => setU(e.target.value)} autoFocus
          className="w-full mb-4 h-12 px-3.5 rounded-xl border border-zinc-300 text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 transition" />
        <label className="block text-sm font-medium text-zinc-700 mb-1.5">Password</label>
        <input value={p} onChange={e => setP(e.target.value)} type="password"
          className="w-full mb-5 h-12 px-3.5 rounded-xl border border-zinc-300 text-zinc-900 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 transition" />
        {err && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mb-4">{err}</p>}
        <button disabled={busy} className="w-full h-12 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 active:scale-[0.99] transition disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}

function CheckIn() {
  const [pin, setPin] = useState('')
  const [member, setMember] = useState<Member | null>(null)
  const [results, setResults] = useState<Member[]>([])
  const [notFound, setNotFound] = useState(false)
  const [confirmed, setConfirmed] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setPin(''); setMember(null); setResults([]); setNotFound(false); setConfirmed(null); setSearch('')
  }, [])

  const lookup = useCallback(async (body: any) => {
    setBusy(true); setNotFound(false)
    const r = await fetch('/api/reception/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json(); setBusy(false)
    const ms: Member[] = j.members || []
    if (ms.length === 1) { setMember(ms[0]); setResults([]) }
    else if (ms.length > 1) { setResults(ms); setMember(null) }
    else { setNotFound(true); setMember(null); setResults([]) }
  }, [])

  useEffect(() => { if (pin.length === 4) lookup({ pin }) }, [pin, lookup])

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (document.activeElement === searchRef.current) return
      if (confirmed) return
      if (/^[0-9]$/.test(e.key) && !member && pin.length < 4) setPin(p => (p + e.key).slice(0, 4))
      else if (e.key === 'Backspace') { if (member) reset(); else setPin(p => p.slice(0, -1)) }
      else if (e.key === 'Escape') reset()
      else if (e.key === 'Enter' && member) doCheckin()
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  })

  const doCheckin = async () => {
    if (!member || busy) return
    setBusy(true)
    const r = await fetch('/api/reception/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.id }) })
    const j = await r.json(); setBusy(false)
    if (j.success) {
      setConfirmed(j.checkedInAt)
      resetTimer.current && clearTimeout(resetTimer.current)
      resetTimer.current = setTimeout(reset, 2600)
    }
  }

  return (
    <div className="w-full max-w-2xl flex flex-col items-center">
      {!member && !confirmed && (
        <>
          <p className="text-sm text-zinc-500 mb-5">Ask the member for their 4-digit PIN</p>
          {/* PIN boxes */}
          <div className="flex gap-3 mb-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`h-16 w-14 rounded-xl border-2 bg-white grid place-items-center text-3xl font-semibold tabular-nums transition-colors ${pin[i] ? 'border-zinc-900 text-zinc-900' : 'border-zinc-200 text-zinc-300'}`}>
                {pin[i] || ''}
              </div>
            ))}
          </div>
          <div className="h-6 mb-2">
            {notFound && <p className="text-sm text-red-700">No member with that PIN — try again, or search by name below.</p>}
          </div>
          {/* keypad */}
          <div className="grid grid-cols-3 gap-2.5 w-full max-w-xs">
            {['1','2','3','4','5','6','7','8','9','clear','0','del'].map(k => (
              <button key={k}
                onClick={() => { if (k === 'clear') reset(); else if (k === 'del') setPin(p => p.slice(0, -1)); else if (pin.length < 4) setPin(p => p + k) }}
                className={`h-16 rounded-2xl transition active:scale-[0.96] ${/^\d$/.test(k)
                  ? 'bg-white border border-zinc-200 shadow-sm text-2xl font-medium text-zinc-900 hover:border-zinc-300'
                  : 'text-sm font-medium text-zinc-400 hover:text-zinc-700'}`}>
                {k === 'del' ? '⌫' : k === 'clear' ? 'Clear' : k}
              </button>
            ))}
          </div>
          {/* name fallback */}
          <div className="w-full max-w-xs mt-8">
            <input ref={searchRef} value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && search.trim().length >= 2) lookup({ name: search }) }}
              placeholder="Forgot PIN? Search name, then press Enter"
              className="w-full h-11 px-3.5 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-900 placeholder:text-zinc-400 outline-none focus:border-zinc-900 focus:ring-2 focus:ring-zinc-900/10 transition" />
          </div>
          {results.length > 1 && (
            <div className="w-full max-w-md mt-4 bg-white border border-zinc-200 rounded-2xl shadow-sm divide-y divide-zinc-100 overflow-hidden">
              {results.map(m => (
                <button key={m.id} onClick={() => { setMember(m); setResults([]) }}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-zinc-50 transition text-left">
                  <span className="h-9 w-9 rounded-full bg-zinc-100 grid place-items-center text-xs font-semibold text-zinc-600 shrink-0">{initials(m.name)}</span>
                  <span className="flex-1 min-w-0">
                    <span className="block font-medium text-zinc-900 truncate">{m.name}</span>
                    <span className="block text-xs text-zinc-500">PIN {m.pin} · {planLabel(m.plan)}</span>
                  </span>
                  <StatusPill status={m.status} />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* member card */}
      {member && !confirmed && (
        <div className="w-full max-w-md mt-4 bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden animate-in">
          <div className="p-6">
            <div className="flex items-center gap-4">
              <div className="h-14 w-14 rounded-full bg-zinc-100 grid place-items-center text-lg font-semibold text-zinc-600 overflow-hidden shrink-0">
                {member.photo ? <img src={member.photo} alt="" className="h-full w-full object-cover" /> : initials(member.name)}
              </div>
              <div className="min-w-0 flex-1">
                <h2 className="text-xl font-semibold tracking-tight text-zinc-900 truncate">{member.name}</h2>
                <p className="text-sm text-zinc-500 mt-0.5">{planLabel(member.plan)}{member.packageEnd ? ` · ends ${fmtDay(member.packageEnd)}` : (member.price ? ` · £${member.price}/mo` : '')} · PIN {member.pin}</p>
              </div>
              <StatusPill status={member.status} />
            </div>
            <div className="mt-4 rounded-xl bg-zinc-50 border border-zinc-100 px-4 py-3 flex items-center justify-between">
              <p className="text-sm text-zinc-600">{pill(member.status).sub}</p>
              <p className="text-xs text-zinc-400">
                {member.checkedInToday ? `Already in today · ${fmtTime(member.checkedInToday)}`
                  : member.lastVisit ? `Last visit ${fmtDay(member.lastVisit)}` : 'First visit'}
              </p>
            </div>
          </div>
          <div className="px-6 pb-6 flex gap-3">
            <button onClick={reset} className="h-12 px-5 rounded-xl border border-zinc-200 text-sm font-medium text-zinc-600 hover:bg-zinc-50 transition">Cancel</button>
            <button onClick={doCheckin} disabled={busy}
              className="h-12 flex-1 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 active:scale-[0.99] transition disabled:opacity-60">
              {busy ? 'Checking in…' : 'Check in'}
            </button>
          </div>
        </div>
      )}

      {/* confirmation */}
      {confirmed && member && (
        <div className="mt-20 flex flex-col items-center animate-in">
          <div className="h-20 w-20 rounded-full bg-green-100 grid place-items-center">
            <svg className="h-10 w-10 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 mt-5">You're in, {member.name.split(' ')[0]}</h2>
          <p className="text-sm text-zinc-500 mt-1">Checked in at {fmtTime(confirmed)}</p>
        </div>
      )}
      <style jsx>{`.animate-in{animation:rise .22s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){.animate-in{animation:none}}`}</style>
    </div>
  )
}

function Today() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [data, setData] = useState<{ count: number; entries: Entry[] } | null>(null)
  const [windowH, setWindowH] = useState<number | null>(null)
  const load = useCallback(() => {
    fetch(`/api/reception/attendance?date=${date}`).then(r => r.json()).then(setData).catch(() => {})
  }, [date])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  const today = date === new Date().toLocaleDateString('sv-SE')
  const cutoff = windowH ? Date.now() - windowH * 3600_000 : null
  const shown = (data?.entries || []).filter(e => !cutoff || new Date(e.time).getTime() >= cutoff)
  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-end justify-between">
        <div>
          <p className="text-sm text-zinc-500">{windowH ? `Checked in — last ${windowH}h` : today ? 'Checked in today' : `Attendance · ${date}`}</p>
          <p className="text-6xl font-semibold tracking-tight tabular-nums mt-1">{data ? shown.length : '—'}</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="h-10 px-3 rounded-xl border border-zinc-200 bg-white text-sm text-zinc-700 outline-none focus:border-zinc-900" />
      </div>
      <div className="inline-flex items-center rounded-xl bg-zinc-200/70 p-1 mt-5 mb-5">
        {([[1, 'Last hour'], [2, '2h'], [3, '3h'], [null, 'All day']] as const).map(([h, label]) => (
          <button key={label} onClick={() => setWindowH(h as number | null)} disabled={!today && h !== null}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition ${windowH === h ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-500 hover:text-zinc-800 disabled:opacity-30'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm divide-y divide-zinc-100 overflow-hidden">
        {shown.map((e, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <span className="h-9 w-9 rounded-full bg-zinc-100 grid place-items-center text-xs font-semibold text-zinc-600 shrink-0">{initials(e.name)}</span>
            <span className="flex-1 font-medium text-zinc-900 truncate">{e.name}</span>
            <StatusPill status={e.status} />
            <span className="text-sm text-zinc-400 tabular-nums w-12 text-right">{fmtTime(e.time)}</span>
          </div>
        ))}
        {data && shown.length === 0 && <p className="text-sm text-zinc-400 text-center py-14">No check-ins {windowH ? `in the last ${windowH}h` : today ? 'yet today' : 'on this day'}.</p>}
      </div>
    </div>
  )
}
