'use client'

import { useEffect } from 'react'

export default function PwaRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return

    let disposed=false
    let registration=null

    const register=async()=>{
      try{
        registration=await navigator.serviceWorker.register('/sw.js',{scope:'/'})
        if(disposed)return
        await registration.update().catch(()=>{})
      }catch{}
    }

    const onVisible=()=>{
      if(document.visibilityState==='visible')registration?.update?.().catch(()=>{})
    }
    const onOnline=()=>registration?.update?.().catch(()=>{})

    if(document.readyState==='complete')register()
    else window.addEventListener('load',register,{once:true})

    document.addEventListener('visibilitychange',onVisible)
    window.addEventListener('online',onOnline)

    return()=>{
      disposed=true
      document.removeEventListener('visibilitychange',onVisible)
      window.removeEventListener('online',onOnline)
    }
  },[])

  return null
}
