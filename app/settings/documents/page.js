'use client'

import { useEffect,useRef,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getPlatformContext } from '../../../lib/platformDb'

const compressLogo=file=>new Promise((resolve,reject)=>{
  const reader=new FileReader()
  reader.onerror=()=>reject(new Error('Could not read that logo.'))
  reader.onload=()=>{
    const image=new Image()
    image.onerror=()=>reject(new Error('Could not open that logo image.'))
    image.onload=()=>{
      try{
        const max=420
        const ratio=Math.min(1,max/Math.max(image.width,image.height))
        const canvas=document.createElement('canvas')
        canvas.width=Math.max(1,Math.round(image.width*ratio))
        canvas.height=Math.max(1,Math.round(image.height*ratio))
        const ctx=canvas.getContext('2d')
        if(!ctx)throw new Error('Image processing is not supported on this device.')
        ctx.clearRect(0,0,canvas.width,canvas.height)
        ctx.drawImage(image,0,0,canvas.width,canvas.height)
        let data=canvas.toDataURL('image/webp',0.82)
        if(data.length>340000)data=canvas.toDataURL('image/jpeg',0.72)
        if(data.length>350000)throw new Error('The processed logo is still too large. Use a simpler or smaller image.')
        resolve(data)
      }catch(error){reject(error)}
    }
    image.src=reader.result
  }
  reader.readAsDataURL(file)
})

