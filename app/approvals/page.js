'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()

const ruleMeta={
  purchase_order:{label:'Purchase orders',description:'Require approval when a purchase order reaches this total value.',unit:'money'},
  stock_adjustment:{label:'Stock adjustments',description:'Require approval when the absolute stock adjustment reaches this quantity.',unit:'quantity'},
  production_order:{label:'Production orders',description:'Require approval when planned production output reaches this quantity.',unit:'quantity'},
}

export default function ApprovalsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [rules,setRules]=useState([])
  const [requests,setRequests]=useState([])
  const [tab,setTab]=useState('pending')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [reviewing,setReviewing]=useState(null)
  const [reviewNotes,setReviewNotes]=useState('')

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canManage=permissions.includes('approvals.manage')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,ruleRes,requestRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('approval_rules').select('id,rule_type,enabled,threshold,updated_at').eq('organization_id',org).order('rule_type'),
        supabase.from('approval_requests').select('id,location_id,request_type,entity_type,entity_id,title,amount,status,review_notes,metadata,created_at,reviewed_at,locations(name),requester:users!approval_requests_requested_by_fkey(full_name),reviewer:users!approval_requests_reviewed_by_fkey(full_name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),
      ])
      for(const result of [permRes,ruleRes,requestRes])if(result.error)throw result.error
      setPermissions((permRes.data||[]).map((row)=>row.permission))
      setRules(ruleRes.data||[])
      setRequests(requestRes.data||[])
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load approvals.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const updateRule=async(rule,changes)=>{
    if(!canManage)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.from('approval_rules').update({...changes,updated_at:new Date().toISOString()}).eq('id',rule.id)
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:'Approval rule updated.'});await load()}
    setBusy(false)
  }

  const review=async(decision)=>{
    if(!reviewing)return
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('review_approval_request',{
      p_request_id:reviewing.id,
      p_decision:decision,
      p_notes:reviewNotes||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:`${reviewing.title} ${data?.status||decision}.`})
      setReviewing(null);setReviewNotes('');await load()
    }
    setBusy(false)
  }

  const pending=requests.filter((row)=>row.status==='pending')
  const history=requests.filter((row)=>row.status!=='pending')
  const purchasePending=pending.filter((row)=>row.request_type==='purchase_order').length
  const stockPending=pending.filter((row)=>row.request_type==='stock_adjustment').length
  const productionPending=pending.filter((row)=>row.request_type==='production_order').length

  const detailFor=(request)=>{
    if(request.request_type==='purchase_order'){
      const total=Number(request.metadata?.total_amount??request.amount??0)
      return `Purchase value ${money(total,currency)}`
    }
    if(request.request_type==='stock_adjustment'){
      const delta=Number(request.metadata?.quantity_delta||0)
      return `Stock change ${delta>0?'+':''}${delta.toLocaleString()} · ${request.metadata?.reason||'adjustment'}`
    }
    if(request.request_type==='production_order'){
      return `Planned output ${Number(request.metadata?.planned_quantity??request.amount??0).toLocaleString()}`
    }
    return request.entity_type
  }

  const requestLink=(request)=>{
    if(request.request_type==='purchase_order')return '/purchasing'
    if(request.request_type==='production_order')return '/production'
    if(request.request_type==='stock_adjustment')return '/inventory'
    return '/'
  }

  if(loading)return <main className="page-wrap text-muted">Loading approvals...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Management control</p><h1 className="page-title">Approvals</h1><p className="page-subtitle">Sensitive purchases, stock changes and production runs can wait for authorized review before they affect operations.</p></div>
      <Link href="/alerts" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Business Alerts</Link>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Pending approvals</p><strong className="mt-2 block text-2xl">{pending.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Purchasing</p><strong className="mt-2 block text-2xl">{purchasePending}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Stock adjustments</p><strong className="mt-2 block text-2xl">{stockPending}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Production</p><strong className="mt-2 block text-2xl">{productionPending}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['pending','Pending'],['history','History'],['rules','Approval rules']].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='pending'&&<section className="space-y-3">
      {!pending.length&&<div className="page-card p-8 text-center"><strong>No approvals waiting</strong><p className="mt-2 text-sm text-muted">Controlled transactions that cross an enabled threshold will appear here.</p></div>}
      {pending.map((request)=><article key={request.id} className="page-card p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600">{request.request_type.replaceAll('_',' ')}</span><strong>{request.title}</strong></div><p className="mt-2 text-sm text-muted">{detailFor(request)}</p><p className="mt-1 text-xs text-muted">Requested by {request.requester?.full_name||'staff'} · {request.locations?.name||'Business'} · {new Date(request.created_at).toLocaleString()}</p></div>
          <div className="flex flex-wrap gap-2"><Link href={requestLink(request)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">View operation</Link>{canManage&&<button type="button" onClick={()=>{setReviewing(request);setReviewNotes('')}} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Review</button>}</div>
        </div>
      </article>)}
    </section>}

    {tab==='history'&&<section className="page-card overflow-hidden">
      <div className="divide-y divide-[var(--line)]">
        {!history.length&&<p className="p-6 text-center text-sm text-muted">No approval decisions yet.</p>}
        {history.map((request)=><div key={request.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><strong>{request.title}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${request.status==='approved'?'bg-emerald-500/10 text-emerald-600':request.status==='rejected'?'bg-red-500/10 text-red-500':'bg-[var(--panel-2)] text-muted'}`}>{request.status}</span></div><p className="mt-1 text-xs text-muted">{detailFor(request)} · requested by {request.requester?.full_name||'staff'}</p>{request.review_notes&&<p className="mt-2 text-sm text-muted">Review note: {request.review_notes}</p>}</div><div className="text-left sm:text-right"><span className="text-xs text-muted">Reviewed by</span><strong className="block text-sm">{request.reviewer?.full_name||'—'}</strong><span className="text-xs text-muted">{request.reviewed_at?new Date(request.reviewed_at).toLocaleString():''}</span></div></div>)}
      </div>
    </section>}

    {tab==='rules'&&<section className="grid gap-4 lg:grid-cols-3">
      {rules.map((rule)=>{
        const meta=ruleMeta[rule.rule_type]||{label:rule.rule_type,description:'',unit:'quantity'}
        return <article key={rule.id} className="page-card p-5">
          <div className="flex items-start justify-between gap-3"><div><strong>{meta.label}</strong><p className="mt-1 text-xs text-muted">{meta.description}</p></div><button disabled={!canManage||busy} type="button" onClick={()=>updateRule(rule,{enabled:!rule.enabled})} className={`rounded-full px-3 py-1 text-xs font-black ${rule.enabled?'bg-emerald-500/10 text-emerald-600':'bg-[var(--panel-2)] text-muted'}`}>{rule.enabled?'ON':'OFF'}</button></div>
          <label className="mt-5 block"><span className="mb-1 block text-xs font-bold text-muted">{meta.unit==='money'?`Threshold (${currency})`:'Quantity threshold'}</span><input disabled={!canManage} className="input-base" type="number" min="0" step={meta.unit==='money'?'0.01':'0.001'} defaultValue={rule.threshold} onBlur={(event)=>{const value=Number(event.target.value||0);if(value!==Number(rule.threshold))updateRule(rule,{threshold:value})}}/></label>
          <p className="mt-3 text-xs text-muted">{rule.enabled?'Transactions at or above this threshold will wait for approval.':'This rule is currently disabled; matching transactions post immediately.'}</p>
        </article>
      })}
      {!rules.length&&<div className="page-card p-6 text-sm text-muted">No approval rules configured.</div>}
    </section>}

    {reviewing&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8"><div className="mx-auto max-w-xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Approval review</p><h2 className="text-xl font-black">{reviewing.title}</h2><p className="mt-2 text-sm text-muted">{detailFor(reviewing)}</p></div><button type="button" onClick={()=>setReviewing(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><div className="mt-4 rounded-2xl bg-[var(--panel-2)] p-4 text-sm"><p>Requested by <strong>{reviewing.requester?.full_name||'staff'}</strong></p><p className="mt-1 text-muted">{reviewing.locations?.name||'Business'} · {new Date(reviewing.created_at).toLocaleString()}</p>{reviewing.metadata?.notes&&<p className="mt-2 text-muted">{reviewing.metadata.notes}</p>}</div><textarea className="input-base mt-4 min-h-24" placeholder="Review notes (optional)" value={reviewNotes} onChange={(event)=>setReviewNotes(event.target.value)}/><div className="mt-4 grid gap-3 sm:grid-cols-2"><button disabled={busy} type="button" onClick={()=>review('rejected')} className="rounded-xl bg-red-500 px-4 py-3 font-black text-white disabled:opacity-50">{busy?'Working...':'Reject'}</button><button disabled={busy} type="button" onClick={()=>review('approved')} className="rounded-xl bg-emerald-600 px-4 py-3 font-black text-white disabled:opacity-50">{busy?'Working...':'Approve'}</button></div></div></div>}
  </main>
}
