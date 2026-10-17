'use client'

import { useState, useSyncExternalStore } from 'react'
import { getInstallState, getServerInstallState, requestInstall, subscribeToInstall } from '../../lib/pwaInstall'

export default function InstallButton() {
  const { prompt, installed } = useSyncExternalStore(subscribeToInstall, getInstallState, getServerInstallState)
  const [message, setMessage] = useState('')
  return <div className="mt-5">
    {installed ? <p role="status">MGT is already running as an app.</p> : prompt ? (
      <button className="btn-primary rounded-xl px-5 py-3 font-bold" onClick={async () => setMessage(await requestInstall())}>Install MGT</button>
    ) : <p className="text-sm text-muted">Use the instructions for your device below. An Install button appears when your browser offers installation.</p>}
    {message && <p className="mt-3 text-sm" role="status">{message}</p>}
  </div>
}
