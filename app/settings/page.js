'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { signOutAndRedirect } from '../../lib/sessionCache'
import ThemePicker from '../components/ThemePicker'
import ProfileAvatar, { avatarStorageKey } from '../components/ProfileAvatar'
import { DEFAULT_NOTIFICATION_CATEGORIES, NOTIFICATION_CATEGORY_LABELS, loadNotificationPreferences, saveNotificationPreferences } from '../../lib/notifications'

const DISPLAY_KEY = 'mgt-display-preferences'
const notificationKey = (userId) => `mgt-notification-preferences:${userId || 'guest'}`

const DEFAULT_DISPLAY = {
  density: 'comfortable',
  reducedMotion: false,
  numberFormat: 'full',
  dateFormat: 'dd/mm/yyyy',
}

const DEFAULT_NOTIFICATIONS = {
  browser: false,
  email: false,
  categories: { ...DEFAULT_NOTIFICATION_CATEGORIES },
}

const NOTIFICATION_DESCRIPTIONS = {
  approvals: 'Approval requests and approval decisions.',
  finance: 'Customer credit, overdue receivables and supplier payment warnings.',
  inventory: 'Low stock, out-of-stock and inventory attention items.',
  operations: 'Service jobs, maintenance and other operational exceptions.',
  hr: 'Leave, payroll and staff-related activity.',
  projects: 'Project assignments, overdue tasks, milestones and billing.',
  fleet: 'Driver assignments, deliveries, servicing and vehicle documents.',
  documents: 'Quotation validity and business document reminders.',
  system: 'Important MGT system and account notices.',
}

function RowIcon({ children }) {
  return <span className="settings-row-icon">{children}</span>
}

function Toggle({ checked, onChange, disabled = false, label }) {
  return (
    <button
      type="button"
      className={`pref-toggle ${checked ? 'pref-toggle-on' : ''}`}
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      aria-pressed={checked}
      aria-label={label}
    >
      <span />
    </button>
  )
}

const compressProfilePhoto = (file) => new Promise((resolve, reject) => {
  const reader = new FileReader()
  reader.onerror = () => reject(new Error('Could not read that image.'))
  reader.onload = () => {
    const image = new Image()
    image.onerror = () => reject(new Error('Could not open that image.'))
    image.onload = () => {
      try {
        const size = Math.min(image.width, image.height)
        const sx = Math.max(0, (image.width - size) / 2)
        const sy = Math.max(0, (image.height - size) / 2)
        const canvas = document.createElement('canvas')
        canvas.width = 512
        canvas.height = 512
        const ctx = canvas.getContext('2d')
        if (!ctx) throw new Error('Image processing is not supported on this device.')
        ctx.drawImage(image, sx, sy, size, size, 0, 0, 512, 512)
        resolve(canvas.toDataURL('image/jpeg', 0.82))
      } catch (error) {
        reject(error)
      }
    }
    image.src = reader.result
  }
  reader.readAsDataURL(file)
})

