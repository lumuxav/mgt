'use client'

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '../../lib/supabase'
import {
  BUSINESS_TEMPLATES,
  CURRENCIES,
  DEFAULT_BUSINESS_CONFIG,
  LOCATION_TYPES,
  MODULE_CATALOG,
  getBusinessConfig,
  normalizeBusinessConfig,
  saveBusinessConfig,
  templateConfig,
} from '../../lib/platformConfig'
import { invalidatePlatformContext, loadBusinessConfigFromDatabase } from '../../lib/platformDb'
import { isSavedLocation, matchSetupLocation } from '../../lib/setupLocations'

const slug = () => Math.random().toString(36).slice(2, 8)

export default function BusinessSetupPage() {
  const router = useRouter()
  const [step, setStep] = useState(1)
  const [config, setConfig] = useState(DEFAULT_BUSINESS_CONFIG)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [backendStatus, setBackendStatus] = useState('')

  useEffect(() => {
    let mounted = true
    const hydrate = async () => {
      const cached = getBusinessConfig()
      if (mounted) setConfig(cached)
      try {
        const databaseConfig = await loadBusinessConfigFromDatabase()
        if (mounted && databaseConfig) setConfig(databaseConfig)
      } catch {}
    }
    hydrate()
    return () => { mounted = false }
  }, [])

  const selectedTemplate = BUSINESS_TEMPLATES[config.businessType] || BUSINESS_TEMPLATES.hybrid
  const modules = useMemo(() => new Set(config.enabledModules || []), [config.enabledModules])

  const update = (changes) => {
    setSaved(false)
    setConfig((current) => ({ ...current, ...changes }))
  }

  const chooseTemplate = (type) => {
    setSaved(false)
    setConfig((current) => templateConfig(type, current))
  }

  const toggleModule = (id) => {
    const definition = MODULE_CATALOG.find((item) => item.id === id)
    if (definition?.core) return
    const next = new Set(config.enabledModules || [])
    if (next.has(id)) next.delete(id)
    else next.add(id)
    update({ enabledModules: [...next] })
  }

  const addLocation = () => {
    update({
      locations: [
        ...(config.locations || []),
        { id: slug(), name: 'New Location', type: 'branch', active: true },
      ],
    })
  }

  const updateLocation = (id, changes) => {
    const locations = config.locations.map((location) => location.id === id ? { ...location, ...changes } : location)
    update({
      locations,
      defaultLocationId: locations.find(item => item.id === config.defaultLocationId && item.active !== false)?.id || locations.find(item => item.active !== false)?.id,
    })
  }

  const removeLocation = (id) => {
    if (config.locations.filter(item => item.active !== false).length <= 1) return
    if (isSavedLocation(config.locations.find(item => item.id === id))) {
      updateLocation(id, { active: false })
      return
    }
    const locations = config.locations.filter((location) => location.id !== id)
    update({
      locations,
      defaultLocationId: config.defaultLocationId === id ? locations.find(item => item.active !== false).id : config.defaultLocationId,
    })
  }

  const finish = async () => {
    setSaving(true)
    setBackendStatus('')
    const businessName = config.businessName.trim() || 'My Business'
    const initials = businessName.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]).join('').toUpperCase() || 'MB'
    const normalized = normalizeBusinessConfig({
      ...config,
      businessName,
      shortName: config.shortName.trim().toUpperCase() || initials,
      setupComplete: true,
    })

    try {
      if (!normalized.locations.some(item => item.active !== false)) throw new Error('Keep at least one active location.')
      const names = normalized.locations.map(item => item.name.trim().toLowerCase())
      if (names.some(name => !name) || new Set(names).size !== names.length) throw new Error('Give each location a unique, non-empty name.')
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) {
        const cached = saveBusinessConfig(normalized)
        setConfig(cached)
        setSaved(true)
        setBackendStatus('Saved on this device. Sign in to store this configuration centrally for the business.')
        return
      }

      const profileResult = await supabase
        .from('users')
        .select('organization_id')
        .eq('id', session.user.id)
        .maybeSingle()

      if (profileResult.error) throw profileResult.error

      const preferred = normalized.locations.find((item) => item.id === normalized.defaultLocationId) || normalized.locations[0]
      let organizationId = profileResult.data?.organization_id || null

      if (!organizationId) {
        const { data: bootstrapped, error: bootstrapError } = await supabase.rpc('bootstrap_organization', {
          business_name: normalized.businessName,
          business_type: normalized.businessType,
          currency_code: normalized.currency,
          country_name: normalized.country,
          timezone_name: normalized.timezone,
          short_code: normalized.shortName,
          location_name: preferred?.name || 'Main Location',
          location_type: preferred?.type || 'branch',
        })
        if (bootstrapError) throw bootstrapError
        organizationId = bootstrapped
      }

      const { error: orgError } = await supabase
        .from('organizations')
        .update({
          name: normalized.businessName,
          short_name: normalized.shortName,
          legal_name: normalized.legalName || null,
          business_type: normalized.businessType,
          country: normalized.country,
          currency: normalized.currency,
          timezone: normalized.timezone,
          updated_at: new Date().toISOString(),
        })
        .eq('id', organizationId)
      if (orgError) throw orgError

      const { data: existingLocations, error: locationReadError } = await supabase
        .from('locations')
        .select('id, name, type')
        .eq('organization_id', organizationId)
      if (locationReadError) throw locationReadError

      const resolvedLocations = []
      for (const location of normalized.locations) {
        const match = matchSetupLocation(existingLocations || [], location)
        if (match) {
          const { data, error } = await supabase
            .from('locations')
            .update({ name: location.name.trim(), type: location.type, active: location.active !== false })
            .eq('id', match.id)
            .eq('organization_id', organizationId)
            .select('id, name, type')
            .single()
          if (error) throw error
          resolvedLocations.push({ ...location, databaseId: data.id })
        } else {
          const { data, error } = await supabase
            .from('locations')
            .insert({
              organization_id: organizationId,
              name: location.name.trim() || 'Location',
              type: location.type,
              active: location.active !== false,
            })
            .select('id, name, type')
            .single()
          if (error) throw error
          resolvedLocations.push({ ...location, databaseId: data.id })
        }
      }

      const preferredResolved = resolvedLocations.find((item) => item.id === normalized.defaultLocationId) || resolvedLocations[0]
      if (preferredResolved?.databaseId) {
        const { error } = await supabase
          .from('users')
          .update({ default_location_id: preferredResolved.databaseId, updated_at: new Date().toISOString() })
          .eq('id', session.user.id)
        if (error) throw error
      }

      const { error: moduleError } = await supabase.rpc('save_organization_modules', {
        p_enabled_modules: normalized.enabledModules,
      })
      if (moduleError) throw moduleError

      invalidatePlatformContext()
      const authoritative = await loadBusinessConfigFromDatabase()
      const resolved = authoritative || saveBusinessConfig(normalized)
      setConfig(resolved)
      setSaved(true)
      setBackendStatus('Business setup saved centrally. Module choices will now follow this business across devices.')
    } catch (error) {
      setSaved(false)
      setBackendStatus(`Could not save the business configuration: ${error?.message || 'unknown error'}`)
    } finally {
      setSaving(false)
    }
  }

  return (
    <main className="page-wrap setup-page mgt-standalone-safe-page">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Platform setup</p>
          <h1 className="page-title">Configure your business</h1>
          <p className="page-subtitle">Turn MGT into the system your business actually needs. These settings can be changed later.</p>
        </div>
        <button type="button" onClick={() => router.push('/')} className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Close</button>
      </div>

      <div className="setup-progress" aria-label="Setup progress">
        {[1, 2, 3, 4].map((item) => (
          <button key={item} type="button" onClick={() => setStep(item)} className={`setup-progress-step ${step === item ? 'active' : ''} ${step > item ? 'done' : ''}`}>
            <span>{step > item ? '✓' : item}</span>
            <small>{['Business', 'Locations', 'Modules', 'Review'][item - 1]}</small>
          </button>
        ))}
      </div>

      {step === 1 && (
        <section className="page-card setup-card">
          <div className="setup-section-heading">
            <div>
              <p className="page-eyebrow">Step 1</p>
              <h2>What kind of business is this?</h2>
              <p>Choose a starting template. It only selects sensible defaults; you can customize everything.</p>
            </div>
          </div>

          <div className="setup-template-grid">
            {Object.entries(BUSINESS_TEMPLATES).map(([id, template]) => (
              <button key={id} type="button" onClick={() => chooseTemplate(id)} className={`setup-template ${config.businessType === id ? 'active' : ''}`}>
                <strong>{template.label}</strong>
                <span>{template.description}</span>
              </button>
            ))}
          </div>

          <div className="setup-form-grid">
            <label><span>Business name</span><input className="input-base" value={config.businessName} onChange={(e) => update({ businessName: e.target.value })} placeholder="e.g. Acme Traders Ltd" /></label>
            <label><span>Short name / mark</span><input className="input-base" maxLength={4} value={config.shortName} onChange={(e) => update({ shortName: e.target.value.toUpperCase() })} placeholder="e.g. AT" /></label>
            <label><span>Legal name (optional)</span><input className="input-base" value={config.legalName} onChange={(e) => update({ legalName: e.target.value })} placeholder="Registered company name" /></label>
            <label><span>Country</span><input className="input-base" value={config.country} onChange={(e) => update({ country: e.target.value })} /></label>
            <label><span>Currency</span><select className="input-base" value={config.currency} onChange={(e) => update({ currency: e.target.value })}>{CURRENCIES.map((item) => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
            <label><span>Timezone</span><input className="input-base" value={config.timezone} onChange={(e) => update({ timezone: e.target.value })} placeholder="Africa/Kampala" /></label>
          </div>
        </section>
      )}

      {step === 2 && (
        <section className="page-card setup-card">
          <div className="setup-section-heading">
            <div>
              <p className="page-eyebrow">Step 2</p>
              <h2>Where does the business operate?</h2>
              <p>Use one location for a single-site business, or add branches, warehouses, factories, outlets and offices.</p>
            </div>
            <button type="button" onClick={addLocation} className="btn-primary rounded-xl px-4 py-2 text-sm font-bold">+ Add location</button>
          </div>

          <div className="setup-location-list">
            {config.locations.map((location) => (
              <div className="setup-location-card" key={location.id}>
                <div className="setup-location-fields">
                  <label><span>Location name</span><input className="input-base" value={location.name} onChange={(e) => updateLocation(location.id, { name: e.target.value })} /></label>
                  <label><span>Type</span><select className="input-base" value={location.type} onChange={(e) => updateLocation(location.id, { type: e.target.value })}>{LOCATION_TYPES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
                </div>
                <div className="setup-location-actions">
                  <label className="setup-radio"><input type="radio" name="default-location" disabled={location.active === false} checked={config.defaultLocationId === location.id} onChange={() => update({ defaultLocationId: location.id })} /> Default location</label>
                  {location.active === false ? <button type="button" onClick={() => updateLocation(location.id, { active: true })} className="setup-remove">Reactivate</button> : <button type="button" onClick={() => removeLocation(location.id)} disabled={config.locations.filter(item => item.active !== false).length <= 1} className="setup-remove">{isSavedLocation(location) ? 'Deactivate' : 'Remove'}</button>}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="page-card setup-card">
          <div className="setup-section-heading">
            <div>
              <p className="page-eyebrow">Step 3</p>
              <h2>Choose the modules you need</h2>
              <p>{selectedTemplate.label} defaults are selected. Core controls stay enabled for accountability and administration.</p>
            </div>
          </div>

          <div className="setup-module-grid">
            {MODULE_CATALOG.map((module) => {
              const enabled = modules.has(module.id)
              return (
                <button key={module.id} type="button" onClick={() => toggleModule(module.id)} className={`setup-module ${enabled ? 'enabled' : ''}`}>
                  <span className="setup-module-check">{enabled ? '✓' : '+'}</span>
                  <div><strong>{module.label}</strong><p>{module.description}</p>{module.core && <small>Core module</small>}</div>
                </button>
              )
            })}
          </div>
        </section>
      )}

      {step === 4 && (
        <section className="page-card setup-card">
          <div className="setup-section-heading">
            <div>
              <p className="page-eyebrow">Step 4</p>
              <h2>Review the business workspace</h2>
              <p>MGT will use this configuration to decide what the team sees and how the workspace is organized.</p>
            </div>
          </div>

          <div className="setup-review-grid">
            <div><span>Business</span><strong>{config.businessName || 'My Business'}</strong><small>{selectedTemplate.label}</small></div>
            <div><span>Currency</span><strong>{config.currency}</strong><small>{config.country}</small></div>
            <div><span>Locations</span><strong>{config.locations.length}</strong><small>{config.locations.map((item) => item.name).join(', ')}</small></div>
            <div><span>Modules</span><strong>{config.enabledModules.length}</strong><small>{MODULE_CATALOG.filter((item) => modules.has(item.id)).map((item) => item.label).join(', ')}</small></div>
          </div>

          <div className="setup-future-note">
            <strong>Your business, connected</strong>
            <p>Save your business details, locations and modules to make them available to your team across devices.</p>
          </div>

          <button type="button" onClick={finish} disabled={saving} className="btn-primary mt-5 w-full rounded-xl px-5 py-3.5 font-black disabled:opacity-60">{saving ? 'Saving...' : saved ? 'Configuration saved ✓' : 'Save business configuration'}</button>{backendStatus && <p className="mt-3 text-center text-xs text-muted">{backendStatus}</p>}
          {saved && <button type="button" onClick={() => router.push('/')} className="btn-secondary mt-3 w-full rounded-xl px-5 py-3 font-bold">Open dashboard</button>}
        </section>
      )}

      <div className="setup-footer-actions">
        <button type="button" onClick={() => setStep((value) => Math.max(1, value - 1))} disabled={step === 1} className="btn-secondary rounded-xl px-4 py-2 font-bold disabled:opacity-40">Back</button>
        {step < 4 && <button type="button" onClick={() => setStep((value) => Math.min(4, value + 1))} className="btn-primary rounded-xl px-5 py-2 font-bold">Continue</button>}
      </div>
    </main>
  )
}

