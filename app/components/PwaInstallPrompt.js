'use client'

import Link from 'next/link'
import { useEffect, useSyncExternalStore } from 'react'
import { attachInstallEvents, dismissInstall, getInstallState, getServerInstallState, requestInstall, subscribeToInstall } from '../../lib/pwaInstall'

export default function PwaInstallPrompt() {
  const { prompt, installed, dismissed } = useSyncExternalStore(subscribeToInstall, getInstallState, getServerInstallState)
  useEffect(() => attachInstallEvents(window), [])
  if (!prompt || installed || dismissed) return null
  return <div className="mgt-install-prompt" role="region" aria-label="Install MGT Business Suite">
    <div>
      <strong>Install MGT on this device</strong>
      <p>Open MGT in its own app window. <Link href="/install" className="underline">Device instructions</Link></p>
    </div>
    <div className="mgt-install-actions">
      <button type="button" onClick={() => dismissInstall(window)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Later</button>
      <button type="button" onClick={requestInstall} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Install</button>
    </div>
  </div>
}
