import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

const SYSTEM_LOCKED = new Set(['owner', 'admin'])
const slugRole = (value) => String(value || '')
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, '_')
  .replace(/^_+|_+$/g, '')
  .slice(0, 48)

async function loadBundle(adminClient, organizationId) {
  const [rolesRes, permissionsRes, rulesRes] = await Promise.all([
    adminClient.from('roles').select('*').eq('organization_id', organizationId).order('is_system', { ascending: false }).order('name'),
    adminClient.from('permission_catalog').select('*').order('sort_order'),
    adminClient.from('role_permissions').select('role, permission, allowed').eq('organization_id', organizationId),
  ])

  for (const result of [rolesRes, permissionsRes, rulesRes]) {
    if (result.error) throw result.error
  }

  const permissionMap = {}
  for (const rule of rulesRes.data || []) {
    if (!permissionMap[rule.role]) permissionMap[rule.role] = []
    if (rule.allowed) permissionMap[rule.role].push(rule.permission)
  }

  return {
    roles: (rolesRes.data || []).map((role) => ({ ...role, permissions: permissionMap[role.key] || [] })),
    permissions: permissionsRes.data || [],
  }
}

export async function GET(req) {
  const check = await verifyOrganizationPermission(req, 'roles.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  try {
    return NextResponse.json({ ok: true, ...(await loadBundle(check.adminClient, check.organizationId)) })
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 400 })
  }
}

export async function POST(req) {
  const check = await verifyOrganizationPermission(req, 'roles.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check
  const body = await req.json()
  const name = String(body.name || '').trim()
  const key = slugRole(body.key || name)
  const description = String(body.description || '').trim() || null
  const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.map(String))] : []

  if (!name || !key) return NextResponse.json({ error: 'Role name is required.' }, { status: 400 })
  if (['owner','admin','super_admin','system_admin'].includes(key)) {
    return NextResponse.json({ error: 'That role key is reserved.' }, { status: 400 })
  }

  const { data: validPermissions, error: permissionError } = await adminClient
    .from('permission_catalog')
    .select('code')
    .in('code', permissions.length ? permissions : ['__none__'])

  if (permissionError) return NextResponse.json({ error: permissionError.message }, { status: 400 })
  if ((validPermissions || []).length !== permissions.length) {
    return NextResponse.json({ error: 'One or more permissions are invalid.' }, { status: 400 })
  }

  const { error: roleError } = await adminClient.from('roles').insert({
    organization_id: organizationId,
    key,
    name,
    description,
    is_system: false,
    active: true,
  })
  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 400 })

  if (permissions.length) {
    const { error: ruleError } = await adminClient.from('role_permissions').insert(
      permissions.map((permission) => ({
        organization_id: organizationId,
        role: key,
        permission,
        allowed: true,
      }))
    )
    if (ruleError) return NextResponse.json({ error: ruleError.message }, { status: 400 })
  }

  await adminClient.from('audit_log').insert({
    organization_id: organizationId,
    location_id: caller.default_location_id,
    user_id: caller.id,
    action: 'role_created',
    entity_type: 'role',
    entity_id: key,
    summary: `Role created: ${name}`,
    metadata: { permissions },
  })

  return NextResponse.json({ ok: true, ...(await loadBundle(adminClient, organizationId)) })
}

export async function PATCH(req) {
  const check = await verifyOrganizationPermission(req, 'roles.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check
  const body = await req.json()
  const key = slugRole(body.key)
  const permissions = Array.isArray(body.permissions) ? [...new Set(body.permissions.map(String))] : null

  const { data: role, error: roleReadError } = await adminClient
    .from('roles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('key', key)
    .maybeSingle()

  if (roleReadError) return NextResponse.json({ error: roleReadError.message }, { status: 400 })
  if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 })

  const changes = { updated_at: new Date().toISOString() }
  if (body.name !== undefined) changes.name = String(body.name || '').trim() || role.name
  if (body.description !== undefined) changes.description = String(body.description || '').trim() || null
  if (body.active !== undefined && !role.is_system) changes.active = Boolean(body.active)

  const { error: updateError } = await adminClient
    .from('roles')
    .update(changes)
    .eq('organization_id', organizationId)
    .eq('key', key)

  if (updateError) return NextResponse.json({ error: updateError.message }, { status: 400 })

  if (permissions) {
    if (SYSTEM_LOCKED.has(key)) {
      return NextResponse.json({ error: 'Owner and Administrator always retain full platform permissions.' }, { status: 400 })
    }

    const { data: validPermissions, error: permissionError } = await adminClient
      .from('permission_catalog')
      .select('code')
      .in('code', permissions.length ? permissions : ['__none__'])

    if (permissionError) return NextResponse.json({ error: permissionError.message }, { status: 400 })
    if ((validPermissions || []).length !== permissions.length) {
      return NextResponse.json({ error: 'One or more permissions are invalid.' }, { status: 400 })
    }

    const { error: clearError } = await adminClient
      .from('role_permissions')
      .delete()
      .eq('organization_id', organizationId)
      .eq('role', key)

    if (clearError) return NextResponse.json({ error: clearError.message }, { status: 400 })

    if (permissions.length) {
      const { error: insertError } = await adminClient.from('role_permissions').insert(
        permissions.map((permission) => ({
          organization_id: organizationId,
          role: key,
          permission,
          allowed: true,
        }))
      )
      if (insertError) return NextResponse.json({ error: insertError.message }, { status: 400 })
    }
  }

  await adminClient.from('audit_log').insert({
    organization_id: organizationId,
    location_id: caller.default_location_id,
    user_id: caller.id,
    action: 'role_updated',
    entity_type: 'role',
    entity_id: key,
    summary: `Role updated: ${changes.name || role.name}`,
    metadata: { permissions },
  })

  return NextResponse.json({ ok: true, ...(await loadBundle(adminClient, organizationId)) })
}

export async function DELETE(req) {
  const check = await verifyOrganizationPermission(req, 'roles.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })

  const { adminClient, organizationId, caller } = check
  const body = await req.json()
  const key = slugRole(body.key)

  const { data: role, error: roleError } = await adminClient
    .from('roles')
    .select('*')
    .eq('organization_id', organizationId)
    .eq('key', key)
    .maybeSingle()

  if (roleError) return NextResponse.json({ error: roleError.message }, { status: 400 })
  if (!role) return NextResponse.json({ error: 'Role not found.' }, { status: 404 })
  if (role.is_system) return NextResponse.json({ error: 'Built-in roles cannot be deleted.' }, { status: 400 })

  const { count, error: countError } = await adminClient
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', organizationId)
    .eq('role', key)
    .is('archived_at', null)

  if (countError) return NextResponse.json({ error: countError.message }, { status: 400 })
  if ((count || 0) > 0) return NextResponse.json({ error: 'Move staff out of this role before deleting it.' }, { status: 409 })

  await adminClient.from('role_permissions').delete().eq('organization_id', organizationId).eq('role', key)
  const { error: deleteError } = await adminClient.from('roles').delete().eq('organization_id', organizationId).eq('key', key)
  if (deleteError) return NextResponse.json({ error: deleteError.message }, { status: 400 })

  await adminClient.from('audit_log').insert({
    organization_id: organizationId,
    location_id: caller.default_location_id,
    user_id: caller.id,
    action: 'role_deleted',
    entity_type: 'role',
    entity_id: key,
    summary: `Role deleted: ${role.name}`,
  })

  return NextResponse.json({ ok: true, ...(await loadBundle(adminClient, organizationId)) })
}
