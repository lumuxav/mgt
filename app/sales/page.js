'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext, loadBusinessConfigFromDatabase } from '../../lib/platformDb'
import { getBusinessConfig, moduleEnabled } from '../../lib/platformConfig'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const sameDay = (value, date = new Date()) => new Date(value).toDateString() === date.toDateString()

export default function SalesPage() {
  const [business, setBusiness] = useState(() => getBusinessConfig())
  const [productCount, setProductCount] = useState(null)
  const [context, setContext] = useState(null)
  const [permissions, setPermissions] = useState([])
  const [sales, setSales] = useState([])
  const [customers, setCustomers] = useState([])
  const [customerBalances, setCustomerBalances] = useState([])
  const [payments, setPayments] = useState([])
  const [returns, setReturns] = useState([])
  const [tab, setTab] = useState('sales')
  const [search, setSearch] = useState('')
  const [message, setMessage] = useState(null)
  const [loading, setLoading] = useState(true)
  const [selectedCustomer, setSelectedCustomer] = useState(null)
  const [payAmount, setPayAmount] = useState('')
  const [payMethod, setPayMethod] = useState('cash')
  const [payReference, setPayReference] = useState('')
  const [payNotes, setPayNotes] = useState('')
  const [returnSale, setReturnSale] = useState(null)
  const [returnItems, setReturnItems] = useState([])
  const [returnQty, setReturnQty] = useState({})
  const [returnMethod, setReturnMethod] = useState('cash')
  const [returnReference, setReturnReference] = useState('')
  const [returnReason, setReturnReason] = useState('')
  const [busy, setBusy] = useState(false)

  const currency = context?.organization?.currency || business.currency || 'UGX'
  const canRefund = permissions.includes('sales.refund')
  const canTakePayment = permissions.includes('sales.create') || permissions.includes('finance.manage')
  const canSell = permissions.includes('sales.create')
  const posReady = moduleEnabled(business, 'pos')

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id
      const authoritative = await loadBusinessConfigFromDatabase()
      if (authoritative?.organizationId === org) setBusiness(authoritative)

      const [permissionRes, salesRes, customersRes, paymentsRes, returnsRes, balancesRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('sales')
          .select('id,sale_number,customer_id,location_id,pricing_mode,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,refunded_amount,notes,sold_by,created_at,customers(name,phone),locations(name)')
          .eq('organization_id', org)
          .order('created_at', { ascending: false })
          .limit(500),
        supabase.from('customers').select('id,name,phone,email,credit_limit,active').eq('organization_id', org).eq('active', true).order('name'),
        supabase.from('payments').select('id,customer_id,sale_id,direction,payment_type,method,amount,reference,created_at,received_by').eq('organization_id', org).order('created_at', { ascending: false }).limit(1000),
        supabase.from('sale_returns').select('id,sale_id,customer_id,return_number,total_amount,credit_reduction,cash_refund_amount,refund_method,reason,created_at').eq('organization_id', org).order('created_at', { ascending: false }).limit(300),
        supabase.rpc('get_customer_sales_balances'),
      ])

      for (const result of [permissionRes, salesRes, customersRes, paymentsRes, returnsRes, balancesRes]) if (result.error) throw result.error

      setPermissions((permissionRes.data || []).map((row) => row.permission))
      const grants = new Set((permissionRes.data || []).map(row => row.permission))
      if (grants.has('catalog.view')) {
        const countResult = await supabase.from('products').select('id', { count: 'exact', head: true }).eq('organization_id', org).eq('active', true)
        setProductCount(countResult.error ? null : countResult.count ?? 0)
      } else setProductCount(null)
      setSales(salesRes.data || [])
      setCustomers(customersRes.data || [])
      setCustomerBalances(balancesRes.data || [])
      setPayments(paymentsRes.data || [])
      setReturns(returnsRes.data || [])
    } catch (error) {
      setMessage({ type: 'error', text: error.message || 'Could not load sales.' })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const outstandingForSale = (sale) => Math.max(0, Number(sale.total_amount || 0) - Number(sale.refunded_amount || 0) - Number(sale.amount_paid || 0))

  const debtors = useMemo(() => {
    return customerBalances.filter(row => Number(row.balance_due) > 0.009).map(row => ({
      id: row.customer_id, name: row.name, phone: row.phone || '', credit_limit: Number(row.credit_limit || 0),
      owed: Number(row.balance_due), opening_due: Number(row.opening_due), sales: Number(row.sale_count), last: row.last_sale_at,
    })).sort((a, b) => b.owed - a.owed)
  }, [customerBalances])

  const todaySales = sales.filter((sale) => sameDay(sale.created_at))
  const todayReturns = returns.filter((item) => sameDay(item.created_at))
  const todayPaymentsIn = payments.filter((payment) => payment.direction === 'in' && sameDay(payment.created_at)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const todayRefunds = payments.filter((payment) => payment.direction === 'out' && payment.payment_type === 'refund' && sameDay(payment.created_at)).reduce((sum, payment) => sum + Number(payment.amount || 0), 0)
  const outstanding = debtors.reduce((sum, customer) => sum + customer.owed, 0)

  const filteredSales = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return sales
    return sales.filter((sale) => [
      sale.sale_number,
      sale.customers?.name,
      sale.locations?.name,
      sale.payment_status,
      sale.status,
    ].filter(Boolean).some((value) => String(value).toLowerCase().includes(term)))
  }, [sales, search])

  const customerSales = selectedCustomer ? sales.filter((sale) => sale.customer_id === selectedCustomer.id && outstandingForSale(sale) > 0.009) : []
  const customerPayments = selectedCustomer ? payments.filter((payment) => payment.customer_id === selectedCustomer.id) : []

  const recordPayment = async (event) => {
    event.preventDefault()
    if (!selectedCustomer || !Number(payAmount || 0)) return
    setBusy(true)
    setMessage(null)

    const locationId = context?.location?.id || sales.find((sale) => sale.customer_id === selectedCustomer.id)?.location_id
    const { data, error } = await supabase.rpc('record_customer_payment', {
      p_customer_id: selectedCustomer.id,
      p_location_id: locationId,
      p_amount: Number(payAmount),
      p_method: payMethod,
      p_reference: payReference || null,
      p_notes: payNotes || null,
    })

    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `Payment recorded. Remaining balance: ${money(data?.remaining_balance, currency)}.` })
      setPayAmount('')
      setPayReference('')
      setPayNotes('')
      setSelectedCustomer(null)
      await load()
    }
    setBusy(false)
  }

  const startReturn = async (sale) => {
    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.from('sale_items').select('id,product_id,description,quantity,unit_price,line_total').eq('sale_id', sale.id).order('id')
    if (error) {
      setMessage({ type: 'error', text: error.message })
      setBusy(false)
      return
    }

    const returnHeaders = returns.filter((item) => item.sale_id === sale.id).map((item) => item.id)
    let returned = []
    if (returnHeaders.length) {
      const result = await supabase.from('sale_return_items').select('sale_item_id,quantity').in('return_id', returnHeaders)
      if (result.error) {
        setMessage({ type: 'error', text: result.error.message })
        setBusy(false)
        return
      }
      returned = result.data || []
    }

    const used = {}
    for (const row of returned) used[row.sale_item_id] = (used[row.sale_item_id] || 0) + Number(row.quantity || 0)
    setReturnItems((data || []).map((item) => ({ ...item, returned_qty: used[item.id] || 0 })))
    setReturnQty({})
    setReturnSale(sale)
    setBusy(false)
  }

  const processReturn = async (event) => {
    event.preventDefault()
    const items = returnItems
      .map((item) => ({ sale_item_id: item.id, quantity: Number(returnQty[item.id] || 0) }))
      .filter((item) => item.quantity > 0)

    if (!returnSale || !items.length) return setMessage({ type: 'error', text: 'Enter at least one return quantity.' })

    setBusy(true)
    setMessage(null)
    const { data, error } = await supabase.rpc('process_sale_return', {
      p_sale_id: returnSale.id,
      p_items: items,
      p_refund_method: returnMethod,
      p_reference: returnReference || null,
      p_reason: returnReason || null,
    })

    if (error) setMessage({ type: 'error', text: error.message })
    else {
      setMessage({ type: 'success', text: `${data?.return_number || 'Return'} processed. Value: ${money(data?.total_return, currency)}.` })
      setReturnSale(null)
      setReturnItems([])
      setReturnQty({})
      setReturnReference('')
      setReturnReason('')
      await load()
    }
    setBusy(false)
  }

  if (loading) return <main className="page-wrap text-muted">Loading sales...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Sales</p>
          <h1 className="page-title">Sales, Credit & Returns</h1>
          <p className="page-subtitle">Receipts, customer balances, repayments and returns across the business.</p>
        </div>
        <div className="flex flex-wrap gap-2">{moduleEnabled(business,'payments') && (permissions.includes('payments.view')||permissions.includes('payments.request')) && <Link href="/payments" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">External Payments</Link>}{canSell && posReady && <Link href="/pos" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Make a Sale · POS</Link>}</div>
      </div>

      {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type === 'error' ? 'border-red-500/30 bg-red-500/10 text-red-500' : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Sales today</p><strong className="mt-2 block text-2xl">{todaySales.length}</strong><p className="mt-1 text-xs text-muted">{money(todaySales.reduce((sum, sale) => sum + Number(sale.total_amount || 0), 0), currency)}</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Payments received today</p><strong className="mt-2 block text-2xl text-emerald-600">{money(todayPaymentsIn, currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Outstanding credit</p><strong className="mt-2 block text-2xl text-red-500">{money(outstanding, currency)}</strong><p className="mt-1 text-xs text-muted">{debtors.length} debtor(s)</p></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Refund cash today</p><strong className="mt-2 block text-2xl text-amber-600">{money(todayRefunds, currency)}</strong><p className="mt-1 text-xs text-muted">{todayReturns.length} return(s)</p></div>
      </section>

      <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
        {[
          ['sales', 'Sales history'],
          ['credit', `Customer credit${debtors.length ? ` (${debtors.length})` : ''}`],
          ['returns', 'Returns'],
        ].map(([key, label]) => (
          <button key={key} type="button" onClick={() => setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab === key ? 'bg-[var(--panel)] text-accent shadow-sm' : 'text-muted'}`}>{label}</button>
        ))}
      </div>

      {canSell && (!posReady || productCount === 0) && (
        <section className="page-card mb-5 border border-amber-500/30 p-4" role="status">
          <strong className="text-sm">Before you can record a new sale</strong>
          {!posReady && <p className="mt-2 text-sm text-muted">Point of Sale is disabled in this business. Sales & Credit shows records and repayments; it does not create checkout transactions. The owner must enable Point of Sale in Business Setup.</p>}
          {productCount === 0 && <p className="mt-2 text-sm text-muted">This business has no active products or services to sell. An authorized catalog manager must add at least one item after Inventory is enabled.</p>}
          {permissions.includes('settings.manage') && <Link href="/setup" className="btn-primary mt-3 inline-flex rounded-xl px-4 py-2 text-xs font-bold">Open Business Setup</Link>}
        </section>
      )}

      {tab === 'sales' && (
        <section className="space-y-4">
          <input className="input-base max-w-xl" placeholder="Search receipt, customer, status or location…" value={search} onChange={(event) => setSearch(event.target.value)} />
          <div className="space-y-3">
            {!filteredSales.length && <div className="page-card p-6 text-center text-sm text-muted">No sales yet.</div>}
            {filteredSales.map((sale) => {
              const due = outstandingForSale(sale)
              return (
                <article key={sale.id} className="page-card p-4 sm:p-5">
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <strong>{sale.sale_number || 'Sale'}</strong>
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${sale.status === 'refunded' ? 'bg-red-500/10 text-red-500' : sale.status === 'partially_refunded' ? 'bg-amber-500/10 text-amber-600' : 'bg-emerald-500/10 text-emerald-600'}`}>{String(sale.status || 'completed').replaceAll('_',' ')}</span>
                        <span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{sale.pricing_mode || 'retail'}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted">{sale.customers?.name || 'Walk-in customer'} · {sale.locations?.name || 'Location'}</p>
                      <p className="mt-1 text-xs text-muted">{new Date(sale.created_at).toLocaleString()}</p>
                    </div>
                    <div className="text-left lg:text-right">
                      <strong className="text-lg">{money(sale.total_amount, currency)}</strong>
                      <p className="mt-1 text-xs text-muted">Paid {money(sale.amount_paid, currency)}{Number(sale.refunded_amount || 0) > 0 ? ` · Returned ${money(sale.refunded_amount, currency)}` : ''}</p>
                      {due > 0.009 && <p className="mt-1 text-xs font-black text-red-500">Balance {money(due, currency)}</p>}
                    </div>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/sales/${sale.id}/invoice`} className="btn-primary rounded-xl px-3 py-2 text-xs font-bold">Invoice</Link><Link href={`/sales/${sale.id}/receipt`} className="btn-secondary rounded-xl px-3 py-2 text-xs font-bold">Receipt</Link>
                    {canRefund && sale.status !== 'refunded' && <button type="button" disabled={busy} onClick={() => startReturn(sale)} className="rounded-xl border border-amber-500/40 px-3 py-2 text-xs font-bold text-amber-600">Return / refund</button>}
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      )}

      {tab === 'credit' && !selectedCustomer && (
        <section className="space-y-3">
          {!debtors.length && <div className="page-card p-6 text-center text-sm text-muted">No customer has an outstanding balance.</div>}
          {debtors.map((customer) => (
            <button key={customer.id} type="button" onClick={() => setSelectedCustomer(customer)} className="page-card flex w-full items-center justify-between gap-4 p-4 text-left">
              <div><strong>{customer.name}</strong><p className="mt-1 text-xs text-muted">{customer.phone || 'No phone'} · {customer.sales} open sale(s) · limit {money(customer.credit_limit, currency)}</p></div>
              <strong className="text-lg text-red-500">{money(customer.owed, currency)}</strong>
            </button>
          ))}
        </section>
      )}

      {tab === 'credit' && selectedCustomer && (
        <section className="grid gap-5 lg:grid-cols-[370px_1fr]">
          <div className="space-y-4">
            <button type="button" onClick={() => setSelectedCustomer(null)} className="text-sm font-black text-accent">← All debtors</button>
            <div className="page-card p-5">
              <p className="page-eyebrow">Customer account</p>
              <h2 className="text-xl font-black">{selectedCustomer.name}</h2>
              <p className="mt-2 text-3xl font-black text-red-500">{money(selectedCustomer.owed, currency)}</p>
              <p className="mt-1 text-xs text-muted">Credit limit {money(selectedCustomer.credit_limit, currency)}</p>
              {selectedCustomer.opening_due > 0 && <p className="mt-2 text-xs text-muted">Includes opening balance {money(selectedCustomer.opening_due, currency)}</p>}
            </div>

            {canTakePayment && (
              <form onSubmit={recordPayment} className="page-card p-5">
                <h3 className="font-black">Record repayment</h3>
                <p className="mt-1 text-xs text-muted">MGT clears the opening balance first, then the oldest outstanding sales.</p>
                <input className="input-base mt-4" required type="number" min="0.01" max={selectedCustomer.owed} step="0.01" placeholder="Amount received" value={payAmount} onChange={(event) => setPayAmount(event.target.value)} />
                <select className="input-base mt-3" value={payMethod} onChange={(event) => setPayMethod(event.target.value)}>
                  <option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="bank">Bank</option><option value="cheque">Cheque</option>
                </select>
                {payMethod !== 'cash' && <input className="input-base mt-3" placeholder="Reference / transaction ID" value={payReference} onChange={(event) => setPayReference(event.target.value)} />}
                <textarea className="input-base mt-3 min-h-20" placeholder="Notes" value={payNotes} onChange={(event) => setPayNotes(event.target.value)} />
                <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy ? 'Recording...' : 'Record payment'}</button>
              </form>
            )}
          </div>

          <div className="space-y-5">
            <div className="page-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Outstanding sales</strong></div>
              <div className="divide-y divide-[var(--line)]">
                {customerSales.map((sale) => <div key={sale.id} className="flex items-center justify-between gap-4 p-4"><div><strong>{sale.sale_number}</strong><p className="mt-1 text-xs text-muted">{new Date(sale.created_at).toLocaleDateString()}</p></div><div className="text-right"><strong className="text-red-500">{money(outstandingForSale(sale), currency)}</strong><div className="mt-1 flex justify-end gap-2"><Link href={`/sales/${sale.id}/invoice`} className="text-xs font-bold text-accent">Invoice</Link><Link href={`/sales/${sale.id}/receipt`} className="text-xs font-bold text-accent">Receipt</Link></div></div></div>)}
              </div>
            </div>
            <div className="page-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Payment activity</strong></div>
              <div className="divide-y divide-[var(--line)]">
                {!customerPayments.length && <p className="p-5 text-sm text-muted">No payment activity yet.</p>}
                {customerPayments.slice(0, 30).map((payment) => <div key={payment.id} className="flex items-center justify-between gap-4 p-4"><div><strong className="capitalize">{payment.payment_type?.replaceAll('_',' ')}</strong><p className="mt-1 text-xs text-muted">{payment.method?.replaceAll('_',' ')} · {new Date(payment.created_at).toLocaleString()}</p></div><strong className={payment.direction === 'out' ? 'text-red-500' : 'text-emerald-600'}>{payment.direction === 'out' ? '-' : '+'}{money(payment.amount, currency)}</strong></div>)}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab === 'returns' && (
        <section className="space-y-3">
          {!returns.length && <div className="page-card p-6 text-center text-sm text-muted">No returns have been processed.</div>}
          {returns.map((item) => {
            const sale = sales.find((row) => row.id === item.sale_id)
            return <div key={item.id} className="page-card p-4"><div className="flex items-start justify-between gap-4"><div><strong>{item.return_number}</strong><p className="mt-1 text-xs text-muted">{sale?.sale_number || 'Sale'} · {sale?.customers?.name || 'Walk-in'} · {new Date(item.created_at).toLocaleString()}</p>{item.reason && <p className="mt-2 text-sm text-muted">{item.reason}</p>}</div><div className="text-right"><strong>{money(item.total_amount, currency)}</strong><p className="mt-1 text-xs text-muted">Cash refund {money(item.cash_refund_amount, currency)} · credit reduced {money(item.credit_reduction, currency)}</p></div></div></div>
          })}
        </section>
      )}

      {returnSale && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8">
          <form onSubmit={processReturn} className="mx-auto max-w-2xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Return / refund</p><h2 className="text-xl font-black">{returnSale.sale_number}</h2><p className="mt-1 text-sm text-muted">{returnSale.customers?.name || 'Walk-in customer'}</p></div><button type="button" onClick={() => setReturnSale(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div>
            <div className="mt-5 space-y-3">
              {returnItems.map((item) => {
                const available = Number(item.quantity || 0) - Number(item.returned_qty || 0)
                return <div key={item.id} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4"><div className="flex justify-between gap-3"><div><strong>{item.description}</strong><p className="mt-1 text-xs text-muted">Sold {item.quantity} · already returned {item.returned_qty} · available {available}</p></div><strong>{money(item.line_total, currency)}</strong></div><input className="input-base mt-3" type="number" min="0" max={available} step="0.001" placeholder="Quantity to return" value={returnQty[item.id] || ''} onChange={(event) => setReturnQty({ ...returnQty, [item.id]: event.target.value })} /></div>
              })}
            </div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <select className="input-base" value={returnMethod} onChange={(event) => setReturnMethod(event.target.value)}><option value="cash">Cash refund</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="bank">Bank</option></select>
              <input className="input-base" placeholder="Refund reference (optional)" value={returnReference} onChange={(event) => setReturnReference(event.target.value)} />
            </div>
            <textarea className="input-base mt-3 min-h-20" placeholder="Reason for return" value={returnReason} onChange={(event) => setReturnReason(event.target.value)} />
            <p className="mt-3 text-xs text-muted">For credit sales, MGT reduces unpaid debt first. Only the remaining refundable value is paid back to the customer.</p>
            <button disabled={busy} className="mt-4 w-full rounded-xl bg-amber-500 px-4 py-3 font-black text-slate-950 disabled:opacity-50">{busy ? 'Processing...' : 'Process return'}</button>
          </form>
        </div>
      )}
    </main>
  )
}

