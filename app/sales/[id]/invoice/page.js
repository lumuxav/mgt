'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function SalesInvoicePage(){
  const params=useParams()
  const id=params?.id
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [sale,setSale]=useState(null)
  const [items,setItems]=useState([])
  const [payments,setPayments]=useState([])
  const [cashier,setCashier]=useState(null)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    ;(async()=>{
      try{
        const ctx=await getPlatformContext();setContext(ctx)
        const saleRes=await supabase.from('sales')
          .select('id,sale_number,organization_id,location_id,customer_id,pricing_mode,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,refunded_amount,notes,sold_by,created_at,customers(name,phone,email,address),locations(name,code,type)')
          .eq('id',id).maybeSingle()
        if(saleRes.error)throw saleRes.error
        if(!saleRes.data)throw new Error('Sale not found.')
        setSale(saleRes.data)
        const [itemRes,paymentRes,userRes]=await Promise.all([
          supabase.from('sale_items').select('id,description,quantity,unit_price,discount_amount,tax_amount,line_total').eq('sale_id',id),
          supabase.from('payments').select('id,direction,payment_type,method,amount,reference,created_at').eq('sale_id',id).order('created_at'),
          saleRes.data.sold_by?supabase.from('users').select('full_name').eq('id',saleRes.data.sold_by).maybeSingle():Promise.resolve({data:null,error:null}),
        ])
        for(const r of [itemRes,paymentRes,userRes])if(r.error)throw r.error
        setItems(itemRes.data||[]);setPayments(paymentRes.data||[]);setCashier(userRes.data||null)
      }catch(error){setMessage(error.message||'Could not load sales invoice.')}
      finally{setLoading(false)}
    })()
  },[id])

  if(loading)return <main className="page-wrap text-muted">Loading invoice...</main>
  if(!sale)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>

  const profile=businessDocumentProfile(context,business)
  const currency=profile.currency
  const balance=Math.max(0,Number(sale.total_amount||0)-Number(sale.refunded_amount||0)-Number(sale.amount_paid||0))
  const share=async()=>{
    await shareDocument({title:'Invoice '+sale.sale_number,lines:[
      profile.tradingName,'Sales Invoice '+sale.sale_number,
      sale.customers?.name?'Bill to: '+sale.customers.name:'',
      'Total: '+money(sale.total_amount,currency),'Paid: '+money(sale.amount_paid,currency),'Balance: '+money(balance,currency)
    ]})
    setMessage('Invoice details copied/shared.')
  }

  return <main className="page-wrap">
    <DocumentToolbar backHref="/sales" backLabel="Sales" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={sale.locations} title={profile.taxNumber?'Tax / Sales Invoice':'Sales Invoice'} number={sale.sale_number} status={sale.payment_status} meta={'Issued '+dateText(sale.created_at,true)}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Bill to" name={sale.customers?.name||'Walk-in customer'} phone={sale.customers?.phone} email={sale.customers?.email} address={sale.customers?.address}/>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Sale details</span><strong className="mt-1 block">Issued by {cashier?.full_name||'Business staff'}</strong><span className="mt-0.5 block text-xs capitalize text-slate-500">{sale.pricing_mode||'retail'} pricing · {sale.status}</span></div>
      </section>
      <section className="py-5">
        <div className="grid grid-cols-[1fr_64px_105px_115px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
        <div className="divide-y divide-slate-100">{items.map(item=><div key={item.id} className="grid grid-cols-[1fr_64px_105px_115px] gap-3 py-3 text-sm"><div><strong>{item.description}</strong>{Number(item.discount_amount||0)>0&&<p className="mt-1 text-xs text-slate-500">Line discount {money(item.discount_amount,currency)}</p>}</div><span className="text-right">{Number(item.quantity).toLocaleString()}</span><span className="text-right">{money(item.unit_price,currency)}</span><strong className="text-right">{money(item.line_total,currency)}</strong></div>)}</div>
      </section>
      <DocumentTotals currency={currency} total={sale.total_amount} balance={balance} rows={[
        {label:'Subtotal',value:sale.subtotal},
        {label:'Discount',value:sale.discount_amount,prefix:'- '},
        {label:'Tax',value:sale.tax_amount},
        Number(sale.refunded_amount||0)>0?{label:'Returned / credited',value:sale.refunded_amount,prefix:'- ',className:'text-amber-600'}:null,
        {label:'Paid',value:sale.amount_paid,className:'text-emerald-600'}
      ]}/>
      {payments.length>0&&<section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Payments applied</h2><div className="mt-3 space-y-2">{payments.map(p=><div key={p.id} className="flex justify-between gap-4 text-sm"><span className="capitalize text-slate-600">{dateText(p.created_at,true)} · {String(p.method||'payment').replaceAll('_',' ')}{p.reference?' · '+p.reference:''}</span><strong className={p.direction==='out'?'text-red-600':'text-emerald-600'}>{p.direction==='out'?'- ':'+ '}{money(p.amount,currency)}</strong></div>)}</div></section>}
      {sale.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{sale.notes}</p></section>}
      <DocumentFooter profile={profile}/>
    </DocumentPaper>
  </main>
}
