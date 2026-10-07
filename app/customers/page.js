'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext, isUniversalSchemaMissing } from '../../lib/platformDb'

const INITIAL = {"name":"","phone":"","email":"","credit_limit":"","notes":""}

export default function Page() {
  const [context, setContext] = useState(null)
  const [rows, setRows] = useState([])
  const [form, setForm] = useState(INITIAL)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    setLoading(true)
    setMessage('')
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if (!ctx.organization?.id) return
      const { data, error } = await supabase.from('customers').select('id,name,phone,email,credit_limit,active,created_at').eq('organization_id', ctx.organization.id).order('created_at', { ascending: false })
      if (error) throw error
      setRows(data || [])
    } catch (error) {
      setMessage(isUniversalSchemaMissing(error) ? 'Universal backend not connected yet.' : error.message)
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  const submit = async (e) => {
    e.preventDefault()
    if (!context?.organization?.id) return setMessage('Complete business setup on the new MGT backend first.')
    setSaving(true)
    setMessage('')
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim() || null, email: form.email.trim() || null, credit_limit: Number(form.credit_limit || 0), notes: form.notes.trim() || null }
      const { error } = await supabase.from('customers').insert({ organization_id: context.organization.id, ...payload })
      if (error) throw error
      setForm(INITIAL)
      setMessage('Customer added.')
      await load()
    } catch (error) { setMessage(error.message) }
    finally { setSaving(false) }
  }

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Universal core</p><h1 className="page-title">Customers</h1><p className="page-subtitle">Customer records, contacts, credit limits and account relationships.</p></div><Link href="/" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Back</Link></div>
    {message && <div className="mb-4 rounded-xl border border-[var(--line)] bg-[var(--panel)] p-3 text-sm">{message}</div>}
    <section className="grid gap-5 lg:grid-cols-[360px_1fr]">
      <form onSubmit={submit} className="page-card h-fit p-5"><h2 className="mb-4 text-base font-black">Add Customer</h2><div className="space-y-3">
    <input className="input-base" required placeholder="Customer name" value={form.name} onChange={(e)=>setForm({...form,name:e.target.value})}/>
    <input className="input-base" placeholder="Phone" value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})}/>
    <input className="input-base" type="email" placeholder="Email" value={form.email} onChange={(e)=>setForm({...form,email:e.target.value})}/>
    <input className="input-base" type="number" min="0" placeholder="Credit limit" value={form.credit_limit} onChange={(e)=>setForm({...form,credit_limit:e.target.value})}/>
    <textarea className="input-base min-h-24" placeholder="Notes" value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})}/>
  </div><button disabled={saving} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{saving ? 'Saving...' : 'Save'}</button></form>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Customers</strong><p className="mt-1 text-xs text-muted">{rows.length} record(s)</p></div><div className="divide-y divide-[var(--line)]">{loading ? <p className="p-5 text-sm text-muted">Loading...</p> : rows.length === 0 ? <p className="p-5 text-sm text-muted">No customers yet.</p> : rows.map((row) => <div key={row.id} className="flex items-start justify-between gap-4 p-4"><div><strong>{row.name}</strong><p className="mt-1 text-xs text-muted">{[row.phone,row.email].filter(Boolean).join(' · ') || 'No contact details'}</p></div><div className="text-right"><span className="text-xs text-muted">Credit limit</span><strong className="block">{Number(row.credit_limit||0).toLocaleString()}</strong></div></div>)}</div></div>
    </section>
  </main>
}
