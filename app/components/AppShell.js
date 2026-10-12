'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import { setCachedProfile, clearSessionProfileCache } from '../../lib/sessionCache'
import { loadBusinessConfigFromDatabase } from '../../lib/platformDb'
import { hasRoutePermission } from '../../lib/routeAccess'
import { loadNotificationInbox, notificationCategoryEnabled, syncNotificationSystem } from '../../lib/notifications'
import {
  PLATFORM_CONFIG_EVENT,
  getBusinessConfig,
  getDefaultLocation,
  moduleEnabled,
  moduleForPath,
} from '../../lib/platformConfig'
import ProfileAvatar from './ProfileAvatar'

const Icon = ({ name }) => {
  const paths = {
    home: <><path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5"/><path d="M9.5 20v-6h5v6"/></>,
    stock: <><rect x="4" y="5" width="16" height="14" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/></>,
    sales: <><path d="M4 18h16"/><path d="M6 15V9M12 15V5M18 15v-3"/></>,
    service: <><path d="M14.5 5.5 18.5 9.5"/><path d="M13 7 6 14l-1 4 4-1 7-7"/><path d="M4 20h16"/></>,
    production: <><path d="M4 18h16V9l-5 3V8l-5 3V5L4 9z"/><path d="M7 18v-3h3v3"/></>,
    cash: <><rect x="3" y="6" width="18" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 9h.01M18 15h.01"/></>,
    reports: <><path d="M5 20V10M12 20V4M19 20v-7"/></>,
    alert: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9"/><path d="M10 21h4"/></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21h-4v-.1A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1A1.7 1.7 0 0 0 4.6 15 1.7 1.7 0 0 0 3 14H3v-4h.1A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6 1.7 1.7 0 0 0 10 3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.1v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
    users: <><circle cx="9" cy="8" r="3"/><path d="M3.5 20v-1.5A4.5 4.5 0 0 1 8 14h2a4.5 4.5 0 0 1 4.5 4.5V20"/><path d="M16 5.5a3 3 0 0 1 0 5.5M17 14a4 4 0 0 1 3.5 4v2"/></>,
    system: <><rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h5M8 17h3"/><circle cx="16.5" cy="16.5" r="1.5"/></>,
    setup: <><path d="M4 7h16M7 4v6M17 14v6M4 17h16"/><circle cx="17" cy="11" r="2"/><circle cx="7" cy="14" r="2"/></>,
  }
  return <svg viewBox="0 0 24 24" className="app-icon" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.home}</svg>
}

const NAV = [
  { href: '/', label: 'Home', icon: 'home', module: 'dashboard', permission: 'dashboard.view' },
  { href: '/catalog', label: 'Catalog', icon: 'stock', module: 'inventory', permission: 'catalog.view' },
  { href: '/inventory', label: 'Inventory', icon: 'stock', module: 'inventory', permission: 'inventory.view' },
  { href: '/pos', label: 'Point of Sale', icon: 'cash', module: 'pos', permission: 'sales.create' },
  { href: '/sales', label: 'Sales & Credit', icon: 'sales', module: 'sales', permission: 'sales.view' },
  { href: '/customers', label: 'Customers', icon: 'users', module: 'customers', permission: 'customers.view' },
  { href: '/suppliers', label: 'Suppliers', icon: 'service', module: 'suppliers', permission: 'suppliers.view' },
  { href: '/purchasing', label: 'Purchasing', icon: 'reports', module: 'purchasing', permission: 'purchasing.view' },
  { href: '/work-orders', label: 'Services / Jobs', icon: 'service', module: 'services', permission: 'services.view' },
  { href: '/production', label: 'Production', icon: 'production', module: 'manufacturing', permission: 'manufacturing.view' },
  { href: '/cashbook', label: 'Cash & Finance', icon: 'cash', module: 'finance', permission: 'finance.view' },
  { href: '/hr', label: 'HR & Payroll', icon: 'users', module: 'hr', permission: ['attendance.use','hr.view','hr.manage','payroll.view','payroll.manage','payroll.pay'] },
  { href: '/projects', label: 'Projects', icon: 'reports', module: 'projects', permission: ['projects.time','projects.view','projects.manage','projects.costs','projects.billing'] },
  { href: '/assets', label: 'Assets & Maintenance', icon: 'production', module: 'assets', permission: ['assets.view','assets.manage','assets.maintenance'] },
  { href: '/fleet', label: 'Fleet & Delivery', icon: 'service', module: 'fleet', permission: ['fleet.view','fleet.manage','fleet.dispatch'] },
  { href: '/ecommerce', label: 'E-commerce', icon: 'sales', module: 'ecommerce', permission: ['ecommerce.view','ecommerce.manage','ecommerce.orders','ecommerce.fulfill'] },
]

