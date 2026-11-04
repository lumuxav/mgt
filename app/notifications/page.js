'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { getPlatformContext } from '../../lib/platformDb'
import {
  NOTIFICATION_CATEGORY_LABELS,
  dismissNotification,
  loadNotificationInbox,
  markAllNotificationsRead,
  markNotificationRead,
  syncNotificationSystem,
} from '../../lib/notifications'

const relativeTime=value=>{
  const ms=Date.now()-new Date(value).getTime()
  const minutes=Math.max(0,Math.floor(ms/60000))
  if(minutes<1)return 'Just now'
  if(minutes<60)return minutes+'m ago'
  const hours=Math.floor(minutes/60)
  if(hours<24)return hours+'h ago'
  const days=Math.floor(hours/24)
  if(days<7)return days+'d ago'
  return new Date(value).toLocaleDateString()
}

const toneClass=severity=>{
  if(severity==='critical')return 'border-red-500/30 bg-red-500/10'
  if(severity==='warning')return 'border-amber-500/30 bg-amber-500/10'
  if(severity==='success')return 'border-emerald-500/30 bg-emerald-500/10'
  return 'border-[var(--line)] bg-[var(--panel)]'
}

const badgeClass=severity=>{
  if(severity==='critical')return 'bg-red-500/10 text-red-500'
  if(severity==='warning')return 'bg-amber-500/10 text-amber-600'
  if(severity==='success')return 'bg-emerald-500/10 text-emerald-600'
  return 'bg-blue-500/10 text-blue-600'
}

