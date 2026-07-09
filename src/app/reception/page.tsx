'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn, signOut } from 'next-auth/react'

type Member = {
  id: string; name: string; photo: string | null; pin: string
  plan: string | null; price: number; status: string
  lastVisit: string | null; checkedInToday: string | null
}
type Entry = { time: string; name: string; photo: string | null; status: string }

const STATUS_META: Record<string, { label: string; sub: string; cls: string; dot: string }> = {
  ACTIVE:    { label: 'ACTIVE',        sub: 'Good to go',                        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' },
  TRIALING:  { label: 'ACTIVE',        sub: 'Good to go',                        cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40', dot: 'bg-emerald-400' },
  PAST_DUE:  { label: 'PAYMENT DUE',   sub: 'Let in — mention the failed payment', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/40',     dot: 'bg-amber-400' },
  PAUSED:    { label: 'PAUSED',        sub: 'Membership is paused',              cls: 'bg-slate-500/15 text-slate-300 border-slate-500/40',       dot: 'bg-slate-400' },
  CANCELLED: { label: 'CANCELLED',     sub: 'No active membership',              cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400' },
  NONE:      { label: 'NO MEMBERSHIP', sub: 'No membership on file',             cls: 'bg-rose-500/15 text-rose-300 border-rose-500/40',          dot: 'bg-rose-400' },
}
const meta = (s: string) => STATUS_META[s] || STATUS_META.NONE
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const planLabel = (p: string | null) => (p || 'Unknown plan').replace(/^MIG_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

export default function ReceptionPage() {
  const [authed, setAuthed] = useState<null | boolean>(null)
  const [tab, setTab] = useState<'checkin' | 'today'>('checkin')

  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      const role = s?.user?.role
      setAuthed(!!role && ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'].includes(role))
    }).catch(() => setAuthed(false))
  }, [])

  if (authed === null) return <Shell><div className="text-white/40 text-lg mt-40">Loading…</div></Shell>
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <Shell>
      <header className="w-full max-w-3xl flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-gradient-to-br from-emerald-400 to-cyan-500 grid place-items-center font-black text-slate-950">T</div>
          <div>
            <h1 className="text-white font-semibold text-lg leading-none tracking-tight">Tracker365</h1>
            <p className="text-white/35 text-xs mt-1">Aura reception</p>
          </div>
        </div>
        <nav className="flex items-center gap-1 bg-white/5 border border-white/10 rounded-full p-1">
          {(['checkin', 'today'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-2 rounded-full text-sm font-medium transition ${tab === t ? 'bg-white text-slate-950' : 'text-white/60 hover:text-white'}`}>
              {t === 'checkin' ? 'Check in' : 'Today'}
            </button>
          ))}
        </nav>
        <button onClick={() => signOut({ callbackUrl: '/reception' })} className="text-white/30 hover:text-white/70 text-sm transition">Sign out</button>
      </header>
      {tab === 'checkin' ? <CheckIn /> : <Today />}
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-slate-950 bg-[radial-gradient(80%_60%_at_50%_-10%,rgba(16,185,129,0.10),transparent)] flex flex-col items-center px-6 py-8">
      {children}
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
    if (res?.ok) onDone(); else setErr('Wrong login — try again')
  }
  return (
    <Shell>
      <form onSubmit={submit} className="mt-32 w-full max-w-sm bg-white/[0.04] border border-white/10 rounded-3xl p-8 backdrop-blur">
        <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-400 to-cyan-500 grid place-items-center font-black text-xl text-slate-950 mb-5">T</div>
        <h1 className="text-white text-2xl font-semibold tracking-tight">Tracker365</h1>
        <p className="text-white/40 text-sm mt-1 mb-6">Reception check-in</p>
        <input value={u} onChange={e => setU(e.target.value)} placeholder="Username" autoFocus
          className="w-full mb-3 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-emerald-400/60" />
        <input value={p} onChange={e => setP(e.target.value)} placeholder="Password" type="password"
          className="w-full mb-4 px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 outline-none focus:border-emerald-400/60" />
        {err && <p className="text-rose-400 text-sm mb-3">{err}</p>}
        <button disabled={busy} className="w-full py-3 rounded-xl bg-emerald-400 text-slate-950 font-semibold hover:bg-emerald-300 transition disabled:opacity-50">
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </Shell>
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

  // physical keyboard: digits + backspace, when not typing in search
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
    <div className="w-full max-w-3xl flex flex-col items-center">
      {!member && !confirmed && (
        <>
          {/* PIN dots */}
          <div className="flex gap-4 my-8">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`h-16 w-14 rounded-2xl border grid place-items-center text-3xl font-bold transition-all
                ${pin[i] ? 'border-emerald-400/60 bg-emerald-400/10 text-white scale-105' : 'border-white/10 bg-white/[0.03] text-white/20'}`}>
                {pin[i] ? '•' : ''}
              </div>
            ))}
          </div>
          {notFound && <p className="text-rose-400 mb-4 -mt-4 text-sm">No member with that PIN — try again or search by name</p>}
          {/* keypad */}
          <div className="grid grid-cols-3 gap-3 w-full max-w-xs">
            {['1','2','3','4','5','6','7','8','9','clear','0','del'].map(k => (
              <button key={k}
                onClick={() => { if (k === 'clear') reset(); else if (k === 'del') setPin(p => p.slice(0, -1)); else if (pin.length < 4) setPin(p => p + k) }}
                className={`h-16 rounded-2xl text-xl font-semibold transition active:scale-95
                  ${/^\d$/.test(k) ? 'bg-white/[0.06] border border-white/10 text-white hover:bg-white/10' : 'bg-transparent text-white/40 hover:text-white text-sm'}`}>
                {k === 'del' ? '⌫' : k === 'clear' ? 'Clear' : k}
              </button>
            ))}
          </div>
          {/* name fallback */}
          <div className="w-full max-w-xs mt-8">
            <input ref={searchRef} value={search}
              onChange={e => setSearch(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && search.trim().length >= 2) lookup({ name: search }) }}
              placeholder="Forgot PIN? Search name and press Enter"
              className="w-full px-4 py-3 rounded-xl bg-white/[0.04] border border-white/10 text-white text-sm placeholder:text-white/25 outline-none focus:border-emerald-400/50" />
          </div>
          {results.length > 1 && (
            <div className="w-full max-w-md mt-4 space-y-2">
              {results.map(m => (
                <button key={m.id} onClick={() => { setMember(m); setResults([]) }}
                  className="w-full flex items-center justify-between px-4 py-3 rounded-xl bg-white/[0.05] border border-white/10 hover:bg-white/10 transition text-left">
                  <span className="text-white">{m.name}</span>
                  <span className="text-white/40 text-sm">{planLabel(m.plan)} · <span className={meta(m.status).cls.split(' ')[1]}>{meta(m.status).label}</span></span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* member card */}
      {member && !confirmed && (
        <div className="w-full max-w-md mt-10 bg-white/[0.05] border border-white/10 rounded-3xl overflow-hidden backdrop-blur animate-in">
          <div className="p-7">
            <div className="flex items-center gap-4">
              <div className="h-16 w-16 rounded-2xl bg-white/10 grid place-items-center text-2xl font-bold text-white/60 overflow-hidden">
                {member.photo ? <img src={member.photo} alt="" className="h-full w-full object-cover" /> : member.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div className="min-w-0">
                <h2 className="text-white text-2xl font-semibold tracking-tight truncate">{member.name}</h2>
                <p className="text-white/45 text-sm mt-0.5">{planLabel(member.plan)}{member.price ? ` · £${member.price}/mo` : ''}</p>
              </div>
            </div>
            <div className={`mt-5 flex items-center gap-3 px-4 py-3 rounded-2xl border ${meta(member.status).cls}`}>
              <span className={`h-2.5 w-2.5 rounded-full ${meta(member.status).dot} animate-pulse`} />
              <div>
                <p className="font-bold text-sm tracking-wide">{meta(member.status).label}</p>
                <p className="text-xs opacity-80">{meta(member.status).sub}</p>
              </div>
            </div>
            <div className="mt-4 flex gap-4 text-xs text-white/35">
              {member.checkedInToday && <span className="text-amber-300/80">Already checked in today at {fmtTime(member.checkedInToday)}</span>}
              {!member.checkedInToday && member.lastVisit && <span>Last visit {fmtDay(member.lastVisit)}, {fmtTime(member.lastVisit)}</span>}
              {!member.lastVisit && <span>First visit 🎉</span>}
            </div>
          </div>
          <div className="grid grid-cols-3 border-t border-white/10">
            <button onClick={reset} className="py-4 text-white/40 hover:text-white text-sm transition">Cancel</button>
            <button onClick={doCheckin} disabled={busy}
              className="col-span-2 py-4 bg-emerald-400 text-slate-950 font-bold text-lg hover:bg-emerald-300 transition disabled:opacity-60">
              {busy ? '…' : '✓ Check in'}
            </button>
          </div>
        </div>
      )}

      {/* confirmation */}
      {confirmed && member && (
        <div className="mt-20 flex flex-col items-center animate-in">
          <div className="h-24 w-24 rounded-full bg-emerald-400 grid place-items-center text-5xl text-slate-950 shadow-[0_0_60px_rgba(52,211,153,0.5)]">✓</div>
          <h2 className="text-white text-3xl font-semibold mt-6 tracking-tight">{member.name}</h2>
          <p className="text-emerald-300 mt-2">Checked in · {fmtTime(confirmed)}</p>
        </div>
      )}
      <style jsx>{`.animate-in{animation:pop .25s ease-out}@keyframes pop{from{opacity:0;transform:scale(.96) translateY(8px)}to{opacity:1;transform:none}}`}</style>
    </div>
  )
}

function Today() {
  const [date, setDate] = useState(() => new Date().toLocaleDateString('sv-SE'))
  const [data, setData] = useState<{ count: number; entries: Entry[] } | null>(null)
  const [windowH, setWindowH] = useState<number | null>(null) // null = all day
  const load = useCallback(() => {
    fetch(`/api/reception/attendance?date=${date}`).then(r => r.json()).then(setData).catch(() => {})
  }, [date])
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t) }, [load])
  const today = date === new Date().toLocaleDateString('sv-SE')
  const cutoff = windowH ? Date.now() - windowH * 3600_000 : null
  const shown = (data?.entries || []).filter(e => !cutoff || new Date(e.time).getTime() >= cutoff)
  return (
    <div className="w-full max-w-2xl">
      <div className="flex items-end justify-between mb-4">
        <div>
          <p className="text-white/40 text-sm">{windowH ? `Checked in · last ${windowH}h` : today ? 'Checked in today' : `Attendance · ${date}`}</p>
          <p className="text-white text-5xl font-bold tracking-tight mt-1">{data ? shown.length : '—'}</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-white/[0.05] border border-white/10 rounded-xl px-3 py-2 text-white text-sm outline-none [color-scheme:dark]" />
      </div>
      <div className="flex gap-1.5 mb-5">
        {([[1, 'Last hour'], [2, 'Last 2h'], [3, 'Last 3h'], [null, 'All day']] as const).map(([h, label]) => (
          <button key={label} onClick={() => setWindowH(h as number | null)} disabled={!today && h !== null}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium transition border ${windowH === h ? 'bg-white text-slate-950 border-white' : 'text-white/50 border-white/10 hover:text-white disabled:opacity-30'}`}>
            {label}
          </button>
        ))}
      </div>
      <div className="space-y-1.5">
        {shown.map((e, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3 rounded-xl bg-white/[0.04] border border-white/[0.06]">
            <span className="text-white/35 text-sm tabular-nums w-12">{fmtTime(e.time)}</span>
            <span className="text-white flex-1 truncate">{e.name}</span>
            <span className={`text-xs px-2 py-1 rounded-md border ${meta(e.status).cls}`}>{meta(e.status).label}</span>
          </div>
        ))}
        {data && shown.length === 0 && <p className="text-white/25 text-center py-16">No check-ins {windowH ? `in the last ${windowH}h` : today ? 'yet today' : 'on this day'}</p>}
      </div>
    </div>
  )
}
