import { NextResponse } from 'next/server'
import { canManageOwner, consumeServerRateLimit, verifyOrganizationPermission } from '../../../../lib/serverAccess'

const cleanEmail = (value) => String(value || '').trim().toLowerCase()
const cleanText = (value) => String(value || '').trim()

async function loadRole(adminClient, organizationId, role) {
  const { data, error } = await adminClient
    .from('roles')
    .select('key, name, is_system, active')
    .eq('organization_id', organizationId)
    .eq('key', role)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

async function activeOwnerCount(adminClient, organizationId, excludeUserId = null) {
  let query = adminClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('role', 'owner')
    .eq('active', true)
    .is('archived_at', null)
  if (excludeUserId) query = query.neq('id', excludeUserId)
  const { count, error } = await query
  if (error) throw error
  return Number(count || 0)
}

async function loadLocation(adminClient, organizationId, id) {
  if (!id) return null
  const { data, error } = await adminClient
    .from('locations')
    .select('id, name, type, active')
    .eq('organization_id', organizationId)
    .eq('id', id)
    .eq('active', true)
    .maybeSingle()
  if (error) throw error
  return data
}

export async function GET(req) {
  const check = await verifyOrganizationPermission(req, 'users.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check

  const [profilesRes, authRes, rolesRes, locationsRes, invitationsRes] = await Promise.all([
    adminClient
      .from('users')
      .select('id, full_name, email, role, active, default_location_id, created_at, archived_at')
      .eq('organization_id', organizationId)
      .is('archived_at', null)
      .order('created_at', { ascending: true }),
    adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 }),
    adminClient
      .from('roles')
      .select('id, key, name, description, is_system, active')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('is_system', { ascending: false })
      .order('name'),
    adminClient
      .from('locations')
      .select('id, name, type, active')
      .eq('organization_id', organizationId)
      .eq('active', true)
      .order('name'),
    adminClient
      .from('staff_invitations')
      .select('id, email, full_name, role, default_location_id, auth_user_id, status, invited_at, accepted_at')
      .eq('organization_id', organizationId)
      .eq('status', 'pending')
      .order('invited_at', { ascending: false }),
  ])

  for (const result of [profilesRes, authRes, rolesRes, locationsRes, invitationsRes]) {
    if (result.error) return NextResponse.json({ error: result.error.message }, { status: 400 })
  }

  const authMap = Object.fromEntries((authRes.data?.users || []).map((user) => [user.id, user]))
  const users = (profilesRes.data || []).map((profile) => {
    const auth = authMap[profile.id]
    return {
      ...profile,
      email: profile.email || auth?.email || null,
      auth_created_at: auth?.created_at || profile.created_at || null,
      last_sign_in_at: auth?.last_sign_in_at || null,
      email_confirmed_at: auth?.email_confirmed_at || null,
      invited_at: auth?.invited_at || null,
    }
  })

  return NextResponse.json({
    ok: true,
    caller,
    users,
    roles: rolesRes.data || [],
    locations: locationsRes.data || [],
    invitations: invitationsRes.data || [],
  })
}