const MODULE_LABELS = {
  dashboard: 'Dashboard',
  pos: 'Point of Sale',
  inventory: 'Inventory',
  sales: 'Sales & Invoicing',
  customers: 'Customers & CRM',
  suppliers: 'Suppliers',
  purchasing: 'Purchasing',
  services: 'Services & Work Orders',
  manufacturing: 'Manufacturing',
  finance: 'Cash & Finance',
  reports: 'Reports & Analytics',
  documents: 'Business Documents',
  alerts: 'Alerts & Approvals',
  hr: 'HR & Staff',
  projects: 'Projects',
  assets: 'Assets & Maintenance',
  fleet: 'Fleet & Delivery',
  ecommerce: 'E-commerce',
  payments: 'External Payments',
  integrations: 'Integrations & Data Exchange',
  insights: 'MGT Intelligence',
}

const MANAGEMENT = [
  { href: '/notifications', label: 'Notifications', icon: 'alert', module: 'alerts' },
  { href: '/alerts', label: 'Business Alerts', icon: 'alert', module: 'alerts', permission: 'dashboard.view' },
  { href: '/approvals', label: 'Approvals', icon: 'alert', module: 'alerts', permission: 'approvals.view' },
  { href: '/executive-dashboard', label: 'Executive Dashboard', icon: 'reports', module: 'reports', permission: 'reports.view' },
  { href: '/sales-report', label: 'Detailed Reports', icon: 'reports', module: 'reports', permission: 'reports.view' },
  { href: '/documents', label: 'Documents', icon: 'reports', module: 'documents', permission: 'documents.view' },
  { href: '/accounting', label: 'Accounting', icon: 'cash', module: 'finance', permission: 'accounting.view' },
  { href: '/payments', label: 'External Payments', icon: 'cash', module: 'payments', permission: ['payments.view','payments.request','payments.manage'] },
  { href: '/insights', label: 'MGT Intelligence', icon: 'reports', module: 'insights', permission: 'insights.view' },
  { href: '/locations', label: 'Locations', icon: 'setup', permission: 'locations.manage' },
  { href: '/setup', label: 'Business Setup', icon: 'setup', permission: 'settings.manage' },
  { href: '/migration-center', label: 'Migration Center', icon: 'system', module: 'integrations', permission: 'migration.view' },
  { href: '/integrations', label: 'Integrations', icon: 'system', module: 'integrations', permission: 'integrations.view' },
  { href: '/settings', label: 'Settings', icon: 'settings' },
]

