'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn, signOut } from 'next-auth/react'
import { Oswald } from 'next/font/google'

const oswald = Oswald({ subsets: ['latin'], weight: ['500', '600', '700'] })

type Member = {
  id: string; name: string; photo: string | null; pin: string
  plan: string | null; price: number; status: string
  lastVisit: string | null; checkedInToday: string | null
}
type Entry = { time: string; name: string; photo: string | null; status: string }

const STATUS_META: Record<string, { label: string; sub: string; bar: string; text: string }> = {
  ACTIVE:    { label: 'ACTIVE',        sub: 'GOOD TO GO',                          bar: 'bg-[#16a34a]', text: 'text-white' },
  TRIALING:  { label: 'ACTIVE',        sub: 'GOOD TO GO',                          bar: 'bg-[#16a34a]', text: 'text-white' },
  PAST_DUE:  { label: 'PAYMENT DUE',   sub: 'LET IN — MENTION THE FAILED PAYMENT', bar: 'bg-[#f59e0b]', text: 'text-black' },
  PAUSED:    { label: 'PAUSED',        sub: 'MEMBERSHIP PAUSED',                   bar: 'bg-neutral-400', text: 'text-black' },
  CANCELLED: { label: 'CANCELLED',     sub: 'NO ACTIVE MEMBERSHIP',                bar: 'bg-[#dc2626]', text: 'text-white' },
  NONE:      { label: 'NO MEMBERSHIP', sub: 'NOTHING ON FILE',                     bar: 'bg-[#dc2626]', text: 'text-white' },
}
const meta = (s: string) => STATUS_META[s] || STATUS_META.NONE
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const fmtDay = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
const planLabel = (p: string | null) => (p || 'Unknown plan').replace(/^MIG_/, '').replace(/_/g, ' ')

