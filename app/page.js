'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../lib/supabase'
import { getBusinessConfig, getDefaultLocation, moduleEnabled } from '../lib/platformConfig'
import { getPlatformContext, isUniversalSchemaMissing, loadBusinessConfigFromDatabase } from '../lib/platformDb'
import { getSessionProfile } from '../lib/sessionCache'
import ProfileAvatar from './components/ProfileAvatar'

const day = (value) => new Date(value).toISOString().slice(0, 10)
const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()

export default function HomePage() {
  const [business, setBusiness] = useState(() => getBusinessConfig())
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [context, setContext] = useState(null)
  const [metrics, setMetrics] = useState({
    salesToday: 0,
    revenueToday: 0,
    outstanding: 0,
    products: 0,
    customers: 0,
    expensesToday: 0,
    openPurchases: 0,
    openWorkOrders: 0,
  })
  const [backendReady, setBackendReady] = useState(true)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const { session, profile: cachedProfile } = await getSessionProfile()
        if (!session) return (window.location.href = '/login')
        setUserId(session.user.id)
        setProfile(cachedProfile)

        const databaseBusiness = await loadBusinessConfigFromDatabase().catch(() => null)
        if (databaseBusiness) setBusiness(databaseBusiness)

        const platform = await getPlatformContext()
        setContext(platform)
        if (!platform.organization?.id) {
          setBackendReady(false)
          return
        }

        const orgId = platform.organization.id
        const today = new Date().toISOString().slice(0, 10)
        const start = `${today}T00:00:00.000Z`
        const end = `${today}T23:59:59.999Z`

        const [salesRes, allSalesRes, productsRes, customersRes, expensesRes, purchasesRes, workOrdersRes] = await Promise.all([
          supabase.from('sales').select('id,total_amount,amount_paid,refunded_amount,created_at').eq('organization_id', orgId).gte('created_at', start).lte('created_at', end),
          supabase.from('sales').select('total_amount,amount_paid,refunded_amount').eq('organization_id', orgId).in('payment_status', ['partial', 'credit']),
          supabase.from('products').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('active', true),
          supabase.from('customers').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).eq('active', true),
          supabase.from('expenses').select('amount,created_at').eq('organization_id', orgId).gte('created_at', start).lte('created_at', end),
          supabase.from('purchases').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['draft', 'ordered', 'partial']),
          supabase.from('work_orders').select('id', { count: 'exact', head: true }).eq('organization_id', orgId).in('status', ['open', 'in_progress']),
        ])

        const fatal = [salesRes, allSalesRes, productsRes, customersRes, expensesRes, purchasesRes, workOrdersRes].find((r) => r.error)
        if (fatal?.error) throw fatal.error

        const sales = salesRes.data || []
        setMetrics({
          salesToday: sales.length,
          revenueToday: sales.reduce((sum, sale) => sum + Number(sale.amount_paid || 0), 0),
          outstanding: (allSalesRes.data || []).reduce((sum, sale) => sum + Math.max(0, Number(sale.total_amount || 0) - Number(sale.refunded_amount || 0) - Number(sale.amount_paid || 0)), 0),
          products: productsRes.count || 0,
          customers: customersRes.count || 0,
          expensesToday: (expensesRes.data || []).reduce((sum, expense) => sum + Number(expense.amount || 0), 0),
          openPurchases: purchasesRes.count || 0,
          openWorkOrders: workOrdersRes.count || 0,
        })
      } catch (error) {
        if (isUniversalSchemaMissing(error) || String(error?.message || '').includes('organization_id')) {
          setBackendReady(false)
        }
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const effectiveBusiness = context?.organization
    ? {
        ...business,
        businessName: context.organization.name || business.businessName,
        shortName: context.organization.short_name || business.shortName,
        currency: context.organization.currency || business.currency,
      }
    : business
  const location = context?.location || getDefaultLocation(business)
  const initials = useMemo(() => (profile?.full_name || 'User').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase(), [profile])

  const quickActions = [
    moduleEnabled(business, 'pos') && ['/pos', 'New POS sale', 'Fast counter checkout', '+'],
    moduleEnabled(business, 'sales') && ['/sales', 'Sales & credit', 'Receipts, debt and returns', '▤'],
    moduleEnabled(business, 'inventory') && ['/catalog', 'Add product', 'Manage products and services', '□'],
    moduleEnabled(business, 'customers') && ['/customers', 'Add customer', 'Customer records and credit', '◎'],
    moduleEnabled(business, 'purchasing') && ['/purchasing', 'New purchase', 'Order or receive stock', '↓'],
    moduleEnabled(business, 'manufacturing') && ['/production', 'Production', 'Plan or record output', '⚙'],
    moduleEnabled(business, 'services') && ['/work-orders', 'New job', 'Create a service work order', '⌁'],
  ].filter(Boolean).slice(0, 4)

  if (loading) return <main className="page-wrap text-muted">Opening business workspace...</main>

  return (
    <main className="page-wrap">
      {!backendReady && (
        <div className="mb-5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <strong className="text-amber-600">Universal backend not connected yet</strong>
          <p className="mt-1 text-sm text-muted">The MGT interface is running without an active business backend. Connect the dedicated Universal MGT Supabase project and apply the universal schema to activate live business data.</p>
          <Link href="/setup" className="mt-3 inline-flex rounded-xl bg-amber-500 px-3 py-2 text-sm font-black text-slate-950">Open business setup</Link>
        </div>
      )}

      <section className="home-hero-grid">
        <div className="home-welcome-card">
          <p className="page-eyebrow">{location?.name || 'Business workspace'}</p>
          <h1 className="home-greeting">Hi {profile?.full_name?.split(' ')[0] || 'there'}!</h1>
          <p className="page-subtitle">Here’s what’s happening at {effectiveBusiness.businessName || 'your business'} today.</p>
          <div className="home-quick-row">
            {quickActions.length ? quickActions.map(([href, label, description, icon]) => (
              <Link key={href + label} href={href} className="home-quick-action">
                <span>{icon}</span><div><strong>{label}</strong><small>{description}</small></div>
              </Link>
            )) : <Link href="/setup" className="home-quick-action"><span>+</span><div><strong>Configure modules</strong><small>Choose what this business needs</small></div></Link>}
          </div>
        </div>

        <section className="home-profile-card" aria-label="User profile summary">
          <ProfileAvatar userId={userId} initials={initials} className="home-profile-avatar" />
          <div className="home-profile-name">{profile?.full_name || 'Business user'}</div>
          <div className="home-profile-role">{profile?.role?.replaceAll('_', ' ') || 'user'}</div>
          <div className="home-profile-stats">
            <div><strong>{metrics.salesToday}</strong><span>Sales today</span></div>
            <div><strong>{metrics.products}</strong><span>Active catalog items</span></div>
            <div><strong>{metrics.customers}</strong><span>Customers</span></div>
          </div>
          <span className="home-profile-note">Profile changes are managed in Settings</span>
        </section>
      </section>

      <section className="mt-7 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Link href="/sales" className="page-card p-5"><p className="text-sm text-muted">Cash / payments today</p><p className="metric-value-success mt-3 text-3xl font-black">{money(metrics.revenueToday, effectiveBusiness.currency)}</p><p className="mt-2 text-xs text-muted">{metrics.salesToday} sale(s) recorded</p></Link>
        <Link href="/customers" className="page-card p-5"><p className="text-sm text-muted">Outstanding receivables</p><p className="metric-value-danger mt-3 text-3xl font-black">{money(metrics.outstanding, effectiveBusiness.currency)}</p><p className="mt-2 text-xs text-muted">Customer credit still due</p></Link>
        <Link href="/purchasing" className="page-card p-5"><p className="text-sm text-muted">Open purchases</p><p className="metric-value-warning mt-3 text-3xl font-black">{metrics.openPurchases}</p><p className="mt-2 text-xs text-muted">Draft, ordered or partially received</p></Link>
        <Link href="/cashbook" className="page-card p-5"><p className="text-sm text-muted">Expenses today</p><p className="mt-3 text-3xl font-black">{money(metrics.expensesToday, effectiveBusiness.currency)}</p><p className="mt-2 text-xs text-muted">Recorded business expenses</p></Link>
      </section>

      <section className="mt-8 grid gap-6 lg:grid-cols-[1.3fr_.7fr]">
        <div className="page-card p-5">
          <div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="text-lg font-black">Business modules</h2><p className="mt-1 text-xs text-muted">Your workspace adapts to the modules enabled for this business.</p></div><Link href="/setup" className="text-sm font-bold text-accent">Manage</Link></div>
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              ['inventory','Inventory','Products, stock and locations','/catalog'],
              ['customers','Customers','CRM, balances and history','/customers'],
              ['suppliers','Suppliers','Vendors and purchase relationships','/suppliers'],
              ['services','Services','Jobs and work orders','/work-orders'],
              ['manufacturing','Manufacturing','BOMs and production','/production'],
              ['finance','Finance','Cash, expenses and banking','/cashbook'],
            ].filter(([module]) => moduleEnabled(business, module)).map(([module,label,description,href]) => (
              <Link href={href} key={module} className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4">
                <strong>{label}</strong><p className="mt-1 text-xs text-muted">{description}</p>
              </Link>
            ))}
          </div>
        </div>

        <div className="page-card p-5">
          <h2 className="text-lg font-black">Workspace</h2>
          <div className="mt-4 space-y-3 text-sm">
            <div className="flex justify-between gap-4"><span className="text-muted">Business</span><strong className="text-right">{effectiveBusiness.businessName}</strong></div>
            <div className="flex justify-between gap-4"><span className="text-muted">Location</span><strong className="text-right">{location?.name || 'Not selected'}</strong></div>
            <div className="flex justify-between gap-4"><span className="text-muted">Currency</span><strong>{effectiveBusiness.currency}</strong></div>
            <div className="flex justify-between gap-4"><span className="text-muted">Business type</span><strong className="capitalize">{business.businessType?.replaceAll('_',' ')}</strong></div>
          </div>
          <div className="mt-5 grid gap-2"><Link href="/executive-dashboard" className="btn-primary block rounded-xl px-4 py-3 text-center text-sm font-bold">Open executive dashboard</Link><Link href="/locations" className="btn-secondary block rounded-xl px-4 py-3 text-center text-sm font-bold">Manage locations</Link></div>
        </div>
      </section>
    </main>
  )
}
