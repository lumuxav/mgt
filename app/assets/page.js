'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()
const today=()=>new Date().toISOString().slice(0,10)

export default function AssetsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [assets,setAssets]=useState([])
  const [maintenance,setMaintenance]=useState([])
  const [users,setUsers]=useState([])
  const [locations,setLocations]=useState([])
  const [bankAccounts,setBankAccounts]=useState([])
  const [tab,setTab]=useState('assets')
  const [search,setSearch]=useState('')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [selected,setSelected]=useState(null)
  const [completeTarget,setCompleteTarget]=useState(null)

  const [assetForm,setAssetForm]=useState({location_id:'',name:'',category:'',asset_type:'equipment',manufacturer:'',model:'',serial_number:'',purchase_date:'',purchase_cost:'',salvage_value:'',useful_life_months:'',assigned_user_id:'',next_service_date:'',service_interval_days:'',notes:''})
  const [maintForm,setMaintForm]=useState({asset_id:'',maintenance_type:'preventive',priority:'normal',scheduled_date:today(),description:'',assigned_user_id:'',vendor:'',notes:''})
  const [completeForm,setCompleteForm]=useState({cost:'',downtime_hours:'',meter_reading:'',next_service_date:'',notes:'',payment_method:'',bank_account_id:'',reference:''})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canManage=permissions.includes('assets.manage')
  const canMaintenance=permissions.includes('assets.maintenance')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,assetRes,maintRes,userRes,locRes,bankRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('assets').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(1500),
        supabase.from('asset_maintenance').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(2000),
        supabase.from('users').select('id,full_name,role,default_location_id').eq('organization_id',org).eq('active',true).order('full_name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('bank_accounts').select('id,name,provider,account_type').eq('organization_id',org).eq('active',true).order('name'),
      ])
      for(const r of [permRes,assetRes,maintRes,userRes,locRes,bankRes])if(r.error)throw r.error
      setPermissions((permRes.data||[]).map((x)=>x.permission))
      setAssets(assetRes.data||[])
      setMaintenance(maintRes.data||[])
      setUsers(userRes.data||[])
      setLocations(locRes.data||[])
      setBankAccounts(bankRes.data||[])
      const defaultLocation=ctx.location?.id||locRes.data?.[0]?.id||''
      const firstAsset=assetRes.data?.find((a)=>a.active)?.id||''
      setAssetForm((v)=>({...v,location_id:v.location_id||defaultLocation}))
      setMaintForm((v)=>({...v,asset_id:v.asset_id||firstAsset}))
      setCompleteForm((v)=>({...v,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))
      if(selected){
        const fresh=(assetRes.data||[]).find((a)=>a.id===selected.id)
        if(fresh)setSelected(fresh)
      }
    }catch(error){setMessage({type:'error',text:error.message||'Could not load assets.'})}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const userName=(id)=>users.find((u)=>u.id===id)?.full_name||'Unassigned'
  const locationName=(id)=>locations.find((l)=>l.id===id)?.name||'No location'

  const bookValue=(asset)=>{
    const cost=Number(asset.purchase_cost||0),salvage=Number(asset.salvage_value||0),life=Number(asset.useful_life_months||0)
    if(!asset.purchase_date||!life||cost<=0)return cost
    const start=new Date(asset.purchase_date+'T00:00:00'),now=new Date()
    const months=Math.max(0,Math.min(life,(now.getFullYear()-start.getFullYear())*12+(now.getMonth()-start.getMonth())))
    return Math.max(salvage,cost-((cost-salvage)/life)*months)
  }

  const createAsset=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=assetForm
    const {data,error}=await supabase.rpc('create_asset',{
      p_location_id:f.location_id||null,p_name:f.name,p_category:f.category||null,p_asset_type:f.asset_type,
      p_manufacturer:f.manufacturer||null,p_model:f.model||null,p_serial_number:f.serial_number||null,
      p_purchase_date:f.purchase_date||null,p_purchase_cost:Number(f.purchase_cost||0),p_salvage_value:Number(f.salvage_value||0),
      p_useful_life_months:f.useful_life_months?Number(f.useful_life_months):null,p_assigned_user_id:f.assigned_user_id||null,
      p_next_service_date:f.next_service_date||null,p_service_interval_days:f.service_interval_days?Number(f.service_interval_days):null,p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setAssetForm((v)=>({location_id:v.location_id,name:'',category:'',asset_type:'equipment',manufacturer:'',model:'',serial_number:'',purchase_date:'',purchase_cost:'',salvage_value:'',useful_life_months:'',assigned_user_id:'',next_service_date:'',service_interval_days:'',notes:''}))
      setMessage({type:'success',text:`${data?.asset_number||'Asset'} created.`});await load()
    }
    setBusy(false)
  }

  const scheduleMaintenance=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=maintForm
    const {data,error}=await supabase.rpc('schedule_asset_maintenance',{
      p_asset_id:f.asset_id,p_maintenance_type:f.maintenance_type,p_priority:f.priority,p_scheduled_date:f.scheduled_date||null,
      p_description:f.description,p_assigned_user_id:f.assigned_user_id||null,p_vendor:f.vendor||null,p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMaintForm((v)=>({...v,description:'',vendor:'',notes:'',priority:'normal'}))
      setMessage({type:'success',text:`${data?.maintenance_number||'Maintenance'} scheduled.`});await load()
    }
    setBusy(false)
  }

  const startMaintenance=async(id)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('start_asset_maintenance',{p_maintenance_id:id})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Maintenance started; asset is now unavailable.'});await load()}
    setBusy(false)
  }

  const completeMaintenance=async(event)=>{
    event.preventDefault();if(!completeTarget)return
    setBusy(true);setMessage(null)
    const f=completeForm
    const {error}=await supabase.rpc('complete_asset_maintenance',{
      p_maintenance_id:completeTarget.id,p_cost:Number(f.cost||0),p_downtime_hours:Number(f.downtime_hours||0),
      p_meter_reading:f.meter_reading===''?null:Number(f.meter_reading),p_next_service_date:f.next_service_date||null,
      p_notes:f.notes||null,p_payment_method:f.payment_method||null,
      p_bank_account_id:f.payment_method&&f.payment_method!=='cash'?(f.bank_account_id||null):null,p_reference:f.reference||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setCompleteTarget(null);setCompleteForm((v)=>({cost:'',downtime_hours:'',meter_reading:'',next_service_date:'',notes:'',payment_method:'',bank_account_id:v.bank_account_id,reference:''}))
      setMessage({type:'success',text:'Maintenance completed and asset returned to service.'});await load()
    }
    setBusy(false)
  }

  const setStatus=async(asset,status)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('set_asset_status',{p_asset_id:asset.id,p_status:status,p_notes:null})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:`${asset.asset_number} status changed to ${status.replaceAll('_',' ')}.`});await load()}
    setBusy(false)
  }

  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase()
    if(!term)return assets
    return assets.filter((a)=>[a.asset_number,a.name,a.category,a.asset_type,a.manufacturer,a.model,a.serial_number,a.status].filter(Boolean).some((v)=>String(v).toLowerCase().includes(term)))
  },[assets,search])

  const openMaintenance=maintenance.filter((m)=>['scheduled','in_progress'].includes(m.status))
  const overdueMaint=openMaintenance.filter((m)=>m.scheduled_date&&new Date(m.scheduled_date+'T23:59:59')<new Date())
  const dueService=assets.filter((a)=>a.active&&a.next_service_date&&new Date(a.next_service_date+'T23:59:59')<=new Date(Date.now()+30*86400000))
  const totalCost=assets.reduce((sum,a)=>sum+Number(a.purchase_cost||0),0)
  const totalBook=assets.filter((a)=>a.active).reduce((sum,a)=>sum+bookValue(a),0)

  if(loading)return <main className="page-wrap text-muted">Loading assets...</main>

  const selectedMaint=selected?maintenance.filter((m)=>m.asset_id===selected.id):[]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Assets</p><h1 className="page-title">Assets & Maintenance</h1><p className="page-subtitle">Equipment, machines, tools and fixed assets with maintenance schedules, downtime and lifecycle cost.</p></div>
      <Link href="/fleet" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Fleet & Delivery</Link>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active assets</p><strong className="mt-2 block text-2xl">{assets.filter((a)=>a.active).length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Approx. book value</p><strong className="mt-2 block text-xl">{money(totalBook,currency)}</strong><p className="mt-1 text-xs text-muted">Purchase cost {money(totalCost,currency)}</p></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Service due ≤30 days</p><strong className="mt-2 block text-2xl text-amber-600">{dueService.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Overdue maintenance</p><strong className="mt-2 block text-2xl text-red-500">{overdueMaint.length}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['assets','Asset register'],['new','New asset'],['maintenance','Maintenance']].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='assets'&&<section className="space-y-4">
      <input className="input-base max-w-xl" placeholder="Search asset number, name, type, model, serial or status…" value={search} onChange={(e)=>setSearch(e.target.value)}/>
      {!filtered.length&&<div className="page-card p-7 text-center text-sm text-muted">No assets yet.</div>}
      {filtered.map((a)=><button key={a.id} type="button" onClick={()=>setSelected(a)} className="page-card w-full p-4 text-left sm:p-5"><div className="grid gap-3 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{a.asset_number} · {a.name}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{a.asset_type}</span><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${a.status==='active'?'bg-emerald-500/10 text-emerald-600':a.status==='maintenance'?'bg-amber-500/10 text-amber-600':'bg-red-500/10 text-red-500'}`}>{a.status.replaceAll('_',' ')}</span></div><p className="mt-1 text-xs text-muted">{locationName(a.location_id)} · {a.manufacturer||''} {a.model||''}{a.serial_number?` · S/N ${a.serial_number}`:''}{a.assigned_user_id?` · ${userName(a.assigned_user_id)}`:''}</p></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Book value</span><strong className="block">{money(bookValue(a),currency)}</strong></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Next service</span><strong className={a.next_service_date&&new Date(a.next_service_date+'T23:59:59')<new Date()?'text-red-500':''}>{a.next_service_date?new Date(a.next_service_date+'T00:00:00').toLocaleDateString():'—'}</strong></div></div></button>)}
    </section>}

    {tab==='new'&&canManage&&<form onSubmit={createAsset} className="page-card mx-auto max-w-4xl p-5"><h2 className="font-black">Register asset</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><input required className="input-base" placeholder="Asset name" value={assetForm.name} onChange={(e)=>setAssetForm({...assetForm,name:e.target.value})}/><input className="input-base" placeholder="Category" value={assetForm.category} onChange={(e)=>setAssetForm({...assetForm,category:e.target.value})}/><select className="input-base" value={assetForm.asset_type} onChange={(e)=>setAssetForm({...assetForm,asset_type:e.target.value})}><option value="equipment">Equipment</option><option value="machine">Machine</option><option value="tool">Tool</option><option value="building">Building</option><option value="furniture">Furniture</option><option value="computer">Computer / IT</option><option value="other">Other</option></select><select className="input-base" value={assetForm.location_id} onChange={(e)=>setAssetForm({...assetForm,location_id:e.target.value})}>{locations.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select><input className="input-base" placeholder="Manufacturer" value={assetForm.manufacturer} onChange={(e)=>setAssetForm({...assetForm,manufacturer:e.target.value})}/><input className="input-base" placeholder="Model" value={assetForm.model} onChange={(e)=>setAssetForm({...assetForm,model:e.target.value})}/><input className="input-base" placeholder="Serial number" value={assetForm.serial_number} onChange={(e)=>setAssetForm({...assetForm,serial_number:e.target.value})}/><select className="input-base" value={assetForm.assigned_user_id} onChange={(e)=>setAssetForm({...assetForm,assigned_user_id:e.target.value})}><option value="">Not assigned to a person</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><label><span className="mb-1 block text-xs font-bold text-muted">Purchase date</span><input className="input-base" type="date" value={assetForm.purchase_date} onChange={(e)=>setAssetForm({...assetForm,purchase_date:e.target.value})}/></label><input className="input-base" type="number" min="0" step="0.01" placeholder="Purchase cost" value={assetForm.purchase_cost} onChange={(e)=>setAssetForm({...assetForm,purchase_cost:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Salvage value" value={assetForm.salvage_value} onChange={(e)=>setAssetForm({...assetForm,salvage_value:e.target.value})}/><input className="input-base" type="number" min="1" placeholder="Useful life (months)" value={assetForm.useful_life_months} onChange={(e)=>setAssetForm({...assetForm,useful_life_months:e.target.value})}/><label><span className="mb-1 block text-xs font-bold text-muted">Next service date</span><input className="input-base" type="date" value={assetForm.next_service_date} onChange={(e)=>setAssetForm({...assetForm,next_service_date:e.target.value})}/></label><input className="input-base" type="number" min="1" placeholder="Service interval days" value={assetForm.service_interval_days} onChange={(e)=>setAssetForm({...assetForm,service_interval_days:e.target.value})}/><textarea className="input-base min-h-20 sm:col-span-2" placeholder="Notes" value={assetForm.notes} onChange={(e)=>setAssetForm({...assetForm,notes:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Register asset</button></form>}

    {tab==='maintenance'&&<section className="grid gap-5 xl:grid-cols-[400px_1fr]">
      {canMaintenance&&<form onSubmit={scheduleMaintenance} className="page-card h-fit p-5"><h2 className="font-black">Schedule maintenance</h2><select className="input-base mt-3" value={maintForm.asset_id} onChange={(e)=>setMaintForm({...maintForm,asset_id:e.target.value})}>{assets.filter((a)=>a.active).map((a)=><option key={a.id} value={a.id}>{a.asset_number} · {a.name}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-3"><select className="input-base" value={maintForm.maintenance_type} onChange={(e)=>setMaintForm({...maintForm,maintenance_type:e.target.value})}><option value="preventive">Preventive</option><option value="corrective">Corrective</option><option value="inspection">Inspection</option><option value="repair">Repair</option><option value="service">Service</option><option value="other">Other</option></select><select className="input-base" value={maintForm.priority} onChange={(e)=>setMaintForm({...maintForm,priority:e.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div><input className="input-base mt-3" type="date" value={maintForm.scheduled_date} onChange={(e)=>setMaintForm({...maintForm,scheduled_date:e.target.value})}/><textarea required className="input-base mt-3 min-h-20" placeholder="Work required" value={maintForm.description} onChange={(e)=>setMaintForm({...maintForm,description:e.target.value})}/><select className="input-base mt-3" value={maintForm.assigned_user_id} onChange={(e)=>setMaintForm({...maintForm,assigned_user_id:e.target.value})}><option value="">No internal assignee</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input className="input-base mt-3" placeholder="Vendor / workshop" value={maintForm.vendor} onChange={(e)=>setMaintForm({...maintForm,vendor:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Notes" value={maintForm.notes} onChange={(e)=>setMaintForm({...maintForm,notes:e.target.value})}/><button disabled={busy||!maintForm.asset_id} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black">Schedule maintenance</button></form>}
      <div className="space-y-3">{maintenance.map((m)=>{const a=assets.find((x)=>x.id===m.asset_id);return <article key={m.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{m.maintenance_number}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{m.status.replaceAll('_',' ')}</span><span className={m.priority==='urgent'?'text-red-500 text-xs font-black uppercase':'text-xs text-muted'}>{m.priority}</span></div><p className="mt-1 text-sm">{a?.asset_number||'Asset'} · {a?.name||'Unknown asset'}</p><p className="mt-1 text-xs text-muted">{m.description||m.maintenance_type} · {m.scheduled_date?`scheduled ${new Date(m.scheduled_date+'T00:00:00').toLocaleDateString()}`:''}{m.assigned_user_id?` · ${userName(m.assigned_user_id)}`:''}</p></div><div className="text-left sm:text-right"><strong>{money(m.cost,currency)}</strong><p className="text-xs text-muted">{Number(m.downtime_hours||0).toLocaleString()} downtime hrs</p></div></div>{canMaintenance&&['scheduled','in_progress'].includes(m.status)&&<div className="mt-3 flex gap-2">{m.status==='scheduled'&&<button disabled={busy} type="button" onClick={()=>startMaintenance(m.id)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Start maintenance</button>}<button type="button" onClick={()=>{setCompleteTarget(m);setCompleteForm((v)=>({...v,next_service_date:m.next_service_date||''}))}} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Complete</button></div>}</article>})}</div>
    </section>}

    {selected&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8"><div className="mx-auto max-w-3xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">{selected.asset_number}</p><h2 className="text-2xl font-black">{selected.name}</h2><p className="mt-1 text-sm text-muted">{selected.asset_type} · {locationName(selected.location_id)}</p></div><button type="button" onClick={()=>setSelected(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><div className="mt-5 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Purchase cost</span><strong className="block">{money(selected.purchase_cost,currency)}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Approx. book value</span><strong className="block">{money(bookValue(selected),currency)}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Status</span><strong className="block capitalize">{selected.status.replaceAll('_',' ')}</strong></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-xl border border-[var(--line)] p-4 text-sm"><p><span className="text-muted">Manufacturer:</span> {selected.manufacturer||'—'}</p><p className="mt-2"><span className="text-muted">Model:</span> {selected.model||'—'}</p><p className="mt-2"><span className="text-muted">Serial:</span> {selected.serial_number||'—'}</p><p className="mt-2"><span className="text-muted">Assigned:</span> {selected.assigned_user_id?userName(selected.assigned_user_id):'—'}</p></div><div className="rounded-xl border border-[var(--line)] p-4 text-sm"><p><span className="text-muted">Purchased:</span> {selected.purchase_date||'—'}</p><p className="mt-2"><span className="text-muted">Useful life:</span> {selected.useful_life_months?`${selected.useful_life_months} months`:'—'}</p><p className="mt-2"><span className="text-muted">Next service:</span> {selected.next_service_date||'—'}</p><p className="mt-2"><span className="text-muted">Service interval:</span> {selected.service_interval_days?`${selected.service_interval_days} days`:'—'}</p></div></div>{canManage&&<div className="mt-5 flex flex-wrap gap-2"><button disabled={busy} onClick={()=>setStatus(selected,'active')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Active</button><button disabled={busy} onClick={()=>setStatus(selected,'out_of_service')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Out of service</button><button disabled={busy} onClick={()=>setStatus(selected,'retired')} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white">Retire</button></div>}<div className="mt-5"><h3 className="font-black">Maintenance history</h3><div className="mt-2 space-y-2">{!selectedMaint.length&&<p className="text-sm text-muted">No maintenance history.</p>}{selectedMaint.map((m)=><div key={m.id} className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><div className="flex justify-between gap-3"><strong>{m.maintenance_number} · {m.maintenance_type}</strong><span className="capitalize text-muted">{m.status.replaceAll('_',' ')}</span></div><p className="mt-1 text-xs text-muted">{m.description||''}{m.completed_at?` · completed ${new Date(m.completed_at).toLocaleDateString()}`:''} · {money(m.cost,currency)}</p></div>)}</div></div></div></div>}

    {completeTarget&&<div className="fixed inset-0 z-[110] overflow-y-auto bg-black/60 p-4 sm:p-8"><form onSubmit={completeMaintenance} className="mx-auto max-w-xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Complete maintenance</p><h2 className="text-xl font-black">{completeTarget.maintenance_number}</h2></div><button type="button" onClick={()=>setCompleteTarget(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><div className="mt-4 grid gap-3 sm:grid-cols-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Maintenance cost" value={completeForm.cost} onChange={(e)=>setCompleteForm({...completeForm,cost:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Downtime hours" value={completeForm.downtime_hours} onChange={(e)=>setCompleteForm({...completeForm,downtime_hours:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Meter / odometer reading" value={completeForm.meter_reading} onChange={(e)=>setCompleteForm({...completeForm,meter_reading:e.target.value})}/><label><span className="mb-1 block text-xs font-bold text-muted">Next service</span><input className="input-base" type="date" value={completeForm.next_service_date} onChange={(e)=>setCompleteForm({...completeForm,next_service_date:e.target.value})}/></label></div><select className="input-base mt-3" value={completeForm.payment_method} onChange={(e)=>setCompleteForm({...completeForm,payment_method:e.target.value})}><option value="">Track cost only / not paid now</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="cheque">Cheque</option></select>{completeForm.payment_method&&completeForm.payment_method!=='cash'&&<select className="input-base mt-3" value={completeForm.bank_account_id} onChange={(e)=>setCompleteForm({...completeForm,bank_account_id:e.target.value})}>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}<input className="input-base mt-3" placeholder="Payment reference" value={completeForm.reference} onChange={(e)=>setCompleteForm({...completeForm,reference:e.target.value})}/><textarea className="input-base mt-3 min-h-20" placeholder="Completion notes" value={completeForm.notes} onChange={(e)=>setCompleteForm({...completeForm,notes:e.target.value})}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Complete maintenance</button></form></div>}
  </main>
}
