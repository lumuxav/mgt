'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const blankLine = () => ({ product_id: '', quantity: '1', unit_cost: '' })

export default function PurchasingPage() {
  const business = getBusinessConfig()
  const [context, setContext] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [products, setProducts] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [locations, setLocations] = useState([])
  const [purchases, setPurchases] = useState([])
  const [purchaseItems, setPurchaseItems] = useState([])
  const [tab, setTab] = useState('orders')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const [supplierId, setSupplierId] = useState('')
  const [locationId, setLocationId] = useState('')
  const [dueDate, setDueDate] = useState('')
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState([blankLine()])

  const [selectedPurchase, setSelectedPurchase] = useState(null)
  const [receiveLines, setReceiveLines] = useState({})
  const [supplierInvoice, setSupplierInvoice] = useState('')
  const [receiveNotes, setReceiveNotes] = useState('')

  const currency = context?.organization?.currency || business.currency || 'UGX'
  const canCreate = permissions.includes('purchasing.create')
  const canReceive = permissions.includes('purchasing.receive')
  const canPay = permissions.includes('purchasing.pay') || permissions.includes('finance.manage')

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id

      const [permRes, productRes, supplierRes, locationRes, purchaseRes, itemRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('products').select('id,name,sku,cost_price,track_inventory,unit').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('suppliers').select('id,name,phone,email,opening_balance,opening_balance_paid').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('purchases').select('id,purchase_number,location_id,supplier_id,status,payment_status,total_amount,amount_paid,due_date,supplier_invoice_number,ordered_at,received_at,created_at,notes,suppliers(name),locations(name)').eq('organization_id', org).order('created_at', { ascending: false }).limit(300),
        supabase.from('purchase_items').select('id,purchase_id,product_id,description,quantity,received_quantity,unit_cost,line_total,products(name,sku,unit)').order('id'),
      ])

      for (const result of [permRes, productRes, supplierRes, locationRes, purchaseRes, itemRes]) if (result.error) throw result.error

      setPermissions((permRes.data || []).map((row) => row.permission))
      setProducts(productRes.data || [])
      setSuppliers(supplierRes.data || [])
      setLocations(locationRes.data || [])
      setPurchases(purchaseRes.data || [])
      const purchaseIds = new Set((purchaseRes.data || []).map((row) => row.id))
      setPurchaseItems((itemRes.data || []).filter((row) => purchaseIds.has(row.purchase_id)))

      const defaultLocation = ctx.location?.id || locationRes.data?.[0]?.id || ''
      setLocationId((value) => value || defaultLocation)
      setSupplierId((value) => value || supplierRes.data?.[0]?.id || '')
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not load purchasing.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const chooseProduct = (index, productId) => {
    const product = products.find((item) => item.id === productId)
    setLines((current) => current.map((line, i) => i === index ? { ...line, product_id: productId, unit_cost: String(product?.cost_price ?? 0) } : line))
  }

  const changeLine = (index, key, value) => setLines((current) => current.map((line, i) => i === index ? { ...line, [key]: value } : line))
  const addLine = () => setLines((current) => [...current, blankLine()])
  const removeLine = (index) => setLines((current) => current.length === 1 ? current : current.filter((_, i) => i !== index))
  const orderTotal = useMemo(() => lines.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_cost || 0), 0), [lines])

  const createOrder = async (event) => {
    event.preventDefault()
    const items = lines.filter((line) => line.product_id && Number(line.quantity) > 0).map((line) => ({
      product_id: line.product_id,
      quantity: Number(line.quantity),
      unit_cost: Number(line.unit_cost || 0),
    }))
    if (!supplierId) return setMessage({ type: 'error', text: 'Choose a supplier.' })
    if (!items.length) return setMessage({ type: 'error', text: 'Add at least one purchase item.' })

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('create_purchase_order', {
      p_location_id: locationId,
      p_supplier_id: supplierId,
      p_items: items,
      p_due_date: dueDate || null,
      p_notes: notes || null,
    })

    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage(data?.approval_required
        ? { type: 'success', text: `Purchase order ${data?.purchase_number || ''} created for ${money(data?.total_amount, currency)} and is waiting for approval.` }
        : { type: 'success', text: `Purchase order ${data?.purchase_number || ''} created for ${money(data?.total_amount, currency)}.` })
      setLines([blankLine()])
      setDueDate('')
      setNotes('')
      await load()
    }
    setBusy(false)
  }

  const openReceive = (purchase) => {
    const items = purchaseItems.filter((item) => item.purchase_id === purchase.id)
    const initial = {}
    for (const item of items) {
      const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.received_quantity || 0))
      if (remaining > 0) initial[item.id] = String(remaining)
    }
    setSelectedPurchase(purchase)
    setReceiveLines(initial)
    setSupplierInvoice(purchase.supplier_invoice_number || '')
    setReceiveNotes('')
  }

  const receiveOrder = async (event) => {
    event.preventDefault()
    if (!selectedPurchase) return
    const items = purchaseItems
      .filter((item) => item.purchase_id === selectedPurchase.id)
      .map((item) => ({ purchase_item_id: item.id, quantity: Number(receiveLines[item.id] || 0) }))
      .filter((item) => item.quantity > 0)

    if (!items.length) return setMessage({ type: 'error', text: 'Enter at least one received quantity.' })

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('receive_purchase_order', {
      p_purchase_id: selectedPurchase.id,
      p_items: items,
      p_supplier_invoice_number: supplierInvoice || null,
      p_notes: receiveNotes || null,
    })

    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `${data?.purchase_number || 'Purchase order'} received with status ${data?.status || 'updated'}.` })
      setSelectedPurchase(null)
      setReceiveLines({})
      setSupplierInvoice('')
      setReceiveNotes('')
      await load()
    }
    setBusy(false)
  }

  const supplierBalances = useMemo(() => suppliers.map((supplier) => {
    const purchaseDebt = purchases.filter((purchase) => purchase.supplier_id === supplier.id).reduce((sum, purchase) => sum + Math.max(0, Number(purchase.total_amount || 0) - Number(purchase.amount_paid || 0)), 0)
    const openingDue = Math.max(0, Number(supplier.opening_balance || 0) - Number(supplier.opening_balance_paid || 0))
    return { ...supplier, balance: openingDue + purchaseDebt }
  }).sort((a,b) => b.balance - a.balance), [suppliers, purchases])

  const openOrders = purchases.filter((purchase) => ['ordered','partial'].includes(purchase.status))
  const overdue = purchases.filter((purchase) => purchase.due_date && purchase.payment_status !== 'paid' && new Date(purchase.due_date + 'T23:59:59') < new Date())
  const outstanding = supplierBalances.reduce((sum, supplier) => sum + supplier.balance, 0)

  if (loading) return <main className="page-wrap text-muted">Loading purchasing...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Purchasing</p>
          <h1 className="page-title">Procurement & Receiving</h1>
          <p className="page-subtitle">Purchase orders, partial receiving, supplier invoices and payable tracking.</p>
        </div>
        <div className="flex gap-2">
          <Link href="/suppliers" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Suppliers</Link>
          <Link href="/inventory" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Inventory</Link>
        </div>
      </div>

      {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Open purchase orders</p><strong className="mt-2 block text-2xl">{openOrders.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Supplier payables</p><strong className="mt-2 block text-2xl text-red-500">{money(outstanding,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Overdue payables</p><strong className="mt-2 block text-2xl text-amber-600">{overdue.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Suppliers</p><strong className="mt-2 block text-2xl">{suppliers.length}</strong></div>
      </section>

      <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
        {[
          ['orders','Purchase orders'],
          ['create','New order'],
          ['payables','Supplier payables'],
        ].map(([key,label]) => <button key={key} type="button" onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab === key ? 'bg-[var(--panel)] text-accent shadow-sm' : 'text-muted'}`}>{label}</button>)}
      </div>

      {tab === 'orders' && (
        <section className="space-y-3">
          {!purchases.length && <div className="page-card p-6 text-center text-sm text-muted">No purchase orders yet.</div>}
          {purchases.map((purchase) => {
            const items = purchaseItems.filter((item) => item.purchase_id === purchase.id)
            const orderedQty = items.reduce((sum,item) => sum + Number(item.quantity || 0),0)
            const receivedQty = items.reduce((sum,item) => sum + Number(item.received_quantity || 0),0)
            const balance = Math.max(0, Number(purchase.total_amount || 0) - Number(purchase.amount_paid || 0))
            return (
              <article key={purchase.id} className="page-card p-4 sm:p-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <strong>{purchase.purchase_number || 'Purchase'}</strong>
                      <span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{purchase.status.replaceAll('_',' ')}</span>
                      <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${purchase.payment_status === 'paid' ? 'bg-emerald-500/10 text-emerald-600' : purchase.payment_status === 'partial' ? 'bg-amber-500/10 text-amber-600' : 'bg-red-500/10 text-red-500'}`}>{purchase.payment_status}</span>
                    </div>
                    <p className="mt-1 text-sm text-muted">{purchase.suppliers?.name || 'Supplier'} · {purchase.locations?.name || 'Location'}</p>
                    <p className="mt-1 text-xs text-muted">{new Date(purchase.created_at).toLocaleString()}{purchase.due_date ? ` · due ${new Date(purchase.due_date+'T00:00:00').toLocaleDateString()}` : ''}</p>
                    {purchase.supplier_invoice_number && <p className="mt-1 text-xs text-muted">Supplier invoice: {purchase.supplier_invoice_number}</p>}
                  </div>
                  <div className="text-left lg:text-right">
                    <strong className="text-lg">{money(purchase.total_amount,currency)}</strong>
                    <p className="mt-1 text-xs text-muted">Received {receivedQty.toLocaleString()} / {orderedQty.toLocaleString()} units</p>
                    {balance > 0.009 && <p className="mt-1 text-xs font-black text-red-500">Due {money(balance,currency)}</p>}
                  </div>
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {items.map((item) => <div key={item.id} className="rounded-xl bg-[var(--panel-2)] p-3 text-xs"><strong>{item.description}</strong><p className="mt-1 text-muted">{Number(item.received_quantity || 0).toLocaleString()} / {Number(item.quantity || 0).toLocaleString()} received · {money(item.unit_cost,currency)} each</p></div>)}
                </div>

                <div className="mt-4 flex flex-wrap gap-2"><Link href={`/purchasing/${purchase.id}/order`} className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Purchase order</Link>{canReceive && ['ordered','partial'].includes(purchase.status) && <button type="button" onClick={() => openReceive(purchase)} className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Receive stock</button>}</div>
                {purchase.status === 'pending_approval' && <Link href="/approvals" className="btn-secondary mt-4 inline-block rounded-xl px-4 py-2 text-sm font-black">Open approval queue</Link>}
              </article>
            )
          })}
        </section>
      )}

      {tab === 'create' && (
        <form onSubmit={createOrder} className="page-card mx-auto max-w-4xl p-5">
          <div className="grid gap-3 sm:grid-cols-3">
            <label><span className="mb-1 block text-xs font-bold text-muted">Supplier</span><select className="input-base" value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>{suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}</select></label>
            <label><span className="mb-1 block text-xs font-bold text-muted">Receive at</span><select className="input-base" value={locationId} onChange={(event) => setLocationId(event.target.value)}>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
            <label><span className="mb-1 block text-xs font-bold text-muted">Payment due date</span><input className="input-base" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} /></label>
          </div>

          <div className="mt-5 space-y-3">
            {lines.map((line,index) => (
              <div key={index} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-3">
                <div className="grid gap-2 sm:grid-cols-[1fr_130px_170px_auto]">
                  <select className="input-base" value={line.product_id} onChange={(event) => chooseProduct(index,event.target.value)}>
                    <option value="">Select item</option>
                    {products.map((product) => <option key={product.id} value={product.id}>{product.name}{product.sku ? ` — ${product.sku}` : ''}</option>)}
                  </select>
                  <input className="input-base" type="number" min="0.001" step="0.001" placeholder="Qty" value={line.quantity} onChange={(event) => changeLine(index,'quantity',event.target.value)} />
                  <input className="input-base" type="number" min="0" step="0.01" placeholder="Unit cost" value={line.unit_cost} onChange={(event) => changeLine(index,'unit_cost',event.target.value)} />
                  <button type="button" onClick={() => removeLine(index)} className="rounded-xl border border-[var(--line)] px-3 text-red-500">×</button>
                </div>
              </div>
            ))}
          </div>

          <button type="button" onClick={addLine} className="btn-secondary mt-3 rounded-xl px-3 py-2 text-xs font-black">+ Add item</button>
          <textarea className="input-base mt-4 min-h-20" placeholder="Purchase order notes" value={notes} onChange={(event) => setNotes(event.target.value)} />

          <div className="mt-4 flex items-center justify-between rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-muted">Order total</span><strong className="text-xl">{money(orderTotal,currency)}</strong></div>
          <button disabled={busy || !canCreate || !supplierId || !locationId} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Creating...' : canCreate ? 'Create purchase order' : 'Purchase permission required'}</button>
        </form>
      )}

      {tab === 'payables' && (
        <section className="space-y-3">
          {!supplierBalances.length && <div className="page-card p-6 text-center text-sm text-muted">No suppliers yet.</div>}
          {supplierBalances.map((supplier) => <Link href="/suppliers" key={supplier.id} className="page-card flex items-center justify-between gap-4 p-4"><div><strong>{supplier.name}</strong><p className="mt-1 text-xs text-muted">{supplier.phone || supplier.email || 'No contact details'}</p></div><div className="text-right"><strong className={supplier.balance > 0 ? 'text-red-500' : 'text-emerald-600'}>{money(supplier.balance,currency)}</strong><p className="mt-1 text-xs text-muted">{canPay ? 'Open Suppliers to record payment' : 'Outstanding payable'}</p></div></Link>)}
        </section>
      )}

      {selectedPurchase && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8">
          <form onSubmit={receiveOrder} className="mx-auto max-w-2xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Receive purchase</p><h2 className="text-xl font-black">{selectedPurchase.purchase_number}</h2><p className="mt-1 text-sm text-muted">{selectedPurchase.suppliers?.name} → {selectedPurchase.locations?.name}</p></div><button type="button" onClick={() => setSelectedPurchase(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div>

            <div className="mt-5 space-y-3">
              {purchaseItems.filter((item) => item.purchase_id === selectedPurchase.id).map((item) => {
                const remaining = Math.max(0, Number(item.quantity || 0) - Number(item.received_quantity || 0))
                return <div key={item.id} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4"><div className="flex justify-between gap-3"><div><strong>{item.description}</strong><p className="mt-1 text-xs text-muted">Ordered {Number(item.quantity).toLocaleString()} · already received {Number(item.received_quantity || 0).toLocaleString()} · remaining {remaining.toLocaleString()}</p></div><strong>{money(item.unit_cost,currency)}</strong></div><input disabled={remaining <= 0} className="input-base mt-3" type="number" min="0" max={remaining} step="0.001" value={receiveLines[item.id] || ''} onChange={(event) => setReceiveLines({ ...receiveLines, [item.id]: event.target.value })} placeholder="Quantity received now" /></div>
              })}
            </div>

            <input className="input-base mt-4" placeholder="Supplier invoice number (optional)" value={supplierInvoice} onChange={(event) => setSupplierInvoice(event.target.value)} />
            <textarea className="input-base mt-3 min-h-20" placeholder="Receiving notes" value={receiveNotes} onChange={(event) => setReceiveNotes(event.target.value)} />
            <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Receiving...' : 'Post receipt into inventory'}</button>
          </form>
        </div>
      )}
    </main>
  )
}
