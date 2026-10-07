'use client'

import Link from 'next/link'

export const money=(value,currency)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(currency||'')
export const dateText=(value,withTime=false)=>{
  if(!value)return '—'
  const d=new Date(String(value).length===10?value+'T00:00:00':value)
  return withTime?d.toLocaleString():d.toLocaleDateString()
}

export function businessDocumentProfile(context,business={}){
  const org=context?.organization||{}
  return {
    name:org.legal_name||org.name||business.legalName||business.businessName||'Business',
    tradingName:org.name||business.businessName||'Business',
    shortName:org.short_name||business.shortName||'MGT',
    phone:org.phone||'',
    email:org.email||'',
    address:org.address||'',
    website:org.website||'',
    taxNumber:org.tax_number||'',
    registrationNumber:org.registration_number||'',
    logoUrl:org.logo_url||'',
    footer:org.document_footer||'',
    terms:org.document_terms||'',
    currency:org.currency||business.currency||'UGX',
  }
}

export function DocumentToolbar({backHref='/',backLabel='Back',onShare,printLabel='Print / Save PDF',children}){
  return <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
    <Link href={backHref} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">← {backLabel}</Link>
    <div className="flex flex-wrap gap-2">
      {children}
      {onShare&&<button type="button" onClick={onShare} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Share</button>}
      <button type="button" onClick={()=>window.print()} className="btn-primary rounded-xl px-4 py-2 text-sm font-black">{printLabel}</button>
    </div>
  </div>
}

export function DocumentPaper({children,size='wide'}){
  return <article className={'mx-auto '+(size==='narrow'?'max-w-2xl':'max-w-4xl')+' rounded-3xl bg-white p-6 text-slate-900 shadow-sm sm:p-8 print:max-w-none print:rounded-none print:p-0 print:shadow-none'}>{children}</article>
}

export function DocumentHeader({profile,location,title,number,status,meta}){
  const contact=[profile?.address,profile?.phone,profile?.email,profile?.website].filter(Boolean)
  const registrations=[
    profile?.registrationNumber?'Reg: '+profile.registrationNumber:'',
    profile?.taxNumber?'Tax/VAT: '+profile.taxNumber:'',
  ].filter(Boolean)
  return <header className="border-b-2 border-slate-900 pb-5">
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-4">
        {profile?.logoUrl&&<img src={profile.logoUrl} alt="" className="h-16 w-16 rounded-xl object-contain"/>}
        <div>
          <h1 className="text-2xl font-black tracking-tight">{profile?.name||'Business'}</h1>
          {profile?.tradingName&&profile.tradingName!==profile.name&&<p className="mt-0.5 text-sm font-bold text-slate-600">Trading as {profile.tradingName}</p>}
          {location&&<p className="mt-1 text-sm text-slate-500">{typeof location==='string'?location:location.name}</p>}
          {contact.length>0&&<p className="mt-2 max-w-md text-xs leading-5 text-slate-500">{contact.join(' · ')}</p>}
          {registrations.length>0&&<p className="mt-1 text-[11px] font-bold text-slate-500">{registrations.join(' · ')}</p>}
        </div>
      </div>
      <div className="text-left sm:min-w-56 sm:text-right">
        <p className="text-xs font-black uppercase tracking-[0.22em] text-slate-400">{title}</p>
        <p className="mt-1 text-xl font-black">{number||'—'}</p>
        {status&&<span className="mt-2 inline-block rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-black uppercase text-slate-600">{String(status).replaceAll('_',' ')}</span>}
        {meta&&<p className="mt-2 text-xs leading-5 text-slate-500">{meta}</p>}
      </div>
    </div>
  </header>
}

export function PartyBlock({label,name,phone,email,address,extra}){
  return <div>
    <span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">{label}</span>
    <strong className="mt-1 block">{name||'—'}</strong>
    {[phone,email,address,extra].filter(Boolean).map((value,index)=><span key={index} className="mt-0.5 block text-xs text-slate-500">{value}</span>)}
  </div>
}

export function DocumentTotals({rows=[],totalLabel='Total',total=0,currency,balance}){
  return <section className="ml-auto max-w-sm space-y-2 border-t border-slate-200 pt-5 text-sm">
    {rows.filter(row=>row&&row.value!=null).map((row,index)=><div key={row.label+index} className="flex justify-between gap-4"><span className="text-slate-500">{row.label}</span><strong className={row.className||''}>{row.prefix||''}{money(row.value,currency)}</strong></div>)}
    <div className="flex justify-between gap-4 border-t border-slate-200 pt-3 text-lg"><strong>{totalLabel}</strong><strong>{money(total,currency)}</strong></div>
    {balance!=null&&<div className="flex justify-between gap-4"><span className="text-slate-500">Balance due</span><strong className={Number(balance)>0?'text-red-600':'text-emerald-600'}>{money(balance,currency)}</strong></div>}
  </section>
}

export function DocumentFooter({profile,note}){
  return <footer className="mt-8 border-t border-slate-200 pt-5 text-center text-xs leading-5 text-slate-400">
    <p>{profile?.footer||note||'Thank you for your business.'}</p>
    {profile?.terms&&<p className="mt-1">{profile.terms}</p>}
    <p className="mt-2">Generated by MGT Business Suite</p>
  </footer>
}

export async function shareDocument({title,lines=[]}){
  const text=lines.filter(Boolean).join('\n')
  if(typeof navigator!=='undefined'&&navigator.share){
    try{await navigator.share({title,text,url:window.location.href});return true}catch{}
  }
  if(typeof navigator!=='undefined'&&navigator.clipboard){
    await navigator.clipboard.writeText(text+'\n'+window.location.href)
    return true
  }
  return false
}
