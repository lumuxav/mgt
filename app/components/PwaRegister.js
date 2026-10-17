'use client'

import { useEffect, useRef, useState } from 'react'

export default function PwaRegister() {
  const [waitingWorker, setWaitingWorker] = useState(null)
  const refreshRequested = useRef(false)

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    let disposed = false
    let registration = null
    const workers = new Set()
    const checkWaiting = () => {
      if (!disposed && registration?.waiting && navigator.serviceWorker.controller) setWaitingWorker(registration.waiting)
    }
    const onUpdate = () => {
      const worker = registration?.installing
      if (!worker) return
      workers.add(worker)
      worker.addEventListener('statechange', checkWaiting)
    }
    const register = async () => {
      try {
        registration = await navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
        if (disposed) return
        registration.addEventListener('updatefound', onUpdate)
        onUpdate()
        checkWaiting()
        await registration.update()
      } catch { /* A connection failure must not prevent use of the app. */ }
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') registration?.update().catch(() => {})
    }
    const onOnline = () => registration?.update().catch(() => {})
    const onControllerChange = () => {
      if (refreshRequested.current) window.location.reload()
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', onOnline)
    navigator.serviceWorker.addEventListener('controllerchange', onControllerChange)
    return () => {
      disposed = true
      window.removeEventListener('load', register)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', onOnline)
      navigator.serviceWorker.removeEventListener('controllerchange', onControllerChange)
      registration?.removeEventListener('updatefound', onUpdate)
      workers.forEach(worker => worker.removeEventListener('statechange', checkWaiting))
    }
  }, [])

  if (!waitingWorker) return null
  return <div className="mgt-update-prompt" role="region" aria-label="App update available">
    <p><strong>An MGT update is ready.</strong> Finish any work in progress before updating.</p>
    <div className="mt-3 flex gap-2">
      <button className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold" onClick={() => setWaitingWorker(null)}>Later</button>
      <button className="btn-primary rounded-xl px-3 py-2 text-sm font-bold" onClick={() => {
        refreshRequested.current = true
        waitingWorker.postMessage({ type: 'SKIP_WAITING' })
      }}>Update now</button>
    </div>
  </div>
}
