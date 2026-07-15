'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { signIn } from 'next-auth/react'

type Member = {
  id: string; name: string; plan: string | null; price: number; status: string
  checkedInToday: string | null
}
const OK = new Set(['ACTIVE', 'TRIALING'])
const planLabel = (p: string | null) => (p || '').replace(/^MIG_/, '').replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())

function Logo({ className = 'h-10' }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/images/auralogo.png" alt="Aura" className={`${className} w-auto object-contain`} />
}

export default function KioskPage() {
  const [authed, setAuthed] = useState<null | boolean>(null)
  useEffect(() => {
    fetch('/api/auth/session').then(r => r.json()).then(s => {
      const role = s?.user?.role
      setAuthed(!!role && ['RECEPTIONIST', 'ADMIN', 'SUPER_ADMIN'].includes(role))
    }).catch(() => setAuthed(false))
  }, [])
  if (authed === null) return <main className="min-h-screen bg-[#F7F7F8]" />
  if (!authed) return <KioskLogin onDone={() => setAuthed(true)} />
  return <Kiosk />
}

function KioskLogin({ onDone }: { onDone: () => void }) {
  const [u, setU] = useState(''); const [p, setP] = useState('')
  const [err, setErr] = useState('')
  const submit = async (e: React.FormEvent) => {
    e.preventDefault(); setErr('')
    const email = u.includes('@') ? u.trim() : `${u.trim()}@portal365.local`
    const res = await signIn('credentials', { email, password: p, redirect: false })
    if (res?.ok) onDone(); else setErr('Wrong login')
  }
  return (
    <main className="min-h-screen bg-[#F7F7F8] grid place-items-center px-6">
      <form onSubmit={submit} className="w-full max-w-xs bg-white border border-zinc-200 rounded-2xl shadow-sm p-6">
        <Logo className="h-8" />
        <p className="text-sm text-zinc-500 mt-3 mb-5">Kiosk device sign-in</p>
        <input value={u} onChange={e => setU(e.target.value)} placeholder="Username" className="w-full mb-3 h-11 px-3 rounded-xl border border-zinc-300 outline-none focus:border-zinc-900" />
        <input value={p} onChange={e => setP(e.target.value)} type="password" placeholder="Password" className="w-full mb-4 h-11 px-3 rounded-xl border border-zinc-300 outline-none focus:border-zinc-900" />
        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <button className="w-full h-11 rounded-xl bg-zinc-900 text-white font-medium">Sign in</button>
      </form>
    </main>
  )
}

