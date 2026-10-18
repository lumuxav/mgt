'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext, loadBusinessConfigFromDatabase } from '../../lib/platformDb'
import { moduleEnabled } from '../../lib/platformConfig'

const pretty = value => String(value||'').replaceAll('_',' ').replace(/\b\w/g,letter=>letter.toUpperCase())
export default function MyWorkPage(){
  const [context,setContext]=useState(null)
  const [business,setBusiness]=useState(null)
  const [grants,setGrants]=useState([])
  const [data,setData]=useState({tasks:[],jobs:[],attendance:{}})
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState('')
  const [message,setMessage]=useState('')
  const [failure,setFailure]=useState('')

  const load=async()=>{
    try{
      const ctx=await getPlatformContext({force:true})
      setFailure('')
      if(!ctx?.organization?.id)throw new Error('You need an active business workspace.')
      const authoritative=await loadBusinessConfigFromDatabase()
      if(!authoritative?.organizationId || authoritative.organizationId!==ctx.organization.id) throw new Error('Business module configuration unavailable.')
      const [work,permissions]=await Promise.all([
        supabase.rpc('mgt_my_work'),supabase.rpc('current_permissions')
      ])
      if(work.error)throw work.error
      if(permissions.error)throw permissions.error
      setContext(ctx)
      setBusiness(authoritative)
      setGrants((permissions.data||[]).map(row=>row.permission))
      setData({tasks:work.data?.tasks||[],jobs:work.data?.jobs||[],attendance:work.data?.attendance||{}})
    }catch(error){setFailure(error?.message||'Could not load your work.')}finally{setLoading(false)}
  }
  useEffect(()=>{
    const timer=window.setTimeout(()=>{void load()},0)
    return ()=>window.clearTimeout(timer)
  },[])
  const run=async(key,fn)=>{
    setBusy(key);setMessage('');setFailure('')
    try{
      const {error}=await fn()
      if(error)throw error
      setMessage('Work updated successfully.')
      await load()
    }catch(error){setFailure(error?.message||'Could not save your update.')}finally{setBusy('')}
  }
  const can=permission=>grants.includes(permission)
  const enable=key=>moduleEnabled(business,key)
  const attendanceEnabled=enable('hr')&&can('attendance.use')
  const actions=[
    enable('pos')&&can('sales.create')&&['/pos','Open point of sale','Process checkout'],
    enable('sales')&&can('sales.view')&&['/sales','Sales and customers','Review your sales'],
    enable('inventory')&&can('inventory.view')&&['/inventory','Stock workspace','Stock and receiving'],
    enable('purchasing')&&can('purchasing.view')&&['/purchasing','Purchasing','Purchase requests and deliveries'],
    enable('manufacturing')&&can('manufacturing.view')&&['/production','Production','Manufacturing work orders'],
    enable('fleet')&&can('fleet.dispatch')&&['/fleet','Dispatch','Delivery operations'],
    enable('projects')&&can('projects.time')&&['/projects','Timesheets','Submit project hours'],
    enable('hr')&&(can('leave.request')||can('hr.view'))&&['/hr','Attendance and leave','Manage your work records'],
    can('users.manage')&&['/users','Staff & Access','Manage employees and roles'],
  ].filter(Boolean)
  if(loading)return <main className="page-wrap text-muted">Preparing your workspace...</main>
  return <main className="page-wrap">
    <div className="page-header-row"><div>
      <p className="page-eyebrow">Personal workspace</p>
      <h1 className="page-title">My Work</h1>
      <p className="page-subtitle">Welcome {context?.user?.full_name||'back'}. Only assigned work and authorized actions appear here.</p>
    </div><button type="button" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold" onClick={()=>{setLoading(true);load()}}>Refresh</button></div>
    {failure&&<p role="alert" className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{failure}</p>}
    {message&&<p role="status" className="mb-4 rounded-xl border border-emerald-500/30 p-3 text-sm">{message}</p>}
    <section className="grid gap-4 md:grid-cols-3">
      <div className="page-card p-5"><p className="text-sm text-muted">My open tasks</p><p className="mt-2 text-3xl font-black">{data.tasks.length}</p></div>
      <div className="page-card p-5"><p className="text-sm text-muted">My assigned service jobs</p><p className="mt-2 text-3xl font-black">{data.jobs.length}</p></div>
      <div className="page-card p-5"><p className="text-sm text-muted">My attendance</p>
        <p className="mt-2 font-bold">{attendanceEnabled?(data.attendance.check_out?'Shift completed':data.attendance.check_in?'Clocked in':'Not clocked in'):'Managed by your workplace'}</p>
        {attendanceEnabled&&<div className="mt-3 flex flex-wrap gap-2">
          {!data.attendance.check_in&&context?.user?.default_location_id&&<button type="button" disabled={!!busy} className="btn-primary rounded-xl px-3 py-2 text-xs font-bold" onClick={()=>run('clock-in',()=>supabase.rpc('clock_in',{p_location_id:context.user.default_location_id}))}>Clock in</button>}
          {data.attendance.check_in&&!data.attendance.check_out&&<button type="button" disabled={!!busy} className="btn-secondary rounded-xl px-3 py-2 text-xs font-bold" onClick={()=>run('clock-out',()=>supabase.rpc('clock_out'))}>Clock out</button>}
        </div>}
      </div>
    </section>
    <section className="mt-6 grid gap-5 lg:grid-cols-2">
      <div className="page-card p-5">
        <h2 className="text-lg font-black">Assigned project tasks</h2>
        <p className="mb-4 mt-1 text-xs text-muted">Update progress on tasks allocated to your account.</p>
        {data.tasks.length===0?<p className="text-sm text-muted">No active project tasks assigned.</p>:<div className="space-y-3">{data.tasks.map(task=><article key={task.id} className="rounded-xl border border-[var(--line)] p-3">
          <strong>{task.title}</strong><p className="mt-1 text-xs text-muted">{pretty(task.status)}{task.due_date?' · Due '+task.due_date:''}</p>
          {(can('projects.time')||can('projects.manage'))&&<div className="mt-3 flex flex-wrap gap-2">
            {['in_progress','blocked','completed'].filter(x=>x!==task.status).map(status=><button key={status} type="button" disabled={!!busy} onClick={()=>run(task.id+status,()=>supabase.rpc('update_project_task',{p_task_id:task.id,p_status:status,p_progress_percent:status==='completed'?100:null}))} className="btn-secondary rounded-xl px-2 py-2 text-xs font-bold">{pretty(status)}</button>)}
          </div>}
        </article>)}</div>}
      </div>
      <div className="page-card p-5">
        <h2 className="text-lg font-black">Assigned service jobs</h2>
        <p className="mb-4 mt-1 text-xs text-muted">Update your assigned job progress without accessing pricing or profit details.</p>
        {data.jobs.length===0?<p className="text-sm text-muted">No active service jobs assigned.</p>:<div className="space-y-3">{data.jobs.map(job=><article key={job.id} className="rounded-xl border border-[var(--line)] p-3">
          <strong>{job.number?job.number+' · ':''}{job.title}</strong><p className="mt-1 text-xs text-muted">{pretty(job.status)}{job.due_at?' · '+new Date(job.due_at).toLocaleDateString():''}</p>
          {can('services.assigned')&&<div className="mt-3 flex flex-wrap gap-2">{['in_progress','on_hold'].filter(x=>x!==job.status).map(status=><button key={status} type="button" disabled={!!busy} onClick={()=>run(job.id+status,()=>supabase.rpc('mgt_update_assigned_job',{p_work_order_id:job.id,p_status:status}))} className="btn-secondary rounded-xl px-2 py-2 text-xs font-bold">{pretty(status)}</button>)}</div>}
        </article>)}</div>}
      </div>
    </section>
    <section className="page-card mt-6 p-5"><h2 className="text-lg font-black">Your authorized workspaces</h2>
      {actions.length?<div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{actions.map(([href,label,detail])=><Link key={href} href={href} className="rounded-xl border border-[var(--line)] p-4"><strong>{label}</strong><p className="mt-1 text-xs text-muted">{detail}</p></Link>)}</div>:<p className="mt-3 text-sm text-muted">Ask your manager to enable a relevant module and assign a job role. Your personal work area is ready.</p>}
    </section>
  </main>
}
