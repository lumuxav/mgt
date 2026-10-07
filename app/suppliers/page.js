'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const INITIAL = { name:'', phone:'', email:'', address:'', opening_balance:'', notes:'' }

export default function SuppliersPage() {
  const business = getBusinessConfig()
  const [context,setContext] = useState(null)
  const [permissions,setPermissions] = useState([])
  const [suppliers,setSuppliers] = useState([])
  const [purchases,setPurchases] = useState([])
  const [payments,setPayments] = useState([])
  const [locations,setLocations] = useState([])
  const [form,setForm] = useState(INITIAL)
  const [selected,setSelected] = useState(null)
  const [locationId,setLocationId] = useState('')
  const [payAmount,setPayAmount] = useState('')
  const [payMethod,setPayMethod] = useState('bank')
  const [payReference,setPayReference] = useState('')
  const [payNotes,setPayNotes] = useState('')
  const [message,setMessage] = useState(null)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)

  const currency = context?.organization?.currency || business.currency || 'UGX'
  const canManage = permissions.includes('suppliers.manage')
  const canPay = permissions.includes('purchasing.pay') || permissions.includes('finance.manage')

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id

      const [permRes,supplierRes,purchaseRes,paymentRes,locationRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('suppliers').select('id,name,phone,email,address,opening_balance,opening_balance_paid,active,notes,created_at').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('purchases').select('id,purchase_number,supplier_id,location_id,status,payment_status,total_amount,amount_paid,due_date,created_at,locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),
        supabase.from('payments').select('id,supplier_id,purchase_id,direction,payment_type,method,amount,reference,notes,created_at,locations(name)').eq('organization_id',org).not('supplier_id','is',null).order('created_at',{ascending:false}).limit(500),
        supabase.from('locations').select('id,name').eq('organization_id',org).eq('active',true).order('name'),
      ])

      for (const result of [permRes,supplierRes,purchaseRes,paymentRes,locationRes]) if (result.error) throw result.error

      setPermissions((permRes.data || []).map((row) => row.permission))
      setSuppliers(supplierRes.data || [])
      setPurchases(purchaseRes.data || [])
      setPayments(paymentRes.data || [])
      setLocations(locationRes.data || [])
      setLocationId((value) => value || ctx.location?.id || locationRes.data?.[0]?.id || '')
    } catch (error) {
      setMessage({type:'error',text:error.message || 'Could not load suppliers.'})
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const balances = useMemo(() => {
    const result = {}
    for (const supplier of suppliers) {
      const opening = Math.max(0, Number(supplier.opening_balance || 0) - Number(supplier.opening_balance_paid || 0))
      const purchaseDebt = purchases.filter((purchase) => purchase.supplier_id === supplier.id).reduce((sum,purchase) => sum + Math.max(0,Number(purchase.total_amount || 0) - Number(purchase.amount_paid || 0)),0)
      result[supplier.id] = opening + purchaseDebt
    }
    return result
  },[suppliers,purchases])

  const totalPayable = Object.values(balances).reduce((sum,value) => sum + Number(value || 0),0)

  const addSupplier = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('suppliers').insert({
      organization_id: context.organization.id,
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      address: form.address.trim() || null,
      opening_balance: Number(form.opening_balance || 0),
      notes: form.notes.trim() || null,
    })
    if (error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:'Supplier added.'})
      setForm(INITIAL)
      await load()
    }
    setBusy(false)
  }

  const paySupplier = async (event) => {
    event.preventDefault()
    if (!selected) return
    setBusy(true)
    setMessage(null)
    const { data,error } = await supabase.rpc('record_supplier_payment',{
      p_supplier_id:selected.id,
      p_location_id:locationId,
      p_amount:Number(payAmount),
      p_method:payMethod,
      p_reference:payReference || null,
      p_notes:payNotes || null,
    })
    if (error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:`Supplier payment recorded. Remaining balance: ${money(data?.remaining_balance,currency)}.`})
      setPayAmount('')
      setPayReference('')
      setPayNotes('')
      setSelected(null)
      await load()
    }
    setBusy(false)
  }

  if (loading) return <main className="page-wrap text-muted">Loading suppliers...</main>

  const selectedPurchases = selected ? purchases.filter((purchase) => purchase.supplier_id === selected.id) : []
  const selectedPayments = selected ? payments.filter((payment) => payment.supplier_id === selected.id) : []

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Suppliers</p>
          <h1 className="page-title">Suppliers & Payables</h1>
          <p className="page-subtitle">Supplier records, purchase balances, payment history and account settlement.</p>
        </div>
        <Link href="/purchasing" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Purchasing</Link>
      </div>

      {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="page-card p-4"><p className="text-xs text-muted">Active suppliers</p><strong className="mt-2 block text-2xl">{suppliers.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Outstanding payables</p><strong className="mt-2 block text-2xl text-red-500">{money(totalPayable,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Open supplier accounts</p><strong className="mt-2 block text-2xl">{suppliers.filter((supplier)=>Number(balances[supplier.id]||0)>0.009).length}</strong></div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
        {canManage && (
          <form onSubmit={addSupplier} className="page-card h-fit p-5">
            <h2 className="font-black">Add supplier</h2>
            <div className="mt-4 space-y-3">
              <input required className="input-base" placeholder="Supplier name" value={form.name} onChange={(event)=>setForm({...form,name:event.target.value})}/>
              <input className="input-base" placeholder="Phone" value={form.phone} onChange={(event)=>setForm({...form,phone:event.target.value})}/>
              <input className="input-base" type="email" placeholder="Email" value={form.email} onChange={(event)=>setForm({...form,email:event.target.value})}/>
              <input className="input-base" placeholder="Address" value={form.address} onChange={(event)=>setForm({...form,address:event.target.value})}/>
              <input className="input-base" type="number" min="0" step="0.01" placeholder="Opening payable balance" value={form.opening_balance} onChange={(event)=>setForm({...form,opening_balance:event.target.value})}/>
              <textarea className="input-base min-h-20" placeholder="Notes" value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})}/>
            </div>
            <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Saving...':'Save supplier'}</button>
          </form>
        )}

        <div className="page-card overflow-hidden">
          <div className="border-b border-[var(--line)] p-4"><strong>Supplier accounts</strong><p className="mt-1 text-xs text-muted">Select a supplier to view purchases and settle balances.</p></div>
          <div className="divide-y divide-[var(--line)]">
            {!suppliers.length && <p className="p-6 text-center text-sm text-muted">No suppliers yet.</p>}
            {suppliers.map((supplier) => {
              const balance = Number(balances[supplier.id] || 0)
              return <button key={supplier.id} type="button" onClick={()=>setSelected(supplier)} className="grid w-full gap-3 p-4 text-left sm:grid-cols-[1fr_auto]"><div><strong>{supplier.name}</strong><p className="mt-1 text-xs text-muted">{[supplier.phone,supplier.email,supplier.address].filter(Boolean).join(' · ') || 'No contact details'}</p></div><div className="text-left sm:text-right"><span className="text-xs text-muted">Balance due</span><strong className={`block text-lg ${balance>0?'text-red-500':'text-emerald-600'}`}>{money(balance,currency)}</strong></div></button>
            })}
          </div>
        </div>
      </section>

      {selected && (
        <div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8">
          <div className="mx-auto max-w-4xl rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div><p className="page-eyebrow">Supplier account</p><h2 className="text-xl font-black">{selected.name}</h2><p className="mt-1 text-sm text-muted">{selected.phone || selected.email || 'Supplier'}</p></div>
              <button type="button" onClick={()=>setSelected(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button>
            </div>

            <div className="mt-5 grid gap-4 lg:grid-cols-[330px_1fr]">
              <div className="space-y-4">
                <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Outstanding payable</span><strong className="mt-1 block text-2xl text-red-500">{money(balances[selected.id],currency)}</strong><p className="mt-2 text-xs text-muted">Opening balance remaining: {money(Math.max(0,Number(selected.opening_balance||0)-Number(selected.opening_balance_paid||0)),currency)}</p></div>

                {canPay && Number(balances[selected.id] || 0) > 0.009 && (
                  <form onSubmit={paySupplier} className="rounded-2xl border border-[var(--line)] p-4">
                    <h3 className="font-black">Record supplier payment</h3>
                    <p className="mt-1 text-xs text-muted">Payment is allocated to the oldest supplier debt first.</p>
                    <select className="input-base mt-3" value={locationId} onChange={(event)=>setLocationId(event.target.value)}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select>
                    <input required className="input-base mt-3" type="number" min="0.01" max={balances[selected.id]} step="0.01" placeholder="Amount paid" value={payAmount} onChange={(event)=>setPayAmount(event.target.value)}/>
                    <select className="input-base mt-3" value={payMethod} onChange={(event)=>setPayMethod(event.target.value)}><option value="bank">Bank</option><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="cheque">Cheque</option></select>
                    <input className="input-base mt-3" placeholder="Reference / transaction ID" value={payReference} onChange={(event)=>setPayReference(event.target.value)}/>
                    <textarea className="input-base mt-3 min-h-20" placeholder="Payment notes" value={payNotes} onChange={(event)=>setPayNotes(event.target.value)}/>
                    <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Recording...':'Record payment'}</button>
                  </form>
                )}
              </div>

              <div className="space-y-4">
                <div className="rounded-2xl border border-[var(--line)]">
                  <div className="border-b border-[var(--line)] p-4"><strong>Purchases</strong></div>
                  <div className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto">
                    {!selectedPurchases.length && <p className="p-5 text-sm text-muted">No purchases from this supplier.</p>}
                    {selectedPurchases.map((purchase)=>{
                      const due = Math.max(0,Number(purchase.total_amount||0)-Number(purchase.amount_paid||0))
                      return <div key={purchase.id} className="flex justify-between gap-4 p-4"><div><strong>{purchase.purchase_number}</strong><p className="mt-1 text-xs text-muted">{purchase.status} · {purchase.locations?.name || 'Location'} · {new Date(purchase.created_at).toLocaleDateString()}</p></div><div className="text-right"><strong>{money(purchase.total_amount,currency)}</strong>{due>0.009&&<p className="mt-1 text-xs font-black text-red-500">Due {money(due,currency)}</p>}</div></div>
                    })}
                  </div>
                </div>

                <div className="rounded-2xl border border-[var(--line)]">
                  <div className="border-b border-[var(--line)] p-4"><strong>Payment history</strong></div>
                  <div className="max-h-72 divide-y divide-[var(--line)] overflow-y-auto">
                    {!selectedPayments.length && <p className="p-5 text-sm text-muted">No supplier payments recorded.</p>}
                    {selectedPayments.map((payment)=><div key={payment.id} className="flex justify-between gap-4 p-4"><div><strong className="capitalize">{payment.method?.replaceAll('_',' ')}</strong><p className="mt-1 text-xs text-muted">{new Date(payment.created_at).toLocaleString()}{payment.reference ? ` · ${payment.reference}` : ''}</p></div><strong className="text-red-500">- {money(payment.amount,currency)}</strong></div>)}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
