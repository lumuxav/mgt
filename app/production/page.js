'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()
const blankComponent=()=>({product_id:'',quantity:'1'})

export default function ProductionPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [products,setProducts]=useState([])
  const [locations,setLocations]=useState([])
  const [boms,setBoms]=useState([])
  const [orders,setOrders]=useState([])
  const [consumption,setConsumption]=useState([])
  const [outputs,setOutputs]=useState([])
  const [tab,setTab]=useState('orders')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const [bomName,setBomName]=useState('')
  const [outputProduct,setOutputProduct]=useState('')
  const [outputQty,setOutputQty]=useState('1')
  const [components,setComponents]=useState([blankComponent()])

  const [orderBom,setOrderBom]=useState('')
  const [orderLocation,setOrderLocation]=useState('')
  const [plannedQty,setPlannedQty]=useState('')
  const [orderNotes,setOrderNotes]=useState('')

  const [completeOrder,setCompleteOrder]=useState(null)
  const [actualOutput,setActualOutput]=useState('')
  const [wasteQty,setWasteQty]=useState('')
  const [actualUse,setActualUse]=useState({})
  const [completeNotes,setCompleteNotes]=useState('')

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canBom=permissions.includes('manufacturing.bom')||permissions.includes('manufacturing.manage')
  const canProduce=permissions.includes('manufacturing.production')||permissions.includes('manufacturing.manage')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,productRes,locationRes,bomRes,orderRes,consRes,outRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('products').select('id,name,sku,unit,item_type,cost_price,track_inventory').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('boms').select('id,name,output_product_id,output_quantity,active,created_at,products(name,sku,unit),bom_items(id,product_id,quantity,products(name,sku,unit,cost_price))').eq('organization_id',org).eq('active',true).order('created_at',{ascending:false}),
        supabase.from('production_orders').select('id,production_number,location_id,bom_id,output_product_id,planned_quantity,actual_quantity,waste_quantity,status,total_material_cost,unit_cost,output_variance,approval_status,notes,started_at,completed_at,created_at,locations(name),boms(name,output_quantity),products(name,sku,unit)').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),
        supabase.from('production_consumption').select('id,production_order_id,product_id,planned_quantity,actual_quantity,unit_cost,line_cost,created_at,products(name,sku,unit)').eq('organization_id',org).order('created_at',{ascending:false}).limit(2000),
        supabase.from('production_outputs').select('id,production_order_id,product_id,quantity,unit_cost,output_type,created_at,products(name,sku,unit)').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
      ])
      for(const result of [permRes,productRes,locationRes,bomRes,orderRes,consRes,outRes])if(result.error)throw result.error
      setPermissions((permRes.data||[]).map((row)=>row.permission))
      setProducts((productRes.data||[]).filter((item)=>item.track_inventory))
      setLocations(locationRes.data||[])
      setBoms(bomRes.data||[])
      setOrders(orderRes.data||[])
      setConsumption(consRes.data||[])
      setOutputs(outRes.data||[])
      const defaultLocation=ctx.location?.id||locationRes.data?.[0]?.id||''
      setOrderLocation((value)=>value||defaultLocation)
      setOutputProduct((value)=>value||productRes.data?.find((item)=>item.track_inventory)?.id||'')
      setOrderBom((value)=>value||bomRes.data?.[0]?.id||'')
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load manufacturing.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const addComponent=()=>setComponents((rows)=>[...rows,blankComponent()])
  const changeComponent=(index,key,value)=>setComponents((rows)=>rows.map((row,i)=>i===index?{...row,[key]:value}:row))
  const removeComponent=(index)=>setComponents((rows)=>rows.length===1?rows:rows.filter((_,i)=>i!==index))

  const createBom=async(event)=>{
    event.preventDefault()
    const items=components.filter((item)=>item.product_id&&Number(item.quantity)>0).map((item)=>({product_id:item.product_id,quantity:Number(item.quantity)}))
    if(!items.length)return setMessage({type:'error',text:'Add at least one raw material/component.'})
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('create_bom',{
      p_name:bomName,
      p_output_product_id:outputProduct,
      p_output_quantity:Number(outputQty),
      p_items:items,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:`BOM ${data?.name||bomName} created.`})
      setBomName('');setOutputQty('1');setComponents([blankComponent()]);await load()
    }
    setBusy(false)
  }

  const createOrder=async(event)=>{
    event.preventDefault()
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('create_production_order',{
      p_location_id:orderLocation,
      p_bom_id:orderBom,
      p_planned_quantity:Number(plannedQty),
      p_notes:orderNotes||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:data?.approval_required?'warn':'success',text:data?.approval_required?`${data.production_number} is waiting for approval.`:`${data.production_number} created and ready to start.`})
      setPlannedQty('');setOrderNotes('');setTab('orders');await load()
    }
    setBusy(false)
  }

  const startOrder=async(order)=>{
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('start_production_order',{p_production_order_id:order.id})
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:`${data?.production_number||'Production order'} started.`});await load()}
    setBusy(false)
  }

  const openCompletion=(order)=>{
    const bom=boms.find((item)=>item.id===order.bom_id)
    const initial={}
    for(const item of bom?.bom_items||[]){
      const required=(Number(item.quantity||0)/Number(bom.output_quantity||1))*Number(order.planned_quantity||0)
      initial[item.product_id]=String(Number(required.toFixed(3)))
    }
    setCompleteOrder(order)
    setActualOutput(String(order.planned_quantity||''))
    setWasteQty('0')
    setActualUse(initial)
    setCompleteNotes('')
  }

  const completeProduction=async(event)=>{
    event.preventDefault()
    if(!completeOrder)return
    const bom=boms.find((item)=>item.id===completeOrder.bom_id)
    const use=(bom?.bom_items||[]).map((item)=>({product_id:item.product_id,quantity:Number(actualUse[item.product_id]||0)}))
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('complete_production_order',{
      p_production_order_id:completeOrder.id,
      p_actual_output:Number(actualOutput),
      p_waste_quantity:Number(wasteQty||0),
      p_consumption:use,
      p_notes:completeNotes||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:`${data?.production_number||'Production'} completed. Material cost ${money(data?.material_cost,currency)} · unit cost ${money(data?.unit_cost,currency)}.`})
      setCompleteOrder(null);await load()
    }
    setBusy(false)
  }

  const activeOrders=orders.filter((order)=>['planned','in_progress','pending_approval'].includes(order.status))
  const completed=orders.filter((order)=>order.status==='completed')
  const completedToday=completed.filter((order)=>order.completed_at&&new Date(order.completed_at).toDateString()===new Date().toDateString())
  const todayOutput=completedToday.reduce((sum,order)=>sum+Number(order.actual_quantity||0),0)
  const materialCost=completed.reduce((sum,order)=>sum+Number(order.total_material_cost||0),0)

  const selectedBom=boms.find((bom)=>bom.id===orderBom)
  const selectedRequirements=useMemo(()=>{
    if(!selectedBom||!plannedQty)return[]
    return (selectedBom.bom_items||[]).map((item)=>({
      name:item.products?.name||'Material',
      unit:item.products?.unit||'units',
      quantity:(Number(item.quantity||0)/Number(selectedBom.output_quantity||1))*Number(plannedQty||0),
      cost:Number(item.products?.cost_price||0),
    }))
  },[selectedBom,plannedQty])

  if(loading)return <main className="page-wrap text-muted">Loading manufacturing...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Manufacturing</p><h1 className="page-title">Production & BOMs</h1><p className="page-subtitle">Plan production, consume raw materials, record yield and waste, and cost finished goods automatically.</p></div>
      <div className="flex gap-2"><Link href="/inventory" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Inventory</Link><Link href="/approvals" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Approvals</Link></div>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':message.type==='warn'?'border-amber-500/30 bg-amber-500/10 text-amber-600':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active production orders</p><strong className="mt-2 block text-2xl">{activeOrders.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Completed today</p><strong className="mt-2 block text-2xl">{completedToday.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Output today</p><strong className="mt-2 block text-2xl">{todayOutput.toLocaleString()}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Recorded material cost</p><strong className="mt-2 block text-xl">{money(materialCost,currency)}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[
        ['orders','Production orders'],
        ['new','New production'],
        ['boms','BOMs / recipes'],
        ['history','Production history'],
      ].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='orders'&&<section className="space-y-3">
      {!activeOrders.length&&<div className="page-card p-7 text-center text-sm text-muted">No active production orders.</div>}
      {activeOrders.map((order)=>{
        const bom=boms.find((item)=>item.id===order.bom_id)
        return <article key={order.id} className="page-card p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><strong>{order.production_number||'Production order'}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{order.status.replaceAll('_',' ')}</span>{order.approval_status==='pending'&&<span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600">approval pending</span>}</div><p className="mt-1 text-sm text-muted">{order.products?.name||'Finished product'} · {order.locations?.name||'Location'} · {bom?.name||order.boms?.name||'BOM'}</p><p className="mt-1 text-xs text-muted">Created {new Date(order.created_at).toLocaleString()}</p></div>
            <div className="text-left lg:text-right"><span className="text-xs text-muted">Planned output</span><strong className="block text-xl">{Number(order.planned_quantity||0).toLocaleString()} {order.products?.unit||''}</strong></div>
          </div>
          {bom&&<div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{(bom.bom_items||[]).map((item)=>{const qty=(Number(item.quantity||0)/Number(bom.output_quantity||1))*Number(order.planned_quantity||0);return <div key={item.id} className="rounded-xl bg-[var(--panel-2)] p-3"><strong className="text-sm">{item.products?.name||'Material'}</strong><p className="mt-1 text-xs text-muted">Requires {qty.toLocaleString()} {item.products?.unit||''}</p></div>})}</div>}
          <div className="mt-4 flex flex-wrap gap-2">{order.status==='planned'&&canProduce&&<button disabled={busy} type="button" onClick={()=>startOrder(order)} className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Start production</button>}{['planned','in_progress'].includes(order.status)&&canProduce&&<button disabled={busy} type="button" onClick={()=>openCompletion(order)} className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Complete production</button>}{order.status==='pending_approval'&&<Link href="/approvals" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Open approval queue</Link>}</div>
        </article>
      })}
    </section>}

    {tab==='new'&&<form onSubmit={createOrder} className="page-card mx-auto max-w-3xl p-5">
      <h2 className="font-black">Create production order</h2><p className="mt-1 text-sm text-muted">Choose a recipe and target output. Material requirements are calculated from the BOM.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label><span className="mb-1 block text-xs font-bold text-muted">BOM / recipe</span><select className="input-base" value={orderBom} onChange={(event)=>setOrderBom(event.target.value)}><option value="">Select BOM</option>{boms.map((bom)=><option key={bom.id} value={bom.id}>{bom.name} → {bom.products?.name||'Output'}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Production location</span><select className="input-base" value={orderLocation} onChange={(event)=>setOrderLocation(event.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-muted">Planned finished quantity</span><input required className="input-base" type="number" min="0.001" step="0.001" value={plannedQty} onChange={(event)=>setPlannedQty(event.target.value)} placeholder="Target output"/></label>
      </div>
      {selectedRequirements.length>0&&<div className="mt-4 rounded-2xl bg-[var(--panel-2)] p-4"><strong className="text-sm">Material requirement preview</strong><div className="mt-3 space-y-2">{selectedRequirements.map((item)=><div key={item.name} className="flex justify-between gap-4 text-sm"><span>{item.name}</span><span><strong>{item.quantity.toLocaleString()}</strong> {item.unit} · {money(item.quantity*item.cost,currency)}</span></div>)}</div></div>}
      <textarea className="input-base mt-4 min-h-20" placeholder="Production notes" value={orderNotes} onChange={(event)=>setOrderNotes(event.target.value)}/>
      <button disabled={busy||!canProduce||!orderBom||!orderLocation} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Creating...':canProduce?'Create production order':'Production permission required'}</button>
    </form>}

    {tab==='boms'&&<section className="grid gap-5 xl:grid-cols-[420px_1fr]">
      {canBom&&<form onSubmit={createBom} className="page-card h-fit p-5">
        <h2 className="font-black">Create BOM / recipe</h2>
        <input required className="input-base mt-4" placeholder="BOM name e.g. 500ml Bottle Recipe" value={bomName} onChange={(event)=>setBomName(event.target.value)}/>
        <select className="input-base mt-3" value={outputProduct} onChange={(event)=>setOutputProduct(event.target.value)}>{products.map((product)=><option key={product.id} value={product.id}>{product.name}{product.sku?` — ${product.sku}`:''}</option>)}</select>
        <input required className="input-base mt-3" type="number" min="0.001" step="0.001" placeholder="Output quantity per recipe" value={outputQty} onChange={(event)=>setOutputQty(event.target.value)}/>
        <div className="mt-4 space-y-3">{components.map((row,index)=><div key={index} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-3"><div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]"><select className="input-base" value={row.product_id} onChange={(event)=>changeComponent(index,'product_id',event.target.value)}><option value="">Component</option>{products.filter((product)=>product.id!==outputProduct).map((product)=><option key={product.id} value={product.id}>{product.name}</option>)}</select><input className="input-base" type="number" min="0.001" step="0.001" value={row.quantity} onChange={(event)=>changeComponent(index,'quantity',event.target.value)}/><button type="button" onClick={()=>removeComponent(index)} className="rounded-xl border border-[var(--line)] px-3 text-red-500">×</button></div></div>)}</div>
        <button type="button" onClick={addComponent} className="btn-secondary mt-3 rounded-xl px-3 py-2 text-xs font-black">+ Add material</button>
        <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Saving...':'Save BOM'}</button>
      </form>}
      <div className="space-y-3">{!boms.length&&<div className="page-card p-6 text-center text-sm text-muted">No BOMs yet.</div>}{boms.map((bom)=><article key={bom.id} className="page-card p-5"><div><strong>{bom.name}</strong><p className="mt-1 text-sm text-muted">Produces {Number(bom.output_quantity||0).toLocaleString()} {bom.products?.unit||''} of {bom.products?.name||'finished product'}</p></div><div className="mt-4 space-y-2">{(bom.bom_items||[]).map((item)=><div key={item.id} className="flex justify-between gap-4 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span>{item.products?.name||'Material'}</span><strong>{Number(item.quantity||0).toLocaleString()} {item.products?.unit||''}</strong></div>)}</div></article>)}</div>
    </section>}

    {tab==='history'&&<section className="space-y-3">
      {!completed.length&&<div className="page-card p-7 text-center text-sm text-muted">No completed production yet.</div>}
      {completed.map((order)=>{
        const used=consumption.filter((item)=>item.production_order_id===order.id)
        const made=outputs.filter((item)=>item.production_order_id===order.id)
        return <article key={order.id} className="page-card p-5"><div className="flex flex-col gap-3 lg:flex-row lg:justify-between"><div><strong>{order.production_number||'Production order'}</strong><p className="mt-1 text-sm text-muted">{order.products?.name||'Finished product'} · {order.locations?.name||'Location'} · completed {order.completed_at?new Date(order.completed_at).toLocaleString():''}</p></div><div className="text-left lg:text-right"><strong>{money(order.total_material_cost,currency)}</strong><p className="mt-1 text-xs text-muted">Unit cost {money(order.unit_cost,currency)}</p></div></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Planned output</span><strong className="mt-1 block">{Number(order.planned_quantity||0).toLocaleString()}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Actual output</span><strong className="mt-1 block">{Number(order.actual_quantity||0).toLocaleString()}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Output variance</span><strong className={`mt-1 block ${Number(order.output_variance||0)<0?'text-red-500':Number(order.output_variance||0)>0?'text-emerald-600':''}`}>{Number(order.output_variance||0).toLocaleString()}</strong></div></div>{used.length>0&&<div className="mt-4"><p className="mb-2 text-xs font-black uppercase tracking-wide text-muted">Material consumption</p><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{used.map((item)=><div key={item.id} className="rounded-xl border border-[var(--line)] p-3 text-sm"><strong>{item.products?.name||'Material'}</strong><p className="mt-1 text-xs text-muted">Planned {Number(item.planned_quantity||0).toLocaleString()} · used {Number(item.actual_quantity||0).toLocaleString()}</p><p className="mt-1 text-xs text-muted">{money(item.line_cost,currency)}</p></div>)}</div></div>}{made.length>0&&<p className="mt-3 text-xs text-muted">Recorded output: {made.reduce((sum,item)=>sum+Number(item.quantity||0),0).toLocaleString()} units · waste/scrap: {Number(order.waste_quantity||0).toLocaleString()}</p>}</article>
      })}
    </section>}

    {completeOrder&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8"><form onSubmit={completeProduction} className="mx-auto max-w-3xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Complete production</p><h2 className="text-xl font-black">{completeOrder.production_number}</h2><p className="mt-1 text-sm text-muted">{completeOrder.products?.name}</p></div><button type="button" onClick={()=>setCompleteOrder(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><div className="mt-5 grid gap-3 sm:grid-cols-2"><label><span className="mb-1 block text-xs font-bold text-muted">Actual finished quantity</span><input required className="input-base" type="number" min="0.001" step="0.001" value={actualOutput} onChange={(event)=>setActualOutput(event.target.value)}/></label><label><span className="mb-1 block text-xs font-bold text-muted">Waste / scrap quantity</span><input className="input-base" type="number" min="0" step="0.001" value={wasteQty} onChange={(event)=>setWasteQty(event.target.value)}/></label></div><div className="mt-5"><p className="text-sm font-black">Actual material consumption</p><p className="mt-1 text-xs text-muted">Defaults come from the BOM. Change them if real consumption differed.</p><div className="mt-3 space-y-3">{(boms.find((bom)=>bom.id===completeOrder.bom_id)?.bom_items||[]).map((item)=><label key={item.product_id} className="grid gap-2 rounded-xl bg-[var(--panel-2)] p-3 sm:grid-cols-[1fr_160px] sm:items-center"><div><strong>{item.products?.name||'Material'}</strong><p className="text-xs text-muted">{item.products?.unit||'units'}</p></div><input className="input-base" type="number" min="0" step="0.001" value={actualUse[item.product_id]??''} onChange={(event)=>setActualUse({...actualUse,[item.product_id]:event.target.value})}/></label>)}</div></div><textarea className="input-base mt-4 min-h-20" placeholder="Completion notes" value={completeNotes} onChange={(event)=>setCompleteNotes(event.target.value)}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Posting production...':'Complete & post inventory'}</button></form></div>}
  </main>
}
