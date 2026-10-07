import { supabase } from './supabase'
import { normalizeBusinessConfig, saveBusinessConfig } from './platformConfig'

export async function getPlatformContext() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!session) return { session: null, user: null, organization: null, location: null }

  const { data: user, error: userError } = await supabase
    .from('users')
    .select('id, full_name, role, active, organization_id, default_location_id')
    .eq('id', session.user.id)
    .maybeSingle()

  if (userError) throw userError
  if (!user) return { session, user: null, organization: null, location: null }

  const [orgRes, locationRes] = await Promise.all([
    user.organization_id
      ? supabase.from('organizations').select('*').eq('id', user.organization_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    user.default_location_id
      ? supabase.from('locations').select('*').eq('id', user.default_location_id).maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ])

  if (orgRes.error) throw orgRes.error
  if (locationRes.error) throw locationRes.error

  return {
    session,
    user,
    organization: orgRes.data,
    location: locationRes.data,
  }
}

export function isUniversalSchemaMissing(error) {
  const message = String(error?.message || '')
  return (
    message.includes('does not exist') ||
    message.includes('Could not find the table') ||
    message.includes('schema cache')
  )
}

export async function listOrganizationRows(table, options = {}) {
  const { organization } = await getPlatformContext()
  if (!organization?.id) return { data: [], organization: null }

  let query = supabase.from(table).select(options.select || '*').eq('organization_id', organization.id)
  if (options.activeOnly) query = query.eq('active', true)
  if (options.orderBy) query = query.order(options.orderBy, { ascending: options.ascending !== false })
  if (options.limit) query = query.limit(options.limit)

  const { data, error } = await query
  if (error) throw error
  return { data: data || [], organization }
}

export async function createOrganizationRow(table, values) {
  const { session, user, organization, location } = await getPlatformContext()
  if (!session || !organization?.id) throw new Error('Business setup is not complete.')

  const payload = {
    ...values,
    organization_id: organization.id,
  }

  const { data, error } = await supabase.from(table).insert(payload).select().single()
  if (error) throw error
  return { data, context: { session, user, organization, location } }
}


export async function loadBusinessConfigFromDatabase() {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError) throw sessionError
  if (!session) return null

  const { data, error } = await supabase.rpc('get_my_business_configuration')
  if (error) throw error
  if (!data?.organization?.id) return null

  const locations = (data.locations || []).map((location) => ({
    id: location.id,
    name: location.name,
    type: location.type || 'branch',
    active: location.active !== false,
    code: location.code || null,
  }))

  const normalized = normalizeBusinessConfig({
    setupComplete: true,
    organizationId: data.organization.id,
    businessName: data.organization.name || 'My Business',
    shortName: data.organization.short_name || '',
    legalName: data.organization.legal_name || '',
    businessType: data.organization.business_type || 'hybrid',
    country: data.organization.country || 'Uganda',
    currency: data.organization.currency || 'UGX',
    timezone: data.organization.timezone || 'Africa/Kampala',
    defaultLocationId: data.default_location_id || locations[0]?.id || 'main',
    locations: locations.length ? locations : undefined,
    enabledModules: Array.isArray(data.enabled_modules) ? data.enabled_modules : [],
  })

  return saveBusinessConfig(normalized)
}