export default function AppShell({ children }) {
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [business, setBusiness] = useState(() => getBusinessConfig())
  const [canManageUsers, setCanManageUsers] = useState(false)
  const [grantedPermissions, setGrantedPermissions] = useState([])
  const [accessChecked, setAccessChecked] = useState(false)
  const [notificationCount,setNotificationCount] = useState(0)
  const [mobileMenuOpen,setMobileMenuOpen] = useState(false)
  const isStandalone = pathname === '/login' || pathname === '/setup' || pathname === '/onboarding' || pathname === '/forgot-password' || pathname === '/reset-password' || pathname === '/accept-invite' || pathname === '/shop' || pathname.startsWith('/shop/')

  useEffect(() => { setMobileMenuOpen(false) }, [pathname])

  useEffect(() => {
    const sync = (event) => setBusiness(event?.detail || getBusinessConfig())
    window.addEventListener(PLATFORM_CONFIG_EVENT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(PLATFORM_CONFIG_EVENT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  useEffect(() => {
    if (isStandalone || !profile?.organization_id) return
    let mounted = true
    let refreshTimer = null
    let configChannel = null
    const subscriptionKey = `${Date.now()}-${Math.random()}`

    const refreshBusinessConfig = async () => {
      try {
        const next = await loadBusinessConfigFromDatabase()
        if (mounted && next) setBusiness(next)
      } catch {}
    }

    refreshBusinessConfig()

    configChannel = supabase
      .channel(`mgt-business-config-${profile.organization_id}-${subscriptionKey}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'organization_modules',
        filter: `organization_id=eq.${profile.organization_id}`,
      }, refreshBusinessConfig)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'organizations',
        filter: `id=eq.${profile.organization_id}`,
      }, refreshBusinessConfig)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'locations',
        filter: `organization_id=eq.${profile.organization_id}`,
      }, refreshBusinessConfig)
      .subscribe()

    refreshTimer = window.setInterval(refreshBusinessConfig, 60000)
    const onFocus = () => refreshBusinessConfig()
    window.addEventListener('focus', onFocus)

    return () => {
      mounted = false
      if (refreshTimer) window.clearInterval(refreshTimer)
      if (configChannel) supabase.removeChannel(configChannel)
      window.removeEventListener('focus', onFocus)
    }
  }, [isStandalone, profile?.organization_id])

  useEffect(() => {
    if (isStandalone) return
    let mounted = true
    let intervalId = null
    let channel = null
    const subscriptionKey = `${Date.now()}-${Math.random()}`

    const forceSignOut = async () => {
      clearSessionProfileCache()
      try { await supabase.auth.signOut() } catch {}
      window.location.replace('/login?disabled=1')
    }

    const checkAccess = async () => {
      const { data: { session }, error: sessionError } = await supabase.auth.getSession()
      if (sessionError) return
      if (!session) return window.location.replace('/login')

      const id = session.user.id
      if (mounted) setUserId(id)

      const { data, error } = await supabase.from('users').select('full_name, role, active, archived_at, organization_id, default_location_id').eq('id', id).maybeSingle()
      if (!mounted) return
      if (error) return
      if (!data || data.active === false || data.archived_at) return forceSignOut()
      if (!data.organization_id) return window.location.replace('/onboarding')

      setCachedProfile(id, data)
      if (mounted) setProfile(data)

      const { data: permissionRows, error: permissionError } = await supabase.rpc('current_permissions')
      if (permissionError) return
      const resolvedPermissions = (permissionRows || []).map((row) => row.permission).filter(Boolean)
      if (mounted) {
        setGrantedPermissions(resolvedPermissions)
        setCanManageUsers(resolvedPermissions.includes('users.manage'))
        setAccessChecked(true)
      }
    }

    const load = async () => {
      const { data: { session }, error } = await supabase.auth.getSession()
      if (error) return
      if (!session) return window.location.replace('/login')

      const id = session.user.id
      if (mounted) setUserId(id)
      await checkAccess()
      if (!mounted) return

      channel = supabase
        .channel(`mgt-user-access-${id}-${subscriptionKey}`)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'users', filter: `id=eq.${id}` }, (payload) => {
          if (payload.eventType === 'DELETE' || payload?.new?.active === false || payload?.new?.archived_at) return forceSignOut()
          if (payload?.new) {
            setCachedProfile(id, payload.new)
            if (mounted) setProfile(payload.new)
            checkAccess()
          }
        })
        .subscribe()

      intervalId = window.setInterval(() => checkAccess(), 15000)
    }

    const onFocus = () => checkAccess()
    const onVisibility = () => { if (document.visibilityState === 'visible') checkAccess() }

    load()
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted = false
      if (intervalId) window.clearInterval(intervalId)
      if (channel) supabase.removeChannel(channel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isStandalone, userId])

  useEffect(() => {
    if (isStandalone || !userId || !profile?.organization_id) return
    let mounted = true
    let notificationChannel = null
    let stateChannel = null
    let syncInterval = null
    const subscriptionKey = `${Date.now()}-${Math.random()}`

    const refreshNotifications = async ({ sync = false, inserted = null } = {}) => {
      try {
        if (sync) await syncNotificationSystem()
        const inbox = await loadNotificationInbox({
          userId,
          organizationId: profile.organization_id,
          limit: 250,
        })
        if (mounted) setNotificationCount(inbox.unread)

        if (
          inserted &&
          inbox.preferences?.browser_enabled &&
          notificationCategoryEnabled(inbox.preferences, inserted.category) &&
          typeof Notification !== 'undefined' &&
          Notification.permission === 'granted' &&
          document.visibilityState !== 'visible'
        ) {
          new Notification(inserted.title || 'MGT Business Suite', {
            body: inserted.body || 'You have a new business notification.',
            icon: '/icon.svg',
          })
        }
      } catch {}
    }

    refreshNotifications({ sync: true })

    notificationChannel = supabase
      .channel(`mgt-notifications-${userId}-${subscriptionKey}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `organization_id=eq.${profile.organization_id}`,
      }, (payload) => {
        refreshNotifications({
          sync: false,
          inserted: payload.eventType === 'INSERT' ? payload.new : null,
        })
      })
      .subscribe()

    stateChannel = supabase
      .channel(`mgt-notification-state-${userId}-${subscriptionKey}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notification_states',
        filter: `user_id=eq.${userId}`,
      }, () => refreshNotifications({ sync: false }))
      .subscribe()

    syncInterval = window.setInterval(() => refreshNotifications({ sync: true }), 300000)
    const onFocus = () => refreshNotifications({ sync: true })
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refreshNotifications({ sync: false })
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      mounted = false
      if (syncInterval) window.clearInterval(syncInterval)
      if (notificationChannel) supabase.removeChannel(notificationChannel)
      if (stateChannel) supabase.removeChannel(stateChannel)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [isStandalone, userId, profile?.organization_id])

  const initials = useMemo(() => {
    const name = profile?.full_name || 'MGT User'
    return name.split(' ').filter(Boolean).slice(0, 2).map((p) => p[0]).join('').toUpperCase()
  }, [profile])

  const active = (href) => href === '/' ? pathname === '/' : pathname.startsWith(href)
  const isSuper = ['super_admin', 'system_admin'].includes(profile?.role)
  const defaultLocation = getDefaultLocation(business)
  const hasPermission = (permission) => !permission || (Array.isArray(permission)
    ? permission.some((item) => grantedPermissions.includes(item))
    : grantedPermissions.includes(permission))
  const visibleNav = NAV.filter((item) => moduleEnabled(business, item.module) && hasPermission(item.permission))
  const visibleManagement = MANAGEMENT.filter((item) => moduleEnabled(business, item.module) && hasPermission(item.permission))
  const mobilePrimary = [
    { href: '/', label: 'Home', icon: 'home', module: 'dashboard', permission: 'dashboard.view' },
    { href: '/pos', label: 'POS', icon: 'cash', module: 'pos', permission: 'sales.create' },
    { href: '/inventory', label: 'Stock', icon: 'stock', module: 'inventory', permission: 'inventory.view' },
    { href: '/sales', label: 'Sales', icon: 'sales', module: 'sales', permission: 'sales.view' },
  ].filter((item) => moduleEnabled(business, item.module) && hasPermission(item.permission)).slice(0,4)
  const currentModule = moduleForPath(pathname)
  const routeModuleDisabled = Boolean(currentModule && !moduleEnabled(business, currentModule))
  const routePermissionDenied = !hasRoutePermission(pathname, grantedPermissions, profile?.role)
  const currentModuleLabel = currentModule ? (MODULE_LABELS[currentModule] || currentModule.replaceAll('_', ' ')) : ''
  const brandName = business.businessName || 'My Business'
  const brandMark = business.shortName || 'MGT'

  if (isStandalone) return children
  if (!accessChecked || business.organizationId !== profile?.organization_id) return <main className="page-wrap text-muted">Checking account access...</main>

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <div className="app-brand">
          <div className="app-brand-mark">{brandMark}</div>
          <div><strong>{brandName}</strong><span>{defaultLocation?.name || 'Business Management'}</span></div>
        </div>

        <nav className="app-nav">
          <p className="app-nav-label">Business workspace</p>
          {visibleNav.map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} /><span>{item.label}</span>
              {item.href==='/notifications'&&notificationCount>0&&<span className="ml-auto rounded-full bg-red-500 px-2 py-0.5 text-[10px] font-black text-white">{notificationCount>99?'99+':notificationCount}</span>}
            </Link>
          ))}

          <p className="app-nav-label app-nav-label-spaced">Management</p>
          {visibleManagement.map((item) => (
            <Link key={item.href} href={item.href} className={`app-nav-item ${active(item.href) ? 'active' : ''}`}>
              <Icon name={item.icon} /><span>{item.label}</span>
            </Link>
          ))}

          {(isSuper || canManageUsers) && (
            <>
              <p className="app-nav-label app-nav-label-spaced">Administration</p>
              {isSuper && (
                <Link href="/system-control" className={`app-nav-item ${active('/system-control') ? 'active' : ''}`}>
                  <Icon name="system" /><span>System Control</span>
                </Link>
              )}
              {canManageUsers && (
                <Link href="/users" className={`app-nav-item ${active('/users') ? 'active' : ''}`}>
                  <Icon name="users" /><span>Staff & Access</span>
                </Link>
              )}
            </>
          )}
        </nav>

        <div className="app-profile-card" aria-label="Signed-in user">
          <ProfileAvatar userId={userId} initials={initials} className="app-avatar" />
          <div className="min-w-0"><strong>{profile?.full_name || 'Account'}</strong><span>{isSuper ? 'System Administrator' : profile?.role || 'staff'}</span></div>
        </div>
      </aside>

      <div className="app-main">
        <header className="app-mobile-header">
          <div className="app-mobile-brand"><div className="app-brand-mark small">{brandMark}</div><div><strong>{brandName}</strong><span>{isSuper ? 'System Administration' : defaultLocation?.name || 'Management'}</span></div></div>
          <div className="flex items-center gap-2">
            <Link href="/notifications" aria-label="Notifications" className="relative grid h-10 w-10 place-items-center rounded-full border border-[var(--line)] bg-[var(--panel)] text-[var(--text)]">
              <Icon name="alert" />
              {notificationCount>0&&<span className="absolute -right-1 -top-1 min-w-5 rounded-full bg-red-500 px-1.5 py-0.5 text-center text-[9px] font-black leading-none text-white">{notificationCount>99?'99+':notificationCount}</span>}
            </Link>
            <Link href="/settings" aria-label="Account settings"><ProfileAvatar userId={userId} initials={initials} className="app-avatar small" /></Link>
          </div>
        </header>
        <div className="app-content">
          {routeModuleDisabled || routePermissionDenied ? (
            <main className="page-wrap">
              <section className="page-card mx-auto max-w-2xl p-7 text-center">
                <p className="page-eyebrow">{routeModuleDisabled ? 'Module disabled' : 'Access restricted'}</p>
                <h1 className="mt-2 text-2xl font-black">{routeModuleDisabled ? `${currentModuleLabel} is not enabled for this business` : 'Your role cannot open this workspace'}</h1>
                <p className="mt-3 text-sm leading-6 text-muted">{routeModuleDisabled ? 'Your company has turned this module off. An authorized manager can enable it in Business Setup.' : 'Contact your business administrator if you need access.'}</p>
                <div className="mt-5 flex flex-wrap justify-center gap-2">
                  <Link href="/" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Back to Home</Link>
                  {hasPermission('settings.manage') && <Link href="/setup" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Manage Business Modules</Link>}
                </div>
              </section>
            </main>
          ) : children}
        </div>
      </div>

      <nav className="app-bottom-nav" aria-label="Primary navigation" style={{gridTemplateColumns:`repeat(${mobilePrimary.length+1},minmax(0,1fr))`}}>
        {mobilePrimary.map((item) => (
          <Link key={item.href} href={item.href} className={`app-bottom-item ${active(item.href) ? 'active' : ''}`}>
            <Icon name={item.icon} /><span>{item.label}</span>
          </Link>
        ))}
        <button type="button" onClick={()=>setMobileMenuOpen(true)} className={`app-bottom-item ${mobileMenuOpen ? 'active' : ''}`} aria-label="Open all modules">
          <Icon name="system" /><span>More</span>
        </button>
      </nav>

      {mobileMenuOpen&&<div className="mobile-nav-backdrop" onMouseDown={event=>{if(event.target===event.currentTarget)setMobileMenuOpen(false)}}>
        <section className="mobile-nav-sheet" role="dialog" aria-modal="true" aria-label="All MGT modules">
          <div className="mobile-nav-handle" />
          <div className="mobile-nav-sheet-header">
            <div><p className="page-eyebrow">Workspace</p><h2>All modules</h2></div>
            <button type="button" onClick={()=>setMobileMenuOpen(false)} className="barcode-close" aria-label="Close menu">×</button>
          </div>

          <div className="mobile-nav-section">
            <p className="app-nav-label">Business workspace</p>
            <div className="mobile-nav-grid">
              {visibleNav.map(item=><Link key={item.href} href={item.href} className={`mobile-nav-card ${active(item.href)?'active':''}`}><Icon name={item.icon}/><span>{item.label}</span></Link>)}
            </div>
          </div>

          <div className="mobile-nav-section">
            <p className="app-nav-label">Management</p>
            <div className="mobile-nav-grid">
              {visibleManagement.map(item=><Link key={item.href} href={item.href} className={`mobile-nav-card ${active(item.href)?'active':''}`}><Icon name={item.icon}/><span>{item.label}</span>{item.href==='/notifications'&&notificationCount>0&&<b>{notificationCount>99?'99+':notificationCount}</b>}</Link>)}
              {canManageUsers&&<Link href="/users" className={`mobile-nav-card ${active('/users')?'active':''}`}><Icon name="users"/><span>Staff & Access</span></Link>}
              {isSuper&&<Link href="/system-control" className={`mobile-nav-card ${active('/system-control')?'active':''}`}><Icon name="system"/><span>System Control</span></Link>}
            </div>
          </div>
        </section>
      </div>}
    </div>
  )
}