export default function NotificationsPage(){
  const [context,setContext]=useState(null)
  const [items,setItems]=useState([])
  const [preferences,setPreferences]=useState(null)
  const [filter,setFilter]=useState('all')
  const [category,setCategory]=useState('all')
  const [search,setSearch]=useState('')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const load=async({sync=true}={})=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.user?.id||!ctx.organization?.id)throw new Error('Complete business setup first.')
      if(sync)await syncNotificationSystem()
      const inbox=await loadNotificationInbox({userId:ctx.user.id,organizationId:ctx.organization.id})
      setItems(inbox.items)
      setPreferences(inbox.preferences)
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load notifications.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])


  const visible=useMemo(()=>{
    const term=search.trim().toLowerCase()
    return items.filter(item=>{
      if(filter==='unread'&&item.state?.read_at)return false
      if(filter==='critical'&&item.severity!=='critical')return false
      if(category!=='all'&&item.category!==category)return false
      if(term&&!([item.title,item.body,item.category,item.entity_type].filter(Boolean).join(' ').toLowerCase().includes(term)))return false
      return true
    })
  },[items,filter,category,search])

  const unread=items.filter(item=>!item.state?.read_at).length
  const critical=items.filter(item=>item.severity==='critical').length
  const warnings=items.filter(item=>item.severity==='warning').length

  const markRead=async(id,read=true)=>{
    try{
      await markNotificationRead(id,read)
      setItems(current=>current.map(item=>item.id===id?{...item,state:{...(item.state||{}),read_at:read?new Date().toISOString():null,dismissed_at:null}}:item))
    }catch(error){setMessage({type:'error',text:error.message})}
  }

  const dismiss=async id=>{
    try{
      await dismissNotification(id)
      setItems(current=>current.filter(item=>item.id!==id))
    }catch(error){setMessage({type:'error',text:error.message})}
  }

  const markAll=async()=>{
    setBusy(true);setMessage(null)
    try{
      await markAllNotificationsRead()
      const stamp=new Date().toISOString()
      setItems(current=>current.map(item=>({...item,state:{...(item.state||{}),read_at:stamp}})))
      setMessage({type:'success',text:'All visible notifications marked as read.'})
    }catch(error){setMessage({type:'error',text:error.message})}
    setBusy(false)
  }

  const refresh=async()=>{
    setMessage(null)
    await load({sync:true})
  }

  if(loading&&!context)return <main className="page-wrap text-muted">Loading notifications...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Notification center</p><h1 className="page-title">Notifications</h1><p className="page-subtitle">Personal assignments, approvals and business exceptions that need your attention.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/alerts" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Business Alerts</Link><button type="button" onClick={refresh} disabled={loading} className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50">{loading?'Refreshing...':'Refresh'}</button></div>
    </div>

    {message&&<div className={'mb-5 rounded-xl border px-4 py-3 text-sm '+(message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600')}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button type="button" onClick={()=>setFilter('all')} className={'page-card p-4 text-left '+(filter==='all'?'ring-2 ring-[var(--accent)]':'')}><p className="text-xs text-muted">Active notifications</p><strong className="mt-2 block text-2xl">{items.length}</strong></button>
      <button type="button" onClick={()=>setFilter('unread')} className={'page-card p-4 text-left '+(filter==='unread'?'ring-2 ring-[var(--accent)]':'')}><p className="text-xs text-muted">Unread</p><strong className="mt-2 block text-2xl">{unread}</strong></button>
      <button type="button" onClick={()=>setFilter('critical')} className={'page-card p-4 text-left '+(filter==='critical'?'ring-2 ring-[var(--accent)]':'')}><p className="text-xs text-muted">Critical</p><strong className="mt-2 block text-2xl text-red-500">{critical}</strong></button>
      <div className="page-card p-4"><p className="text-xs text-muted">Warnings</p><strong className="mt-2 block text-2xl text-amber-600">{warnings}</strong></div>
    </section>

    <section className="mb-5 page-card p-4">
      <div className="grid gap-3 lg:grid-cols-[1fr_220px_auto]">
        <input className="input-base" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search notifications"/>
        <select className="input-base" value={category} onChange={e=>setCategory(e.target.value)}>
          <option value="all">All categories</option>
          {Object.entries(NOTIFICATION_CATEGORY_LABELS).filter(([key])=>preferences?.categories?.[key]!==false).map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select>
        <button type="button" disabled={busy||!unread} onClick={markAll} className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-40">{busy?'Working...':'Mark all read'}</button>
      </div>
    </section>

    <section className="space-y-3">
      {!visible.length&&<div className="page-card p-8 text-center"><strong>No matching notifications</strong><p className="mt-2 text-sm text-muted">You are caught up for the current filter.</p></div>}
      {visible.map(item=><article key={item.id} className={'rounded-2xl border p-4 sm:p-5 '+toneClass(item.severity)+' '+(!item.state?.read_at?'shadow-sm':'opacity-80')}>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              {!item.state?.read_at&&<span className="h-2.5 w-2.5 rounded-full bg-[var(--accent)]" aria-label="Unread"/>}
              <span className={'rounded-full px-2 py-1 text-[10px] font-black uppercase '+badgeClass(item.severity)}>{item.severity}</span>
              <span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{NOTIFICATION_CATEGORY_LABELS[item.category]||item.category}</span>
              {item.recipient_user_id&&<span className="rounded-full bg-violet-500/10 px-2 py-1 text-[10px] font-black uppercase text-violet-600">Personal</span>}
            </div>
            <h2 className="mt-3 text-base font-black">{item.title}</h2>
            {item.body&&<p className="mt-1 text-sm leading-6 text-muted">{item.body}</p>}
            <p className="mt-2 text-xs text-muted">{relativeTime(item.created_at)} · {new Date(item.created_at).toLocaleString()}</p>
          </div>
          <div className="flex flex-wrap gap-2 lg:justify-end">
            {item.href&&<Link href={item.href} onClick={()=>markRead(item.id,true)} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">{item.action_label||'Open'}</Link>}
            <button type="button" onClick={()=>markRead(item.id,!item.state?.read_at)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{item.state?.read_at?'Mark unread':'Mark read'}</button>
            <button type="button" onClick={()=>dismiss(item.id)} className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black text-muted">Dismiss</button>
          </div>
        </div>
      </article>)}
    </section>

    <p className="mt-6 text-xs text-muted">Notification categories can be changed in Settings. Dismissing an item hides it for your account only; it does not delete the underlying business record.</p>
  </main>
}
