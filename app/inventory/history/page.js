'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../../lib/supabase'
import { getPlatformContext } from '../../../lib/platformDb'

const MOVE_STYLE={
  receipt:{icon:'↓',accent:'text-emerald-600'},
  sale:{icon:'↑',accent:'text-amber-600'},
  adjustment:{icon:'±',accent:'text-blue-600'},
  transfer_in:{icon:'→',accent:'text-emerald-600'},
  transfer_out:{icon:'←',accent:'text-amber-600'},
  production_input:{icon:'⚙',accent:'text-purple-600'},
  production_output:{icon:'✓',accent:'text-blue-600'},
  stocktake:{icon:'≡',accent:'text-red-600'},
}

export default function InventoryHistoryPage(){
  const [product,setProduct]=useState(null)
  const [locations,setLocations]=useState([])
  const [balances,setBalances]=useState([])
  const [moves,setMoves]=useState([])
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  useEffect(()=>{
    const load=async()=>{
      try{
        const params=new URLSearchParams(window.location.search)
        const productId=params.get('product')||params.get('id')
        const locationId=params.get('location')||''
        if(!productId)throw new Error('Choose a product from Inventory to view its movement history.')

        const ctx=await getPlatformContext()
        if(!ctx.organization?.id)throw new Error('Complete business setup first.')
        const org=ctx.organization.id

        const [productRes,locationRes,balanceRes,movementRes]=await Promise.all([
          supabase.from('products').select('id,name,sku,barcode,unit,track_inventory,active').eq('organization_id',org).eq('id',productId).maybeSingle(),
          supabase.from('locations').select('id,name,code,type,active').eq('organization_id',org).order('name'),
          supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,updated_at').eq('product_id',productId),
          (()=>{let q=supabase.from('stock_movements').select('id,organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by,created_at').eq('organization_id',org).eq('product_id',productId).order('created_at',{ascending:false}).limit(1000);if(locationId)q=q.eq('location_id',locationId);return q})(),
        ])
        for(const r of [productRes,locationRes,balanceRes,movementRes])if(r.error)throw r.error
        if(!productRes.data)throw new Error('Product not found in this business.')

        setProduct(productRes.data)
        setLocations(locationRes.data||[])
        setBalances((balanceRes.data||[]).filter(row=>!locationId||row.location_id===locationId))
        setMoves(movementRes.data||[])
      }catch(error){setMessage(error.message||'Could not load inventory history.')}
      setLoading(false)
    }
    load()
  },[])

  const locationMap=useMemo(()=>Object.fromEntries(locations.map(row=>[row.id,row])),[locations])
  const total=balances.reduce((sum,row)=>sum+Number(row.quantity||0),0)
  const reserved=balances.reduce((sum,row)=>sum+Number(row.reserved_quantity||0),0)

  if(loading)return <main className="page-wrap text-muted">Loading inventory history...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Inventory</p><h1 className="page-title">Movement History</h1><p className="page-subtitle">{product?product.name:'Product history'}</p></div>
      <Link href="/inventory" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Back to Inventory</Link>
    </div>

    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}

    {product&&<>
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Product</p><strong className="mt-1 block">{product.name}</strong><p className="mt-1 text-xs text-muted">{product.sku||product.barcode||'No SKU / barcode'}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Current quantity</p><strong className="mt-1 block text-2xl">{total.toLocaleString()} {product.unit||''}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Reserved</p><strong className="mt-1 block text-2xl">{reserved.toLocaleString()} {product.unit||''}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Movement records</p><strong className="mt-1 block text-2xl">{moves.length}</strong></div>
      </section>

      <section className="mb-6 page-card overflow-x-auto">
        <table className="min-w-[620px] w-full text-left text-sm">
          <thead><tr className="border-b border-[var(--line)]"><th className="p-4">Location</th><th className="p-4">On hand</th><th className="p-4">Reserved</th><th className="p-4">Available</th></tr></thead>
          <tbody>{balances.length?balances.map(row=><tr key={row.location_id} className="border-b border-[var(--line)] last:border-0"><td className="p-4 font-bold">{locationMap[row.location_id]?.name||'Unknown location'}</td><td className="p-4">{Number(row.quantity||0).toLocaleString()}</td><td className="p-4">{Number(row.reserved_quantity||0).toLocaleString()}</td><td className="p-4 font-black">{Math.max(0,Number(row.quantity||0)-Number(row.reserved_quantity||0)).toLocaleString()}</td></tr>):<tr><td colSpan={4} className="p-6 text-center text-muted">No stock balance exists for this product yet.</td></tr>}</tbody>
        </table>
      </section>

      <section className="space-y-3">
        {moves.length===0&&<div className="page-card p-6 text-center text-sm text-muted">No inventory movements recorded for this product.</div>}
        {moves.map(move=>{
          const style=MOVE_STYLE[move.movement_type]||{icon:'•',accent:'text-accent'}
          const qty=Number(move.quantity||0)
          return <article key={move.id} className="page-card p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0"><p className={`text-xs font-black uppercase tracking-wide ${style.accent}`}>{style.icon} {String(move.movement_type||'movement').replaceAll('_',' ')}</p><p className="mt-1 font-bold">{locationMap[move.location_id]?.name||'Unknown location'}</p><p className="mt-1 text-xs text-muted">{new Date(move.created_at).toLocaleString()}{move.reference_type?` · ${String(move.reference_type).replaceAll('_',' ')}`:''}</p>{move.notes&&<p className="mt-2 text-sm text-muted">{move.notes}</p>}</div>
              <div className="text-right"><strong className={`text-xl ${qty<0?'text-red-500':'text-emerald-600'}`}>{qty>0?'+':''}{qty.toLocaleString()}</strong>{move.unit_cost!==null&&move.unit_cost!==undefined&&<p className="mt-1 text-xs text-muted">Unit cost {Number(move.unit_cost||0).toLocaleString()}</p>}</div>
            </div>
          </article>
        })}
      </section>
    </>}
  </main>
}
