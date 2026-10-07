'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../lib/supabase'
import { getPlatformContext } from '../../../lib/platformDb'
import { getBusinessConfig } from '../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../components/BusinessDocument'

export default function QuotationPage(){
  const params=useParams()
  const id=params?.id
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [quote,setQuote]=useState(null)
  const [items,setItems]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{
    ;(async()=>{
      try{
        const ctx=await getPlatformContext();setContext(ctx)
        const quoteRes=await supabase.from('quotations').select('*,customers(name,phone,email,address),locations(name,type)').eq('id',id).maybeSingle()
        if(quoteRes.error)throw quoteRes.error
        if(!quoteRes.data)throw new Error('Quotation not found or you do not have access.')
        setQuote(quoteRes.data)
        const itemRes=await supabase.from('quotation_items').select('*').eq('quotation_id',id).order('created_at')
        if(itemRes.error)throw itemRes.error
        setItems(itemRes.data||[])
      }catch(error){setMessage(error.message||'Could not load quotation.')}
      finally{setLoading(false)}
    })()
  },[id])

  if(loading)return <main className="page-wrap text-muted">Loading quotation...</main>
  if(!quote)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>

  const profile=businessDocumentProfile(context,business)
  const currency=profile.currency
  const share=async()=>{
    await shareDocument({title:'Quotation '+quote.quotation_number,lines:[
      profile.tradingName,'Quotation '+quote.quotation_number,
      quote.customers?.name?'Prepared for '+quote.customers.name:'',
      'Total: '+money(quote.total_amount,currency),
      quote.valid_until?'Valid until: '+dateText(quote.valid_until):''
    ]})
    setMessage('Quotation link/details ready to share.')
  }

  return <main className="page-wrap">
    <DocumentToolbar backHref="/documents" backLabel="Documents" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={quote.locations} title="Quotation" number={quote.quotation_number} status={quote.status} meta={quote.valid_until?'Valid until '+dateText(quote.valid_until):'Validity not specified'}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Prepared for" name={quote.customers?.name||'Prospective / walk-in customer'} phone={quote.customers?.phone} email={quote.customers?.email} address={quote.customers?.address}/>
        <div className="grid grid-cols-2 gap-4"><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Issue date</span><strong className="mt-1 block">{dateText(quote.issue_date)}</strong></div><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Valid until</span><strong className="mt-1 block">{quote.valid_until?dateText(quote.valid_until):'Not specified'}</strong></div></div>
      </section>
      <section className="py-5">
        <div className="grid grid-cols-[1fr_64px_100px_110px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div>
        <div className="divide-y divide-slate-100">{items.map(item=><div key={item.id} className="grid grid-cols-[1fr_64px_100px_110px] gap-3 py-3 text-sm"><div><strong>{item.description}</strong>{Number(item.discount_amount||0)>0&&<p className="mt-1 text-xs text-slate-500">Discount {money(item.discount_amount,currency)}</p>}{Number(item.tax_amount||0)>0&&<p className="mt-1 text-xs text-slate-500">Tax {money(item.tax_amount,currency)}</p>}</div><span className="text-right">{Number(item.quantity).toLocaleString()}</span><span className="text-right">{money(item.unit_price,currency)}</span><strong className="text-right">{money(item.line_total,currency)}</strong></div>)}</div>
      </section>
      <DocumentTotals currency={currency} total={quote.total_amount} rows={[
        {label:'Subtotal',value:quote.subtotal},
        {label:'Discount',value:quote.discount_amount,prefix:'- '},
        {label:'Tax',value:quote.tax_amount}
      ]}/>
      {quote.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{quote.notes}</p></section>}
      {quote.terms&&<section className="mt-5 border-t border-slate-200 pt-5 text-sm"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Quotation terms</h2><p className="mt-2 whitespace-pre-wrap text-slate-600">{quote.terms}</p></section>}
      <DocumentFooter profile={{...profile,terms:quote.terms?'':profile.terms}} note="We appreciate the opportunity to quote for your business."/>
    </DocumentPaper>
  </main>
}