function AuraMark({ className = 'h-9' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/auralogo.png" alt="Aura" className={`${className} w-auto object-contain`} />
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

  if (authed === null) return <main className="min-h-screen bg-white" />
  if (!authed) return <Login onDone={() => setAuthed(true)} />
  return (
    <main className="min-h-screen bg-white flex flex-col items-center px-6 py-6 selection:bg-black selection:text-white">
      <header className="w-full max-w-3xl flex items-center justify-between border-b border-black/15 pb-5 mb-10">
        <div className="flex items-center gap-4">
          <AuraMark />
          <span className={`${oswald.className} text-black text-xl font-bold uppercase tracking-[0.18em]`}>Tracker</span>
        </div>
        <nav className="flex items-center gap-8">
          {(['checkin', 'today'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`${oswald.className} uppercase tracking-[0.14em] text-sm font-semibold pb-1 border-b-2 transition ${tab === t ? 'text-black border-black' : 'text-black/40 border-transparent hover:text-black'}`}>
              {t === 'checkin' ? 'Check in' : 'Today'}
            </button>
          ))}
          <button onClick={() => signOut({ callbackUrl: '/reception' })} className="text-black/30 hover:text-black text-xs uppercase tracking-widest transition">Sign out</button>
        </nav>
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
    if (res?.ok) onDone(); else setErr('WRONG LOGIN — TRY AGAIN')
  }
  return (
    <main className="min-h-screen bg-white flex items-center justify-center px-6">
      <form onSubmit={submit} className="w-full max-w-sm">
        <AuraMark className="h-12" />
        <h1 className={`${oswald.className} text-black text-4xl font-bold uppercase tracking-tight mt-8`}>Tracker</h1>
        <p className="text-black/40 text-xs uppercase tracking-[0.2em] mt-1 mb-10">Reception check-in</p>
        <input value={u} onChange={e => setU(e.target.value)} placeholder="USERNAME" autoFocus
          className="w-full mb-6 pb-3 bg-transparent border-b border-black/25 text-black text-lg placeholder:text-black/25 placeholder:text-sm placeholder:tracking-[0.2em] outline-none focus:border-black transition" />
        <input value={p} onChange={e => setP(e.target.value)} placeholder="PASSWORD" type="password"
          className="w-full mb-8 pb-3 bg-transparent border-b border-black/25 text-black text-lg placeholder:text-black/25 placeholder:text-sm placeholder:tracking-[0.2em] outline-none focus:border-black transition" />
        {err && <p className="text-[#dc2626] text-xs tracking-widest mb-4">{err}</p>}
        <button disabled={busy} className={`${oswald.className} w-full py-4 bg-black text-white font-bold uppercase tracking-[0.2em] hover:bg-neutral-800 transition disabled:opacity-50`}>
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
    <div className="w-full max-w-3xl flex flex-col items-center">
      {!member && !confirmed && (
        <>
          {/* PIN digits — flat underline slots */}
          <div className="flex gap-6 mt-6 mb-10">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`${oswald.className} h-20 w-16 flex items-end justify-center pb-2 border-b-4 text-6xl font-bold transition-colors ${pin[i] ? 'border-black text-black' : 'border-black/15 text-transparent'}`}>
                {pin[i] || '0'}
              </div>
            ))}
          </div>
          {notFound && <p className={`${oswald.className} text-[#dc2626] uppercase tracking-[0.15em] text-sm -mt-6 mb-6`}>No member with that PIN — search by name below</p>}
          {/* keypad — flat mono */}
          <div className="grid grid-cols-3 gap-px bg-black/15 border border-black/15 w-full max-w-xs">
            {['1','2','3','4','5','6','7','8','9','clear','0','del'].map(k => (
              <button key={k}
                onClick={() => { if (k === 'clear') reset(); else if (k === 'del') setPin(p => p.slice(0, -1)); else if (pin.length < 4) setPin(p => p + k) }}
                className={`${oswald.className} h-18 sm:h-20 bg-white text-black flex items-center justify-center transition active:bg-black active:text-white ${/^\d$/.test(k) ? 'text-3xl font-semibold hover:bg-neutral-100' : 'text-[11px] uppercase tracking-[0.2em] text-black/50 hover:text-black hover:bg-neutral-100'}`}>
                {k === 'del' ? '⌫' : k === 'clear' ? 'Clear' : k}
              </button>
            ))}
          </div>
          {/* name fallback */}
          <input ref={searchRef} value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && search.trim().length >= 2) lookup({ name: search }) }}
            placeholder="FORGOT PIN? TYPE NAME + ENTER"
            className="w-full max-w-xs mt-10 pb-3 bg-transparent border-b border-black/25 text-black text-base placeholder:text-black/25 placeholder:text-xs placeholder:tracking-[0.18em] outline-none focus:border-black transition" />
          {results.length > 1 && (
            <div className="w-full max-w-md mt-6 border-t border-black/15">
              {results.map(m => (
                <button key={m.id} onClick={() => { setMember(m); setResults([]) }}
                  className="w-full flex items-center justify-between py-4 border-b border-black/15 hover:bg-black hover:text-white text-black transition px-3 text-left group">
                  <span className={`${oswald.className} uppercase font-semibold tracking-wide`}>{m.name}</span>
                  <span className="text-xs uppercase tracking-widest opacity-50 group-hover:opacity-80">PIN {m.pin} · {planLabel(m.plan)} · {meta(m.status).label}</span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {/* member card — white poster block */}
      {member && !confirmed && (
        <div className="w-full max-w-md mt-8 bg-black text-white animate-in">
          <div className="p-8 pb-6">
            <div className="flex items-start gap-5">
              <div className={`${oswald.className} h-20 w-20 bg-white text-black grid place-items-center text-2xl font-bold overflow-hidden shrink-0`}>
                {member.photo ? <img src={member.photo} alt="" className="h-full w-full object-cover" /> : member.name.split(' ').map(w => w[0]).slice(0, 2).join('')}
              </div>
              <div className="min-w-0">
                <h2 className={`${oswald.className} text-4xl font-bold uppercase leading-none tracking-tight`}>{member.name}</h2>
                <p className="text-xs uppercase tracking-[0.2em] text-white/60 mt-2">{planLabel(member.plan)}{member.price ? ` — £${member.price}/MO` : ''} · PIN {member.pin}</p>
              </div>
            </div>
          </div>
          <div className={`${meta(member.status).bar} ${meta(member.status).text} px-8 py-4`}>
            <p className={`${oswald.className} font-bold uppercase tracking-[0.15em]`}>{meta(member.status).label}</p>
            <p className="text-[11px] uppercase tracking-[0.15em] opacity-80 mt-0.5">{meta(member.status).sub}</p>
          </div>
          <div className="px-8 py-3 text-[11px] uppercase tracking-[0.15em] text-white/50 border-b border-white/10">
            {member.checkedInToday ? `Already checked in today at ${fmtTime(member.checkedInToday)}`
              : member.lastVisit ? `Last visit ${fmtDay(member.lastVisit)}, ${fmtTime(member.lastVisit)}` : 'First visit'}
          </div>
          <div className="grid grid-cols-3">
            <button onClick={reset} className={`${oswald.className} py-5 uppercase tracking-[0.15em] text-white/40 hover:text-white text-sm transition`}>Cancel</button>
            <button onClick={doCheckin} disabled={busy}
              className={`${oswald.className} col-span-2 py-5 bg-white text-black font-bold uppercase tracking-[0.2em] text-lg hover:bg-neutral-200 transition disabled:opacity-60`}>
              {busy ? '…' : 'Check in →'}
            </button>
          </div>
        </div>
      )}

      {/* confirmation — full-bleed statement */}
      {confirmed && member && (
        <div className="mt-24 text-center animate-in">
          <p className={`${oswald.className} text-black text-6xl sm:text-7xl font-bold uppercase tracking-tight leading-none`}>{member.name.split(' ')[0]}</p>
          <p className={`${oswald.className} text-[#16a34a] text-2xl font-bold uppercase tracking-[0.25em] mt-4`}>Checked in ✓</p>
          <p className="text-black/40 text-xs uppercase tracking-[0.2em] mt-2">{fmtTime(confirmed)}</p>
        </div>
      )}
      <style jsx>{`.animate-in{animation:pop .22s ease-out}@keyframes pop{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}} .h-18{height:4.5rem}`}</style>
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
      <div className="flex items-end justify-between mb-2">
        <div>
          <p className="text-black/40 text-[11px] uppercase tracking-[0.25em]">{windowH ? `Last ${windowH}h` : today ? 'Checked in today' : date}</p>
          <p className={`${oswald.className} text-black text-7xl font-bold leading-none mt-2`}>{data ? shown.length : '—'}</p>
        </div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-transparent border border-black/25 px-3 py-2 text-black text-sm outline-none focus:border-black [color-scheme:light]" />
      </div>
      <div className="flex gap-6 mt-6 mb-6 border-b border-black/15">
        {([[1, '1H'], [2, '2H'], [3, '3H'], [null, 'All day']] as const).map(([h, label]) => (
          <button key={label} onClick={() => setWindowH(h as number | null)} disabled={!today && h !== null}
            className={`${oswald.className} uppercase tracking-[0.15em] text-xs font-semibold pb-2 border-b-2 -mb-px transition ${windowH === h ? 'text-black border-black' : 'text-black/35 border-transparent hover:text-black disabled:opacity-20'}`}>
            {label}
          </button>
        ))}
      </div>
      <div>
        {shown.map((e, i) => (
          <div key={i} className="flex items-center gap-5 py-3.5 border-b border-black/10">
            <span className={`${oswald.className} text-black/40 text-sm tabular-nums w-12`}>{fmtTime(e.time)}</span>
            <span className={`${oswald.className} text-black uppercase tracking-wide flex-1 truncate`}>{e.name}</span>
            <span className={`text-[10px] uppercase tracking-[0.15em] px-2 py-1 ${meta(e.status).bar} ${meta(e.status).text}`}>{meta(e.status).label}</span>
          </div>
        ))}
        {data && shown.length === 0 && <p className="text-black/25 text-center py-16 uppercase tracking-[0.2em] text-xs">No check-ins {windowH ? `in the last ${windowH}h` : today ? 'yet today' : 'on this day'}</p>}
      </div>
    </div>
  )
}