export default function SettingsPage() {
  const [profile, setProfile] = useState(null)
  const [userId, setUserId] = useState(null)
  const [photoMessage, setPhotoMessage] = useState('')
  const [photoBusy, setPhotoBusy] = useState(false)
  const [openPanel, setOpenPanel] = useState(null)
  const [display, setDisplay] = useState(DEFAULT_DISPLAY)
  const [notifications, setNotifications] = useState(DEFAULT_NOTIFICATIONS)
  const [notificationStatus, setNotificationStatus] = useState('')
  const fileRef = useRef(null)

  useEffect(() => {
    const load = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      setUserId(session.user.id)
      const { data } = await supabase.from('users').select('full_name, role, organization_id').eq('id', session.user.id).single()
      setProfile(data || null)

      try {
        const savedDisplay = JSON.parse(localStorage.getItem(DISPLAY_KEY) || '{}')
        setDisplay({ ...DEFAULT_DISPLAY, ...savedDisplay })
        const savedNotifications = JSON.parse(localStorage.getItem(notificationKey(session.user.id)) || '{}')
        const resolvedCategories = {
          ...DEFAULT_NOTIFICATION_CATEGORIES,
          ...(savedNotifications.categories || {}),
        }
        let remotePreferences = null
        if (data?.organization_id) {
          try { remotePreferences = await loadNotificationPreferences(session.user.id, data.organization_id) } catch {}
        }
        setNotifications({
          browser: remotePreferences?.browser_enabled ?? savedNotifications.browser ?? false,
          email: remotePreferences?.email_enabled ?? savedNotifications.email ?? false,
          categories: { ...resolvedCategories, ...(remotePreferences?.categories || {}) },
        })
      } catch {}
    }
    load()
  }, [])

  const signOut = async () => {
    await signOutAndRedirect()
  }

  const initials = (profile?.full_name || 'MGT').split(' ').filter(Boolean).slice(0, 2).map((x) => x[0]).join('').toUpperCase()

  const choosePhoto = () => {
    if (!fileRef.current || photoBusy) return
    fileRef.current.value = ''
    fileRef.current.click()
  }

  const savePhoto = async (file) => {
    if (!file || !userId) return
    setPhotoMessage('')
    if (!file.type.startsWith('image/')) return setPhotoMessage('Please choose an image file.')
    if (file.size > 15 * 1024 * 1024) return setPhotoMessage('That image is too large. Please choose one smaller than 15 MB.')

    setPhotoBusy(true)
    setPhotoMessage('Preparing photo...')
    try {
      const compressed = await compressProfilePhoto(file)
      localStorage.setItem(avatarStorageKey(userId), compressed)
      window.dispatchEvent(new CustomEvent('mgt-avatar-change', { detail: { userId } }))
      setPhotoMessage('Profile photo updated.')
    } catch (error) {
      setPhotoMessage(error?.message || 'Could not update the photo. Try another image.')
    } finally {
      setPhotoBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removePhoto = () => {
    if (!userId || photoBusy) return
    localStorage.removeItem(avatarStorageKey(userId))
    window.dispatchEvent(new CustomEvent('mgt-avatar-change', { detail: { userId } }))
    if (fileRef.current) fileRef.current.value = ''
    setPhotoMessage('Profile photo removed.')
  }

  const saveDisplay = (changes) => {
    const next = { ...display, ...changes }
    setDisplay(next)
    localStorage.setItem(DISPLAY_KEY, JSON.stringify(next))
    document.documentElement.dataset.density = next.density
    document.documentElement.dataset.motion = next.reducedMotion ? 'reduced' : 'normal'
    window.dispatchEvent(new CustomEvent('mgt-display-change', { detail: next }))
  }

  const saveNotifications = async (changes) => {
    const next = {
      ...notifications,
      ...changes,
      categories: { ...DEFAULT_NOTIFICATION_CATEGORIES, ...(notifications.categories || {}), ...(changes.categories || {}) },
    }
    setNotifications(next)
    if (userId) localStorage.setItem(notificationKey(userId), JSON.stringify(next))
    try {
      await saveNotificationPreferences({ browserEnabled: next.browser, emailEnabled: next.email, categories: next.categories })
      setNotificationStatus('Notification preferences saved.')
    } catch (error) {
      setNotificationStatus(error?.message || 'Preferences are saved on this device, but could not sync to your account.')
    }
  }

  const toggleNotificationCategory = (key, enabled) => {
    saveNotifications({ categories: { ...(notifications.categories || {}), [key]: enabled } })
  }

  const toggleBrowserNotifications = async (enabled) => {
    setNotificationStatus('')
    if (!enabled) {
      saveNotifications({ browser: false })
      return
    }
    if (!('Notification' in window)) {
      setNotificationStatus('This browser does not support notifications.')
      return
    }
    const permission = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission()
    if (permission === 'granted') {
      saveNotifications({ browser: true })
      setNotificationStatus('Browser notifications enabled on this device.')
    } else {
      saveNotifications({ browser: false })
      setNotificationStatus('Notification permission was not granted.')
    }
  }

  const testNotification = () => {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      setNotificationStatus('Enable browser notifications first.')
      return
    }
    new Notification('MGT Business Suite', {
      body: 'Notifications are working on this device.',
      icon: '/icon.svg',
    })
    setNotificationStatus('Test notification sent.')
  }

  const numberPreview = display.numberFormat === 'compact'
    ? new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(1250000)
    : new Intl.NumberFormat('en-US').format(1250000)

  const datePreview = display.dateFormat === 'mm/dd/yyyy' ? '09/26/2026' : '26/09/2026'

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Account</p>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your profile, appearance and account preferences.</p>
        </div>
      </div>

      <section className="settings-profile-card settings-profile-edit-card">
        <ProfileAvatar userId={userId} initials={initials} className="settings-profile-photo" />
        <div className="settings-profile-copy">
          <h2>{profile?.full_name || 'MGT Business Suite User'}</h2>
          <p>{profile?.role || 'staff'}</p>
          <div className="settings-photo-actions">
            <button type="button" onClick={choosePhoto} disabled={photoBusy} className="settings-photo-button disabled:opacity-60">{photoBusy ? 'Updating...' : 'Change photo'}</button>
            <button type="button" onClick={removePhoto} disabled={photoBusy} className="settings-photo-button settings-photo-button-subtle disabled:opacity-60">Remove</button>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => savePhoto(e.target.files?.[0])} />
          <small className="settings-photo-message">{photoMessage || 'Photos are automatically resized for your profile.'}</small>
        </div>
      </section>

      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="settings-appearance-card">
          <div><strong>Theme</strong><p>Choose how MGT Business Suite looks on this device.</p></div>
          <ThemePicker />
        </div>
      </section>

      <section className="settings-section">
        <h3>Preferences</h3>
        <div className="settings-list">
          <button type="button" className="settings-row" onClick={() => setOpenPanel(openPanel === 'notifications' ? null : 'notifications')}>
            <RowIcon>◎</RowIcon>
            <div><strong>Notifications</strong><p>Choose which alerts can notify you on this device</p></div>
            <span className="settings-chevron">{openPanel === 'notifications' ? '⌄' : '›'}</span>
          </button>
          {openPanel === 'notifications' && (
            <div className="preference-panel">
              <div className="preference-control"><div><strong>Browser notifications</strong><p>Allow MGT Business Suite to send device notifications while supported by your browser.</p></div><Toggle checked={notifications.browser} onChange={toggleBrowserNotifications} label="Browser notifications" /></div>
              <div className="preference-control"><div><strong>Email notifications</strong><p>Receive eligible MGT notifications at the email address on your staff account. Your business must also enable email delivery centrally.</p></div><Toggle checked={notifications.email} onChange={(v)=>saveNotifications({email:v})} label="Email notifications" /></div>
              {Object.entries(NOTIFICATION_CATEGORY_LABELS).map(([key,label])=><div key={key} className="preference-control"><div><strong>{label}</strong><p>{NOTIFICATION_DESCRIPTIONS[key]}</p></div><Toggle checked={notifications.categories?.[key]!==false} onChange={(v)=>toggleNotificationCategory(key,v)} label={label+' notifications'} /></div>)}
              <div className="preference-actions"><div className="flex flex-wrap gap-2"><button type="button" className="btn-secondary pref-button" onClick={testNotification}>Send test notification</button><Link href="/notifications" className="btn-secondary pref-button">Open notification center</Link></div><span>{notificationStatus}</span></div>
            </div>
          )}

          <button type="button" className="settings-row" onClick={() => setOpenPanel(openPanel === 'display' ? null : 'display')}>
            <RowIcon>▣</RowIcon>
            <div><strong>Display & data</strong><p>Layout density, motion and number/date display</p></div>
            <span className="settings-chevron">{openPanel === 'display' ? '⌄' : '›'}</span>
          </button>
          {openPanel === 'display' && (
            <div className="preference-panel">
              <div className="preference-control"><div><strong>Compact layout</strong><p>Show more information on screen with tighter spacing.</p></div><Toggle checked={display.density === 'compact'} onChange={(v) => saveDisplay({ density: v ? 'compact' : 'comfortable' })} label="Compact layout" /></div>
              <div className="preference-control"><div><strong>Reduced motion</strong><p>Minimize movement and transition effects across the app.</p></div><Toggle checked={display.reducedMotion} onChange={(v) => saveDisplay({ reducedMotion: v })} label="Reduced motion" /></div>
              <div className="preference-choice"><div><strong>Number display</strong><p>Preview: {numberPreview} UGX</p></div><select className="input-base pref-select" value={display.numberFormat} onChange={(e) => saveDisplay({ numberFormat: e.target.value })}><option value="full">1,250,000</option><option value="compact">1.3M</option></select></div>
              <div className="preference-choice"><div><strong>Date format</strong><p>Preview: {datePreview}</p></div><select className="input-base pref-select" value={display.dateFormat} onChange={(e) => saveDisplay({ dateFormat: e.target.value })}><option value="dd/mm/yyyy">DD/MM/YYYY</option><option value="mm/dd/yyyy">MM/DD/YYYY</option></select></div>
              <p className="preference-note">Layout and motion apply immediately. Number/date preferences are saved on this device for reports and formatted views that use the shared preference.</p>
            </div>
          )}

          <button type="button" className="settings-row" onClick={() => setOpenPanel(openPanel === 'help' ? null : 'help')}>
            <RowIcon>?</RowIcon>
            <div><strong>Help</strong><p>System guidance and common troubleshooting</p></div>
            <span className="settings-chevron">{openPanel === 'help' ? '⌄' : '›'}</span>
          </button>
          {openPanel === 'help' && (
            <div className="preference-panel help-panel">
              <details><summary>How do I record a normal sale?</summary><p>Open Point of Sale for fast checkout or Sales for account-based selling. Select the customer and items, confirm quantities and prices, then record full, partial or credit payment as appropriate.</p></details>
              <details><summary>How do I record work using customer-owned material?</summary><p>Create a Services / Jobs work order and add the labour or service charges. Customer-owned material should not reduce MGT inventory unless business-owned materials are also issued to the job.</p></details>
              <details><summary>What happens to cash that has not been banked?</summary><p>Cash remains in the relevant till or cash account until a deposit or other cash movement is recorded. Banking activity should be entered in Cash & Finance so the ledger reflects the real movement.</p></details>
              <details><summary>Who can see profits and business reports?</summary><p>Access is controlled by business roles and permissions. Owners and administrators have broad access, while other roles only see reporting areas explicitly granted to them.</p></details>
              <details><summary>What should I do if a transaction fails?</summary><p>Do not repeat the same action many times. Take a screenshot of the exact error and check whether stock, cash or the user record already changed before retrying.</p></details>
            </div>
          )}
        </div>
      </section>

      <section className="settings-section">
        <h3>Business documents</h3>
        <div className="settings-list">
          <Link href="/settings/documents" className="settings-row">
            <RowIcon>▤</RowIcon>
            <div><strong>Document profile</strong><p>Business logo, contacts, tax details, footer and standard terms</p></div>
            <span className="settings-chevron">›</span>
          </Link>
          <Link href="/documents" className="settings-row">
            <RowIcon>□</RowIcon>
            <div><strong>Document center</strong><p>Quotations, invoices, receipts, orders, statements and printable records</p></div>
            <span className="settings-chevron">›</span>
          </Link>
        </div>
      </section>

      <section className="settings-section">
        <h3>Account</h3>
        <div className="settings-list">
          <button type="button" onClick={signOut} className="settings-row settings-danger-row">
            <RowIcon>↗</RowIcon>
            <div><strong>Sign out</strong><p>Sign out of this device</p></div>
            <span className="settings-chevron">›</span>
          </button>
        </div>
      </section>

      <p className="settings-version">MGT Business Suite Management</p>
    </main>
  )
}

