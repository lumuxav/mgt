'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function ReceiptPage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [sale,setSale]=useState(null)
  const [items,setItems]=useState([])
  const [payments,setPayments]=useState([])
  const [returns,setReturns]=useState([])
  const [cashier,setCashier]=useState(null)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const sRes=await supabase.from('sales').select('id,sale_number,organization_id,location_id,customer_id,pricing_mode,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,refunded_amount,notes,sold_by,created_at,customers(name,phone,email,address),locations(name,code,type)').eq('id',id).maybeSingle()
      if(sRes.error)throw sRes.error;if(!sRes.data)throw new Error('Sale not found.')
      setSale(sRes.data)
      const [iRes,pRes,rRes,uRes]=await Promise.all([
        supabase.from('sale_items').select('id,description,quantity,unit_price,discount_amount,tax_amount,line_total').eq('sale_id',id),
        supabase.from('payments').select('id,direction,payment_type,method,amount,reference,created_at').eq('sale_id',id).order('created_at'),
        supabase.from('sale_returns').select('id,return_number,total_amount,created_at').eq('sale_id',id).order('created_at'),
        sRes.data.sold_by?supabase.from('users').select('full_name').eq('id',sRes.data.sold_by).maybeSingle():Promise.resolve({data:null,error:null})
      ])
      for(const r of [iRes,pRes,rRes,uRes])if(r.error)throw r.error
      setItems(iRes.data||[]);setPayments(pRes.data||[]);setReturns(rRes.data||[]);setCashier(uRes.data||null)
    }catch(error){setMessage(error.message||'Could not load receipt.')}finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading receipt...</main>
  if(!sale)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const balance=Math.max(0,Number(sale.total_amount||0)-Number(sale.refunded_amount||0)-Number(sale.amount_paid||0))
  const share=async()=>{await shareDocument({title:'Receipt '+sale.sale_number,lines:[profile.tradingName,'Receipt '+sale.sale_number,'Total: '+money(sale.total_amount,currency),'Paid: '+money(sale.amount_paid,currency),balance?'Balance: '+money(balance,currency):'Paid in full']});setMessage('Receipt details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/sales" backLabel="Sales" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper size="narrow">
      <DocumentHeader profile={profile} location={sale.locations} title="Sales Receipt" number={sale.sale_number} status={sale.payment_status} meta={dateText(sale.created_at,true)}/>
      <section className="grid gap-4 border-b border-slate-200 py-5 text-sm sm:grid-cols-2"><PartyBlock label="Customer" name={sale.customers?.name||'Walk-in customer'} phone={sale.customers?.phone} email={sale.customers?.email}/><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Cashier</span><strong className="mt-1 block">{cashier?.full_name||'Business staff'}</strong><span className="text-xs capitalize text-slate-500">{sale.pricing_mode||'retail'} pricing</span></div></section>
      <section className="py-5"><div className="grid grid-cols-[1fr_auto] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Item</span><span>Total</span></div><div className="divide-y divide-slate-100">{items.map(item=><div key={item.id} className="grid grid-cols-[1fr_auto] gap-3 py-3 text-sm"><div><strong>{item.description}</strong><p className="mt-1 text-xs text-slate-500">{Number(item.quantity).toLocaleString()} × {money(item.unit_price,currency)}{Number(item.discount_amount||0)>0?' · discount '+money(item.discount_amount,currency):''}</p></div><strong>{money(item.line_total,currency)}</strong></div>)}</div></section>
      <DocumentTotals currency={currency} total={sale.total_amount} balance={balance} rows={[
        {label:'Subtotal',value:sale.subtotal},{label:'Discount',value:sale.discount_amount,prefix:'- '},{label:'Tax',value:sale.tax_amount},
        Number(sale.refunded_amount||0)>0?{label:'Returned / refunded',value:sale.refunded_amount,prefix:'- ',className:'text-amber-600'}:null,
        {label:'Paid',value:sale.amount_paid,className:'text-emerald-600'}
      ]}/>
      <section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Payment activity</h2><div className="mt-3 space-y-2">{!payments.length&&<p className="text-sm text-slate-500">No payment received yet.</p>}{payments.map(p=><div key={p.id} className="flex justify-between gap-4 text-sm"><span className="capitalize text-slate-600">{String(p.payment_type||'payment').replaceAll('_',' ')} · {String(p.method||'').replaceAll('_',' ')}{p.reference?' · '+p.reference:''}</span><strong className={p.direction==='out'?'text-red-600':'text-emerald-600'}>{p.direction==='out'?'- ':'+ '}{money(p.amount,currency)}</strong></div>)}</div></section>
      {returns.length>0&&<section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Returns</h2><div className="mt-3 space-y-2">{returns.map(x=><div key={x.id} className="flex justify-between text-sm"><span>{x.return_number} · {dateText(x.created_at)}</span><strong>{money(x.total_amount,currency)}</strong></div>)}</div></section>}
      {sale.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{sale.notes}</p></section>}
      <DocumentFooter profile={profile}/>
    </DocumentPaper>
  </main>
}
