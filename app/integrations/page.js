'use client'

import { useEffect,useMemo,useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'

const prettyDate=(value)=>value?new Date(value).toLocaleString():'Never'

const EMAIL_CATEGORY_LABELS={
  approvals:'Approvals',
  finance:'Finance & credit',
  inventory:'Inventory',
  operations:'Operations & service',
  hr:'HR & payroll',
  projects:'Projects',
  fleet:'Fleet & delivery',
  documents:'Documents',
  system:'System',
}
const DEFAULT_EMAIL_CATEGORIES=Object.fromEntries(Object.keys(EMAIL_CATEGORY_LABELS).map(key=>[key,true]))

function parseCsv(text){
  const rows=[]
  let row=[],cell='',quoted=false
  for(let i=0;i<text.length;i++){
    const ch=text[i]
    if(quoted){
      if(ch==='"'&&text[i+1]==='"'){cell+='"';i++}
      else if(ch==='"')quoted=false
      else cell+=ch
    }else{
      if(ch==='"')quoted=true
      else if(ch===','){row.push(cell);cell=''}
      else if(ch==='\n'){row.push(cell);rows.push(row);row=[];cell=''}
      else if(ch!=='\r')cell+=ch
    }
  }
  if(cell.length||row.length){row.push(cell);rows.push(row)}
  if(rows.length<2)return []
  const headers=rows[0].map(x=>x.trim())
  return rows.slice(1).filter(r=>r.some(v=>String(v).trim()!=='')).map(r=>{
    const obj={}
    headers.forEach((h,i)=>{if(h)obj[h]=r[i]??''})
    return obj
  })
}

export default function IntegrationsPage(){
  const [bundle,setBundle]=useState({api_keys:[],webhooks:[],deliveries:[],events:[],notification_delivery_settings:null,notification_deliveries:[],available_scopes:[],available_events:[]})
  const [tab,setTab]=useState('api')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)
  const [revealedSecret,setRevealedSecret]=useState(null)
  const [keyForm,setKeyForm]=useState({name:'',scopes:[],expires_at:''})
  const [webhookForm,setWebhookForm]=useState({name:'',url:'',events:['*']})
  const [exportEntity,setExportEntity]=useState('products')
  const [exportFormat,setExportFormat]=useState('csv')
  const [importEntity,setImportEntity]=useState('products')
  const [importStrategy,setImportStrategy]=useState('append')
  const [importRows,setImportRows]=useState([])
  const [importFileName,setImportFileName]=useState('')
  const [deliveryForm,setDeliveryForm]=useState({
    email_enabled:false,
    email_min_severity:'warning',
    email_categories:{...DEFAULT_EMAIL_CATEGORIES},
    sender_name:'',
    reply_to_email:'',
  })

  const load=async()=>{
    setLoading(true)
    const result=await adminApi('/api/integrations')
    if(result.ok){
      setBundle(result)
      const settings=result.notification_delivery_settings||{}
      setDeliveryForm({
        email_enabled:Boolean(settings.email_enabled),
        email_min_severity:settings.email_min_severity||'warning',
        email_categories:{...DEFAULT_EMAIL_CATEGORIES,...(settings.email_categories||{})},
        sender_name:settings.sender_name||'',
        reply_to_email:settings.reply_to_email||'',
      })
    }else setMessage({type:'error',text:result.error||'Could not load integrations.'})
    setLoading(false)
  }
  useEffect(()=>{load()},[])

  const setScope=(scope,on)=>setKeyForm((f)=>({...f,scopes:on?[...new Set([...f.scopes,scope])]:f.scopes.filter(x=>x!==scope)}))
  const setEvent=(event,on)=>setWebhookForm((f)=>({...f,events:on?[...new Set([...f.events,event])]:f.events.filter(x=>x!==event)}))

  const createKey=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations',{method:'POST',body:JSON.stringify({type:'api_key',...keyForm,expires_at:keyForm.expires_at||null})})
    if(result.ok){
      setBundle(result);setRevealedSecret({title:'API key created',value:result.secret,note:'Copy this API key now. MGT stores only its hash and cannot show it again.'})
      setKeyForm({name:'',scopes:[],expires_at:''});setMessage({type:'success',text:'API key created.'})
    }else setMessage({type:'error',text:result.error||'Could not create API key.'})
    setBusy(false)
  }

  const createWebhook=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations',{method:'POST',body:JSON.stringify({type:'webhook',...webhookForm})})
    if(result.ok){
      setBundle(result);setRevealedSecret({title:'Webhook signing secret',value:result.signing_secret,note:'Copy this secret now. Use it to verify x-mgt-signature on webhook requests.'})
      setWebhookForm({name:'',url:'',events:['*']});setMessage({type:'success',text:'Webhook endpoint created.'})
    }else setMessage({type:'error',text:result.error||'Could not create webhook.'})
    setBusy(false)
  }

  const toggleIntegration=async(type,id,active)=>{
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations',{method:'PATCH',body:JSON.stringify({type,id,active})})
    if(result.ok){setBundle(result);setMessage({type:'success',text:`${type==='api_key'?'API key':'Webhook'} ${active?'enabled':'disabled'}.`})}
    else setMessage({type:'error',text:result.error||'Could not update integration.'})
    setBusy(false)
  }

  const removeIntegration=async(type,id)=>{
    if(!window.confirm(type==='api_key'?'Revoke this API key? It will stop working immediately.':'Remove this webhook endpoint?'))return
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations',{method:'DELETE',body:JSON.stringify({type,id})})
    if(result.ok){setBundle(result);setMessage({type:'success',text:'Integration removed/revoked.'})}
    else setMessage({type:'error',text:result.error||'Could not remove integration.'})
    setBusy(false)
  }

  const processQueue=async()=>{
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations/process',{method:'POST',body:JSON.stringify({})})
    if(result.ok){setMessage({type:'success',text:`Processed ${result.processed} queued delivery(s): ${result.delivered} delivered, ${result.failed} failed.`});await load()}
    else setMessage({type:'error',text:result.error||'Could not process webhook queue.'})
    setBusy(false)
  }

  const toggleDeliveryCategory=(key,on)=>setDeliveryForm(form=>({...form,email_categories:{...form.email_categories,[key]:on}}))

  const saveDeliverySettings=async(event)=>{
    event.preventDefault()
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('save_notification_delivery_settings',{
      p_email_enabled:deliveryForm.email_enabled,
      p_email_min_severity:deliveryForm.email_min_severity,
      p_email_categories:deliveryForm.email_categories,
      p_sender_name:deliveryForm.sender_name||null,
      p_reply_to_email:deliveryForm.reply_to_email||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:'Notification delivery settings saved. Eligible emails will be processed automatically by the delivery worker.'})
      await load()
    }
    setBusy(false)
  }

  const queueEmailTest=async()=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('queue_test_notification_email')
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:'Test email notification queued. The delivery worker checks the queue every minute.'})
      window.setTimeout(()=>load(),1200)
    }
    setBusy(false)
  }

  const downloadExport=async()=>{
    setBusy(true);setMessage(null)
    try{
      let {data:{session}}=await supabase.auth.getSession()
      if(!session){const r=await supabase.auth.refreshSession();session=r.data?.session}
      if(!session)throw new Error('Session expired — sign in again.')
      const response=await fetch(`/api/integrations/data?entity=${encodeURIComponent(exportEntity)}&format=${encodeURIComponent(exportFormat)}`,{headers:{authorization:`Bearer ${session.access_token}`}})
      if(!response.ok){const j=await response.json();throw new Error(j.error||'Export failed.')}
      const blob=await response.blob()
      const url=URL.createObjectURL(blob)
      const a=document.createElement('a');a.href=url;a.download=`mgt-${exportEntity}.${exportFormat==='json'?'json':'csv'}`;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(url)
      setMessage({type:'success',text:`${exportEntity} export downloaded.`})
    }catch(error){setMessage({type:'error',text:error.message})}
    setBusy(false)
  }

  const selectImportFile=async(event)=>{
    const file=event.target.files?.[0]
    if(!file)return
    try{
      const text=await file.text()
      const rows=file.name.toLowerCase().endsWith('.json')?JSON.parse(text):parseCsv(text)
      if(!Array.isArray(rows))throw new Error('Import file must contain an array of records.')
      if(!rows.length)throw new Error('No data rows found in that file.')
      setImportRows(rows.slice(0,500));setImportFileName(file.name);setMessage({type:'success',text:`Loaded ${Math.min(rows.length,500)} row(s) from ${file.name}.`})
    }catch(error){setImportRows([]);setImportFileName('');setMessage({type:'error',text:error.message})}
  }

  const importData=async(dryRun=false)=>{
    if(!importRows.length)return
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/integrations/data',{method:'POST',body:JSON.stringify({entity:importEntity,strategy:importStrategy,rows:importRows,dry_run:dryRun})})
    if(result.ok){
      if(dryRun)setMessage({type:'success',text:`Validation passed: ${result.valid_rows} row(s) are structurally valid.`})
      else{setMessage({type:'success',text:`Import finished: ${result.inserted} inserted, ${result.updated} updated, ${result.failed} failed.`});if(!result.failed){setImportRows([]);setImportFileName('')}}
    }else{
      const detail=result.errors?.length?` ${result.errors.slice(0,3).map(e=>`Row ${e.row}: ${e.error}`).join(' | ')}`:''
      setMessage({type:'error',text:(result.error||'Import failed.')+detail})
    }
    setBusy(false)
  }

  const pending=bundle.deliveries.filter(d=>['queued','failed'].includes(d.status)).length
  const delivered=bundle.deliveries.filter(d=>d.status==='delivered').length
  const activeKeys=bundle.api_keys.filter(k=>k.active&&!k.revoked_at).length
  const activeHooks=bundle.webhooks.filter(w=>w.active).length
  const scopesByArea=useMemo(()=>bundle.available_scopes.reduce((g,s)=>{const area=s.split('.')[0];(g[area]||(g[area]=[])).push(s);return g},{}),[bundle.available_scopes])
  const emailQueued=bundle.notification_deliveries.filter(d=>['queued','processing','failed'].includes(d.status)).length
  const emailDelivered=bundle.notification_deliveries.filter(d=>d.status==='delivered').length
  const emailProblems=bundle.notification_deliveries.filter(d=>['failed','abandoned'].includes(d.status)).length

  if(loading)return <main className="page-wrap text-muted">Loading integrations...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Connectivity</p><h1 className="page-title">Integrations & Data Exchange</h1><p className="page-subtitle">Secure API access, webhooks, notification delivery and controlled external connectivity.</p></div><a href="/migration-center" className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">Migration Center</a></div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    {revealedSecret&&<div className="mb-5 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-5"><div className="flex items-start justify-between gap-3"><div><strong>{revealedSecret.title}</strong><p className="mt-1 text-xs text-muted">{revealedSecret.note}</p></div><button onClick={()=>setRevealedSecret(null)} className="rounded-lg px-2 py-1 font-black">×</button></div><div className="mt-3 flex gap-2"><code className="min-w-0 flex-1 overflow-x-auto rounded-xl bg-[var(--panel)] p-3 text-xs">{revealedSecret.value}</code><button type="button" onClick={()=>navigator.clipboard?.writeText(revealedSecret.value)} className="btn-secondary rounded-xl px-3 text-xs font-black">Copy</button></div></div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active API keys</p><strong className="mt-2 block text-2xl">{activeKeys}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Active webhooks</p><strong className="mt-2 block text-2xl">{activeHooks}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Queued / retrying</p><strong className="mt-2 block text-2xl text-amber-600">{pending}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Recent delivered</p><strong className="mt-2 block text-2xl text-emerald-600">{delivered}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['api','API Access'],['webhooks','Webhooks'],['notifications','Notification Delivery'],['activity','Activity']].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='api'&&<section className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <form onSubmit={createKey} className="page-card h-fit p-5"><h2 className="font-black">Create scoped API key</h2><p className="mt-1 text-xs text-muted">The secret is shown once. External apps send it as a Bearer token to /api/external/v1/&lt;resource&gt;.</p><input required className="input-base mt-4" placeholder="Key name e.g. Accounting connector" value={keyForm.name} onChange={e=>setKeyForm({...keyForm,name:e.target.value})}/><label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-muted">Optional expiry</span><input className="input-base" type="datetime-local" value={keyForm.expires_at} onChange={e=>setKeyForm({...keyForm,expires_at:e.target.value})}/></label><div className="mt-4 space-y-3">{Object.entries(scopesByArea).map(([area,items])=><div key={area}><p className="mb-2 text-xs font-black uppercase text-muted">{area}</p><div className="space-y-2">{items.map(scope=><label key={scope} className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={keyForm.scopes.includes(scope)} onChange={e=>setScope(scope,e.target.checked)}/><code className="text-xs">{scope}</code></label>)}</div></div>)}</div><button disabled={busy||!keyForm.scopes.length} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">Create API key</button></form>
      <div className="space-y-3">{!bundle.api_keys.length&&<div className="page-card p-6 text-sm text-muted">No API keys created.</div>}{bundle.api_keys.map(k=><article key={k.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{k.name}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${k.active?'bg-emerald-500/10 text-emerald-600':'bg-red-500/10 text-red-500'}`}>{k.active?'active':'revoked'}</span></div><p className="mt-1 text-xs text-muted">Prefix {k.key_prefix}… · created {prettyDate(k.created_at)} · last used {prettyDate(k.last_used_at)}</p><div className="mt-2 flex flex-wrap gap-1">{(k.scopes||[]).map(s=><code key={s} className="rounded bg-[var(--panel-2)] px-2 py-1 text-[10px]">{s}</code>)}</div>{k.expires_at&&<p className="mt-2 text-xs text-muted">Expires {prettyDate(k.expires_at)}</p>}</div><div className="flex gap-2"><button disabled={busy} onClick={()=>toggleIntegration('api_key',k.id,!k.active)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{k.active?'Disable':'Enable'}</button><button disabled={busy} onClick={()=>removeIntegration('api_key',k.id)} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-black text-red-500">Revoke</button></div></div></article>)}</div>
    </section>}

    {tab==='webhooks'&&<section className="grid gap-5 xl:grid-cols-[440px_1fr]">
      <form onSubmit={createWebhook} className="page-card h-fit p-5"><h2 className="font-black">Webhook endpoint</h2><p className="mt-1 text-xs text-muted">MGT signs each JSON request using HMAC-SHA256 in the x-mgt-signature header.</p><input required className="input-base mt-4" placeholder="Webhook name" value={webhookForm.name} onChange={e=>setWebhookForm({...webhookForm,name:e.target.value})}/><input required className="input-base mt-3" type="url" placeholder="https://example.com/webhooks/mgt" value={webhookForm.url} onChange={e=>setWebhookForm({...webhookForm,url:e.target.value})}/><div className="mt-4 grid gap-2 sm:grid-cols-2">{bundle.available_events.map(ev=><label key={ev} className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-xs"><input type="checkbox" checked={webhookForm.events.includes(ev)} onChange={e=>{if(ev==='*'&&e.target.checked)setWebhookForm({...webhookForm,events:['*']});else setEvent(ev,e.target.checked)}}/><code>{ev}</code></label>)}</div><button disabled={busy||!webhookForm.events.length} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Create webhook</button></form>
      <div className="space-y-3">{!bundle.webhooks.length&&<div className="page-card p-6 text-sm text-muted">No webhook endpoints.</div>}{bundle.webhooks.map(w=><article key={w.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{w.name}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${w.active?'bg-emerald-500/10 text-emerald-600':'bg-red-500/10 text-red-500'}`}>{w.active?'active':'disabled'}</span></div><p className="mt-1 break-all text-xs text-muted">{w.url}</p><p className="mt-1 text-xs text-muted">Failures: {w.failure_count||0} · last delivery {prettyDate(w.last_delivery_at)} · last success {prettyDate(w.last_success_at)}</p><div className="mt-2 flex flex-wrap gap-1">{(w.events||[]).map(ev=><code key={ev} className="rounded bg-[var(--panel-2)] px-2 py-1 text-[10px]">{ev}</code>)}</div></div><div className="flex gap-2"><button disabled={busy} onClick={()=>toggleIntegration('webhook',w.id,!w.active)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{w.active?'Disable':'Enable'}</button><button disabled={busy} onClick={()=>removeIntegration('webhook',w.id)} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-black text-red-500">Remove</button></div></div></article>)}</div>
    </section>}

    {tab==='notifications'&&<section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="page-card p-4"><p className="text-xs text-muted">Queued / retrying email</p><strong className="mt-2 block text-2xl text-amber-600">{emailQueued}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Recent email delivered</p><strong className="mt-2 block text-2xl text-emerald-600">{emailDelivered}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Email delivery problems</p><strong className="mt-2 block text-2xl text-red-500">{emailProblems}</strong></div>
      </div>

      <div className="grid gap-5 xl:grid-cols-[430px_1fr]">
        <form onSubmit={saveDeliverySettings} className="page-card h-fit p-5">
          <h2 className="font-black">Email notification delivery</h2>
          <p className="mt-1 text-xs leading-5 text-muted">The business controls which notification classes are eligible for email. Each staff member must also enable Email notifications in their own Settings.</p>

          <label className="mt-4 flex items-center justify-between gap-3 rounded-xl bg-[var(--panel-2)] p-4"><div><strong className="text-sm">Enable business email delivery</strong><p className="mt-1 text-xs text-muted">Queues eligible MGT notifications for opted-in staff.</p></div><input type="checkbox" checked={deliveryForm.email_enabled} onChange={e=>setDeliveryForm({...deliveryForm,email_enabled:e.target.checked})}/></label>

          <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-muted">Minimum severity</span><select className="input-base" value={deliveryForm.email_min_severity} onChange={e=>setDeliveryForm({...deliveryForm,email_min_severity:e.target.value})}><option value="info">Info / success and above</option><option value="warning">Warning and critical</option><option value="critical">Critical only</option></select></label>
          <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-muted">Sender display name</span><input className="input-base" value={deliveryForm.sender_name} onChange={e=>setDeliveryForm({...deliveryForm,sender_name:e.target.value})} placeholder="Business name"/></label>
          <label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-muted">Reply-to email</span><input className="input-base" type="email" value={deliveryForm.reply_to_email} onChange={e=>setDeliveryForm({...deliveryForm,reply_to_email:e.target.value})} placeholder="accounts@example.com"/></label>

          <div className="mt-4 space-y-2"><p className="text-xs font-black uppercase text-muted">Email categories</p>{Object.entries(EMAIL_CATEGORY_LABELS).map(([key,label])=><label key={key} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span>{label}</span><input type="checkbox" checked={deliveryForm.email_categories?.[key]!==false} onChange={e=>toggleDeliveryCategory(key,e.target.checked)}/></label>)}</div>

          <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">Save email delivery settings</button>
          <button type="button" disabled={busy||!deliveryForm.email_enabled} onClick={queueEmailTest} className="btn-secondary mt-2 w-full rounded-xl px-4 py-3 text-sm font-black disabled:opacity-40">Queue test email to my account</button>
        </form>

        <div className="space-y-5">
          <div className="page-card p-5">
            <h2 className="font-black">Delivery engine</h2>
            <p className="mt-2 text-sm leading-6 text-muted">MGT now has an asynchronous email outbox with retry/backoff and an automatic Supabase worker that runs every minute. The worker is Resend-ready. To activate real external email sending, configure <code>RESEND_API_KEY</code> and <code>MGT_NOTIFICATION_FROM_EMAIL</code> as Supabase Edge Function secrets. <code>MGT_APP_URL</code> is optional and controls links inside emails.</p>
            <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs leading-5 text-amber-700">No provider key is stored in the MGT database or browser. Provider credentials remain server-side only.</div>
          </div>

          <div className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4"><strong>Email delivery history</strong></div>
            <div className="max-h-[620px] divide-y divide-[var(--line)] overflow-y-auto">
              {!bundle.notification_deliveries.length&&<p className="p-5 text-sm text-muted">No notification emails have been queued yet.</p>}
              {bundle.notification_deliveries.map(d=><div key={d.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto] lg:items-center"><div className="min-w-0"><strong className="break-all text-sm">{d.recipient}</strong><p className="mt-1 text-xs text-muted">Attempt {d.attempt_count||0} · created {prettyDate(d.created_at)} · last {prettyDate(d.last_attempt_at)}{d.error_message?' · '+d.error_message:''}</p>{d.provider_message_id&&<p className="mt-1 text-[10px] text-muted">Provider ID: {d.provider_message_id}</p>}</div><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${d.status==='delivered'?'bg-emerald-500/10 text-emerald-600':d.status==='failed'||d.status==='abandoned'?'bg-red-500/10 text-red-500':d.status==='skipped'?'bg-slate-500/10 text-muted':'bg-amber-500/10 text-amber-600'}`}>{d.status}</span></div>)}
            </div>
          </div>
        </div>
      </div>
    </section>}

    {tab==='activity'&&<section className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-black">Webhook delivery outbox</h2><p className="text-xs text-muted">Queued deliveries retry with exponential backoff. Manual processing handles up to 25 due deliveries per run.</p></div><button disabled={busy||!pending} onClick={processQueue} className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-50">Process queue now</button></div>
      <div className="page-card overflow-hidden"><div className="divide-y divide-[var(--line)]">{!bundle.deliveries.length&&<p className="p-5 text-sm text-muted">No webhook delivery activity yet.</p>}{bundle.deliveries.map(d=><div key={d.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div className="min-w-0"><strong className="break-all text-sm">{d.endpoint_url}</strong><p className="mt-1 text-xs text-muted">Attempt {d.attempt_count||0} · last {prettyDate(d.last_attempt_at)}{d.error_message?` · ${d.error_message}`:''}</p></div><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${d.status==='delivered'?'bg-emerald-500/10 text-emerald-600':d.status==='failed'||d.status==='abandoned'?'bg-red-500/10 text-red-500':'bg-amber-500/10 text-amber-600'}`}>{d.status}</span><span className="text-xs text-muted">{d.response_code||'—'}</span></div>)}</div></div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Recent integration events</strong></div><div className="max-h-[500px] divide-y divide-[var(--line)] overflow-y-auto">{!bundle.events.length&&<p className="p-5 text-sm text-muted">Events are only stored when at least one active webhook subscribes to them.</p>}{bundle.events.map(e=><div key={e.id} className="flex justify-between gap-4 p-4"><div><strong className="text-sm">{e.event_type}</strong><p className="mt-1 text-xs text-muted">{e.entity_type} · {e.entity_id||'—'} · {prettyDate(e.created_at)}</p></div><span className="text-xs font-black uppercase text-muted">{e.status}</span></div>)}</div></div>
    </section>}

    {tab==='data'&&<section className="grid gap-5 xl:grid-cols-2">
      <div className="page-card p-5"><h2 className="font-black">Export business data</h2><p className="mt-1 text-sm text-muted">Download clean organization-scoped data for migration, analysis or another system.</p><select className="input-base mt-4" value={exportEntity} onChange={e=>setExportEntity(e.target.value)}><option value="products">Products & services</option><option value="customers">Customers</option><option value="suppliers">Suppliers</option></select><select className="input-base mt-3" value={exportFormat} onChange={e=>setExportFormat(e.target.value)}><option value="csv">CSV</option><option value="json">JSON</option></select><button disabled={busy} onClick={downloadExport} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Download export</button></div>
      <div className="page-card p-5"><h2 className="font-black">Import master data</h2><p className="mt-1 text-sm text-muted">Import up to 500 products, customers or suppliers per batch. Validate first before writing.</p><select className="input-base mt-4" value={importEntity} onChange={e=>{setImportEntity(e.target.value);setImportRows([]);setImportFileName('')}}><option value="products">Products & services</option><option value="customers">Customers</option><option value="suppliers">Suppliers</option></select><select className="input-base mt-3" value={importStrategy} onChange={e=>setImportStrategy(e.target.value)}><option value="append">Append as new records</option><option value="update">Update matching records, otherwise append</option></select><label className="mt-3 block rounded-xl border border-dashed border-[var(--line)] p-4 text-center text-sm"><input type="file" accept=".csv,.json,text/csv,application/json" onChange={selectImportFile} className="block w-full text-xs"/>{importFileName&&<span className="mt-2 block text-xs text-muted">{importFileName} · {importRows.length} row(s)</span>}</label><div className="mt-3 grid grid-cols-2 gap-2"><button disabled={busy||!importRows.length} onClick={()=>importData(true)} className="btn-secondary rounded-xl px-3 py-3 text-sm font-black disabled:opacity-40">Validate</button><button disabled={busy||!importRows.length} onClick={()=>importData(false)} className="btn-primary rounded-xl px-3 py-3 text-sm font-black disabled:opacity-40">Import data</button></div><p className="mt-3 text-xs text-muted">For update mode, products match by SKU/barcode; customers and suppliers match by email/phone. A data import is audit-logged.</p></div>
    </section>}
  </main>
}
