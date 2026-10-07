'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'

const money=(value,currency)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(currency||'UGX')
const slugify=(value)=>String(value||'').toLowerCase().trim().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)

export default function EcommercePage(){
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [locations,setLocations]=useState([])
  const [products,setProducts]=useState([])
  const [stores,setStores]=useState([])
  const [listings,setListings]=useState([])
  const [orders,setOrders]=useState([])
  const [items,setItems]=useState([])
  const [activeStoreId,setActiveStoreId]=useState('')
  const [tab,setTab]=useState('orders')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)
  const [storeForm,setStoreForm]=useState({name:'',slug:'',location_id:'',headline:'',description:'',contact_phone:'',contact_email:'',currency:'UGX',delivery_fee:'0',allow_pickup:true,allow_delivery:true,active:true})
  const [listingForm,setListingForm]=useState({product_id:'',title_override:'',description:'',image_url:'',price_override:'',max_per_order:'',featured:false})

  const canManage=permissions.includes('ecommerce.manage')
  const canOrders=permissions.includes('ecommerce.orders')||canManage
  const canFulfill=permissions.includes('ecommerce.fulfill')||canManage
  const activeStore=stores.find(x=>x.id===activeStoreId)||stores[0]||null
  const currency=activeStore?.currency||context?.organization?.currency||'UGX'

  const load=async(preferredStore)=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,locationRes,productRes,storeRes,listingRes,orderRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('products').select('id,name,sku,selling_price').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('storefronts').select('*').eq('organization_id',org).order('created_at'),
        supabase.from('storefront_products').select('*').eq('organization_id',org).order('sort_order'),
        supabase.from('online_orders').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(300),
      ])
      for(const r of [permRes,locationRes,productRes,storeRes,listingRes,orderRes])if(r.error)throw r.error

      let orderItems=[]
      const orderIds=(orderRes.data||[]).map(x=>x.id)
      if(orderIds.length){
        const itemRes=await supabase.from('online_order_items').select('*').in('order_id',orderIds).order('created_at')
        if(itemRes.error)throw itemRes.error
        orderItems=itemRes.data||[]
      }

      setPermissions((permRes.data||[]).map(x=>x.permission))
      setLocations(locationRes.data||[])
      setProducts(productRes.data||[])
      setStores(storeRes.data||[])
      setListings(listingRes.data||[])
      setOrders(orderRes.data||[])
      setItems(orderItems)
      const selected=preferredStore||activeStoreId||storeRes.data?.[0]?.id||''
      setActiveStoreId(selected)
      if(!storeForm.location_id&&locationRes.data?.[0]?.id)setStoreForm(f=>({...f,location_id:locationRes.data[0].id,currency:ctx.organization.currency||'UGX'}))
      if(!listingForm.product_id&&productRes.data?.[0]?.id)setListingForm(f=>({...f,product_id:productRes.data[0].id}))
    }catch(error){setMessage({type:'error',text:error.message})}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  useEffect(()=>{
    if(!activeStore)return
    setStoreForm({
      name:activeStore.name||'',slug:activeStore.slug||'',location_id:activeStore.location_id||'',
      headline:activeStore.headline||'',description:activeStore.description||'',contact_phone:activeStore.contact_phone||'',
      contact_email:activeStore.contact_email||'',currency:activeStore.currency||'UGX',delivery_fee:String(activeStore.delivery_fee||0),
      allow_pickup:activeStore.allow_pickup!==false,allow_delivery:activeStore.allow_delivery!==false,active:activeStore.active!==false
    })
  },[activeStoreId,stores])

  const saveStore=async(event)=>{
    event.preventDefault()
    setBusy(true);setMessage(null)
    try{
      const payload={
        organization_id:context.organization.id,location_id:storeForm.location_id,name:storeForm.name.trim(),
        slug:slugify(storeForm.slug||storeForm.name),headline:storeForm.headline.trim()||null,
        description:storeForm.description.trim()||null,contact_phone:storeForm.contact_phone.trim()||null,
        contact_email:storeForm.contact_email.trim()||null,currency:storeForm.currency||'UGX',
        delivery_fee:Number(storeForm.delivery_fee||0),allow_pickup:storeForm.allow_pickup,allow_delivery:storeForm.allow_delivery,
        active:storeForm.active,updated_at:new Date().toISOString()
      }
      let result
      if(activeStoreId)result=await supabase.from('storefronts').update(payload).eq('id',activeStoreId).select('id').single()
      else result=await supabase.from('storefronts').insert({...payload,created_by:context.user.id}).select('id').single()
      if(result.error)throw result.error
      setMessage({type:'success',text:activeStoreId?'Storefront updated.':'Storefront created.'})
      await load(result.data.id)
    }catch(error){setMessage({type:'error',text:error.message})}
    finally{setBusy(false)}
  }

  const addListing=async(event)=>{
    event.preventDefault()
    if(!activeStore)return
    setBusy(true);setMessage(null)
    try{
      const {error}=await supabase.from('storefront_products').upsert({
        organization_id:context.organization.id,storefront_id:activeStore.id,product_id:listingForm.product_id,
        published:true,featured:listingForm.featured,title_override:listingForm.title_override.trim()||null,
        description:listingForm.description.trim()||null,image_url:listingForm.image_url.trim()||null,
        price_override:listingForm.price_override===''?null:Number(listingForm.price_override),
        max_per_order:listingForm.max_per_order===''?null:Number(listingForm.max_per_order),
        updated_at:new Date().toISOString()
      },{onConflict:'storefront_id,product_id'})
      if(error)throw error
      setListingForm(f=>({...f,title_override:'',description:'',image_url:'',price_override:'',max_per_order:'',featured:false}))
      setMessage({type:'success',text:'Online product saved.'})
      await load(activeStore.id)
    }catch(error){setMessage({type:'error',text:error.message})}
    finally{setBusy(false)}
  }

  const toggleListing=async(row)=>{
    setBusy(true)
    const {error}=await supabase.from('storefront_products').update({published:!row.published,updated_at:new Date().toISOString()}).eq('id',row.id)
    if(error)setMessage({type:'error',text:error.message});else await load(activeStore?.id)
    setBusy(false)
  }

  const transition=async(order,status)=>{
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('transition_online_order',{p_order_id:order.id,p_status:status})
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:'Order '+order.order_number+' moved to '+status+(data?.sale_number?' and posted as '+data.sale_number:'')+'.'});await load(activeStore?.id)}
    setBusy(false)
  }

  const markPaid=async(order)=>{
    const method=window.prompt('Payment method:',order.payment_method||'mobile_money')
    if(!method)return
    const reference=window.prompt('Payment reference (optional):',order.payment_reference||'')||''
    setBusy(true)
    const {error}=await supabase.rpc('record_online_order_payment',{p_order_id:order.id,p_method:method,p_reference:reference||null})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Payment recorded.'});await load(activeStore?.id)}
    setBusy(false)
  }

  const storeOrders=orders.filter(x=>x.storefront_id===activeStore?.id)
  const storeListings=listings.filter(x=>x.storefront_id===activeStore?.id)
  const productName=id=>products.find(x=>x.id===id)?.name||'Product'
  const orderItems=id=>items.filter(x=>x.order_id===id)
  const publicUrl=activeStore&&typeof window!=='undefined'?window.location.origin+'/shop/'+activeStore.slug:''
  const completedRevenue=storeOrders.filter(x=>x.status==='completed').reduce((s,x)=>s+Number(x.total_amount||0),0)

  const actions=order=>{
    if(order.status==='pending'&&canOrders)return ['confirmed','cancelled']
    if(order.status==='confirmed'&&(canOrders||canFulfill))return ['processing','cancelled']
    if(order.status==='processing'&&canFulfill)return ['ready','cancelled']
    if(order.status==='ready'&&canFulfill)return [order.fulfillment_method==='delivery'?'dispatched':'completed','cancelled']
    if(order.status==='dispatched'&&canFulfill)return ['completed','cancelled']
    return []
  }

  if(loading)return <main className="page-wrap text-muted">Loading e-commerce...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Online sales</p><h1 className="page-title">E-commerce</h1><p className="page-subtitle">Publish products online, receive customer orders and keep stock synchronized with MGT.</p></div><div className="flex flex-wrap gap-2"><a href="/payments" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Payments</a>{canManage&&<button onClick={()=>{setActiveStoreId('');setTab('store')}} className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">New storefront</button>}</div></div>

    {message&&<div className={'mb-5 rounded-xl border px-4 py-3 text-sm '+(message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600')}>{message.text}</div>}

    {!!stores.length&&<div className="mb-5 flex flex-wrap items-center gap-2"><select className="input-base max-w-sm" value={activeStoreId} onChange={e=>setActiveStoreId(e.target.value)}>{stores.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>{activeStore&&<a className="btn-secondary rounded-xl px-3 py-2 text-xs font-black" href={'/shop/'+activeStore.slug} target="_blank" rel="noreferrer">Open storefront</a>}</div>}

    {activeStore&&<section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="page-card p-4"><p className="text-xs text-muted">Published products</p><strong className="mt-2 block text-2xl">{storeListings.filter(x=>x.published).length}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Open orders</p><strong className="mt-2 block text-2xl">{storeOrders.filter(x=>!['completed','cancelled'].includes(x.status)).length}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Paid awaiting completion</p><strong className="mt-2 block text-2xl">{storeOrders.filter(x=>x.payment_status==='paid'&&!['completed','cancelled'].includes(x.status)).length}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Completed online sales</p><strong className="mt-2 block text-xl">{money(completedRevenue,currency)}</strong></div></section>}

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">{[['orders','Orders'],['catalog','Online catalog'],['store','Store settings']].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={'whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black '+(tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted')}>{label}</button>)}</div>

    {tab==='orders'&&<section className="space-y-4">{!storeOrders.length&&<div className="page-card p-6 text-sm text-muted">No online orders yet.</div>}{storeOrders.map(order=><article key={order.id} className="page-card p-5"><div className="flex flex-col gap-3 lg:flex-row lg:justify-between"><div><strong className="text-lg">{order.order_number}</strong><p className="mt-1 text-sm text-muted">{order.customer_name} · {order.customer_phone}</p><p className="mt-1 text-xs text-muted">{order.fulfillment_method==='delivery'?'Delivery · '+order.delivery_address:'Customer pickup'} · {order.status} · {order.payment_status}</p></div><strong>{money(order.total_amount,currency)}</strong></div><div className="mt-4 overflow-hidden rounded-xl border border-[var(--line)]">{orderItems(order.id).map(line=><div key={line.id} className="flex justify-between border-b border-[var(--line)] p-3 text-sm last:border-b-0"><span>{line.description} · {Number(line.quantity)}</span><strong>{money(line.line_total,currency)}</strong></div>)}</div><div className="mt-4 flex flex-wrap gap-2">{order.payment_status!=='paid'&&order.status!=='cancelled'&&canOrders&&<button disabled={busy} onClick={()=>markPaid(order)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Mark paid</button>}{actions(order).map(status=><button key={status} disabled={busy} onClick={()=>transition(order,status)} className={status==='cancelled'?'rounded-xl border border-red-500/30 px-3 py-2 text-xs font-black text-red-500':'btn-primary rounded-xl px-3 py-2 text-xs font-black'}>{status==='completed'?'Complete & post sale':status}</button>)}</div></article>)}</section>}

    {tab==='catalog'&&activeStore&&<section className="grid gap-5 xl:grid-cols-[420px_1fr]">{canManage&&<form onSubmit={addListing} className="page-card h-fit p-5"><h2 className="font-black">Publish product</h2><select required className="input-base mt-4" value={listingForm.product_id} onChange={e=>setListingForm({...listingForm,product_id:e.target.value})}>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?' · '+p.sku:''}</option>)}</select><input className="input-base mt-3" placeholder="Online title override" value={listingForm.title_override} onChange={e=>setListingForm({...listingForm,title_override:e.target.value})}/><textarea className="input-base mt-3 min-h-20" placeholder="Description" value={listingForm.description} onChange={e=>setListingForm({...listingForm,description:e.target.value})}/><input className="input-base mt-3" type="url" placeholder="Image URL" value={listingForm.image_url} onChange={e=>setListingForm({...listingForm,image_url:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Price override" value={listingForm.price_override} onChange={e=>setListingForm({...listingForm,price_override:e.target.value})}/><input className="input-base" type="number" min="0.001" step="0.001" placeholder="Max per order" value={listingForm.max_per_order} onChange={e=>setListingForm({...listingForm,max_per_order:e.target.value})}/></div><label className="mt-3 flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={listingForm.featured} onChange={e=>setListingForm({...listingForm,featured:e.target.checked})}/> Featured</label><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Publish / update</button></form>}<div className="space-y-3">{!storeListings.length&&<div className="page-card p-6 text-sm text-muted">No published products yet.</div>}{storeListings.map(row=><article key={row.id} className="page-card p-4"><div className="flex items-center justify-between gap-3"><div><strong>{row.title_override||productName(row.product_id)}</strong><p className="mt-1 text-xs text-muted">{row.price_override!==null?'Online price '+money(row.price_override,currency):'Uses catalog price'} · {row.published?'Published':'Hidden'}</p></div>{canManage&&<button onClick={()=>toggleListing(row)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{row.published?'Hide':'Publish'}</button>}</div></article>)}</div></section>}

    {tab==='store'&&canManage&&<form onSubmit={saveStore} className="page-card max-w-3xl p-5"><h2 className="font-black">{activeStoreId?'Storefront settings':'New storefront'}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><input required className="input-base" placeholder="Store name" value={storeForm.name} onChange={e=>setStoreForm({...storeForm,name:e.target.value,slug:storeForm.slug||slugify(e.target.value)})}/><input required className="input-base" placeholder="store-slug" value={storeForm.slug} onChange={e=>setStoreForm({...storeForm,slug:slugify(e.target.value)})}/><select required className="input-base" value={storeForm.location_id} onChange={e=>setStoreForm({...storeForm,location_id:e.target.value})}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select><input className="input-base" value={storeForm.currency} onChange={e=>setStoreForm({...storeForm,currency:e.target.value.toUpperCase()})}/></div><input className="input-base mt-3" placeholder="Headline" value={storeForm.headline} onChange={e=>setStoreForm({...storeForm,headline:e.target.value})}/><textarea className="input-base mt-3 min-h-24" placeholder="Store description" value={storeForm.description} onChange={e=>setStoreForm({...storeForm,description:e.target.value})}/><div className="mt-3 grid gap-3 sm:grid-cols-3"><input className="input-base" placeholder="Contact phone" value={storeForm.contact_phone} onChange={e=>setStoreForm({...storeForm,contact_phone:e.target.value})}/><input className="input-base" type="email" placeholder="Contact email" value={storeForm.contact_email} onChange={e=>setStoreForm({...storeForm,contact_email:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Delivery fee" value={storeForm.delivery_fee} onChange={e=>setStoreForm({...storeForm,delivery_fee:e.target.value})}/></div><div className="mt-4 grid gap-2 sm:grid-cols-3"><label className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={storeForm.allow_pickup} onChange={e=>setStoreForm({...storeForm,allow_pickup:e.target.checked})}/> Pickup</label><label className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={storeForm.allow_delivery} onChange={e=>setStoreForm({...storeForm,allow_delivery:e.target.checked})}/> Delivery</label><label className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={storeForm.active} onChange={e=>setStoreForm({...storeForm,active:e.target.checked})}/> Live</label></div><div className="mt-4 flex flex-wrap gap-2"><button disabled={busy} className="btn-primary rounded-xl px-5 py-3 font-black">{activeStoreId?'Save storefront':'Create storefront'}</button>{activeStoreId&&publicUrl&&<button type="button" onClick={()=>navigator.clipboard?.writeText(publicUrl)} className="btn-secondary rounded-xl px-4 py-3 font-black">Copy public link</button>}</div></form>}
  </main>
}