export default function DocumentSettingsPage(){
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [form,setForm]=useState({phone:'',email:'',address:'',website:'',tax_number:'',registration_number:'',logo_url:'',document_footer:'',document_terms:''})
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)
  const fileRef=useRef(null)

  useEffect(()=>{
    ;(async()=>{
      try{
        const ctx=await getPlatformContext()
        setContext(ctx)
        if(!ctx.organization?.id)throw new Error('Complete business setup first.')
        const {data,error}=await supabase.rpc('current_permissions')
        if(error)throw error
        setPermissions((data||[]).map(x=>x.permission))
        const org=ctx.organization
        setForm({
          phone:org.phone||'',email:org.email||'',address:org.address||'',website:org.website||'',
          tax_number:org.tax_number||'',registration_number:org.registration_number||'',logo_url:org.logo_url||'',
          document_footer:org.document_footer||'',document_terms:org.document_terms||''
        })
      }catch(error){setMessage({type:'error',text:error.message||'Could not load document settings.'})}
      finally{setLoading(false)}
    })()
  },[])

  const canManage=permissions.includes('settings.manage')
  const chooseLogo=()=>{if(fileRef.current){fileRef.current.value='';fileRef.current.click()}}
  const setLogo=async file=>{
    if(!file)return
    setMessage(null)
    if(!file.type.startsWith('image/'))return setMessage({type:'error',text:'Choose an image file for the business logo.'})
    if(file.size>10*1024*1024)return setMessage({type:'error',text:'Choose a logo smaller than 10 MB.'})
    setBusy(true)
    try{
      const logo=await compressLogo(file)
      setForm(current=>({...current,logo_url:logo}))
      setMessage({type:'success',text:'Logo prepared. Save the document profile to publish it.'})
    }catch(error){setMessage({type:'error',text:error.message||'Could not prepare the logo.'})}
    finally{setBusy(false)}
  }

  const save=async event=>{
    event.preventDefault()
    if(!canManage)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('save_document_profile',{
      p_phone:form.phone||null,p_email:form.email||null,p_address:form.address||null,p_website:form.website||null,
      p_tax_number:form.tax_number||null,p_registration_number:form.registration_number||null,p_logo_url:form.logo_url||null,
      p_document_footer:form.document_footer||null,p_document_terms:form.document_terms||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:'Business document profile saved. New and existing printable documents will use these details.'})
      const ctx=await getPlatformContext();setContext(ctx)
    }
    setBusy(false)
  }

  if(loading)return <main className="page-wrap text-muted">Loading document settings...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Settings · Business documents</p><h1 className="page-title">Document Profile</h1><p className="page-subtitle">Control the business identity printed on quotations, invoices, receipts, orders, statements, payslips, job cards and project documents.</p></div>
      <Link href="/settings" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Back to Settings</Link>
    </div>

    {message&&<div className={'mb-5 rounded-xl border px-4 py-3 text-sm '+(message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600')}>{message.text}</div>}

    {!canManage&&<div className="mb-5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-700">You can view these settings, but only a user with Business Settings permission can change the company document profile.</div>}

    <form onSubmit={save} className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <section className="page-card h-fit p-5">
        <h2 className="font-black">Brand identity</h2>
        <p className="mt-1 text-xs leading-5 text-muted">Use a clean square or horizontal logo. MGT compresses it before saving it with your business profile.</p>
        <div className="mt-5 grid min-h-44 place-items-center rounded-2xl border border-dashed border-[var(--line)] bg-[var(--panel-2)] p-5">
          {form.logo_url?<img src={form.logo_url} alt="Business logo preview" className="max-h-32 max-w-full object-contain"/>:<div className="text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-[var(--panel)] text-xl font-black">{context?.organization?.short_name||'MGT'}</div><p className="mt-3 text-xs text-muted">No logo uploaded</p></div>}
        </div>
        <input ref={fileRef} hidden type="file" accept="image/*" onChange={e=>setLogo(e.target.files?.[0])}/>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={!canManage||busy} onClick={chooseLogo} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black disabled:opacity-40">{form.logo_url?'Replace logo':'Choose logo'}</button>
          <button type="button" disabled={!canManage||busy||!form.logo_url} onClick={()=>setForm({...form,logo_url:''})} className="rounded-xl border border-[var(--line)] px-3 py-2 text-xs font-black text-red-500 disabled:opacity-40">Remove</button>
        </div>
        <div className="mt-5 rounded-xl bg-[var(--panel-2)] p-4 text-sm">
          <span className="text-xs text-muted">Printed business name</span>
          <strong className="mt-1 block">{context?.organization?.legal_name||context?.organization?.name||'Business'}</strong>
          {context?.organization?.legal_name&&context.organization.legal_name!==context.organization.name&&<span className="mt-1 block text-xs text-muted">Trading as {context.organization.name}</span>}
        </div>
      </section>

      <section className="page-card p-5">
        <h2 className="font-black">Company details</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label><span className="mb-1 block text-xs font-bold text-muted">Phone</span><input disabled={!canManage} className="input-base" value={form.phone} onChange={e=>setForm({...form,phone:e.target.value})} placeholder="+256..."/></label>
          <label><span className="mb-1 block text-xs font-bold text-muted">Business email</span><input disabled={!canManage} className="input-base" type="email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})} placeholder="accounts@business.com"/></label>
          <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-muted">Business address</span><input disabled={!canManage} className="input-base" value={form.address} onChange={e=>setForm({...form,address:e.target.value})} placeholder="Street / town / district / country"/></label>
          <label><span className="mb-1 block text-xs font-bold text-muted">Website</span><input disabled={!canManage} className="input-base" value={form.website} onChange={e=>setForm({...form,website:e.target.value})} placeholder="www.business.com"/></label>
          <label><span className="mb-1 block text-xs font-bold text-muted">Registration number</span><input disabled={!canManage} className="input-base" value={form.registration_number} onChange={e=>setForm({...form,registration_number:e.target.value})} placeholder="Company / business registration"/></label>
          <label><span className="mb-1 block text-xs font-bold text-muted">Tax / VAT number</span><input disabled={!canManage} className="input-base" value={form.tax_number} onChange={e=>setForm({...form,tax_number:e.target.value})} placeholder="TIN / VAT number"/></label>
        </div>

        <div className="mt-6 grid gap-4">
          <label><span className="mb-1 block text-xs font-bold text-muted">Default document footer</span><textarea disabled={!canManage} className="input-base min-h-24" value={form.document_footer} onChange={e=>setForm({...form,document_footer:e.target.value})} placeholder="Thank you for your business. Bank/payment instructions or contact information can go here."/></label>
          <label><span className="mb-1 block text-xs font-bold text-muted">Default terms / notice</span><textarea disabled={!canManage} className="input-base min-h-28" value={form.document_terms} onChange={e=>setForm({...form,document_terms:e.target.value})} placeholder="Payment terms, quotation validity wording, returns policy or other standard terms."/></label>
        </div>

        {canManage&&<button disabled={busy} className="btn-primary mt-5 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Saving...':'Save document profile'}</button>}
      </section>
    </form>
  </main>
}