export async function POST(req) {
  const check = await verifyOrganizationPermission(req, 'users.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check

  const rate = await consumeServerRateLimit(adminClient, {
    scope: 'staff_invite',
    key: organizationId + '|' + caller.id,
    limit: 20,
    windowSeconds: 3600,
  })
  if (!rate.allowed) {
    return NextResponse.json(
      { error: 'Too many staff invitations were attempted. Please wait before sending more.' },
      { status: 429, headers: { 'Retry-After': String(rate.retry_after || 300) } }
    )
  }

  const body = await req.json()

  const email = cleanEmail(body.email)
  const fullName = cleanText(body.full_name)
  const role = cleanText(body.role) || 'employee'
  const defaultLocationId = body.default_location_id || null

  if (!email || !email.includes('@') || !fullName) {
    return NextResponse.json({ error: 'A valid email address and full name are required.' }, { status: 400 })
  }

  try {
    const roleDef = await loadRole(adminClient, organizationId, role)
    if (!roleDef) return NextResponse.json({ error: 'Choose a valid active role.' }, { status: 400 })

    if (role === 'owner' && !canManageOwner(caller.role)) {
      return NextResponse.json({ error: 'Only an Owner can invite another Owner.' }, { status: 403 })
    }

    const location = await loadLocation(adminClient, organizationId, defaultLocationId)
    if (defaultLocationId && !location) {
      return NextResponse.json({ error: 'Choose a valid business location.' }, { status: 400 })
    }

    const { data: existingProfile, error: existingProfileError } = await adminClient
      .from('users')
      .select('id, active, archived_at')
      .eq('organization_id', organizationId)
      .ilike('email', email)
      .maybeSingle()

    if (existingProfileError) throw existingProfileError
    if (existingProfile) {
      return NextResponse.json({ error: 'A staff account with this email already exists in this business.' }, { status: 409 })
    }

    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin
    const redirectTo = `${baseUrl.replace(/\/$/, '')}/accept-invite`

    const { data: inviteData, error: inviteError } = await adminClient.auth.admin.inviteUserByEmail(email, {
      redirectTo,
      data: {
        full_name: fullName,
        organization_id: organizationId,
        default_location_id: defaultLocationId,
        role,
        mgt_invited: true,
      },
    })

    if (inviteError) return NextResponse.json({ error: inviteError.message }, { status: 400 })
    if (!inviteData?.user?.id) return NextResponse.json({ error: 'Supabase did not return an invited user account.' }, { status: 500 })

    const userId = inviteData.user.id

    const { error: profileError } = await adminClient
      .from('users')
      .upsert({
        id: userId,
        organization_id: organizationId,
        default_location_id: defaultLocationId,
        full_name: fullName,
        email,
        role,
        active: true,
        archived_at: null,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'id' })

    if (profileError) {
      await adminClient.auth.admin.updateUserById(userId, { ban_duration: '876000h' })
      return NextResponse.json({ error: `Invitation account was created but the MGT profile could not be saved: ${profileError.message}` }, { status: 500 })
    }

    await adminClient
      .from('staff_invitations')
      .update({ status: 'revoked', revoked_at: new Date().toISOString() })
      .eq('organization_id', organizationId)
      .eq('email', email)
      .eq('status', 'pending')

    const { error: invitationError } = await adminClient
      .from('staff_invitations')
      .insert({
        organization_id: organizationId,
        email,
        full_name: fullName,
        role,
        default_location_id: defaultLocationId,
        auth_user_id: userId,
        invited_by: caller.id,
        status: 'pending',
      })

    if (invitationError) return NextResponse.json({ error: invitationError.message }, { status: 500 })

    await adminClient.from('audit_log').insert({
      organization_id: organizationId,
      location_id: caller.default_location_id,
      user_id: caller.id,
      action: 'staff_invited',
      entity_type: 'user',
      entity_id: userId,
      summary: `${fullName} invited as ${role}`,
      metadata: { email, role, default_location_id: defaultLocationId },
    })

    return NextResponse.json({ ok: true, user_id: userId })
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not invite staff member.' }, { status: 500 })
  }
}

export async function PATCH(req) {
  const check = await verifyOrganizationPermission(req, 'users.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check
  const body = await req.json()
  const userId = body.user_id
  if (body.active !== undefined && typeof body.active !== 'boolean') return NextResponse.json({ error: 'active must be true or false.' }, { status: 400 })

  if (!userId) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })

  const { data: target, error: targetError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, active, default_location_id, archived_at')
    .eq('organization_id', organizationId)
    .eq('id', userId)
    .maybeSingle()

  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 400 })
  if (!target || target.archived_at) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 })

  if (userId === caller.id && (body.role !== undefined || body.active === false)) {
    return NextResponse.json({ error: 'You cannot remove your own role or disable your own account.' }, { status: 400 })
  }

  if (target.role === 'owner' && !canManageOwner(caller.role)) {
    return NextResponse.json({ error: 'Only an Owner can modify another Owner account.' }, { status: 403 })
  }

  const changes = { updated_at: new Date().toISOString() }

  const willRemoveOwner = target.role === 'owner' && (
    (body.role !== undefined && cleanText(body.role) !== 'owner')
    || body.active === false
  )
  if (willRemoveOwner && await activeOwnerCount(adminClient, organizationId, target.id) === 0) {
    return NextResponse.json({ error: 'The last active Owner cannot be disabled or demoted.' }, { status: 400 })
  }

  if (body.role !== undefined) {
    const role = cleanText(body.role)
    const roleDef = await loadRole(adminClient, organizationId, role)
    if (!roleDef) return NextResponse.json({ error: 'Choose a valid active role.' }, { status: 400 })
    if (role === 'owner' && !canManageOwner(caller.role)) {
      return NextResponse.json({ error: 'Only an Owner can assign the Owner role.' }, { status: 403 })
    }
    changes.role = role
  }

  if (body.default_location_id !== undefined) {
    const locationId = body.default_location_id || null
    const location = await loadLocation(adminClient, organizationId, locationId)
    if (locationId && !location) return NextResponse.json({ error: 'Choose a valid business location.' }, { status: 400 })
    changes.default_location_id = locationId
  }

  if (body.active !== undefined) changes.active = body.active

  const { error: updateError } = await adminClient.from('users').update(changes).eq('id', userId)
  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })

  let authSyncError = false
  if (body.active !== undefined) {
    const { error: authAccessError } = await adminClient.auth.admin.updateUserById(userId, { ban_duration: body.active ? 'none' : '876000h' })
    authSyncError = Boolean(authAccessError)
  }

  await adminClient.from('audit_log').insert({
    organization_id: organizationId,
    location_id: caller.default_location_id,
    user_id: caller.id,
    action: 'staff_access_updated',
    entity_type: 'user',
    entity_id: userId,
    summary: `${target.full_name} access updated`,
    metadata: changes,
  })

  if (authSyncError) return NextResponse.json({ error: 'Staff profile saved, but sign-in access could not be synchronized. Retry this update.', profile_saved: true }, { status: 502 })
  return NextResponse.json({ ok: true })
}

