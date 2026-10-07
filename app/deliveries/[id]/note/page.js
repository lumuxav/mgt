'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function DeliveryNotePage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [delivery,setDelivery]=useState(null)
  const [items,setItems]=useState([])
  const [sourceLabel,setSourceLabel]=useState('')
  const [driver,setDriver]=useState(null)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const dRes=await supabase.from('deliveries').select('*,customers(name,phone,email,address),locations(name,type),vehicles(registration_number,make,model)').eq('id',id).maybeSingle()
      if(dRes.error)throw dRes.error
      if(!dRes.data)throw new Error('Delivery not found.')
      setDelivery(dRes.data)
      if(dRes.data.driver_user_id){const uRes=await supabase.from('users').select('full_name').eq('id',dRes.data.driver_user_id).maybeSingle();if(!uRes.error)setDriver(uRes.data)}
      if(dRes.data.sale_id){
        const [sRes,iRes]=await Promise.all([
          supabase.from('sales').select('sale_number').eq('id',dRes.data.sale_id).maybeSingle(),
          supabase.from('sale_items').select('id,description,quantity').eq('sale_id',dRes.data.sale_id)
        ])
        if(sRes.error)throw sRes.error;if(iRes.error)throw iRes.error
        setSourceLabel('Sale '+(sRes.data?.sale_number||''));setItems((iRes.data||[]).map(x=>({id:x.id,description:x.description,quantity:x.quantity,unit:''})))
      }else if(dRes.data.work_order_id){
        const [wRes,iRes]=await Promise.all([
          supabase.from('work_orders').select('job_number,title').eq('id',dRes.data.work_order_id).maybeSingle(),
          supabase.from('work_order_lines').select('id,description,quantity,line_type').eq('work_order_id',dRes.data.work_order_id)
        ])
        if(wRes.error)throw wRes.error;if(iRes.error)throw iRes.error
        setSourceLabel('Job '+(wRes.data?.job_number||wRes.data?.title||''));setItems((iRes.data||[]).map(x=>({id:x.id,description:x.description,quantity:x.quantity,unit:x.line_type})))
      }
    }catch(error){setMessage(error.message||'Could not load delivery note.')}
    finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading delivery note...</main>
  if(!delivery)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>

  const profile=businessDocumentProfile(context,business)
  const share=async()=>{await shareDocument({title:'Delivery Note '+delivery.delivery_number,lines:[profile.tradingName,'Delivery Note '+delivery.delivery_number,'To: '+(delivery.customers?.name||delivery.contact_name||delivery.destination||'Recipient'),sourceLabel]});setMessage('Delivery note details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/fleet" backLabel="Fleet & Delivery" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={delivery.locations} title="Delivery Note" number={delivery.delivery_number} status={delivery.status} meta={sourceLabel}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Deliver to" name={delivery.customers?.name||delivery.contact_name||'Recipient'} phone={delivery.contact_phone||delivery.customers?.phone} email={delivery.customers?.email} address={delivery.destination||delivery.customers?.address}/>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Dispatch details</span><strong className="mt-1 block">{driver?.full_name||'Driver not assigned'}</strong><span className="mt-0.5 block text-xs text-slate-500">{delivery.vehicles?delivery.vehicles.registration_number+' · '+[delivery.vehicles.make,delivery.vehicles.model].filter(Boolean).join(' '):'Vehicle not assigned'}</span><span className="mt-0.5 block text-xs text-slate-500">{delivery.dispatched_at?'Dispatched '+dateText(delivery.dispatched_at,true):delivery.scheduled_at?'Scheduled '+dateText(delivery.scheduled_at,true):'Not dispatched'}</span></div>
      </section>
      <section className="py-5">
        <div className="grid grid-cols-[1fr_90px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Goods / service item</span><span className="text-right">Quantity</span></div>
        <div className="divide-y divide-slate-100">{items.length?items.map(item=><div key={item.id} className="grid grid-cols-[1fr_90px] gap-3 py-3 text-sm"><div><strong>{item.description}</strong>{item.unit&&<p className="text-xs capitalize text-slate-500">{String(item.unit).replaceAll('_',' ')}</p>}</div><strong className="text-right">{Number(item.quantity).toLocaleString()}</strong></div>):<div className="py-4 text-sm"><strong>{delivery.package_description||'Delivery package'}</strong></div>}</div>
      </section>
      {delivery.package_description&&items.length>0&&<section className="rounded-xl bg-slate-50 p-4 text-sm"><strong>Package description</strong><p className="mt-1 text-slate-600">{delivery.package_description}</p></section>}
      <section className="mt-6 grid gap-5 border-t border-slate-200 pt-5 text-sm sm:grid-cols-2">
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Recipient / proof of delivery</span><strong className="mt-1 block">{delivery.recipient_name||'____________________________'}</strong><span className="mt-5 block border-b border-slate-300 pb-1 text-xs text-slate-400">Signature / stamp</span></div>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Delivery completion</span><strong className="mt-1 block">{delivery.delivered_at?dateText(delivery.delivered_at,true):'Pending delivery'}</strong>{delivery.delivery_notes&&<span className="mt-1 block text-xs text-slate-500">{delivery.delivery_notes}</span>}{delivery.failure_reason&&<span className="mt-1 block text-xs text-red-600">{delivery.failure_reason}</span>}</div>
      </section>
      <DocumentFooter profile={profile} note="Please confirm that the goods/services listed above were received in good condition."/>
    </DocumentPaper>
  </main>
}
