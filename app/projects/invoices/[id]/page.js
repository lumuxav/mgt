'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,DocumentTotals,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function ProjectInvoicePage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [invoice,setInvoice]=useState(null)
  const [project,setProject]=useState(null)
  const [customer,setCustomer]=useState(null)
  const [location,setLocation]=useState(null)
  const [lines,setLines]=useState([])
  const [payments,setPayments]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const invRes=await supabase.from('project_invoices').select('*').eq('id',id).maybeSingle()
      if(invRes.error)throw invRes.error;if(!invRes.data)throw new Error('Project invoice not found.')
      setInvoice(invRes.data)
      const [pRes,cRes,lRes,lineRes,payRes]=await Promise.all([
        supabase.from('projects').select('id,project_number,name,description').eq('id',invRes.data.project_id).maybeSingle(),
        supabase.from('customers').select('id,name,phone,email,address').eq('id',invRes.data.customer_id).maybeSingle(),
        supabase.from('locations').select('id,name,type').eq('id',invRes.data.location_id).maybeSingle(),
        supabase.from('project_invoice_lines').select('*').eq('invoice_id',id).order('created_at'),
        supabase.from('payments').select('id,method,amount,reference,created_at').eq('project_invoice_id',id).eq('direction','in').order('created_at')
      ])
      for(const r of [pRes,cRes,lRes,lineRes,payRes])if(r.error)throw r.error
      setProject(pRes.data);setCustomer(cRes.data);setLocation(lRes.data);setLines(lineRes.data||[]);setPayments(payRes.data||[])
    }catch(error){setMessage(error.message||'Could not load project invoice.')}finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading project invoice...</main>
  if(!invoice)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const balance=Math.max(0,Number(invoice.total_amount||0)-Number(invoice.amount_paid||0))
  const share=async()=>{await shareDocument({title:'Invoice '+invoice.invoice_number,lines:[profile.tradingName,'Project Invoice '+invoice.invoice_number,'Project: '+(project?.project_number||'')+' '+(project?.name||''),'Total: '+money(invoice.total_amount,currency),'Balance: '+money(balance,currency)]});setMessage('Invoice details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/projects" backLabel="Projects" onShare={share}>{project?.id&&<a href={'/projects/'+project.id+'/document'} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Project summary</a>}</DocumentToolbar>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={location} title={profile.taxNumber?'Tax / Project Invoice':'Project Invoice'} number={invoice.invoice_number} status={invoice.status} meta={'Issued '+dateText(invoice.issue_date)}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2"><PartyBlock label="Bill to" name={customer?.name||'Client'} phone={customer?.phone} email={customer?.email} address={customer?.address}/><div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Project</span><strong className="mt-1 block">{project?.project_number||''} · {project?.name||'Project'}</strong>{project?.description&&<span className="mt-1 block text-xs text-slate-500">{project.description}</span>}<span className="mt-1 block text-xs text-slate-500">Due {invoice.due_date?dateText(invoice.due_date):'on receipt / not specified'}</span></div></section>
      <section className="py-5"><div className="grid grid-cols-[1fr_65px_105px_115px] gap-3 border-b border-slate-200 pb-2 text-xs font-black uppercase text-slate-400"><span>Description</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span></div><div className="divide-y divide-slate-100">{lines.map(x=><div key={x.id} className="grid grid-cols-[1fr_65px_105px_115px] gap-3 py-3 text-sm"><strong>{x.description}</strong><span className="text-right">{Number(x.quantity).toLocaleString()}</span><span className="text-right">{money(x.unit_price,currency)}</span><strong className="text-right">{money(x.line_total,currency)}</strong></div>)}</div></section>
      <DocumentTotals currency={currency} total={invoice.total_amount} balance={balance} rows={[{label:'Subtotal',value:invoice.subtotal},{label:'Tax',value:invoice.tax_amount},{label:'Paid',value:invoice.amount_paid,className:'text-emerald-600'}]}/>
      {payments.length>0&&<section className="mt-6 border-t border-slate-200 pt-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Payments received</h2><div className="mt-3 space-y-2">{payments.map(p=><div key={p.id} className="flex justify-between text-sm"><span className="capitalize text-slate-600">{dateText(p.created_at,true)} · {String(p.method).replaceAll('_',' ')}{p.reference?' · '+p.reference:''}</span><strong>{money(p.amount,currency)}</strong></div>)}</div></section>}
      {invoice.notes&&<section className="mt-6 rounded-xl bg-slate-50 p-4 text-sm"><strong>Notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{invoice.notes}</p></section>}
      <DocumentFooter profile={profile}/>
    </DocumentPaper>
  </main>
}