export async function DELETE(req) {
  const check = await verifyOrganizationPermission(req, 'users.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check
  const { user_id: userId } = await req.json()

  if (!userId) return NextResponse.json({ error: 'User ID is required.' }, { status: 400 })
  if (userId === caller.id) return NextResponse.json({ error: 'You cannot archive your own account.' }, { status: 400 })

  const { data: target, error: targetError } = await adminClient
    .from('users')
    .select('id, full_name, email, role, active, archived_at')
    .eq('organization_id', organizationId)
    .eq('id', userId)
    .maybeSingle()

  if (targetError) return NextResponse.json({ error: targetError.message }, { status: 400 })
  if (!target || target.archived_at) return NextResponse.json({ error: 'Staff account not found.' }, { status: 404 })
  if (target.role === 'owner' && await activeOwnerCount(adminClient, organizationId, target.id) === 0) {
    return NextResponse.json({ error: 'The last active Owner cannot be archived.' }, { status: 400 })
  }
  if (target.role === 'owner' && !canManageOwner(caller.role)) {
    return NextResponse.json({ error: 'Only an Owner can archive another Owner account.' }, { status: 403 })
  }

  const { data: authData } = await adminClient.auth.admin.getUserById(userId)
  const metadata = authData?.user?.user_metadata || {}
  const archivedAt = new Date().toISOString()

  const { error: profileError } = await adminClient
    .from('users')
    .update({ active: false, archived_at: archivedAt, updated_at: archivedAt })
    .eq('id', userId)

  if (profileError) return NextResponse.json({ error: profileError.message }, { status: 500 })

  const { error: authError } = await adminClient.auth.admin.updateUserById(userId, {
    ban_duration: '876000h',
    user_metadata: {
      ...metadata,
      mgt_deleted: true,
      mgt_deleted_at: archivedAt,
    },
  })

  await adminClient
    .from('staff_invitations')
    .update({ status: 'revoked', revoked_at: archivedAt })
    .eq('organization_id', organizationId)
    .eq('auth_user_id', userId)
    .eq('status', 'pending')

  await adminClient.from('audit_log').insert({
    organization_id: organizationId,
    location_id: caller.default_location_id,
    user_id: caller.id,
    action: 'staff_archived',
    entity_type: 'user',
    entity_id: userId,
    summary: `${target.full_name} archived`,
    metadata: { email: target.email, role: target.role },
  })

  return NextResponse.json({ ok: true, ...(authError ? { warning: 'Staff access is disabled. The authentication ban could not be synchronized.' } : {}) })
}
