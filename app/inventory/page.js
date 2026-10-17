'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import BarcodeScanner from '../components/BarcodeScanner'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const transferLine = () => ({ product_id: '', quantity: '1' })

export default function InventoryPage() {
  const business = getBusinessConfig()
  const [context, setContext] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [products, setProducts] = useState([])
  const [locations, setLocations] = useState([])
  const [balances, setBalances] = useState([])
  const [movements, setMovements] = useState([])
  const [transfers, setTransfers] = useState([])
  const [stocktakes, setStocktakes] = useState([])
  const [tab, setTab] = useState('overview')
  const [locationFilter, setLocationFilter] = useState('')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [adjustProduct, setAdjustProduct] = useState('')
  const [adjustLocation, setAdjustLocation] = useState('')
  const [adjustQty, setAdjustQty] = useState('')
  const [adjustReason, setAdjustReason] = useState('correction')
  const [adjustNotes, setAdjustNotes] = useState('')

  const [fromLocation, setFromLocation] = useState('')
  const [toLocation, setToLocation] = useState('')
  const [transferLines, setTransferLines] = useState([transferLine()])
  const [transferNotes, setTransferNotes] = useState('')

  const [stocktakeLocation, setStocktakeLocation] = useState('')
  const [counts, setCounts] = useState({})
  const [stocktakeNotes, setStocktakeNotes] = useState('')

  const currency = context?.organization?.currency || business.currency || 'UGX'
  const canAdjust = permissions.includes('inventory.adjust')
  const canTransfer = permissions.includes('inventory.transfer')
  const canStocktake = permissions.includes('inventory.stocktake')
  const online = useOnlineStatus()

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id

      const [permRes, productRes, locationRes, balanceRes, movementRes, transferRes, stocktakeRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('products').select('id,name,sku,barcode,unit,item_type,track_inventory,cost_price,selling_price,reorder_level').eq('organization_id', org).eq('active', true).eq('track_inventory', true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,updated_at,products(name,sku,barcode,unit,cost_price,reorder_level,organization_id),locations(name,organization_id)'),
        supabase.from('stock_movements').select('id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,notes,recorded_by,created_at,products(name,sku),locations(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(250),
        supabase.from('stock_transfers').select('id,transfer_number,from_location_id,to_location_id,status,notes,created_at,from:locations!stock_transfers_from_location_id_fkey(name),to:locations!stock_transfers_to_location_id_fkey(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(80),
        supabase.from('stocktakes').select('id,stocktake_number,location_id,total_variance_units,total_variance_value,notes,created_at,locations(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(80),
      ])

      for (const result of [permRes, productRes, locationRes, balanceRes, movementRes, transferRes, stocktakeRes]) if (result.error) throw result.error

      setPermissions((permRes.data || []).map((row) => row.permission))
      setProducts(productRes.data || [])
      setLocations(locationRes.data || [])
      setBalances((balanceRes.data || []).filter((row) => row.products?.organization_id === org && row.locations?.organization_id === org))
      setMovements(movementRes.data || [])
      setTransfers(transferRes.data || [])
      setStocktakes(stocktakeRes.data || [])

      const defaultLocation = ctx.location?.id || locationRes.data?.[0]?.id || ''
      setLocationFilter((value) => value || defaultLocation)
      setAdjustLocation((value) => value || defaultLocation)
      setStocktakeLocation((value) => value || defaultLocation)
      setFromLocation((value) => value || defaultLocation)
      setToLocation((value) => value || locationRes.data?.find((item) => item.id !== defaultLocation)?.id || '')
      setAdjustProduct((value) => value || productRes.data?.[0]?.id || '')
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not load inventory.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const quantityFor = (productId, locationId) => {
    const row = balances.find((item) => item.product_id === productId && item.location_id === locationId)
    return Number(row?.quantity || 0)
  }

  const availableFor = (productId, locationId) => {
    const row = balances.find((item) => item.product_id === productId && item.location_id === locationId)
    return Number(row?.quantity || 0) - Number(row?.reserved_quantity || 0)
  }

  const locationBalances = useMemo(() => {
    const term = search.trim().toLowerCase()
    return balances.filter((row) => {
      if (locationFilter && row.location_id !== locationFilter) return false
      if (!term) return true
      return [row.products?.name, row.products?.sku, row.products?.barcode, row.locations?.name].filter(Boolean).some((value) => String(value).toLowerCase().includes(term))
    })
  }, [balances, locationFilter, search])

  const handleScannedBarcode = (value) => {
    const code = String(value || '').trim().toLowerCase()
    const product = products.find((item) =>
      String(item.barcode || '').toLowerCase() === code ||
      String(item.sku || '').toLowerCase() === code
    )
    setSearch(value)
    if (product) {
      setAdjustProduct(product.id)
      setMessage({ type: 'success', text: `Scanned ${product.name}.` })
    } else {
      setMessage({ type: 'error', text: `No inventory product matches barcode / SKU ${value}.` })
    }
  }

  const lowStock = useMemo(() => balances.filter((row) => {
    const reorder = Number(row.products?.reorder_level || 0)
    const available = Number(row.quantity || 0) - Number(row.reserved_quantity || 0)
    return reorder > 0 && available <= reorder
  }), [balances])

  const outOfStock = lowStock.filter((row) => Number(row.quantity || 0) - Number(row.reserved_quantity || 0) <= 0)
  const valuation = balances.reduce((sum, row) => sum + Math.max(0, Number(row.quantity || 0)) * Number(row.products?.cost_price || 0), 0)

  const submitAdjustment = async (event) => {
    event.preventDefault()
    if (!online) return setMessage({ type: 'error', text: 'You are offline. Stock adjustments are disabled until the connection returns.' })
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('submit_stock_adjustment', {
      p_location_id: adjustLocation,
      p_product_id: adjustProduct,
      p_quantity_delta: Number(adjustQty),
      p_reason: adjustReason,
      p_notes: adjustNotes || null,
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage(data?.status === 'pending_approval'
        ? { type: 'success', text: 'Stock adjustment submitted for approval. Inventory has not changed yet.' }
        : { type: 'success', text: `Stock adjusted. New quantity: ${Number(data?.new_quantity || 0).toLocaleString()}.` })
      setAdjustQty('')
      setAdjustNotes('')
      await load()
    }
    setBusy(false)
  }

  const addTransferLine = () => setTransferLines((lines) => [...lines, transferLine()])
  const changeTransferLine = (index, key, value) => setTransferLines((lines) => lines.map((line, i) => i === index ? { ...line, [key]: value } : line))
  const removeTransferLine = (index) => setTransferLines((lines) => lines.length === 1 ? lines : lines.filter((_, i) => i !== index))

  const submitTransfer = async (event) => {
    event.preventDefault()
    if (!online) return setMessage({ type: 'error', text: 'You are offline. Stock transfers are disabled until the connection returns.' })
    const items = transferLines.filter((line) => line.product_id && Number(line.quantity) > 0).map((line) => ({ product_id: line.product_id, quantity: Number(line.quantity) }))
    if (!items.length) return setMessage({ type: 'error', text: 'Add at least one transfer item.' })

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('transfer_stock', {
      p_from_location_id: fromLocation,
      p_to_location_id: toLocation,
      p_items: items,
      p_notes: transferNotes || null,
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `Transfer ${data?.transfer_number || ''} completed.` })
      setTransferLines([transferLine()])
      setTransferNotes('')
      await load()
    }
    setBusy(false)
  }

  const stocktakeRows = useMemo(() => products.map((product) => ({
    ...product,
    system: Number(balances.find(row=>row.product_id===product.id&&row.location_id===stocktakeLocation)?.quantity||0),
  })), [products, balances, stocktakeLocation])

  const submitStocktake = async (event) => {
    event.preventDefault()
    if (!online) return setMessage({ type: 'error', text: 'You are offline. Stocktakes cannot be posted until the connection returns.' })
    const items = stocktakeRows
      .filter((product) => counts[product.id] !== undefined && counts[product.id] !== '')
      .map((product) => ({ product_id: product.id, counted_quantity: Number(counts[product.id]) }))

    if (!items.length) return setMessage({ type: 'error', text: 'Enter at least one counted quantity.' })

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('post_stocktake', {
      p_location_id: stocktakeLocation,
      p_items: items,
      p_notes: stocktakeNotes || null,
    })

    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `${data?.stocktake_number || 'Stocktake'} posted. Variance: ${Number(data?.variance_units || 0).toLocaleString()} units / ${money(data?.variance_value, currency)}.` })
      setCounts({})
      setStocktakeNotes('')
      await load()
    }
    setBusy(false)
  }

  if (loading) return <main className="page-wrap text-muted">Loading inventory...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Inventory</p>
          <h1 className="page-title">Inventory</h1>
          <p className="page-subtitle">Stock levels, transfers, stocktakes, losses, receiving movements and valuation across all locations.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/catalog" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Catalog</Link>
          <Link href="/purchasing" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Purchasing</Link>
        </div>
      </div>

      {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Stock valuation</p><strong className="mt-2 block text-2xl">{money(valuation, currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Low stock lines</p><strong className="mt-2 block text-2xl text-amber-600">{lowStock.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Out of stock</p><strong className="mt-2 block text-2xl text-red-500">{outOfStock.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Locations</p><strong className="mt-2 block text-2xl">{locations.length}</strong></div>
      </section>

      <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
        {[
          ['overview','Stock overview'],
          ['transfer','Transfers'],
          ['stocktake','Stocktake'],
          ['movements','Movements'],
        ].map(([key,label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab === key ? 'bg-[var(--panel)] text-accent shadow-sm' : 'text-muted'}`}>{label}</button>
        ))}
      </div>

      {tab === 'overview' && (
        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          {canAdjust && (
            <form onSubmit={submitAdjustment} className="page-card h-fit p-5">
              <h2 className="font-black">Stock adjustment</h2>
              <p className="mt-1 text-xs text-muted">Use for opening stock, corrections, damage or loss. Sales, purchasing and transfers update stock automatically.</p>
              <select className="input-base mt-4" value={adjustProduct} onChange={(event) => setAdjustProduct(event.target.value)}>
                {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` — ${product.sku}` : ''}</option>)}
              </select>
              <select className="input-base mt-3" value={adjustLocation} onChange={(event) => setAdjustLocation(event.target.value)}>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
              <input required className="input-base mt-3" type="number" step="0.001" placeholder="Quantity change e.g. 10 or -2" value={adjustQty} onChange={(event) => setAdjustQty(event.target.value)} />
              <select className="input-base mt-3" value={adjustReason} onChange={(event) => setAdjustReason(event.target.value)}>
                <option value="opening_stock">Opening stock</option>
                <option value="correction">Correction</option>
                <option value="damage">Damaged stock</option>
                <option value="loss">Lost / missing stock</option>
                <option value="expiry">Expired stock</option>
                <option value="other">Other</option>
              </select>
              <textarea className="input-base mt-3 min-h-20" placeholder="Reason / notes" value={adjustNotes} onChange={(event) => setAdjustNotes(event.target.value)} />
              <button disabled={busy || !online} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Posting...' : 'Post adjustment'}</button>
            </form>
          )}

          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
              <select className="input-base" value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}>
                <option value="">All locations</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
              <div className="flex gap-2">
                <input className="input-base" placeholder="Search product, SKU, barcode or location…" value={search} onChange={(event) => setSearch(event.target.value)} />
                <BarcodeScanner onScan={handleScannedBarcode} label="Camera" className="btn-secondary shrink-0 rounded-xl px-4 py-2.5 text-sm font-black" />
              </div>
            </div>

            <div className="page-card overflow-hidden">
              <div className="divide-y divide-[var(--line)]">
                {!locationBalances.length && <p className="p-6 text-center text-sm text-muted">No stock balances yet.</p>}
                {locationBalances.map((row) => {
                  const available = Number(row.quantity || 0) - Number(row.reserved_quantity || 0)
                  const reorder = Number(row.products?.reorder_level || 0)
                  const low = reorder > 0 && available <= reorder
                  return (
                    <div key={`${row.product_id}-${row.location_id}`} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
                      <div>
                        <div className="flex flex-wrap items-center gap-2"><strong>{row.products?.name || 'Item'}</strong>{low && <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${available <= 0 ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600'}`}>{available <= 0 ? 'Out of stock' : 'Low stock'}</span>}</div>
                        <p className="mt-1 text-xs text-muted">{row.products?.sku || 'No SKU'} · {row.locations?.name} · {row.products?.unit || 'units'}</p>
                      </div>
                      <div className="text-left sm:text-right"><span className="text-xs text-muted">Available</span><strong className="block text-lg">{available.toLocaleString()}</strong><span className="text-[11px] text-muted">Reserved {Number(row.reserved_quantity || 0).toLocaleString()}</span></div>
                      <div className="text-left sm:text-right"><span className="text-xs text-muted">Value</span><strong className="block">{money(Number(row.quantity || 0) * Number(row.products?.cost_price || 0), currency)}</strong>{reorder > 0 && <span className="text-[11px] text-muted">Reorder at {reorder.toLocaleString()}</span>}</div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'transfer' && (
        <section className="grid gap-5 xl:grid-cols-[1fr_.8fr]">
          <form onSubmit={submitTransfer} className="page-card p-5">
            <h2 className="font-black">Transfer stock</h2>
            {!canTransfer && <p className="mt-2 text-sm text-amber-600">Your role can view transfers but cannot create them.</p>}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label><span className="mb-1 block text-xs font-bold text-muted">From</span><select className="input-base" value={fromLocation} onChange={(event) => setFromLocation(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
              <label><span className="mb-1 block text-xs font-bold text-muted">To</span><select className="input-base" value={toLocation} onChange={(event) => setToLocation(event.target.value)}>{locations.filter((location) => location.id !== fromLocation).map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            </div>

            <div className="mt-4 space-y-3">
              {transferLines.map((line,index) => (
                <div key={index} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
                  <div className="grid gap-2 sm:grid-cols-[1fr_150px_auto]">
                    <select className="input-base" value={line.product_id} onChange={(event) => changeTransferLine(index,'product_id',event.target.value)}>
                      <option value="">Select stock item</option>
                      {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` — ${product.sku}` : ''}</option>)}
                    </select>
                    <input className="input-base" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => changeTransferLine(index,'quantity',event.target.value)} />
                    <button type="button" onClick={() => removeTransferLine(index)} className="rounded-xl border border-[var(--line)] px-3 text-red-500">×</button>
                  </div>
                  {line.product_id && <p className="mt-2 text-xs text-muted">Available at source: {availableFor(line.product_id,fromLocation).toLocaleString()}</p>}
                </div>
              ))}
            </div>
            <button type="button" onClick={addTransferLine} className="btn-secondary mt-3 rounded-xl px-3 py-2 text-xs font-black">+ Add item</button>
            <textarea className="input-base mt-4 min-h-20" placeholder="Transfer notes" value={transferNotes} onChange={(event) => setTransferNotes(event.target.value)} />
            <button disabled={busy || !canTransfer || !fromLocation || !toLocation} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Transferring...' : 'Complete transfer'}</button>
          </form>

          <div className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4"><strong>Recent transfers</strong></div>
            <div className="divide-y divide-[var(--line)]">
              {!transfers.length && <p className="p-5 text-sm text-muted">No stock transfers yet.</p>}
              {transfers.map((transfer) => <div key={transfer.id} className="p-4"><div className="flex justify-between gap-3"><div><strong>{transfer.transfer_number}</strong><p className="mt-1 text-xs text-muted">{transfer.from?.name || 'Source'} → {transfer.to?.name || 'Destination'}</p></div><span className="text-xs text-muted">{new Date(transfer.created_at).toLocaleString()}</span></div>{transfer.notes && <p className="mt-2 text-sm text-muted">{transfer.notes}</p>}</div>)}
            </div>
          </div>
        </section>
      )}

      {tab === 'stocktake' && (
        <section className="grid gap-5 xl:grid-cols-[1fr_.7fr]">
          <form onSubmit={submitStocktake} className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3"><div><strong>Physical stock count</strong><p className="mt-1 text-xs text-muted">Enter the physically counted quantity. MGT posts only the variance.</p></div><select className="input-base !w-auto min-w-48" value={stocktakeLocation} onChange={(event) => { setStocktakeLocation(event.target.value); setCounts({}) }}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></div>
            </div>
            <div className="max-h-[560px] divide-y divide-[var(--line)] overflow-y-auto">
              {stocktakeRows.map((product) => {
                const counted = counts[product.id]
                const variance = counted === undefined || counted === '' ? null : Number(counted) - product.system
                return <div key={product.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_110px_130px] sm:items-center"><div><strong>{product.name}</strong><p className="mt-1 text-xs text-muted">{product.sku || 'No SKU'} · system {product.system.toLocaleString()} {product.unit}</p></div><input className="input-base !py-2" type="number" min="0" step="0.001" placeholder="Counted" value={counted ?? ''} onChange={(event) => setCounts({ ...counts, [product.id]: event.target.value })} /><div className="text-sm sm:text-right"><span className="text-xs text-muted">Variance</span><strong className={`block ${variance == null || Math.abs(variance)<0.0009 ? '' : variance<0 ? 'text-red-500' : 'text-emerald-600'}`}>{variance == null ? '—' : variance.toLocaleString()}</strong></div></div>
              })}
            </div>
            <div className="border-t border-[var(--line)] p-4"><textarea className="input-base min-h-20" placeholder="Stocktake notes" value={stocktakeNotes} onChange={(event) => setStocktakeNotes(event.target.value)} /><button disabled={busy || !canStocktake} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Posting count...' : canStocktake ? 'Post stocktake' : 'Stocktake permission required'}</button></div>
          </form>

          <div className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4"><strong>Stocktake history</strong></div>
            <div className="divide-y divide-[var(--line)]">
              {!stocktakes.length && <p className="p-5 text-sm text-muted">No stocktakes posted yet.</p>}
              {stocktakes.map((item) => <div key={item.id} className="p-4"><div className="flex justify-between gap-3"><div><strong>{item.stocktake_number}</strong><p className="mt-1 text-xs text-muted">{item.locations?.name || 'Location'} · {new Date(item.created_at).toLocaleString()}</p></div><div className="text-right"><strong className={Number(item.total_variance_value || 0)<0 ? 'text-red-500' : Number(item.total_variance_value || 0)>0 ? 'text-emerald-600' : ''}>{money(item.total_variance_value,currency)}</strong><p className="text-xs text-muted">{Number(item.total_variance_units || 0).toLocaleString()} units</p></div></div></div>)}
            </div>
          </div>
        </section>
      )}

      {tab === 'movements' && (
        <section className="page-card overflow-hidden">
          <div className="border-b border-[var(--line)] p-4"><strong>Inventory movement history</strong><p className="mt-1 text-xs text-muted">Every sale, purchase receipt, return, transfer, stocktake and manual adjustment is traceable here.</p></div>
          <div className="divide-y divide-[var(--line)]">
            {!movements.length && <p className="p-5 text-sm text-muted">No inventory movements yet.</p>}
            {movements.map((move) => <div key={move.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><strong>{move.products?.name || 'Item'}</strong><p className="mt-1 text-xs text-muted">{move.locations?.name || 'Location'} · {String(move.movement_type).replaceAll('_',' ')} · {new Date(move.created_at).toLocaleString()}</p>{move.notes && <p className="mt-1 text-xs text-muted">{move.notes}</p>}</div><strong className={Number(move.quantity)>0 ? 'text-emerald-600' : 'text-red-500'}>{Number(move.quantity)>0 ? '+' : ''}{Number(move.quantity).toLocaleString()}</strong><span className="text-xs text-muted">{move.reference_type || 'manual'}</span></div>)}
          </div>
        </section>
      )}
    </main>
  )
}

