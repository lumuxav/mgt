'use client'

import { useEffect,useMemo,useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'
import { useOnlineStatus } from '../../lib/useOnlineStatus'

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
  const headers=rows[0].map(x=>String(x||'').trim())
  return rows.slice(1).filter(r=>r.some(v=>String(v||'').trim()!=='')).map(r=>{
    const obj={}
    headers.forEach((h,i)=>{if(h)obj[h]=r[i]??''})
    return obj
  })
}

const fmtDate=v=>v?new Date(v).toLocaleString():'—'
const pretty=s=>String(s||'').replaceAll('_',' ').replace(/\b\w/g,m=>m.toUpperCase())

export default function MigrationCenterPage(){
  const [meta,setMeta]=useState({jobs:[],locations:[],roles:[],import_entities:[],export_entities:[]})
  const [tab,setTab]=useState('import')
  const [entity,setEntity]=useState('products')
  const [strategy,setStrategy]=useState('append')
  const [rows,setRows]=useState([])
  const [fileName,setFileName]=useState('')
  const [validation,setValidation]=useState(null)
  const [exportEntity,setExportEntity]=useState('products')
  const [exportFormat,setExportFormat]=useState('csv')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const online=useOnlineStatus()
  const currentDef=useMemo(()=>meta.import_entities.find(x=>x.key===entity),[meta.import_entities,entity])

  const load=async()=>{
    setLoading(true)
    const result=await adminApi('/api/migrations')
    if(result.ok){
      setMeta(result)
      if(!result.import_entities.some(x=>x.key===entity)&&result.import_entities[0])setEntity(result.import_entities[0].key)
      if(!result.export_entities.includes(exportEntity)&&result.export_entities[0])setExportEntity(result.export_entities[0])
    }else setMessage({type:'error',text:result.error||'Could not load migration tools.'})
    setLoading(false)
  }

  useEffect(()=>{load()},[])

  useEffect(()=>{
    if(entity==='opening_stock'||entity==='customer_balances'||entity==='supplier_balances')setStrategy('replace')
    else setStrategy('append')
    setRows([]);setFileName('');setValidation(null)
  },[entity])

  const chooseFile=async e=>{
    const file=e.target.files?.[0]
    if(!file)return
    setMessage(null);setValidation(null)
    try{
      if(file.size>8*1024*1024)throw new Error('File is too large. Keep migration files below 8 MB.')
      const text=await file.text()
      let parsed
      if(file.name.toLowerCase().endsWith('.json')){
        parsed=JSON.parse(text)
        if(!Array.isArray(parsed))throw new Error('JSON migration files must contain an array of rows.')
      }else parsed=parseCsv(text)
      if(!parsed.length)throw new Error('No data rows were found.')
      const max=entity==='staff'?100:1000
      if(parsed.length>max)throw new Error(`This migration type supports up to ${max} rows per batch.`)
      setRows(parsed)
      setFileName(file.name)
      setMessage({type:'success',text:`Loaded ${parsed.length} row(s). Run validation before importing.`})
    }catch(error){
      setRows([]);setFileName('')
      setMessage({type:'error',text:error.message})
    }
  }

  const validate=async()=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Migration validation requires a live connection.'})
    if(!rows.length)return
    setBusy(true);setMessage(null);setValidation(null)
    const result=await adminApi('/api/migrations',{method:'POST',body:JSON.stringify({entity,strategy,rows,file_name:fileName,dry_run:true})})
    setValidation(result)
    if(result.ok)setMessage({type:'success',text:`Validation passed. ${result.valid_rows} row(s) are ready to import.`})
    else setMessage({type:'error',text:result.error||`Validation found ${result.failed_rows||0} problem row(s).`})
    setBusy(false)
  }

  const runImport=async()=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Imports are disabled until the connection returns.'})
    if(!rows.length)return
    if(!validation?.ok)return setMessage({type:'error',text:'Run validation and fix all errors before importing.'})
    if(!window.confirm(`Import ${rows.length} row(s) into ${pretty(entity)}?\n\nThis action will be logged in Migration History.`))return
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/migrations',{method:'POST',body:JSON.stringify({entity,strategy,rows,file_name:fileName,dry_run:false})})
    if(result.ok){
      setMessage({type:'success',text:`Migration completed: ${result.inserted} inserted, ${result.updated} updated, ${result.skipped} skipped.`})
      setRows([]);setFileName('');setValidation(null)
      await load()
      setTab('history')
    }else{
      const detail=result.errors?.length?` First issue: row ${result.errors[0].row} — ${result.errors[0].error}`:''
      setMessage({type:'error',text:(result.error||`Migration finished with ${result.failed||0} failed row(s).`)+detail})
      await load()
    }
    setBusy(false)
  }

  const download=async(url,fallbackName)=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Downloads require a live connection.'})
    setBusy(true);setMessage(null)
    try{
      let {data:{session}}=await supabase.auth.getSession()
      if(!session){const refreshed=await supabase.auth.refreshSession();session=refreshed.data?.session}
      if(!session)throw new Error('Session expired — sign in again.')
      const response=await fetch(url,{headers:{authorization:`Bearer ${session.access_token}`}})
      if(!response.ok){
        const body=await response.json().catch(()=>({}))
        throw new Error(body.error||'Download failed.')
      }
      const blob=await response.blob()
      const disposition=response.headers.get('content-disposition')||''
      const match=disposition.match(/filename="?([^"]+)"?/)
      const name=match?.[1]||fallbackName
      const objectUrl=URL.createObjectURL(blob)
      const a=document.createElement('a');a.href=objectUrl;a.download=name;document.body.appendChild(a);a.click();a.remove();URL.revokeObjectURL(objectUrl)
    }catch(error){setMessage({type:'error',text:error.message})}
    setBusy(false)
  }

  const template=()=>download(`/api/migrations?mode=template&entity=${encodeURIComponent(entity)}`,`mgt-template-${entity}.csv`)
  const exportData=()=>download(`/api/migrations?mode=export&entity=${encodeURIComponent(exportEntity)}&format=${encodeURIComponent(exportFormat)}`,`mgt-${exportEntity}.${exportFormat}`)

  const strategyOptions=entity==='opening_stock'||entity==='customer_balances'||entity==='supplier_balances'
    ? [['replace','Replace existing opening value'],['add','Add to existing opening value']]
    : [['append','Append new records'],['update','Update matching records or insert new'],['skip','Skip matching records']]

  if(loading)return <main className="page-wrap text-muted">Loading Migration Center...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div>
        <p className="page-eyebrow">Data Migration</p>
        <h1 className="page-title">Migration Center</h1>
        <p className="page-subtitle">Move business data from spreadsheets or another system into MGT with validation, opening-balance controls and a permanent migration history.</p>
      </div>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-3">
      <div className="page-card p-4"><p className="text-xs text-muted">Migration jobs</p><strong className="mt-2 block text-2xl">{meta.jobs.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Completed with errors</p><strong className="mt-2 block text-2xl text-amber-600">{meta.jobs.filter(j=>j.failed_rows>0).length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Available templates</p><strong className="mt-2 block text-2xl">{meta.import_entities.length}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['import','Import'],['export','Export'],['history','History']].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='import'&&<section className="grid gap-5 xl:grid-cols-[430px_1fr]">
      <div className="page-card h-fit p-5">
        <h2 className="font-black">1. Choose migration type</h2>
        <select className="input-base mt-4" value={entity} onChange={e=>setEntity(e.target.value)}>
          {meta.import_entities.map(item=><option key={item.key} value={item.key}>{item.title}</option>)}
        </select>
        <select className="input-base mt-3" value={strategy} onChange={e=>setStrategy(e.target.value)}>
          {strategyOptions.map(([key,label])=><option key={key} value={key}>{label}</option>)}
        </select>

        <button disabled={busy||!online} onClick={template} className="btn-secondary mt-3 w-full rounded-xl px-4 py-3 text-sm font-black">Download CSV template</button>

        <label className="mt-5 block">
          <span className="mb-2 block text-sm font-black">2. Select CSV or JSON file</span>
          <input type="file" accept=".csv,.json,text/csv,application/json" onChange={chooseFile} className="block w-full text-sm text-muted file:mr-3 file:rounded-xl file:border-0 file:bg-[var(--panel-2)] file:px-4 file:py-2.5 file:font-black" />
        </label>

        {fileName&&<div className="mt-4 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><strong>{fileName}</strong><p className="mt-1 text-xs text-muted">{rows.length} row(s) loaded</p></div>}

        <div className="mt-4 grid grid-cols-2 gap-2">
          <button disabled={busy||!online||!rows.length} onClick={validate} className="btn-secondary rounded-xl px-3 py-3 text-sm font-black disabled:opacity-40">{busy?'Working...':'Validate only'}</button>
          <button disabled={busy||!online||!validation?.ok} onClick={runImport} className="btn-primary rounded-xl px-3 py-3 text-sm font-black disabled:opacity-40">Run import</button>
        </div>

        <div className="mt-5 rounded-xl border border-[var(--line)] p-4">
          <p className="text-xs font-black uppercase text-muted">Expected columns</p>
          <div className="mt-2 flex flex-wrap gap-1">{(currentDef?.columns||[]).map(col=><code key={col} className="rounded bg-[var(--panel-2)] px-2 py-1 text-[10px]">{col}{currentDef?.required?.includes(col)?' *':''}</code>)}</div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="page-card p-5">
          <h2 className="font-black">Validation preview</h2>
          {!rows.length?<p className="mt-2 text-sm text-muted">Choose a file to preview its first rows here.</p>:<>
            <div className="mt-3 overflow-x-auto">
              <table className="min-w-full text-left text-xs">
                <thead><tr className="border-b border-[var(--line)]">{Object.keys(rows[0]||{}).slice(0,8).map(key=><th key={key} className="px-2 py-2 font-black">{key}</th>)}</tr></thead>
                <tbody>{rows.slice(0,8).map((row,index)=><tr key={index} className="border-b border-[var(--line)]/60">{Object.keys(rows[0]||{}).slice(0,8).map(key=><td key={key} className="max-w-48 truncate px-2 py-2">{String(row[key]??'')}</td>)}</tr>)}</tbody>
              </table>
            </div>
            {rows.length>8&&<p className="mt-2 text-xs text-muted">Showing 8 of {rows.length} rows.</p>}
          </>}
        </div>

        {validation&&<div className="page-card p-5">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-black">Validation result</h2><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${validation.ok?'bg-emerald-500/10 text-emerald-600':'bg-red-500/10 text-red-500'}`}>{validation.ok?'ready':'fix errors'}</span></div>
          <p className="mt-2 text-sm text-muted">{validation.valid_rows||0} valid · {validation.failed_rows||0} failed</p>
          {!!validation.errors?.length&&<div className="mt-4 max-h-80 space-y-2 overflow-auto">{validation.errors.map((error,index)=><div key={index} className="rounded-xl bg-red-500/10 p-3 text-xs text-red-500"><strong>Row {error.row}</strong> · {error.error}</div>)}</div>}
        </div>}

        <div className="page-card p-5">
          <h2 className="font-black">Opening-data safeguards</h2>
          <p className="mt-2 text-sm leading-6 text-muted">Opening stock is blocked if real operational stock movements already exist for that product/location. Customer and supplier opening balances are posted through Accounting rather than silently changing the balance field. This keeps the general ledger aligned with migrated opening data.</p>
        </div>
      </div>
    </section>}

    {tab==='export'&&<section className="grid gap-5 lg:grid-cols-[420px_1fr]">
      <div className="page-card p-5">
        <h2 className="font-black">Export business data</h2>
        <p className="mt-1 text-sm text-muted">Download current MGT records for backup, analysis or migration to another system.</p>
        <select className="input-base mt-4" value={exportEntity} onChange={e=>setExportEntity(e.target.value)}>
          {meta.export_entities.map(key=><option key={key} value={key}>{pretty(key)}</option>)}
        </select>
        <select className="input-base mt-3" value={exportFormat} onChange={e=>setExportFormat(e.target.value)}>
          <option value="csv">CSV</option><option value="json">JSON</option>
        </select>
        <button disabled={busy||!online} onClick={exportData} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">Download export</button>
      </div>
      <div className="page-card p-5"><h2 className="font-black">Available exports</h2><div className="mt-4 grid gap-2 sm:grid-cols-2">{meta.export_entities.map(key=><div key={key} className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><strong>{pretty(key)}</strong><p className="mt-1 text-xs text-muted">Organization-scoped export</p></div>)}</div></div>
    </section>}

    {tab==='history'&&<section className="space-y-3">
      {!meta.jobs.length&&<div className="page-card p-6 text-sm text-muted">No migration jobs have been run yet.</div>}
      {meta.jobs.map(job=><article key={job.id} className="page-card p-4">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
          <div>
            <div className="flex flex-wrap items-center gap-2"><strong>{pretty(job.entity_type)}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${job.failed_rows?'bg-amber-500/10 text-amber-600':'bg-emerald-500/10 text-emerald-600'}`}>{pretty(job.status)}</span></div>
            <p className="mt-1 text-xs text-muted">{job.file_name||'No file name'} · {job.strategy} · {fmtDate(job.created_at)}</p>
          </div>
          <div className="grid grid-cols-5 gap-2 text-center text-xs">
            <div><strong className="block text-base">{job.total_rows}</strong><span className="text-muted">Rows</span></div>
            <div><strong className="block text-base text-emerald-600">{job.inserted_rows}</strong><span className="text-muted">Inserted</span></div>
            <div><strong className="block text-base text-blue-600">{job.updated_rows}</strong><span className="text-muted">Updated</span></div>
            <div><strong className="block text-base text-muted">{job.skipped_rows}</strong><span className="text-muted">Skipped</span></div>
            <div><strong className="block text-base text-red-500">{job.failed_rows}</strong><span className="text-muted">Failed</span></div>
          </div>
        </div>
        {!!job.errors?.length&&<details className="mt-3"><summary className="cursor-pointer text-xs font-black text-red-500">Show {job.errors.length} recorded error(s)</summary><div className="mt-2 space-y-1">{job.errors.slice(0,20).map((e,i)=><p key={i} className="rounded-lg bg-red-500/10 p-2 text-xs text-red-500">Row {e.row}: {e.error}</p>)}</div></details>}
      </article>)}
    </section>}
  </main>
}
