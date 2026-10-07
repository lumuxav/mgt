'use client'

import { useEffect,useState } from 'react'

const isStandalone=()=>typeof window!=='undefined'&&(
  window.matchMedia?.('(display-mode: standalone)').matches||
  window.navigator.standalone===true||
  window.Capacitor?.isNativePlatform?.()
)

export default function PwaInstallPrompt(){
  const [promptEvent,setPromptEvent]=useState(null)
  const [visible,setVisible]=useState(false)

  useEffect(()=>{
    if(isStandalone())return
    const dismissed=localStorage.getItem('mgt-install-prompt-dismissed-at')
    if(dismissed&&Date.now()-Number(dismissed)<7*24*60*60*1000)return

    const onPrompt=event=>{
      event.preventDefault()
      setPromptEvent(event)
      setVisible(true)
    }
    const onInstalled=()=>{
      setVisible(false)
      setPromptEvent(null)
      localStorage.removeItem('mgt-install-prompt-dismissed-at')
    }

    window.addEventListener('beforeinstallprompt',onPrompt)
    window.addEventListener('appinstalled',onInstalled)
    return()=>{
      window.removeEventListener('beforeinstallprompt',onPrompt)
      window.removeEventListener('appinstalled',onInstalled)
    }
  },[])

  if(!visible||!promptEvent)return null

  const install=async()=>{
    try{
      await promptEvent.prompt()
      await promptEvent.userChoice
    }finally{
      setVisible(false)
      setPromptEvent(null)
    }
  }

  const dismiss=()=>{
    localStorage.setItem('mgt-install-prompt-dismissed-at',String(Date.now()))
    setVisible(false)
  }

  return <div className="mgt-install-prompt" role="dialog" aria-label="Install MGT Business Suite">
    <div>
      <strong>Install MGT on this device</strong>
      <p>Open MGT like an app with its own icon and full-screen workspace.</p>
    </div>
    <div className="mgt-install-actions">
      <button type="button" onClick={dismiss} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Later</button>
      <button type="button" onClick={install} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Install</button>
    </div>
  </div>
}
