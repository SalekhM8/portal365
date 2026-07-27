'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Webcam photo capture modal (reception laptop camera).
 * Streams via getUserMedia, captures a centre-square 400px JPEG,
 * POSTs to /api/reception/photo and returns the data URL via onSaved.
 */
export default function PhotoCapture({ userId, name, onClose, onSaved }: {
  userId: string; name: string; onClose: () => void; onSaved: (dataUrl: string) => void
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [snap, setSnap] = useState<string | null>(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' } })
      .then(stream => {
        if (cancelled) { stream.getTracks().forEach(t => t.stop()); return }
        streamRef.current = stream
        if (videoRef.current) { videoRef.current.srcObject = stream; videoRef.current.play().catch(() => {}) }
      })
      .catch(() => setErr('Camera blocked — allow camera access for this site in the browser, then try again.'))
    return () => { cancelled = true; streamRef.current?.getTracks().forEach(t => t.stop()) }
  }, [])

  const capture = useCallback(() => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const size = 400
    const c = document.createElement('canvas')
    c.width = size; c.height = size
    const ctx = c.getContext('2d')!
    const s = Math.min(v.videoWidth, v.videoHeight)
    ctx.drawImage(v, (v.videoWidth - s) / 2, (v.videoHeight - s) / 2, s, s, 0, 0, size, size)
    setSnap(c.toDataURL('image/jpeg', 0.82))
  }, [])

  const save = async () => {
    if (!snap || busy) return
    setBusy(true); setErr('')
    try {
      const r = await fetch('/api/reception/photo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, image: snap }) })
      const j = await r.json()
      if (r.ok && j.success) { onSaved(snap); onClose() }
      else setErr(j.error || 'Save failed')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 text-zinc-900">
        <h3 className="font-semibold text-lg">Photo — {name}</h3>
        <p className="text-sm text-zinc-500 mb-4">Look at the camera, then Capture.</p>
        <div className="relative aspect-square rounded-xl overflow-hidden bg-zinc-100 mb-4">
          {!snap && <video ref={videoRef} muted playsInline className="absolute inset-0 h-full w-full object-cover" />}
          {snap && <img src={snap} alt="preview" className="absolute inset-0 h-full w-full object-cover" />}
        </div>
        {err && <p className="text-sm text-red-700 mb-3">{err}</p>}
        <div className="flex gap-2">
          <button onClick={onClose} className="h-11 px-4 rounded-xl border border-zinc-300 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Cancel</button>
          {!snap ? (
            <button onClick={capture} className="h-11 flex-1 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800">Capture</button>
          ) : (
            <>
              <button onClick={() => setSnap(null)} className="h-11 px-4 rounded-xl border border-zinc-300 text-sm font-medium text-zinc-600 hover:bg-zinc-50">Retake</button>
              <button onClick={save} disabled={busy} className="h-11 flex-1 rounded-xl bg-zinc-900 text-white font-medium hover:bg-zinc-800 disabled:opacity-60">{busy ? 'Saving…' : 'Save photo'}</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