function Kiosk() {
  const [pin, setPin] = useState('')
  const [member, setMember] = useState<Member | null>(null)
  const [phase, setPhase] = useState<'idle' | 'card' | 'blocked' | 'done'>('idle')
  const [notFound, setNotFound] = useState(false)
  const [fails, setFails] = useState(0)
  const [cooldown, setCooldown] = useState(0)
  const [busy, setBusy] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reset = useCallback(() => {
    setPin(''); setMember(null); setPhase('idle'); setNotFound(false); setBusy(false)
  }, [])

  // cooldown countdown
  useEffect(() => {
    if (cooldown <= 0) return
    const t = setInterval(() => setCooldown(c => c - 1), 1000)
    return () => clearInterval(t)
  }, [cooldown > 0])

  const lookup = useCallback(async (p: string) => {
    setBusy(true); setNotFound(false)
    const r = await fetch('/api/reception/lookup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }) })
    const j = await r.json(); setBusy(false)
    const m: Member | undefined = (j.members || [])[0]
    if (!m) {
      setNotFound(true); setPin('')
      setFails(f => {
        if (f + 1 >= 5) { setCooldown(30); return 0 }
        return f + 1
      })
      return
    }
    setFails(0); setMember(m)
    setPhase(OK.has(m.status) ? 'card' : 'blocked')
    if (!OK.has(m.status)) { timer.current && clearTimeout(timer.current); timer.current = setTimeout(reset, 7000) }
  }, [reset])

  useEffect(() => { if (pin.length === 4 && phase === 'idle' && cooldown === 0) lookup(pin) }, [pin, phase, cooldown, lookup])

  const confirm = async () => {
    if (!member || busy) return
    setBusy(true)
    const r = await fetch('/api/reception/checkin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId: member.id }) })
    const j = await r.json(); setBusy(false)
    if (j.success) {
      setPhase('done')
      timer.current && clearTimeout(timer.current)
      timer.current = setTimeout(reset, 3000)
    }
  }

  return (
    <main className="min-h-screen bg-[#F7F7F8] flex flex-col items-center justify-center px-6 select-none">
      {phase === 'idle' && (
        <div className="flex flex-col items-center w-full max-w-sm">
          <Logo />
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 mt-5">Check in</h1>
          <p className="text-zinc-500 mt-1 mb-8">{cooldown > 0 ? `Too many tries — wait ${cooldown}s or speak to the desk` : 'Enter your 4-digit PIN'}</p>
          <div className="flex gap-3 mb-3">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className={`h-16 w-14 rounded-xl border-2 bg-white grid place-items-center text-3xl font-semibold transition-colors ${pin[i] ? 'border-zinc-900 text-zinc-900' : 'border-zinc-200 text-zinc-300'}`}>
                {pin[i] ? '•' : ''}
              </div>
            ))}
          </div>
          <div className="h-6 mb-3">{notFound && <p className="text-sm text-red-700">PIN not recognised — try again or speak to the desk.</p>}</div>
          <div className="grid grid-cols-3 gap-3 w-full">
            {['1','2','3','4','5','6','7','8','9','','0','del'].map((k, idx) => (
              k === '' ? <div key={idx} /> :
              <button key={idx} disabled={cooldown > 0}
                onClick={() => { if (k === 'del') setPin(p => p.slice(0, -1)); else if (pin.length < 4) setPin(p => p + k) }}
                className={`h-20 rounded-2xl transition active:scale-[0.96] disabled:opacity-30 ${k === 'del' ? 'text-lg text-zinc-400' : 'bg-white border border-zinc-200 shadow-sm text-3xl font-medium text-zinc-900'}`}>
                {k === 'del' ? '⌫' : k}
              </button>
            ))}
          </div>
        </div>
      )}

      {phase === 'card' && member && (
        <div className="w-full max-w-sm bg-white border border-zinc-200 rounded-3xl shadow-sm p-8 text-center animate-in">
          <p className="text-sm text-zinc-500">Welcome</p>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 mt-1">{member.name}</h2>
          <p className="text-zinc-500 mt-1 mb-2">{planLabel(member.plan)}</p>
          {member.checkedInToday && <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-1.5 inline-block mb-2">Already checked in today</p>}
          <button onClick={confirm} disabled={busy}
            className="w-full h-16 mt-4 rounded-2xl bg-zinc-900 text-white text-xl font-semibold active:scale-[0.98] transition disabled:opacity-60">
            {busy ? '…' : 'Confirm ✓'}
          </button>
          <button onClick={reset} className="mt-4 text-sm text-zinc-400">Not you? Cancel</button>
        </div>
      )}

      {phase === 'blocked' && member && (
        <div className={`w-full max-w-sm rounded-3xl p-8 text-center animate-in ${member.status === 'PAST_DUE' ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
          <div className={`mx-auto h-14 w-14 rounded-full grid place-items-center ${member.status === 'PAST_DUE' ? 'bg-amber-100' : 'bg-red-100'}`}>
            <svg className={`h-7 w-7 ${member.status === 'PAST_DUE' ? 'text-amber-600' : 'text-red-600'}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/></svg>
          </div>
          <h2 className="text-2xl font-semibold tracking-tight text-zinc-900 mt-4">{member.name.split(' ')[0]}, please speak to the desk</h2>
          <p className="text-zinc-600 mt-2">{member.status === 'PAST_DUE' ? 'There’s a payment issue on your membership.' : 'Your membership isn’t active.'}</p>
          <button onClick={reset} className="mt-6 text-sm text-zinc-500 underline">Back</button>
        </div>
      )}

      {phase === 'done' && member && (
        <div className="flex flex-col items-center animate-in">
          <div className="h-24 w-24 rounded-full bg-green-100 grid place-items-center">
            <svg className="h-12 w-12 text-green-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"/></svg>
          </div>
          <h2 className="text-3xl font-semibold tracking-tight text-zinc-900 mt-6">You're in, {member.name.split(' ')[0]}</h2>
          <p className="text-zinc-500 mt-1">Have a good session 👊</p>
        </div>
      )}
      <style jsx>{`.animate-in{animation:rise .22s ease-out}@keyframes rise{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion: reduce){.animate-in{animation:none}}`}</style>
    </main>
  )
}
