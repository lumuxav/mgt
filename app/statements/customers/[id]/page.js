'use client'

import { useEffect,useMemo,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

const dateAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)}
const today=()=>new Date().toISOString().slice(0,10)
const key=value=>new Date(value).toISOString().slice(0,10)

export default function CustomerStatement(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [customer,setCustomer]=useState(null)
  const [transactions,setTransactions]=useState([])
  const [startDate,setStartDate]=useState(dateAgo(89))
  const [endDate,setEndDate]=useState(today())
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const [custRes,saleRes,returnRes,jobRes,invoiceRes,paymentRes]=await Promise.all([
        supabase.from('customers').select('*').eq('id',id).maybeSingle(),
        supabase.from('sales').select('id,sale_number,total_amount,created_at,status').eq('customer_id',id).order('created_at'),
        supabase.from('sale_returns').select('id,return_number,total_amount,created_at,sale_id').eq('customer_id',id).order('created_at'),
        supabase.from('work_orders').select('id,job_number,title,final_amount,created_at,status').eq('customer_id',id).neq('status','cancelled').order('created_at'),
        supabase.from('project_invoices').select('id,invoice_number,total_amount,issue_date,status').eq('customer_id',id).neq('status','void').order('issue_date'),
        supabase.from('payments').select('id,direction,payment_type,method,amount,reference,created_at').eq('customer_id',id).order('created_at')
      ])
      for(const r of [custRes,saleRes,returnRes,jobRes,invoiceRes,paymentRes])if(r.error)throw r.error
      if(!custRes.data)throw new Error('Customer not found.')
      setCustomer(custRes.data)
      const rows=[]
      for(const x of saleRes.data||[])rows.push({id:'sale-'+x.id,date:x.created_at,type:'Sales invoice',reference:x.sale_number,debit:Number(x.total_amount||0),credit:0})
      for(const x of returnRes.data||[])rows.push({id:'return-'+x.id,date:x.created_at,type:'Sales return / credit',reference:x.return_number,debit:0,credit:Number(x.total_amount||0)})
      for(const x of jobRes.data||[])if(Number(x.final_amount||0)>0)rows.push({id:'job-'+x.id,date:x.created_at,type:'Service job',reference:x.job_number||x.title,debit:Number(x.final_amount||0),credit:0})
      for(const x of invoiceRes.data||[])rows.push({id:'project-'+x.id,date:x.issue_date,type:'Project invoice',reference:x.invoice_number,debit:Number(x.total_amount||0),credit:0})
      for(const x of paymentRes.data||[])rows.push({id:'pay-'+x.id,date:x.created_at,type:x.direction==='out'?'Refund / payment out':'Payment received',reference:x.reference||String(x.method||'payment').replaceAll('_',' '),debit:x.direction==='out'?Number(x.amount||0):0,credit:x.direction==='out'?0:Number(x.amount||0)})
      rows.sort((a,b)=>new Date(a.date)-new Date(b.date))
      setTransactions(rows)
    }catch(error){setMessage(error.message||'Could not load customer statement.')}finally{setLoading(false)}
  })()},[id])

  const statement=useMemo(()=>{
    const opening=Number(customer?.opening_balance||0)+transactions.filter(x=>key(x.date)<startDate).reduce((s,x)=>s+x.debit-x.credit,0)
    let running=opening
    const rows=transactions.filter(x=>key(x.date)>=startDate&&key(x.date)<=endDate).map(x=>{running+=x.debit-x.credit;return {...x,balance:running}})
    return {opening,rows,closing:running,debits:rows.reduce((s,x)=>s+x.debit,0),credits:rows.reduce((s,x)=>s+x.credit,0)}
  },[customer,transactions,startDate,endDate])

  if(loading)return <main className="page-wrap text-muted">Loading customer statement...</main>
  if(!customer)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const share=async()=>{await shareDocument({title:'Statement - '+customer.name,lines:[profile.tradingName,'Customer Statement: '+customer.name,'Period: '+startDate+' to '+endDate,'Balance due: '+money(statement.closing,currency)]});setMessage('Statement details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/statements/customers" backLabel="Customer Statements" onShare={share}/>
    <div className="mb-5 flex flex-wrap gap-3 page-card p-4 print:hidden"><label><span className="mb-1 block text-xs font-bold text-muted">From</span><input className="input-base" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label><label><span className="mb-1 block text-xs font-bold text-muted">To</span><input className="input-base" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label></div>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} title="Customer Statement" number={customer.name} meta={startDate+' → '+endDate}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 sm:grid-cols-2"><PartyBlock label="Account customer" name={customer.name} phone={customer.phone} email={customer.email} address={customer.address}/><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Statement period</span><strong className="mt-1 block">{dateText(startDate)} → {dateText(endDate)}</strong><span className="mt-1 block text-xs text-slate-500">Opening / brought forward: {money(statement.opening,currency)}</span></div></section>
      <section className="py-5">
        <div className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 border-b border-slate-200 pb-2 text-[10px] font-black uppercase text-slate-400"><span>Date</span><span>Transaction</span><span className="text-right">Charge</span><span className="text-right">Credit</span><span className="text-right">Balance</span></div>
        <div className="divide-y divide-slate-100"><div className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 py-3 text-sm"><span>{dateText(startDate)}</span><strong>Balance brought forward</strong><span/><span/><strong className="text-right">{money(statement.opening,currency)}</strong></div>{statement.rows.map(x=><div key={x.id} className="grid grid-cols-[90px_1fr_110px_110px_120px] gap-3 py-3 text-sm"><span>{dateText(x.date)}</span><div><strong>{x.type}</strong><p className="text-xs text-slate-500">{x.reference}</p></div><span className="text-right">{x.debit?money(x.debit,currency):'—'}</span><span className="text-right">{x.credit?money(x.credit,currency):'—'}</span><strong className="text-right">{money(x.balance,currency)}</strong></div>)}</div>
      </section>
      <section className="ml-auto max-w-md border-t border-slate-200 pt-4 text-sm"><div className="flex justify-between"><span className="text-slate-500">Period charges</span><strong>{money(statement.debits,currency)}</strong></div><div className="mt-2 flex justify-between"><span className="text-slate-500">Period credits / receipts</span><strong>{money(statement.credits,currency)}</strong></div><div className="mt-3 flex justify-between border-t border-slate-200 pt-3 text-lg"><strong>Closing balance due</strong><strong className={statement.closing>0?'text-red-600':'text-emerald-600'}>{money(statement.closing,currency)}</strong></div></section>
      <DocumentFooter profile={profile} note="Please contact us if you have a question about this statement."/>
    </DocumentPaper>
  </main>
}
