'use client'

import { useEffect,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getPlatformContext } from '../../../lib/platformDb'

export default function SupplierStatementsIndex(){
  const [suppliers,setSuppliers]=useState([])
  const [search,setSearch]=useState('')
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')
  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext()
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const {data,error}=await supabase.from('suppliers').select('id,name,phone,email,address').eq('organization_id',ctx.organization.id).eq('active',true).order('name')
      if(error)throw error;setSuppliers(data||[])
    }catch(error){setMessage(error.message||'Could not load suppliers.')}finally{setLoading(false)}
  })()},[])
  if(loading)return <main className="page-wrap text-muted">Loading supplier statements...</main>
  const rows=suppliers.filter(x=>(x.name+' '+(x.phone||'')+' '+(x.email||'')).toLowerCase().includes(search.toLowerCase()))
  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Documents · Statements</p><h1 className="page-title">Supplier Statements</h1><p className="page-subtitle">Review purchases, supplier payments and the running payable balance.</p></div><Link href="/documents" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Documents</Link></div>
    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}
    <input className="input-base mb-5 max-w-xl" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search supplier name, phone or email"/>
    <section className="page-card overflow-hidden"><div className="divide-y divide-[var(--line)]">{!rows.length&&<p className="p-6 text-sm text-muted">No matching suppliers.</p>}{rows.map(x=><div key={x.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"><div><strong>{x.name}</strong><p className="mt-1 text-xs text-muted">{[x.phone,x.email].filter(Boolean).join(' · ')||'No contact details'}</p></div><Link href={'/statements/suppliers/'+x.id} className="btn-primary rounded-xl px-3 py-2 text-center text-xs font-black">Open statement</Link></div>)}</div></section>
  </main>
}
