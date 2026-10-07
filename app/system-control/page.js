'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { adminApi } from '../../lib/adminApi'

const formatDate=value=>value?new Date(value).toLocaleString():'Never'
const isSystemAdmin=role=>['super_admin','system_admin'].includes(role)

export default function SystemControlPage(){
  const [profile,setProfile]=useState(null)
  const [data,setData]=useState(null)
  const [loading,setLoading]=useState(true)
  const [error,setError]=useState('')

  const load=async()=>{
    setLoading(true);setError('')
    const {data:{session}}=await supabase.auth.getSession()
    if(!session)return(window.location.href='/login')

    const {data:prof}=await supabase.from('users').select('full_name,role').eq('id',session.user.id).single()
    setProfile(prof)
    if(!isSystemAdmin(prof?.role)){setLoading(false);return}

    const result=await adminApi('/api/admin/system')
    if(!result.ok){
      setError(result.error||'Could not load system status.')
      if(result.status===401){
        await supabase.auth.signOut()
        setTimeout(()=>{window.location.href='/login'},800)
      }
    }else setData(result)
    setLoading(false)
  }

  useEffect(()=>{load()},[])

  const integrityIssues=useMemo(()=>{
    if(!data?.integrity)return 0
    return Number(data.integrity.negative_stock||0)
      +Number(data.integrity.orphan_sales||0)
      +Number(data.integrity.query_errors?.length||0)
  },[data])

  if(!profile||loading)return <main className="page-wrap text-muted">Loading system control...</main>

  if(!isSystemAdmin(profile.role)){
    return <main className="page-wrap"><div className="page-card max-w-md p-6"><h1 className="font-black">System administrator only</h1><p className="mt-2 text-sm text-muted">This area is reserved for the MGT system administrator.</p></div></main>
  }

  const summary=data?.summary||{}
  const users=data?.users||[]
  const activity=data?.recent_activity||[]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div>
        <p className="page-eyebrow">System administration</p>
        <h1 className="page-title">System Control</h1>
        <p className="page-subtitle">Monitor Universal MGT access, organizations and data integrity.</p>
      </div>
      <button onClick={load} className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Refresh</button>
    </div>

    {error&&<div className="mb-5 max-w-4xl rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{error}</div>}

    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-5"><p className="text-sm text-muted">Active users</p><p className="mt-2 text-3xl font-black">{summary.active_users||0}</p><p className="mt-2 text-xs text-muted">{summary.disabled_users||0} disabled or archived</p></div>
      <div className="page-card p-5"><p className="text-sm text-muted">Organizations</p><p className="mt-2 text-3xl font-black">{summary.active_organizations||0}</p><p className="mt-2 text-xs text-muted">Active business workspaces</p></div>
      <div className="page-card p-5"><p className="text-sm text-muted">Audited actions today</p><p className="mt-2 text-3xl font-black">{summary.actions_today||0}</p><p className="mt-2 text-xs text-muted">Recorded business and administration events</p></div>
      <div className="page-card p-5"><p className="text-sm text-muted">Integrity issues</p><p className={`mt-2 text-3xl font-black ${integrityIssues>0?'text-red-500':'text-emerald-500'}`}>{integrityIssues}</p><p className="mt-2 text-xs text-muted">Negative stock, broken references or query failures</p></div>
    </section>

    <section className="mt-7 grid gap-5 xl:grid-cols-[1.1fr_.9fr]">
      <div>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black">Requires attention</h2><span className="text-xs text-muted">Universal checks</span></div>
        <div className="settings-list">
          <Link href="/inventory" className="settings-row"><span className="settings-row-icon">!</span><div><strong>Negative stock</strong><p>Inventory balances below zero</p></div><span className={summary.negative_stock?'text-red-500 font-black':'text-emerald-500 font-black'}>{summary.negative_stock||0}</span></Link>
          <Link href="/sales" className="settings-row"><span className="settings-row-icon">#</span><div><strong>Broken sale references</strong><p>Sale lines whose product record cannot be found</p></div><span className={summary.orphan_sales?'text-red-500 font-black':'text-emerald-500 font-black'}>{summary.orphan_sales||0}</span></Link>
          <Link href="/cashbook" className="settings-row"><span className="settings-row-icon">¤</span><div><strong>Pending banking</strong><p>Banking transactions awaiting completion</p></div><span className="settings-chevron">{summary.pending_bankings||0} ›</span></Link>
          <Link href="/production" className="settings-row"><span className="settings-row-icon">⚙</span><div><strong>Production variance</strong><p>Completed orders with output variance</p></div><span className="settings-chevron">{summary.production_flags||0} ›</span></Link>
          <Link href="/inventory" className="settings-row"><span className="settings-row-icon">✓</span><div><strong>Stocktake differences</strong><p>Physical counts that differ from system stock</p></div><span className="settings-chevron">{summary.stock_flags||0} ›</span></Link>
        </div>
      </div>

      <div>
        <h2 className="mb-3 text-lg font-black">System tools</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1">
          <Link href="/users" className="page-card p-4"><p className="font-black">Users & Access</p><p className="mt-1 text-sm text-muted">Manage staff accounts, roles and access.</p></Link>
          <Link href="/sales-report" className="page-card p-4"><p className="font-black">Detailed Reports</p><p className="mt-1 text-sm text-muted">Inspect operational and financial reporting across enabled modules.</p></Link>
          <Link href="/accounting" className="page-card p-4"><p className="font-black">Accounting Control</p><p className="mt-1 text-sm text-muted">Review journals, ledgers, statements and accounting periods.</p></Link>
          <Link href="/settings" className="page-card p-4"><p className="font-black">System Settings</p><p className="mt-1 text-sm text-muted">Manage account and application preferences.</p></Link>
        </div>
      </div>
    </section>

    <section className="mt-8 grid gap-6 xl:grid-cols-[1.15fr_.85fr]">
      <div>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black">Recent audited activity</h2><span className="text-xs text-muted">Today</span></div>
        <div className="page-card overflow-hidden">
          {activity.length===0?<p className="p-6 text-center text-sm text-muted">No audited activity recorded today.</p>:activity.map((item,index)=>(
            <div key={`${item.type}-${item.time}-${index}`} className="flex items-start gap-3 border-b border-[var(--line)] p-4 last:border-b-0">
              <span className="settings-row-icon">•</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-bold">{item.text}</p><p className="mt-1 text-xs text-muted">{formatDate(item.time)}</p></div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-black">User activity</h2><Link href="/users" className="text-xs font-bold text-accent">Manage</Link></div>
        <div className="page-card overflow-hidden">
          {users.length===0?<p className="p-6 text-center text-sm text-muted">No user data loaded.</p>:users.slice().sort((a,b)=>new Date(b.last_sign_in_at||0)-new Date(a.last_sign_in_at||0)).slice(0,8).map(user=>(
            <div key={user.id} className="border-b border-[var(--line)] p-4 last:border-b-0">
              <div className="flex items-center justify-between gap-3"><p className="font-bold">{user.full_name}</p><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${user.active===false||user.archived_at?'bg-red-500/10 text-red-500':'bg-emerald-500/10 text-emerald-500'}`}>{user.active===false||user.archived_at?'disabled':user.role}</span></div>
              <p className="mt-1 text-xs text-muted">{user.organization_name||'No organization'} · Last sign in: {formatDate(user.last_sign_in_at)}</p>
            </div>
          ))}
        </div>
      </div>
    </section>

    <p className="mt-6 text-xs text-muted">System status generated {data?.generated_at?formatDate(data.generated_at):'—'}. Passwords and provider secrets are never displayed here.</p>
  </main>
}
