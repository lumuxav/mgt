'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function PurchaseOrderDocument(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [purchase,setPurchase]=useState(null)
  const [items,setItems]=useState([])
  const [payments,setPayments]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const pRes=await supabase.from('purchases').select('*,suppliers(name,phone,email,address),locations(name,type)').eq('id',id).maybeSingle()
      if(pRes.error)throw pRes.error
      if(!pRes.data)throw new Error('Purchase order not found.')
      setPurchase(pRes.data)
      const [iRes,payRes]=await Promise.all([
        supabase.from('purchase_items').select('*').eq('purchase_id',id),
        supabase.from('payments').select('id,method,amount,reference,created_at').eq('purchase_id',id).eq('direction','out').order('created_at')
      ])
      if(iRes.error)throw iRes.error;if(payRes.error)throw payRes.error
      setItems(iRes.data||[]);setPayments(payRes.data||[])
    }catch(error){setMessage(error.message||'Could not load purchase order.')}
    finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading purchase order...</main>
  if(!purchase)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>

  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const balance=Math.max(0,Number(purchase.total_amount||0)-Number(purchase.amount_paid||0))
  const share=async()=>{await shareDocument({title:'Purchase Order '+purchase.purchase_number,lines:[profile.tradingName,'Purchase Order '+purchase.purchase_number,'Supplier: '+(purchase.suppliers?.name||'Supplier'),'Total: '+money(purchase.total_amount,currency)]});setMessage('Purchase order details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/purchasing" backLabel="Purchasing" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={purchase.locations} title="Purchase Order" number={purchase.purchase_number} status={purchase.status} meta={purchase.approval_status?'Approval: '+String(purchase.approval_status).replaceAll('_',' '):''}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Supplier" name={purchase.suppliers?.name||'Supplier'} phone={purchase.suppliers?.phone} email={purchase.suppliers?.email} address={purchase.suppliers?.address}/>
        <div className="grid grid-cols-2 gap-4"><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Order date</span><strong className="mt-1 block">{dateText(purchase.ordered_at||purchase.created_at)}</strong></div><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Payment due</span><strong className="mt-1 block">{purchase.due_date?dateText(purchase.due_date):'Not specified'}</strong></div>{purchase.supplier_invoice_number&&<div className="col-span-2"><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Supplier invoice</span><strong className="mt-1 block">{purchase.supplier_invoice_number}</strong></div>}</div>
      </section>
      <section className="py-5">
        <div className="grid grid-cols-[1fr_65px_80px_105px_115px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Item</span><span className="text-right">Qty</span><span className="text-right">Received</span><span className="text-right">Unit cost</span><span className="text-right">Amount</span></div>
        <div className="divide-y divide-slate-100">{items.map(item=><div key={item.id} className="grid grid-cols-[1fr_65px_80px_105px_115px] gap-3 py-3 text-sm"><strong>{item.description}</strong><span className="text-right">{Number(item.quantity).toLocaleString()}</span><span className="text-right">{Number(item.received_quantity||0).toLocaleString()}</span><span className="text-right">{money(item.unit_cost,currency)}</span><strong className="text-right">{money(item.line_total,currency)}</strong></div>)}</div>
      </section>
      <DocumentTotals currency={currency} total={purchase.total_amount} balance={balance} rows={[
        {label:'Subtotal',value:purchase.subtotal},{label:'Tax',value:purchase.tax_amount},{label:'Paid to supplier',value:purchase.amount_paid,className:'text-emerald-600'}
      ]}/>
      {payments.length>0&&<section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Supplier payments</h2><div className="mt-3 space-y-2">{payments.map(p=><div key={p.id} className="flex justify-between text-sm"><span className="capitalize text-slate-600">{dateText(p.created_at,true)} · {String(p.method||'payment').replaceAll('_',' ')}{p.reference?' · '+p.reference:''}</span><strong>{money(p.amount,currency)}</strong></div>)}</div></section>}
      {purchase.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Order notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{purchase.notes}</p></section>}
      <DocumentFooter profile={profile} note="Please reference the purchase order number on supplier documents."/>
    </DocumentPaper>
  </main>
}
