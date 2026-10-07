'use client'

import { useOnlineStatus } from '../../lib/useOnlineStatus'

export default function ConnectivityStatus(){
  const online=useOnlineStatus()
  if(online)return null
  return <div className="mgt-offline-banner" role="status" aria-live="polite">
    <strong>Offline</strong>
    <span>Live business actions are paused until your connection returns.</span>
  </div>
}
