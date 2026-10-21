'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

const dateAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)}
const today=()=>new Date().toISOString().slice(0,10)

export default function SupplierStatement(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [supplier,setSupplier]=useState(null)
  const [statement,setStatement]=useState({opening:0,rows:[],closing:0,debits:0,credits:0,scope:''})
  const [startDate,setStartDate]=useState(dateAgo(89))
  const [endDate,setEndDate]=useState(today())
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    let active=true
    const controller=new AbortController()
    ;(async()=>{
      try{
        const ctx=await getPlatformContext()
        const {data,error}=await supabase.rpc('get_party_statement',{p_party_type:'supplier',p_party_id:id,p_start_date:startDate,p_end_date:endDate}).abortSignal(controller.signal)
        if(error)throw error
        if(active){setContext(ctx);setSupplier(data.party);setStatement(data);setMessage('')}
      }catch(error){if(active){setSupplier(null);setMessage(error.message||'Could not load statement.')}}
      finally{if(active)setLoading(false)}
    })()
    return ()=>{active=false;controller.abort()}
  },[id,startDate,endDate])

  if(loading)return <main className="page-wrap text-muted">Loading supplier statement...</main>
  if(!supplier)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const share=async()=>{await shareDocument({title:'Supplier Statement - '+supplier.name,lines:[profile.tradingName,'Supplier Statement: '+supplier.name,'Period: '+startDate+' to '+endDate,'Balance payable: '+money(statement.closing,currency)]});setMessage('Statement details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/statements/suppliers" backLabel="Supplier Statements" onShare={share}/>
    <div className="mb-5 flex flex-wrap gap-3 page-card p-4 print:hidden"><label><span className="mb-1 block text-xs font-bold text-muted">From</span><input className="input-base" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label><span className="mb-1 block text-xs font-bold text-muted">To</span><input className="input-base" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label></div>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <p className="mb-3 text-sm text-muted">Scope: {statement.scope}. Dates use {statement.timezone}.</p>
    <DocumentPaper>
      <DocumentHeader profile={profile} title="Supplier Statement" number={supplier.name} meta={startDate+' → '+endDate}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 sm:grid-cols-2"><PartyBlock label="Supplier account" name={supplier.name} phone={supplier.phone} email={supplier.email} address={supplier.address}/><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Statement period</span><strong className="mt-1 block">{dateText(startDate)} → {dateText(endDate)}</strong><span className="mt-1 block text-xs text-slate-500">Opening / brought forward: {money(statement.opening,currency)}</span></div></section>
      <section className="py-5">
        <div className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 border-b border-slate-200 pb-2 text-[10px] font-black uppercase text-slate-400"><span>Date</span><span>Transaction</span><span className="text-right">Purchase</span><span className="text-right">Payment</span><span className="text-right">Balance</span></div>
        <div className="divide-y divide-slate-100"><div className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 py-3 text-sm"><span>{dateText(startDate)}</span><strong>Balance brought forward</strong><span/><span/><strong className="text-right">{money(statement.opening,currency)}</strong></div>{statement.rows.map(x=><div key={x.id} className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 py-3 text-sm"><span>{dateText(x.date)}</span><div><strong>{x.type}</strong><p className="text-xs text-slate-500">{x.reference}</p></div><span className="text-right">{x.debit?money(x.debit,currency):'—'}</span><span className="text-right">{x.credit?money(x.credit,currency):'—'}</span><strong className="text-right">{money(x.balance,currency)}</strong></div>)}</div>
      </section>
      <section className="ml-auto max-w-md border-t border-slate-200 pt-4 text-sm"><div className="flex justify-between"><span className="text-slate-500">Period purchases</span><strong>{money(statement.debits,currency)}</strong></div><div className="mt-2 flex justify-between"><span className="text-slate-500">Period payments / credits</span><strong>{money(statement.credits,currency)}</strong></div><div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg"><strong>Closing balance payable</strong><strong className={statement.closing>0?'text-red-600':'text-emerald-600'}>{money(statement.closing,currency)}</strong></div></section>
      <DocumentFooter profile={profile} note="This statement summarizes purchases and payments recorded in MGT."/>
    </DocumentPaper>
  </main>
}

