'use client'

import { useEffect,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getPlatformContext } from '../../../lib/platformDb'

export default function CustomerStatementsIndex(){
  const [customers,setCustomers]=useState([])
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')
  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext()
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const {data,error}=await supabase.from('customers').select('id,name,phone,email,address,customer_group').eq('organization_id',ctx.organization.id).eq('active',true).order('name')
      if(error)throw error;setCustomers(data||[])
    }catch(error){setMessage(error.message||'Could not load customers.')}finally{setLoading(false)}
  })()},[])
  if(loading)return <main className="page-wrap text-muted">Loading customer statements...</main>
  const rows=customers.filter(x=>(x.name+' '+(x.phone||'')+' '+(x.email||'')).toLowerCase().includes(search.toLowerCase()))
  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Documents · Statements</p><h1 className="page-title">Customer Statements</h1><p className="page-subtitle">Open a printable account statement for any active customer.</p></div><Link href="/documents" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Documents</Link></div>
    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}
    <input className="input-base mb-5 max-w-xl" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customer name, phone or email"/>
    <section className="page-card overflow-hidden"><div className="divide-y divide-[var(--line)]">{!rows.length&&<p className="p-6 text-sm text-muted">No matching customers.</p>}{rows.map(x=><div key={x.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>{x.name}</strong><p className="mt-1 text-xs text-muted">{[x.phone,x.email,x.customer_group].filter(Boolean).join(' · ')||'No contact details'}</p></div><Link href={'/statements/customers/'+x.id} className="btn-primary rounded-xl px-3 py-2 text-center text-xs font-black">Open statement</Link></div>)}</div></section>
  </main>
}
