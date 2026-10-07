'use client'

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'next/navigation'

const money=(value,currency)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(currency||'UGX')

export default function PublicShopPage(){
  const params=useParams()
  const slug=String(params?.slug||'')
  const [bundle,setBundle]=useState(null)
  const [cart,setCart]=useState({})
  const [form,setForm]=useState({customer_name:'',customer_phone:'',customer_email:'',fulfillment_method:'pickup',delivery_address:'',payment_method:'cash_on_delivery',notes:''})
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)
  const [success,setSuccess]=useState(null)

  useEffect(()=>{
    if(!slug)return
    ;(async()=>{
      try{
        const response=await fetch('/api/storefront?slug='+encodeURIComponent(slug),{cache:'no-store'})
        const data=await response.json()
        if(!response.ok)throw new Error(data.error||'Storefront unavailable.')
        setBundle(data)
        if(!data.store.allow_pickup&&data.store.allow_delivery)setForm(f=>({...f,fulfillment_method:'delivery'}))
      }catch(error){setMessage({type:'error',text:error.message})}
      finally{setLoading(false)}
    })()
  },[slug])

  const lines=useMemo(()=>{
    if(!bundle)return []
    return bundle.products.map(product=>{
      const quantity=Number(cart[product.id]||0)
      return quantity>0?{...product,quantity}:null
    }).filter(Boolean)
  },[bundle,cart])

  const subtotal=lines.reduce((sum,x)=>sum+x.quantity*Number(x.price||0),0)
  const tax=lines.reduce((sum,x)=>sum+x.quantity*Number(x.price||0)*Number(x.tax_rate||0)/100,0)
  const delivery=form.fulfillment_method==='delivery'?Number(bundle?.store?.delivery_fee||0):0
  const total=subtotal+tax+delivery

  const changeQty=(product,delta)=>{
    const current=Number(cart[product.id]||0)
    const maxStock=product.available_quantity===null?999999:Number(product.available_quantity)
    const maxOrder=product.max_per_order===null?999999:Number(product.max_per_order)
    const next=Math.max(0,Math.min(current+delta,maxStock,maxOrder))
    setCart(c=>({...c,[product.id]:next}))
  }

  const submit=async(event)=>{
    event.preventDefault()
    if(!lines.length)return setMessage({type:'error',text:'Add at least one item to your cart.'})
    setBusy(true);setMessage(null)
    try{
      const response=await fetch('/api/storefront',{
        method:'POST',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({...form,slug,items:lines.map(x=>({product_id:x.id,quantity:x.quantity}))})
      })
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||'Could not place order.')
      setSuccess(data)
      setCart({})
    }catch(error){setMessage({type:'error',text:error.message})}
    finally{setBusy(false)}
  }

  if(loading)return <main className="min-h-screen bg-[var(--bg)] p-6 text-muted">Loading store...</main>

  if(!bundle)return <main className="min-h-screen bg-[var(--bg)] p-6"><div className="mx-auto max-w-xl rounded-3xl bg-[var(--panel)] p-8 text-center"><h1 className="text-2xl font-black">Store unavailable</h1><p className="mt-2 text-sm text-muted">{message?.text||'This online store is not available.'}</p></div></main>

  const {store,products}=bundle

  if(success)return <main className="min-h-screen bg-[var(--bg)] p-6"><section className="mx-auto max-w-xl rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-8 text-center"><div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-emerald-500/10 text-2xl font-black text-emerald-600">✓</div><p className="mt-5 text-xs font-black uppercase text-muted">{store.name}</p><h1 className="mt-1 text-3xl font-black">Order received</h1><p className="mt-3 text-sm leading-6 text-muted">Keep the order number below. Staff can now confirm and process it inside MGT.</p><div className="mt-5 rounded-2xl bg-[var(--panel-2)] p-5"><p className="text-xs text-muted">Order number</p><strong className="mt-1 block text-xl">{success.order_number}</strong><p className="mt-3 text-xs text-muted">Total</p><strong>{money(success.total_amount,success.currency)}</strong></div><button onClick={()=>setSuccess(null)} className="btn-primary mt-5 rounded-xl px-5 py-3 font-black">Continue shopping</button></section></main>

  return <main className="min-h-screen bg-[var(--bg)]">
    <header className="border-b border-[var(--line)] bg-[var(--panel)]"><div className="mx-auto max-w-7xl px-5 py-5 sm:px-8"><strong className="text-xl">{store.name}</strong><p className="text-xs text-muted">{store.contact_phone||store.contact_email||'Online store'}</p></div></header>

    <section className="border-b border-[var(--line)] bg-[var(--panel-2)]"><div className="mx-auto max-w-7xl px-5 py-10 sm:px-8"><p className="text-xs font-black uppercase text-accent">Shop online</p><h1 className="mt-2 max-w-3xl text-3xl font-black sm:text-5xl">{store.headline||store.name}</h1>{store.description&&<p className="mt-4 max-w-2xl text-sm leading-7 text-muted">{store.description}</p>}</div></section>

    <div className="mx-auto grid max-w-7xl gap-8 px-5 py-8 sm:px-8 lg:grid-cols-[1fr_390px]">
      <section>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {products.map(product=><article key={product.id} className="rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm">
            {product.image_url?<img src={product.image_url} alt={product.name} className="mb-4 aspect-[4/3] w-full rounded-2xl object-cover"/>:<div className="mb-4 grid aspect-[4/3] place-items-center rounded-2xl bg-[var(--panel-2)] text-3xl font-black text-muted">MGT</div>}
            <strong>{product.name}</strong>{product.description&&<p className="mt-2 text-sm leading-6 text-muted">{product.description}</p>}
            <div className="mt-4 flex items-end justify-between gap-3"><div><strong>{money(product.price,store.currency)}</strong><p className={'text-[11px] '+(product.in_stock?'text-emerald-600':'text-red-500')}>{product.in_stock?(product.available_quantity===null?'Available':Number(product.available_quantity)+' available'):'Out of stock'}</p></div><div className="flex items-center gap-2"><button disabled={!cart[product.id]} onClick={()=>changeQty(product,-1)} className="h-9 w-9 rounded-xl border border-[var(--line)] font-black disabled:opacity-30">−</button><span className="min-w-5 text-center font-black">{Number(cart[product.id]||0)}</span><button disabled={!product.in_stock} onClick={()=>changeQty(product,1)} className="h-9 w-9 rounded-xl bg-[var(--accent)] font-black text-white disabled:opacity-30">+</button></div></div>
          </article>)}
        </div>
      </section>

      <aside className="h-fit rounded-3xl border border-[var(--line)] bg-[var(--panel)] p-5 shadow-sm lg:sticky lg:top-5">
        <h2 className="text-xl font-black">Checkout</h2>
        <div className="mt-4 space-y-3">{!lines.length&&<p className="rounded-xl bg-[var(--panel-2)] p-4 text-sm text-muted">Your cart is empty.</p>}{lines.map(line=><div key={line.id} className="flex justify-between gap-3 text-sm"><div><strong>{line.name}</strong><p className="text-xs text-muted">{line.quantity} × {money(line.price,store.currency)}</p></div><strong>{money(line.quantity*line.price*(1+line.tax_rate/100),store.currency)}</strong></div>)}</div>
        {!!lines.length&&<div className="mt-4 space-y-2 border-t border-[var(--line)] pt-4 text-sm"><div className="flex justify-between text-muted"><span>Subtotal</span><span>{money(subtotal,store.currency)}</span></div>{tax>0&&<div className="flex justify-between text-muted"><span>Tax</span><span>{money(tax,store.currency)}</span></div>}{delivery>0&&<div className="flex justify-between text-muted"><span>Delivery</span><span>{money(delivery,store.currency)}</span></div>}<div className="flex justify-between pt-2 text-lg font-black"><span>Total</span><span>{money(total,store.currency)}</span></div></div>}
        <form onSubmit={submit} className="mt-5 space-y-3">
          <input required className="input-base" placeholder="Your name" value={form.customer_name} onChange={e=>setForm({...form,customer_name:e.target.value})}/>
          <input required className="input-base" placeholder="Phone number" value={form.customer_phone} onChange={e=>setForm({...form,customer_phone:e.target.value})}/>
          <input className="input-base" type="email" placeholder="Email (optional)" value={form.customer_email} onChange={e=>setForm({...form,customer_email:e.target.value})}/>
          <select className="input-base" value={form.fulfillment_method} onChange={e=>setForm({...form,fulfillment_method:e.target.value})}>{store.allow_pickup&&<option value="pickup">Pickup</option>}{store.allow_delivery&&<option value="delivery">Delivery</option>}</select>
          {form.fulfillment_method==='delivery'&&<textarea required className="input-base min-h-20" placeholder="Delivery address" value={form.delivery_address} onChange={e=>setForm({...form,delivery_address:e.target.value})}/>}
          <select className="input-base" value={form.payment_method} onChange={e=>setForm({...form,payment_method:e.target.value})}><option value="cash_on_delivery">Pay on pickup / delivery</option><option value="mobile_money">Mobile money</option><option value="bank">Bank transfer</option><option value="card">Card / online payment</option></select>
          <textarea className="input-base min-h-16" placeholder="Order notes (optional)" value={form.notes} onChange={e=>setForm({...form,notes:e.target.value})}/>
          {message&&<div className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-500">{message.text}</div>}
          <button disabled={busy||!lines.length} className="btn-primary w-full rounded-xl px-4 py-3 font-black disabled:opacity-40">{busy?'Placing order...':'Place order · '+money(total,store.currency)}</button>
        </form>
      </aside>
    </div>
  </main>
}
