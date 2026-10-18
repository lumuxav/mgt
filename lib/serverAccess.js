import crypto from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import { assertMgtSupabaseUrl } from './supabaseGuard'

const PRIVILEGED_ROLES = new Set(['owner', 'admin', 'super_admin', 'system_admin'])

export function getServerClients() {
  const url = assertMgtSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL)
  const publicKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY

  if (!publicKey || !serviceKey) {
    throw new Error('Server authentication is not fully configured.')
  }

  const authClient = createClient(url, publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const adminClient = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  return { url, authClient, adminClient }
}

export async function verifyOrganizationPermission(req, permission, moduleKey = null) {
  let clients
  try {
    clients = getServerClients()
  } catch (error) {
    return { error: error.message, status: 500 }
  }

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: 'No session token sent.', status: 401 }

  const { data: authData, error: authError } = await clients.authClient.auth.getUser(token)
  if (authError || !authData?.user) {
    return { error: 'Session expired — sign in again.', status: 401 }
  }

  const { data: caller, error: callerError } = await clients.adminClient
    .from('users')
    .select('id, organization_id, default_location_id, full_name, email, role, active, archived_at')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (callerError) return { error: callerError.message, status: 500 }
  if (!caller || caller.active === false || caller.archived_at) {
    return { error: 'This account is not active.', status: 403 }
  }
  if (!caller.organization_id) {
    return { error: 'Complete business setup before managing staff.', status: 409 }
  }

  const { data: organization, error: organizationError } = await clients.adminClient
    .from('organizations').select('active').eq('id', caller.organization_id).maybeSingle()
  if (organizationError) return { error: organizationError.message, status: 500 }
  if (organization?.active !== true) return { error: 'This business is not active.', status: 403 }

  if (!PRIVILEGED_ROLES.has(caller.role)) {
    const { data: role, error: roleError } = await clients.adminClient.from('roles')
      .select('active').eq('organization_id', caller.organization_id).eq('key', caller.role).maybeSingle()
    if (roleError) return { error: roleError.message, status: 500 }
    if (role?.active !== true) return { error: 'Your staff role is disabled.', status: 403 }
  }

  let allowed = PRIVILEGED_ROLES.has(caller.role)
  if (!allowed && permission) {
    // Additional job roles are strictly non-administrative keys, but they
    // contribute their explicit grants to the same server-side authorization.
    const { data: assignments, error: assignmentError } = await clients.adminClient
      .from('user_additional_roles')
      .select('role')
      .eq('organization_id', caller.organization_id)
      .eq('user_id', caller.id)
    if (assignmentError) return { error: assignmentError.message, status: 500 }
    const assigned = [...new Set((assignments || []).map(row => row.role))]
    let roles = [caller.role]
    if (assigned.length) {
      const { data: activeRoles, error: activeRolesError } = await clients.adminClient
        .from('roles').select('key')
        .eq('organization_id',caller.organization_id).eq('active',true).in('key',assigned)
      if (activeRolesError) return { error: activeRolesError.message, status: 500 }
      roles = [...roles,...(activeRoles||[]).map(row=>row.key)]
    }
    const { data: rules, error: ruleError } = await clients.adminClient
      .from('role_permissions').select('allowed')
      .eq('organization_id', caller.organization_id).in('role',roles)
      .eq('permission', permission).eq('allowed',true).limit(1)

    if (ruleError) return { error: ruleError.message, status: 500 }
    allowed = (rules||[]).length>0
  }

  if (!allowed) {
    return { error: 'You do not have permission to perform this action.', status: 403 }
  }

  if (moduleKey) {
    const { data: moduleRow, error: moduleError } = await clients.adminClient
      .from('organization_modules')
      .select('enabled')
      .eq('organization_id', caller.organization_id)
      .eq('module_key', moduleKey)
      .maybeSingle()

    if (moduleError) return { error: moduleError.message, status: 500 }
    if (moduleRow?.enabled !== true) {
      return { error: 'This module is disabled for the business.', status: 403 }
    }
  }

  return {
    ...clients,
    caller,
    authUser: authData.user,
    organizationId: caller.organization_id,
  }
}

export function canManageOwner(callerRole) {
  return ['owner', 'super_admin', 'system_admin'].includes(callerRole)
}


export function requestClientAddress(req) {
  const forwarded = String(req?.headers?.get('x-forwarded-for') || '').split(',')[0].trim()
  return forwarded || String(req?.headers?.get('x-real-ip') || '').trim() || 'unknown'
}

export async function consumeServerRateLimit(adminClient, { scope, key, limit, windowSeconds }) {
  const keyHash = crypto.createHash('sha256').update(String(key || '')).digest('hex')
  const { data, error } = await adminClient.rpc('server_consume_rate_limit', {
    p_scope: String(scope || ''),
    p_key_hash: keyHash,
    p_limit: Number(limit),
    p_window_seconds: Number(windowSeconds),
  })
  if (error) throw error
  return data || { allowed: false, remaining: 0, retry_after: windowSeconds }
}

