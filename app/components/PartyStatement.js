'use client'

import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { statementDates } from '../../lib/statementDates'
import { businessDocumentProfile, dateText, DocumentFooter, DocumentHeader, DocumentPaper, DocumentToolbar, money, PartyBlock, shareDocument } from './BusinessDocument'

export default function PartyStatement({kind}) {
  const {id}=useParams()
  const [startDate,setStartDate]=useState(null)
  const [endDate,setEndDate]=useState(null)
  const [retry,setRetry]=useState(0)
  const [result,setResult]=useState({key:'',data:null,context:null,error:''})
  const [message,setMessage]=useState('')
  const requestKey=JSON.stringify([kind,id,startDate,endDate,retry])
  const pending=result.key!==requestKey
  const supplier=kind==='supplier'
  const title=supplier?'Supplier Statement':'Customer Statement'

  useEffect(()=>{
    let active=true
    const controller=new AbortController()
    ;(async()=>{
      try{
        const context=await getPlatformContext()
        if(startDate===null&&endDate===null){
          const dates=statementDates(context.organization?.timezone||'UTC')
          if(active){setStartDate(dates.startDate);setEndDate(dates.endDate)}
          return
        }
        if(!startDate||!endDate||startDate>endDate)throw new Error('Choose a valid statement period.')
        const {data,error}=await supabase.rpc('get_party_statement',{p_party_type:kind,p_party_id:id,p_start_date:startDate,p_end_date:endDate}).abortSignal(controller.signal)
        if(error)throw error
        if(active)setResult({key:requestKey,data,context,error:''})
      }catch(error){if(active)setResult({key:requestKey,data:null,context:null,error:error.message||'Could not load statement.'})}
    })()
    return ()=>{active=false;controller.abort()}
  },[kind,id,startDate,endDate,requestKey])

  const statement=pending?null:result.data
  const party=statement?.party
  const profile=businessDocumentProfile(result.context,getBusinessConfig())
  const currency=profile.currency
  const share=async()=>{
    if(!statement)return
    await shareDocument({title:`${title} - ${party.name}`,lines:[profile.tradingName,`${title}: ${party.name}`,`Period: ${startDate} to ${endDate}`,`Balance: ${money(statement.closing,currency)}`]})
    setMessage('Statement details copied/shared.')
  }
  return <main className="page-wrap">
    <DocumentToolbar backHref={`/statements/${kind}s`} backLabel={`${title}s`} onShare={statement?share:undefined}/>
    <div className="mb-5 flex flex-wrap gap-3 page-card p-4 print:hidden">
      <label><span className="mb-1 block text-xs font-bold text-muted">From</span><input className="input-base" type="date" value={startDate||''} onChange={e=>setStartDate(e.target.value)}/></label>
      <label><span className="mb-1 block text-xs font-bold text-muted">To</span><input className="input-base" type="date" value={endDate||''} onChange={e=>setEndDate(e.target.value)}/></label>
    </div>
    {pending&&<p className="text-muted" role="status">Loading statement…</p>}
    {!pending&&result.error&&<div className="page-card p-5" role="alert"><p className="text-red-500">{result.error}</p><button className="btn-secondary mt-3 rounded-xl px-3 py-2" onClick={()=>setRetry(value=>value+1)}>Try again</button></div>}
    {message&&statement&&<p className="mb-4 text-sm print:hidden">{message}</p>}
    {statement&&<>
      <p className="mb-3 text-sm text-muted">Scope: {statement.scope}. Dates use {statement.timezone}.</p>
      <DocumentPaper>
        <DocumentHeader profile={profile} title={title} number={party.name} meta={`${startDate} → ${endDate}`}/>
        <section className="grid gap-5 border-b border-slate-200 py-5 sm:grid-cols-2"><PartyBlock label={supplier?'Supplier account':'Account customer'} name={party.name} phone={party.phone} email={party.email} address={party.address}/><div><span className="block text-xs font-black uppercase tracking-wide text-slate-400">Statement period</span><strong className="mt-1 block">{dateText(startDate)} → {dateText(endDate)}</strong></div></section>
        <div className="overflow-x-auto py-5"><table className="w-full text-left text-sm"><thead><tr className="border-b border-slate-200"><th className="py-3">Date</th><th>Transaction</th><th className="text-right">{supplier?'Purchase':'Charge'}</th><th className="text-right">Credit</th><th className="text-right">Balance</th></tr></thead><tbody>
          <tr className="border-b border-slate-100"><td className="py-3">{dateText(startDate)}</td><td>Balance brought forward</td><td/><td/><td className="text-right font-bold">{money(statement.opening,currency)}</td></tr>
          {statement.rows.map(row=><tr key={row.id} className="border-b border-slate-100"><td className="py-3 pr-3">{dateText(row.date)}</td><td className="pr-3"><strong>{row.type}</strong><p className="text-xs text-slate-500">{row.reference}</p></td><td className="text-right">{row.debit?money(row.debit,currency):'—'}</td><td className="text-right">{row.credit?money(row.credit,currency):'—'}</td><td className="text-right font-bold">{money(row.balance,currency)}</td></tr>)}
        </tbody></table></div>
        <section className="ml-auto max-w-md space-y-2 border-t border-slate-200 pt-4 text-sm"><div className="flex justify-between"><span>Period charges</span><strong>{money(statement.debits,currency)}</strong></div><div className="flex justify-between"><span>Period credits</span><strong>{money(statement.credits,currency)}</strong></div><div className="flex justify-between border-t border-slate-200 pt-3 text-lg"><strong>Closing balance {supplier?'payable':'due'}</strong><strong>{money(statement.closing,currency)}</strong></div></section>
        <DocumentFooter profile={profile} note="Please contact us if you have a question about this statement."/>
      </DocumentPaper>
    </>}
  </main>
}
