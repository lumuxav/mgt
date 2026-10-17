'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getBusinessConfig } from '../../lib/platformConfig'
import { getPlatformContext, isUniversalSchemaMissing } from '../../lib/platformDb'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import BarcodeScanner from '../components/BarcodeScanner'

const INITIAL = {
  name: '',
  sku: '',
  barcode: '',
  item_type: 'product',
  unit: 'pieces',
  cost_price: '',
  selling_price: '',
  wholesale_price: '',
  tax_rate: '0',
  reorder_level: '0',
  track_inventory: true,
}

export default function CatalogPage() {
  const business = getBusinessConfig()
  const [context, setContext] = useState(null)
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(INITIAL)
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const online = useOnlineStatus()

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) return
      const { data, error } = await supabase.from('products').select('*').eq('organization_id', ctx.organization.id).order('name')
      if (error) throw error
      setRows(data || [])
    } catch (error) {
      setMessage(isUniversalSchemaMissing(error) ? 'Business data is unavailable. Please try again or contact your administrator.' : error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const save = async (event) => {
    event.preventDefault()
    if (!online) return setMessage('You are offline. Reconnect before saving a catalog item.')
    if (!context?.organization?.id) return setMessage('Complete business setup first.')
    setSaving(true)
    setMessage('')
    try {
      const { error } = await supabase.from('products').insert({
        organization_id: context.organization.id,
        name: form.name.trim(),
        sku: form.sku.trim() || null,
        barcode: form.barcode.trim() || null,
        item_type: form.item_type,
        unit: form.unit.trim() || 'pieces',
        track_inventory: form.item_type === 'service' ? false : form.track_inventory,
        cost_price: Number(form.cost_price || 0),
        selling_price: Number(form.selling_price || 0),
        wholesale_price: form.wholesale_price === '' ? null : Number(form.wholesale_price),
        tax_rate: Number(form.tax_rate || 0),
        reorder_level: Number(form.reorder_level || 0),
      })
      if (error) throw error
      setForm(INITIAL)
      setMessage('Catalog item added.')
      await load()
    } catch (error) {
      setMessage(error.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Catalog</p>
          <h1 className="page-title">Products & Services</h1>
          <p className="page-subtitle">Retail, wholesale, barcode, tax and stock settings in one catalog.</p>
        </div>
        <Link href="/pos" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Open POS</Link>
      </div>

      {message && <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-sm">{message}</div>}

      <section className="grid gap-5 lg:grid-cols-[400px_1fr]">
        <form onSubmit={save} className="page-card h-fit p-5">
          <h2 className="mb-4 text-base font-black">Add catalog item</h2>
          <div className="space-y-3">
            <input required className="input-base" placeholder="Item / service name" value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />

            <div className="grid grid-cols-2 gap-3">
              <input className="input-base" placeholder="SKU" value={form.sku} onChange={(event) => setForm({ ...form, sku: event.target.value })} />
              <div className="flex gap-2">
                <input className="input-base" placeholder="Barcode" value={form.barcode} onChange={(event) => setForm({ ...form, barcode: event.target.value })} />
                <BarcodeScanner onScan={(value)=>setForm(current=>({...current,barcode:value}))} label="Scan" className="btn-secondary shrink-0 rounded-xl px-3 py-2 text-xs font-black" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <select className="input-base" value={form.item_type} onChange={(event) => setForm({ ...form, item_type: event.target.value })}>
                <option value="product">Product</option>
                <option value="raw_material">Raw material</option>
                <option value="finished_good">Finished good</option>
                <option value="service">Service</option>
              </select>
              <input className="input-base" placeholder="Unit e.g. pieces, kg" value={form.unit} onChange={(event) => setForm({ ...form, unit: event.target.value })} />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <input className="input-base" type="number" min="0" step="0.01" placeholder="Cost price" value={form.cost_price} onChange={(event) => setForm({ ...form, cost_price: event.target.value })} />
              <input className="input-base" type="number" min="0" step="0.01" placeholder="Retail price" value={form.selling_price} onChange={(event) => setForm({ ...form, selling_price: event.target.value })} />
            </div>

            <input className="input-base" type="number" min="0" step="0.01" placeholder="Wholesale price (optional)" value={form.wholesale_price} onChange={(event) => setForm({ ...form, wholesale_price: event.target.value })} />

            <div className="grid grid-cols-2 gap-3">
              <label><span className="mb-1 block text-xs font-bold text-muted">Tax rate %</span><input className="input-base" type="number" min="0" step="0.01" value={form.tax_rate} onChange={(event) => setForm({ ...form, tax_rate: event.target.value })} /></label>
              <label><span className="mb-1 block text-xs font-bold text-muted">Reorder level</span><input className="input-base" type="number" min="0" step="0.001" value={form.reorder_level} onChange={(event) => setForm({ ...form, reorder_level: event.target.value })} /></label>
            </div>

            {form.item_type !== 'service' && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={form.track_inventory} onChange={(event) => setForm({ ...form, track_inventory: event.target.checked })} />
                Track stock for this item
              </label>
            )}
          </div>

          <button disabled={saving || !online} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{saving ? 'Saving...' : 'Save item'}</button>
        </form>

        <div className="page-card overflow-hidden">
          <div className="border-b border-[var(--line)] p-4"><strong>Catalog</strong><p className="mt-1 text-xs text-muted">{rows.length} item(s)</p></div>
          <div className="divide-y divide-[var(--line)]">
            {loading ? <p className="p-5 text-sm text-muted">Loading...</p> : rows.length === 0 ? <p className="p-5 text-sm text-muted">No products or services yet.</p> : rows.map((row) => (
              <div key={row.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <strong>{row.name}</strong>
                    <span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] uppercase text-muted">{row.item_type?.replaceAll('_', ' ')}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{row.sku || 'No SKU'}{row.barcode ? ` · Barcode ${row.barcode}` : ''} · {row.unit} · {row.track_inventory ? 'Stock tracked' : 'Non-stock'}</p>
                  <p className="mt-1 text-xs text-muted">Tax {Number(row.tax_rate || 0)}%{row.track_inventory ? ` · Reorder at ${Number(row.reorder_level || 0).toLocaleString()}` : ''}</p>
                </div>
                <div className="text-right">
                  <span className="text-xs text-muted">Retail</span>
                  <strong className="block">{Number(row.selling_price || 0).toLocaleString()} {business.currency}</strong>
                  {row.wholesale_price != null && <><span className="mt-1 block text-xs text-muted">Wholesale</span><strong className="block text-sm">{Number(row.wholesale_price || 0).toLocaleString()} {business.currency}</strong></>}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </main>
  )
}
