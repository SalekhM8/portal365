'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

type Entry = { id: string; time: string; name: string; photo: string | null; status: string }
const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
const initials = (name: string) => name.split(' ').filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase()
const ok = (s: string) => s === 'ACTIVE' || s === 'TRIALING'

function Logo() {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/auralogo.png" alt="Aura" className="h-10 w-auto object-contain brightness-0 invert" />
}

export default function ScreenPage() {
  const [authed, setAuthed] = useState<null | boolean>(null)
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      const role = s?.user?.role
      setAuthed(!!role && ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'].includes(role))
    }).catch(() => setAuthed(false))
  }, [])
  if (authed === null) return <main className="min-h-screen bg-[#0B0B0C]" />
  if (!authed) return (
    <main className="min-h-screen bg-[#0B0B0C] grid place-items-center">
      <p className="text-white/50 text-xl">Sign in at <span className="text-white font-medium">/reception</span> first, then reopen this page.</p>
    </main>
  )
  return <LiveScreen />
}

function LiveScreen() {
  const [count, setCount] = useState<number | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [pop, setPop] = useState<Entry | null>(null)
  const [clock, setClock] = useState('')
  const cursor = useRef('')
  const popTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }))
    tick(); const t = setInterval(tick, 5000); return () => clearInterval(t)
  }, [])

  const poll = useCallback(async () => {
    if (document.hidden) return
    try {
      const r = await fetch(`/api/reception/feed?since=${cursor.current}`)
      const j = await r.json()
      if (typeof j.count === 'number') setCount(j.count)
      if (Array.isArray(j.entries)) setEntries(j.entries)
      if (j.hasNew && j.entries?.[0]) {
        setPop(j.entries[0])
        popTimer.current && clearTimeout(popTimer.current)
        popTimer.current = setTimeout(() => setPop(null), 4500)
      }
      if (j.newest) cursor.current = j.newest
    } catch {}
  }, [])

  useEffect(() => {
    poll()
    const t = setInterval(poll, 2000)
    return () => clearInterval(t)
  }, [poll])

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <main className="min-h-screen bg-[#0B0B0C] text-white overflow-hidden flex flex-col px-14 py-10">
      {/* header */}
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-5">
          <Logo />
          <div className="h-8 w-px bg-white/15" />
          <p className="text-white/50 text-xl tracking-tight">{today}</p>
        </div>
        <div className="flex items-center gap-6">
          <span className="flex items-center gap-2 text-white/40 text-sm uppercase tracking-[0.2em]">
            <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />Live
          </span>
          <p className="text-3xl font-semibold tabular-nums tracking-tight">{clock}</p>
        </div>
      </header>

      {/* body */}
      <div className="flex-1 flex items-center gap-16 mt-4">
        <div className="shrink-0">
          <p className="text-white/40 text-2xl">Checked in today</p>
          <p className="text-[11rem] leading-none font-semibold tabular-nums tracking-tighter mt-2">{count ?? '—'}</p>
        </div>
        <div className="flex-1 max-w-2xl">
          <p className="text-white/30 text-sm uppercase tracking-[0.25em] mb-4">Recent</p>
          <div className="space-y-1">
            {entries.slice(0, 6).map(e => (
              <div key={e.id} className="flex items-center gap-4 py-3 border-b border-white/[0.07]">
                <span className="h-11 w-11 rounded-full bg-white/10 grid place-items-center text-sm font-semibold text-white/70 shrink-0 overflow-hidden">
                  {e.photo ? <img src={e.photo} alt="" className="h-full w-full object-cover" /> : initials(e.name)}
                </span>
                <span className="flex-1 text-2xl font-medium tracking-tight truncate">{e.name}</span>
                {!ok(e.status) && <span className="text-xs uppercase tracking-widest text-amber-400/90">{e.status.replace('_', ' ')}</span>}
                <span className="text-white/35 text-xl tabular-nums">{fmtTime(e.time)}</span>
              </div>
            ))}
            {entries.length === 0 && <p className="text-white/25 text-2xl py-10">No check-ins yet today</p>}
          </div>
        </div>
      </div>

      {/* confirmation takeover */}
      {pop && (
        <div className="fixed inset-0 bg-[#0B0B0C]/97 backdrop-blur grid place-items-center pop-in">
          <div className="text-center px-10">
            <div className="mx-auto h-32 w-32 rounded-full bg-green-500/15 grid place-items-center draw">
              <svg className="h-16 w-16 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
            </div>
            <h2 className="text-7xl font-semibold tracking-tight mt-10">{pop.name}</h2>
            <p className="text-green-500 text-3xl font-medium mt-4">Checked in · {fmtTime(pop.time)}</p>
          </div>
        </div>
      )}
      <style jsx>{`
        .pop-in{animation:fade .3s ease-out}
        @keyframes fade{from{opacity:0}to{opacity:1}}
        .draw{animation:scale .35s cubic-bezier(.2,1.4,.4,1)}
        @keyframes scale{from{transform:scale(.6);opacity:0}to{transform:scale(1);opacity:1}}
        @media (prefers-reduced-motion: reduce){.pop-in,.draw{animation:none}}
      `}</style>
    </main>
  )
}
