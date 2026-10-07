'use client'

import { useEffect,useState } from 'react'

export function useOnlineStatus(){
  const [online,setOnline]=useState(true)

  useEffect(()=>{
    const sync=()=>setOnline(navigator.onLine!==false)
    sync()
    window.addEventListener('online',sync)
    window.addEventListener('offline',sync)
    return()=>{
      window.removeEventListener('online',sync)
      window.removeEventListener('offline',sync)
    }
  },[])

  return online
}

export function requireOnline(online,message='An internet connection is required for this action.'){
  if(online)return null
  return {type:'error',text:message}
}
