'use client'

import { useEffect, useEffectEvent, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { customerBalanceMap } from '../../lib/balances'
import BarcodeScanner from '../components/BarcodeScanner'
import { checkoutRequest, finishCheckout } from '../../lib/checkoutRequest'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const blankPayment = () => ({ method: 'cash', amount: '', reference: '' })
const repriceCart = (cart, products, mode) => cart.map(line => {
  const product = products.find(item => item.id === line.product_id)
  if (!product || line.custom_price) return line
  const price = mode === 'wholesale' ? product.wholesale_price ?? product.selling_price : product.selling_price
  return { ...line, unit_price: Number(price || 0) }
})

export default function PosPage() {
  const business = getBusinessConfig()
  const searchRef = useRef(null)
  const checkoutInFlight = useRef(false)
  const [context, setContext] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [products, setProducts] = useState([])
  const [customers, setCustomers] = useState([])
  const [locations, setLocations] = useState([])
  const [stockMap, setStockMap] = useState({})
  const [debtMap, setDebtMap] = useState({})
  const [locationId, setLocationId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [pricingMode, setPricingMode] = useState('retail')
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState([])
  const [payments, setPayments] = useState([blankPayment()])
  const [saleDiscount, setSaleDiscount] = useState('0')
  const [notes, setNotes] = useState('')
  const [till, setTill] = useState(null)
  const [tillPayments, setTillPayments] = useState([])
  const [openingCash, setOpeningCash] = useState('')
  const [countedCash, setCountedCash] = useState('')
  const [message, setMessage] = useState(null)
  const [saving, setSaving] = useState(false)
  const [loading, setLoading] = useState(true)
  const [completedSale, setCompletedSale] = useState(null)
  const locationRequest = useRef(0)

  const canDiscount = permissions.includes('sales.discount')
  const online = useOnlineStatus()
  const currency = context?.organization?.currency || business.currency || 'UGX'

  const loadLocationData = async (locId, userId = context?.user?.id) => {
    if (!locId) return
    const request = ++locationRequest.current

    const [stockRes, tillRes] = await Promise.all([
      supabase.from('stock_balances').select('product_id,quantity,reserved_quantity').eq('location_id', locId),
      userId
        ? supabase.from('till_sessions').select('*').eq('location_id', locId).eq('user_id', userId).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ])

    if (stockRes.error && !String(stockRes.error.message || '').includes('permission')) throw stockRes.error

    if (tillRes.error) throw tillRes.error
    let payments = []
    if (tillRes.data?.id) {
      const { data, error } = await supabase.from('payments').select('amount,direction,method,created_at').eq('till_session_id', tillRes.data.id)
      if (error) throw error
      payments = data || []
    }
    if (request !== locationRequest.current) return
    const nextStock = {}
    for (const row of stockRes.data || []) nextStock[row.product_id] = Number(row.quantity || 0) - Number(row.reserved_quantity || 0)
    setStockMap(nextStock)
    setTill(tillRes.data || null)
    setTillPayments(payments)
  }

  const load = async (initialContext) => {
    try {
      const ctx = initialContext || await getPlatformContext()
      setMessage(null)
      setContext(ctx)
      if (!ctx.organization?.id) throw new Error('Complete business setup first.')

      const org = ctx.organization.id
      const preferredLocation = locationId || ctx.location?.id || ''
      const [permissionRes, productsRes, customersRes, locationsRes, debtsRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('products').select('id,name,sku,barcode,item_type,unit,track_inventory,cost_price,selling_price,wholesale_price,tax_rate,active').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('customers').select('id,name,phone,email,credit_limit,active').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id', org).eq('active', true).order('name'),
        supabase.rpc('get_customer_sales_balances'),
        preferredLocation ? loadLocationData(preferredLocation, ctx.user?.id) : Promise.resolve(),
      ])

      for (const result of [permissionRes, productsRes, customersRes, locationsRes, debtsRes]) {
        if (result.error) throw result.error
      }

      const perms = (permissionRes.data || []).map((row) => row.permission)
      setPermissions(perms)
      setProducts(productsRes.data || [])
      setCart(current => repriceCart(current, productsRes.data || [], pricingMode))
      setCustomers(customersRes.data || [])
      setLocations(locationsRes.data || [])

      setDebtMap(customerBalanceMap(debtsRes.data || []))

      const resolvedLocation = preferredLocation || locationsRes.data?.[0]?.id || ''
      setLocationId(resolvedLocation)
      if (resolvedLocation && !preferredLocation) await loadLocationData(resolvedLocation, ctx.user?.id)
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not open POS.' })
    } finally {
      setLoading(false)
    }
  }

  const initialize = useEffectEvent(ctx => load(ctx))
  const initializationFailed = useEffectEvent(error => {
    setMessage({ type: 'error', text: error.message || 'Could not open POS.' })
    setLoading(false)
  })
  useEffect(() => {
    let cancelled = false
    getPlatformContext().then(
      ctx => { if (!cancelled) initialize(ctx) },
      error => { if (!cancelled) initializationFailed(error) },
    )
    return () => { cancelled = true }
  }, [])

  const changeLocation = async (id) => {
    setLocationId(id)
    setLoading(true)
    try {
      await loadLocationData(id, context?.user?.id)
    } catch (error) {
      setStockMap({})
      setTill(null)
      setTillPayments([])
      setMessage({ type: 'error', text: error.message })
    } finally {
      setLoading(false)
    }
  }

  const changePricingMode = (mode) => {
    setPricingMode(mode)
    setCart(current => repriceCart(current, products, mode))
  }

  const filteredProducts = useMemo(() => {
    const term = search.trim().toLowerCase()
    const source = term
      ? products.filter((product) => [product.name, product.sku, product.barcode].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)))
      : products
    return source.slice(0, 24)
  }, [products, search])

  const addProduct = (product) => {
    setCompletedSale(null)
    setCart((current) => {
      const existing = current.find((line) => line.product_id === product.id)
      if (existing) {
        return current.map((line) => line.product_id === product.id ? { ...line, quantity: Number(line.quantity) + 1 } : line)
      }
      const price = pricingMode === 'wholesale'
        ? Number(product.wholesale_price ?? product.selling_price ?? 0)
        : Number(product.selling_price || 0)
      return [...current, {
        product_id: product.id,
        name: product.name,
        sku: product.sku,
        unit: product.unit,
        track_inventory: product.track_inventory,
        tax_rate: Number(product.tax_rate || 0),
        quantity: 1,
        unit_price: price,
        discount_amount: 0,
        custom_price: false,
      }]
    })
    setSearch('')
    window.setTimeout(() => searchRef.current?.focus(), 30)
  }

  const handleScannedBarcode = (value) => {
    const code = String(value || '').trim().toLowerCase()
    const exact = products.find((product) =>
      String(product.barcode || '').toLowerCase() === code ||
      String(product.sku || '').toLowerCase() === code
    )
    if (exact) addProduct(exact)
    else {
      setSearch(value)
      setMessage({ type: 'error', text: `No catalog item matches barcode / SKU ${value}.` })
    }
  }

  const handleSearchKey = (event) => {
    if (event.key !== 'Enter') return
    event.preventDefault()
    const term = search.trim().toLowerCase()
    if (!term) return
    const exact = products.find((product) =>
      String(product.barcode || '').toLowerCase() === term ||
      String(product.sku || '').toLowerCase() === term
    )
    if (exact) addProduct(exact)
    else if (filteredProducts.length === 1) addProduct(filteredProducts[0])
  }

  const changeLine = (productId, key, value) => {
    setCart((current) => current.map((line) => {
      if (line.product_id !== productId) return line
      return {
        ...line,
        [key]: value,
        ...(key === 'unit_price' ? { custom_price: true } : {}),
      }
    }))
  }

  const removeLine = (productId) => setCart((current) => current.filter((line) => line.product_id !== productId))

  const subtotal = useMemo(() => cart.reduce((sum, line) => sum + Number(line.quantity || 0) * Number(line.unit_price || 0), 0), [cart])
  const lineDiscounts = useMemo(() => cart.reduce((sum, line) => sum + Number(line.discount_amount || 0), 0), [cart])
  const tax = useMemo(() => cart.reduce((sum, line) => {
    const base = Number(line.quantity || 0) * Number(line.unit_price || 0) - Number(line.discount_amount || 0)
    return sum + Math.max(0, base) * Number(line.tax_rate || 0) / 100
  }, 0), [cart])
  const total = Math.max(0, subtotal - lineDiscounts - Number(saleDiscount || 0) + tax)
  const paymentTotal = payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const balanceDue = Math.max(0, total - paymentTotal)

  const selectedCustomer = customers.find((customer) => customer.id === customerId)
  const customerDebt = customerId ? Number(debtMap[customerId] || 0) : 0
  const projectedDebt = customerDebt + balanceDue

  const cashInTill = tillPayments.reduce((sum, payment) => {
    if (payment.method !== 'cash') return sum
    return sum + (payment.direction === 'out' ? -Number(payment.amount || 0) : Number(payment.amount || 0))
  }, 0)
  const expectedTillCash = Number(till?.opening_cash || 0) + cashInTill

  const addPayment = () => setPayments((current) => [...current, blankPayment()])
  const changePayment = (index, key, value) => setPayments((current) => current.map((payment, i) => i === index ? { ...payment, [key]: value } : payment))
  const removePayment = (index) => setPayments((current) => current.length === 1 ? current : current.filter((_, i) => i !== index))
  const payFull = () => setPayments([{ method: payments[0]?.method || 'cash', amount: total.toFixed(2), reference: payments[0]?.reference || '' }])

  const openTill = async () => {
    if (!online) return setMessage({ type: 'error', text: 'You are offline. Reconnect before opening a till.' })
    setSaving(true)
    setMessage(null)
    const { error } = await supabase.rpc('open_till', {
      p_location_id: locationId,
      p_opening_cash: Number(openingCash || 0),
      p_notes: null,
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setOpeningCash('')
      setMessage({ type: 'success', text: 'Till opened.' })
      await loadLocationData(locationId)
    }
    setSaving(false)
  }

  const closeTill = async () => {
    if (!till?.id) return
    if (!online) return setMessage({ type: 'error', text: 'You are offline. Reconnect before closing a till.' })
    setSaving(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('close_till', {
      p_session_id: till.id,
      p_counted_cash: Number(countedCash || 0),
      p_notes: null,
    })
    if (error) setMessage({ type: 'error', text: error.message })
    else {
      const variance = Number(data?.variance || 0)
      setMessage({ type: Math.abs(variance) < 0.009 ? 'success' : 'warning', text: `Till closed. Variance: ${money(variance, currency)}.` })
      setCountedCash('')
      await loadLocationData(locationId)
    }
    setSaving(false)
  }

  const checkout = async () => {
    if (checkoutInFlight.current) return
    if (!online) return setMessage({ type: 'error', text: 'You are offline. MGT will not post a sale until the connection is restored.' })
    if (!cart.length) return setMessage({ type: 'error', text: 'Add at least one product or service.' })
    if (!locationId) return setMessage({ type: 'error', text: 'Choose a location.' })
    if (payments.some((payment) => payment.method === 'cash' && Number(payment.amount || 0) > 0) && !till) {
      return setMessage({ type: 'error', text: 'Open the till before accepting cash.' })
    }
    if (balanceDue > 0.009 && !customerId) return setMessage({ type: 'error', text: 'Select a customer for partial or credit sales.' })
    if (paymentTotal > total + 0.009) return setMessage({ type: 'error', text: 'Payments cannot exceed the sale total.' })

    checkoutInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      const payloadItems = cart.map((line) => ({
        product_id: line.product_id,
        quantity: Number(line.quantity),
        unit_price: Number(line.unit_price),
        discount_amount: Number(line.discount_amount || 0),
      }))
      const payloadPayments = payments
        .filter((payment) => Number(payment.amount || 0) > 0)
        .map((payment) => ({
          method: payment.method,
          amount: Number(payment.amount),
          reference: payment.reference || null,
        }))

      const payload = {
        p_location_id: locationId,
        p_customer_id: customerId || null,
        p_items: payloadItems,
        p_payments: payloadPayments,
        p_discount_amount: Number(saleDiscount || 0),
        p_channel: 'pos',
        p_pricing_mode: pricingMode,
        p_notes: notes || null,
      }
      const scope = `${context.organization.id}/${context.user.id}`
      const requestId = await checkoutRequest(window.sessionStorage, window.crypto, scope, payload)
      const { data, error } = await supabase.rpc('post_pos_sale_once', { p_request_id: requestId, ...payload })
      if (error) throw error

      finishCheckout(window.sessionStorage, scope)
      setCompletedSale(data)
      setCart([])
      setPayments([blankPayment()])
      setCustomerId('')
      setSaleDiscount('0')
      setNotes('')
      await load()
      setMessage({ type: 'success', text: `Sale ${data.sale_number} completed successfully.` })
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Sale could not be completed.' })
    } finally {
      checkoutInFlight.current = false
      setSaving(false)
    }
  }

  if (loading) return <main className="page-wrap text-muted">Opening POS...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Point of Sale</p>
          <h1 className="page-title">Point of Sale</h1>
          <p className="page-subtitle">Fast checkout for retail, wholesale, services and mixed businesses.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/payments" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">External Payments</Link>
          <Link href="/sales" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Sales history</Link>
          <Link href="/catalog" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Catalog</Link>
        </div>
      </div>

      {message && (
        <div className={`mb-4 rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : message.type === 'warning' ? 'border-amber-500/30 bg-amber-500/10 text-amber-600' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>
          {message.text}
        </div>
      )}

      {completedSale?.sale_id && (
        <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <strong className="text-emerald-600">Sale complete — {completedSale.sale_number}</strong>
            <p className="mt-1 text-sm text-muted">{money(completedSale.total_amount, currency)} · {completedSale.payment_status}</p>
          </div>
          <Link href={`/sales/${completedSale.sale_id}/receipt`} className="btn-primary rounded-xl px-4 py-2 text-center text-sm font-black">Open receipt</Link>
        </div>
      )}

      <section className="mb-5 grid gap-3 lg:grid-cols-[1fr_auto_auto]">
        <select className="input-base" value={locationId} onChange={(event) => changeLocation(event.target.value)}>
          {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
        </select>
        <div className="flex rounded-xl border border-[var(--line)] bg-[var(--panel)] p-1">
          {['retail','wholesale'].map((mode) => (
            <button key={mode} type="button" onClick={() => changePricingMode(mode)} className={`rounded-lg px-4 py-2 text-xs font-black capitalize ${pricingMode === mode ? 'bg-[var(--accent)] text-white' : 'text-muted'}`}>{mode}</button>
          ))}
          {canDiscount && <button type="button" onClick={() => changePricingMode('custom')} className={`rounded-lg px-4 py-2 text-xs font-black ${pricingMode === 'custom' ? 'bg-[var(--accent)] text-white' : 'text-muted'}`}>Custom</button>}
        </div>
        <div className={`rounded-xl border px-4 py-2 text-xs font-bold ${till ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-amber-500/30 bg-amber-500/10 text-amber-600'}`}>
          {till ? `Till open · expected ${money(expectedTillCash, currency)}` : 'Till closed'}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1.2fr_.8fr]">
        <div className="space-y-5">
          <div className="page-card p-4">
            <div className="flex gap-2">
              <input
                ref={searchRef}
                className="input-base text-base"
                placeholder="Scan barcode or search product, SKU or service…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                onKeyDown={handleSearchKey}
                autoFocus
              />
              <BarcodeScanner onScan={handleScannedBarcode} label="Camera" className="btn-secondary shrink-0 rounded-xl px-4 py-2.5 text-sm font-black" />
            </div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {filteredProducts.map((product) => {
                const available = stockMap[product.id]
                const soldOut = product.track_inventory && available !== undefined && available <= 0
                const price = pricingMode === 'wholesale'
                  ? Number(product.wholesale_price ?? product.selling_price ?? 0)
                  : Number(product.selling_price || 0)
                return (
                  <button key={product.id} type="button" disabled={soldOut} onClick={() => addProduct(product)} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-3 text-left disabled:opacity-40">
                    <div className="flex items-start justify-between gap-2"><strong className="text-sm">{product.name}</strong><span className="text-xs font-black text-accent">{money(price, currency)}</span></div>
                    <p className="mt-1 text-[11px] text-muted">{product.sku || product.barcode || product.item_type}</p>
                    <p className="mt-2 text-[11px] text-muted">{product.track_inventory ? `Available: ${available ?? '—'} ${product.unit}` : 'Non-stock / service'}</p>
                  </button>
                )
              })}
              {!filteredProducts.length && <p className="col-span-full py-6 text-center text-sm text-muted">No matching catalog item.</p>}
            </div>
          </div>

          <div className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4">
              <div className="flex items-center justify-between"><strong>Cart</strong><span className="text-xs text-muted">{cart.length} item(s)</span></div>
            </div>
            <div className="divide-y divide-[var(--line)]">
              {!cart.length && <p className="p-6 text-center text-sm text-muted">Scan or select a product to start a sale.</p>}
              {cart.map((line) => (
                <div key={line.product_id} className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div><strong>{line.name}</strong><p className="mt-1 text-xs text-muted">{line.sku || line.unit}</p></div>
                    <button type="button" onClick={() => removeLine(line.product_id)} className="rounded-lg px-2 py-1 text-sm font-black text-red-500">×</button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <label><span className="mb-1 block text-[10px] font-bold uppercase text-muted">Qty</span><input className="input-base !py-2" type="number" min="0.001" step="0.001" value={line.quantity} onChange={(event) => changeLine(line.product_id, 'quantity', event.target.value)} /></label>
                    <label><span className="mb-1 block text-[10px] font-bold uppercase text-muted">Unit price</span><input className="input-base !py-2" type="number" min="0" step="0.01" disabled={!canDiscount && pricingMode !== 'wholesale'} value={line.unit_price} onChange={(event) => changeLine(line.product_id, 'unit_price', event.target.value)} /></label>
                    <label><span className="mb-1 block text-[10px] font-bold uppercase text-muted">Line discount</span><input className="input-base !py-2" type="number" min="0" step="0.01" disabled={!canDiscount} value={line.discount_amount} onChange={(event) => changeLine(line.product_id, 'discount_amount', event.target.value)} /></label>
                    <div><span className="mb-1 block text-[10px] font-bold uppercase text-muted">Line total</span><div className="rounded-xl bg-[var(--panel-2)] px-3 py-2 text-right text-sm font-black">{money(Number(line.quantity || 0) * Number(line.unit_price || 0) - Number(line.discount_amount || 0), currency)}</div></div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-5">
          <div className="page-card p-5">
            <h2 className="font-black">Customer</h2>
            <select className="input-base mt-3" value={customerId} onChange={(event) => setCustomerId(event.target.value)}>
              <option value="">Walk-in customer</option>
              {customers.map((customer) => <option key={customer.id} value={customer.id}>{customer.name}</option>)}
            </select>
            {selectedCustomer && (
              <div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-xs">
                <div className="flex justify-between"><span className="text-muted">Current debt</span><strong>{money(customerDebt, currency)}</strong></div>
                <div className="mt-1 flex justify-between"><span className="text-muted">Credit limit</span><strong>{money(selectedCustomer.credit_limit, currency)}</strong></div>
                {balanceDue > 0 && <div className="mt-1 flex justify-between"><span className="text-muted">Projected debt</span><strong className={projectedDebt > Number(selectedCustomer.credit_limit || 0) ? 'text-red-500' : ''}>{money(projectedDebt, currency)}</strong></div>}
              </div>
            )}
          </div>

          <div className="page-card p-5">
            <div className="flex items-center justify-between"><h2 className="font-black">Payments</h2><button type="button" onClick={addPayment} className="text-xs font-black text-accent">+ Split payment</button></div>
            <div className="mt-3 space-y-3">
              {payments.map((payment, index) => (
                <div key={index} className="rounded-xl border border-[var(--line)] p-3">
                  <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                    <select className="input-base !py-2 text-xs" value={payment.method} onChange={(event) => changePayment(index, 'method', event.target.value)}>
                      <option value="cash">Cash</option>
                      <option value="mobile_money">Mobile Money (manual)</option>
                      <option value="card">Card</option>
                      <option value="bank">Bank</option>
                      <option value="cheque">Cheque</option>
                    </select>
                    <input className="input-base !py-2" type="number" min="0" step="0.01" placeholder="Amount" value={payment.amount} onChange={(event) => changePayment(index, 'amount', event.target.value)} />
                    <button type="button" onClick={() => removePayment(index)} className="rounded-xl border border-[var(--line)] px-3 text-red-500">×</button>
                  </div>
                  {payment.method !== 'cash' && <input className="input-base mt-2 !py-2 text-xs" placeholder="Reference / transaction ID (optional)" value={payment.reference} onChange={(event) => changePayment(index, 'reference', event.target.value)} />}
                </div>
              ))}
            </div>
            <button type="button" onClick={payFull} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 text-xs font-black">Set full payment</button>
          </div>

          <div className="page-card p-5">
            <h2 className="font-black">Sale totals</h2>
            <div className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-muted">Subtotal</span><strong>{money(subtotal, currency)}</strong></div>
              <div className="flex justify-between"><span className="text-muted">Line discounts</span><strong>- {money(lineDiscounts, currency)}</strong></div>
              <div className="flex justify-between"><span className="text-muted">Tax</span><strong>{money(tax, currency)}</strong></div>
              {canDiscount && <label className="block"><span className="mb-1 block text-xs text-muted">Sale discount</span><input className="input-base !py-2 text-right" type="number" min="0" step="0.01" value={saleDiscount} onChange={(event) => setSaleDiscount(event.target.value)} /></label>}
              <div className="border-t border-[var(--line)] pt-3">
                <div className="flex justify-between text-lg"><span className="font-black">Total</span><strong>{money(total, currency)}</strong></div>
                <div className="mt-1 flex justify-between"><span className="text-muted">Paid now</span><strong className="text-emerald-600">{money(paymentTotal, currency)}</strong></div>
                <div className="mt-1 flex justify-between"><span className="text-muted">Balance due</span><strong className={balanceDue > 0 ? 'text-red-500' : ''}>{money(balanceDue, currency)}</strong></div>
              </div>
            </div>
            <textarea className="input-base mt-4 min-h-20" placeholder="Sale notes (optional)" value={notes} onChange={(event) => setNotes(event.target.value)} />
            <button type="button" disabled={saving || !cart.length || !online} onClick={checkout} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{saving ? 'Processing...' : 'Complete sale'}</button>
          </div>

          <div className="page-card p-5">
            <div className="flex items-center justify-between"><div><h2 className="font-black">Cash till</h2><p className="mt-1 text-xs text-muted">{till ? `Opened ${new Date(till.opened_at).toLocaleString()}` : 'Open a till before taking cash.'}</p></div>{till && <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-black uppercase text-emerald-600">Open</span>}</div>
            {!till ? (
              <div className="mt-4 flex gap-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Opening cash" value={openingCash} onChange={(event) => setOpeningCash(event.target.value)} /><button type="button" disabled={saving || !locationId || !online} onClick={openTill} className="btn-primary rounded-xl px-4 text-sm font-black">Open</button></div>
            ) : (
              <>
                <div className="mt-4 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><div className="flex justify-between"><span className="text-muted">Opening cash</span><strong>{money(till.opening_cash, currency)}</strong></div><div className="mt-1 flex justify-between"><span className="text-muted">Expected now</span><strong>{money(expectedTillCash, currency)}</strong></div></div>
                <div className="mt-3 flex gap-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Counted cash" value={countedCash} onChange={(event) => setCountedCash(event.target.value)} /><button type="button" disabled={saving || countedCash === '' || !online} onClick={closeTill} className="rounded-xl bg-red-500 px-4 text-sm font-black text-white disabled:opacity-50">Close</button></div>
              </>
            )}
          </div>
        </div>
      </section>
    </main>
  )
}

