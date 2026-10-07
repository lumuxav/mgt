'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function WorkOrderInvoicePage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [order,setOrder]=useState(null)
  const [lines,setLines]=useState([])
  const [payments,setPayments]=useState([])
  const [team,setTeam]=useState([])
  const [users,setUsers]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const oRes=await supabase.from('work_orders').select('id,job_number,organization_id,location_id,customer_id,title,description,status,priority,quoted_amount,final_amount,amount_paid,payment_status,due_at,scheduled_at,started_at,completed_at,notes,created_at,customers(name,phone,email,address),locations(name,type)').eq('id',id).maybeSingle()
      if(oRes.error)throw oRes.error;if(!oRes.data)throw new Error('Work order not found.')
      setOrder(oRes.data)
      const [lRes,pRes,aRes,uRes]=await Promise.all([
        supabase.from('work_order_lines').select('id,line_type,description,quantity,unit_price,line_total,created_at').eq('work_order_id',id).order('created_at'),
        supabase.from('payments').select('id,direction,payment_type,method,amount,reference,created_at').eq('work_order_id',id).order('created_at'),
        supabase.from('work_order_assignments').select('user_id').eq('work_order_id',id),
        supabase.from('users').select('id,full_name').eq('organization_id',oRes.data.organization_id).eq('active',true)
      ])
      for(const r of [lRes,pRes,aRes,uRes])if(r.error)throw r.error
      setLines(lRes.data||[]);setPayments(pRes.data||[]);setTeam(aRes.data||[]);setUsers(uRes.data||[])
    }catch(error){setMessage(error.message||'Could not load service invoice.')}finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading service invoice...</main>
  if(!order)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const total=Number(order.final_amount??order.quoted_amount??0)
  const paid=payments.reduce((s,p)=>s+(p.direction==='out'?-Number(p.amount||0):Number(p.amount||0)),0)
  const balance=Math.max(0,total-paid)
  const share=async()=>{await shareDocument({title:'Service Invoice '+order.job_number,lines:[profile.tradingName,'Service Invoice '+(order.job_number||''),order.title,'Total: '+money(total,currency),'Balance: '+money(balance,currency)]});setMessage('Invoice details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/work-orders" backLabel="Jobs" onShare={share}><a href={'/work-orders/'+id+'/job-card'} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Job card</a></DocumentToolbar>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={order.locations} title="Service Invoice" number={order.job_number||'Work Order'} status={order.payment_status||order.status} meta={order.completed_at?'Completed '+dateText(order.completed_at,true):'Job '+String(order.status).replaceAll('_',' ')}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2"><PartyBlock label="Bill to" name={order.customers?.name||'Walk-in customer'} phone={order.customers?.phone} email={order.customers?.email} address={order.customers?.address}/><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Service job</span><strong className="mt-1 block">{order.title}</strong><span className="mt-1 block text-xs text-slate-500">Team: {team.map(x=>users.find(u=>u.id===x.user_id)?.full_name).filter(Boolean).join(', ')||'Unassigned'}</span>{order.due_at&&<span className="mt-0.5 block text-xs text-slate-500">Due {dateText(order.due_at,true)}</span>}</div></section>
      {order.description&&<section className="border-b border-slate-200 py-5 text-sm"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Scope</h2><p className="mt-2 whitespace-pre-wrap text-slate-700">{order.description}</p></section>}
      <section className="py-5"><div className="grid grid-cols-[95px_1fr_70px_110px_115px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Type</span><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div><div className="divide-y divide-slate-100">{!lines.length&&<p className="py-4 text-sm text-slate-500">No itemized lines; final job amount is shown below.</p>}{lines.map(x=><div key={x.id} className="grid grid-cols-[95px_1fr_70px_110px_115px] gap-3 py-3 text-sm"><span className="capitalize text-slate-500">{String(x.line_type).replaceAll('_',' ')}</span><strong>{x.description}</strong><span className="text-right">{Number(x.quantity).toLocaleString()}</span><span className="text-right">{money(x.unit_price,currency)}</span><strong className="text-right">{money(x.line_total,currency)}</strong></div>)}</div></section>
      <DocumentTotals currency={currency} totalLabel="Job total" total={total} balance={balance} rows={[
        order.quoted_amount!=null?{label:'Original quote',value:order.quoted_amount}:null,{label:'Paid',value:paid,className:'text-emerald-600'}
      ]}/>
      {payments.length>0&&<section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Payments</h2><div className="mt-3 space-y-2">{payments.map(p=><div key={p.id} className="flex justify-between gap-4 text-sm"><span className="capitalize text-slate-600">{dateText(p.created_at,true)} · {String(p.method||'payment').replaceAll('_',' ')}{p.reference?' · '+p.reference:''}</span><strong>{p.direction==='out'?'- ':'+ '}{money(p.amount,currency)}</strong></div>)}</div></section>}
      {order.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{order.notes}</p></section>}
      <DocumentFooter profile={profile}/>
    </DocumentPaper>
  </main>
}
