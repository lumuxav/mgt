import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

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

async function manageRole(req, action) {
  const check = await verifyOrganizationPermission(req, 'roles.manage')
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status })
  try {
    const body = await req.json()
    const key = slugRole(body.key || (action === 'create' ? body.name : ''))
    const changes = {}
    for (const field of ['name', 'description', 'active', 'permissions']) {
      if (body[field] !== undefined) changes[field] = body[field]
    }
    const { error } = await check.adminClient.rpc('server_manage_organization_role', {
      p_organization_id: check.organizationId,
      p_actor_id: check.caller.id,
      p_action: action,
      p_key: key,
      p_changes: changes,
    })
    if (error) throw error
    return NextResponse.json({ ok: true, ...(await loadBundle(check.adminClient, check.organizationId)) })
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Could not save role.' }, { status: 400 })
  }
}

export const POST = (req) => manageRole(req, 'create')
export const PATCH = (req) => manageRole(req, 'update')
export const DELETE = (req) => manageRole(req, 'delete')
