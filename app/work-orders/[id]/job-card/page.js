'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function JobCardPage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [order,setOrder]=useState(null)
  const [lines,setLines]=useState([])
  const [team,setTeam]=useState([])
  const [users,setUsers]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const oRes=await supabase.from('work_orders').select('*,customers(name,phone,email,address),locations(name,type)').eq('id',id).maybeSingle()
      if(oRes.error)throw oRes.error;if(!oRes.data)throw new Error('Work order not found.')
      setOrder(oRes.data)
      const [lineRes,assignRes,userRes]=await Promise.all([
        supabase.from('work_order_lines').select('*').eq('work_order_id',id).order('created_at'),
        supabase.from('work_order_assignments').select('user_id').eq('work_order_id',id).order('assigned_at'),
        supabase.from('users').select('id,full_name').eq('organization_id',oRes.data.organization_id).eq('active',true)
      ])
      if(lineRes.error)throw lineRes.error;if(assignRes.error)throw assignRes.error;if(userRes.error)throw userRes.error
      setLines(lineRes.data||[]);setTeam(assignRes.data||[]);setUsers(userRes.data||[])
    }catch(error){setMessage(error.message||'Could not load job card.')}finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading job card...</main>
  if(!order)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business)
  const share=async()=>{await shareDocument({title:'Job Card '+order.job_number,lines:[profile.tradingName,'Job Card '+(order.job_number||''),order.title,'Customer: '+(order.customers?.name||'Walk-in customer'),'Status: '+String(order.status).replaceAll('_',' ')]});setMessage('Job card details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/work-orders" backLabel="Jobs" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={order.locations} title="Service Job Card" number={order.job_number||'Work Order'} status={order.status} meta={'Priority: '+String(order.priority||'normal').replaceAll('_',' ')}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Customer" name={order.customers?.name||'Walk-in customer'} phone={order.customers?.phone} email={order.customers?.email} address={order.customers?.address}/>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Job</span><strong className="mt-1 block">{order.title}</strong><span className="mt-1 block text-xs text-slate-500">Created {dateText(order.created_at,true)}</span>{order.scheduled_at&&<span className="mt-0.5 block text-xs text-slate-500">Scheduled {dateText(order.scheduled_at,true)}</span>}{order.due_at&&<span className="mt-0.5 block text-xs text-slate-500">Due {dateText(order.due_at,true)}</span>}</div>
      </section>

      <section className="border-b border-slate-200 py-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Scope / reported work</h2><p className="mt-2 min-h-12 whitespace-pre-wrap text-sm text-slate-700">{order.description||'No job description recorded.'}</p></section>

      <section className="border-b border-slate-200 py-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Assigned team</h2><p className="mt-2 text-sm">{team.length?team.map(x=>users.find(u=>u.id===x.user_id)?.full_name).filter(Boolean).join(', '):'Unassigned'}</p></section>

      <section className="py-5">
        <div className="grid grid-cols-[95px_1fr_70px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Type</span><span>Work / material</span><span className="text-right">Qty</span></div>
        <div className="divide-y divide-slate-100">{!lines.length&&<p className="py-4 text-sm text-slate-500">No itemized work/material lines recorded.</p>}{lines.map(line=><div key={line.id} className="grid grid-cols-[95px_1fr_70px] gap-3 py-3 text-sm"><span className="capitalize text-slate-500">{String(line.line_type).replaceAll('_',' ')}</span><strong>{line.description}</strong><span className="text-right">{Number(line.quantity).toLocaleString()}</span></div>)}</div>
      </section>

      <section className="grid gap-5 border-t border-slate-200 pt-5 text-sm sm:grid-cols-3">
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Started</span><strong className="mt-1 block">{order.started_at?dateText(order.started_at,true):'________________'}</strong></div>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Completed</span><strong className="mt-1 block">{order.completed_at?dateText(order.completed_at,true):'________________'}</strong></div>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Customer approval</span><span className="mt-6 block border-b border-slate-300 pb-1 text-xs text-slate-400">Name / signature / date</span></div>
      </section>

      {order.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Internal / completion notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{order.notes}</p></section>}
      <DocumentFooter profile={{...profile,terms:''}} note="This job card records the work scope, assigned team and customer completion acknowledgement."/>
    </DocumentPaper>
  </main>
}
