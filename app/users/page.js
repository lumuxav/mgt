'use client'

import { useEffect, useMemo, useState } from 'react'
import { adminApi } from '../../lib/adminApi'

const prettyDate = (value) => value ? new Date(value).toLocaleString() : 'Never'
const prettyRole = (key, roles) => roles.find((role) => role.key === key)?.name || String(key || 'Employee').replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export default function UsersPage() {
  const [tab, setTab] = useState('staff')
  const [caller, setCaller] = useState(null)
  const [users, setUsers] = useState([])
  const [roles, setRoles] = useState([])
  const [locations, setLocations] = useState([])
  const [invitations, setInvitations] = useState([])
  const [permissions, setPermissions] = useState([])
  const [roleBundle, setRoleBundle] = useState([])
  const [selectedRoleKey, setSelectedRoleKey] = useState('')
  const [roleDraft, setRoleDraft] = useState([])
  const [canManageRoles, setCanManageRoles] = useState(true)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [rowMessages, setRowMessages] = useState({})
  const [invite, setInvite] = useState({ full_name: '', email: '', role: 'employee', default_location_id: '' })
  const [newRole, setNewRole] = useState({ name: '', description: '' })

  const callUsers = (method = 'GET', body) => adminApi('/api/admin/users', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  })

  const callRoles = (method = 'GET', body) => adminApi('/api/admin/roles', {
    method,
    body: body ? JSON.stringify(body) : undefined,
  })

  const load = async () => {
    setLoading(true)
    setMessage(null)

    const usersResult = await callUsers('GET')
    if (!usersResult.ok) {
      setMessage({ type: 'error', text: usersResult.error || 'Could not load staff access.' })
      setLoading(false)
      return
    }

    setCaller(usersResult.caller)
    setUsers(usersResult.users || [])
    setRoles(usersResult.roles || [])
    setLocations(usersResult.locations || [])
    setInvitations(usersResult.invitations || [])

    const rolesResult = await callRoles('GET')
    if (rolesResult.ok) {
      setCanManageRoles(true)
      setRoleBundle(rolesResult.roles || [])
      setPermissions(rolesResult.permissions || [])
      const firstEditable = (rolesResult.roles || []).find((role) => !['owner', 'admin'].includes(role.key)) || rolesResult.roles?.[0]
      if (firstEditable) {
        setSelectedRoleKey((current) => current || firstEditable.key)
        if (!selectedRoleKey) setRoleDraft(firstEditable.permissions || [])
      }
    } else {
      setCanManageRoles(false)
    }

    setLoading(false)
  }

  useEffect(() => { load() }, [])

  useEffect(() => {
    const selected = roleBundle.find((role) => role.key === selectedRoleKey)
    if (selected) setRoleDraft(selected.permissions || [])
  }, [selectedRoleKey, roleBundle])

  const inviteStaff = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const result = await callUsers('POST', invite)
    if (result.ok) {
      setMessage({ type: 'success', text: `Invitation sent to ${invite.email}.` })
      setInvite({ full_name: '', email: '', role: 'employee', default_location_id: '' })
      await load()
    } else {
      setMessage({ type: 'error', text: result.error || 'Could not send invitation.' })
    }
    setBusy(false)
  }

  const updateUser = async (user, changes) => {
    setRowMessages((current) => ({ ...current, [user.id]: null }))
    const result = await callUsers('PATCH', { user_id: user.id, ...changes })
    if (result.ok) {
      setRowMessages((current) => ({ ...current, [user.id]: { type: 'success', text: 'Access updated.' } }))
      await load()
    } else {
      setRowMessages((current) => ({ ...current, [user.id]: { type: 'error', text: result.error || 'Could not update access.' } }))
    }
  }

  const archiveUser = async (user) => {
    if (!window.confirm(`Archive ${user.full_name}?\n\nTheir login will be disabled immediately. Historical business records will remain traceable.`)) return
    const result = await callUsers('DELETE', { user_id: user.id })
    if (result.ok) {
      setMessage({ type: 'success', text: `${user.full_name} was archived and can no longer sign in.` })
      await load()
    } else {
      setRowMessages((current) => ({ ...current, [user.id]: { type: 'error', text: result.error || 'Could not archive account.' } }))
    }
  }

  const createRole = async (event) => {
    event.preventDefault()
    if (!newRole.name.trim()) return
    setBusy(true)
    const result = await callRoles('POST', { ...newRole, permissions: [] })
    if (result.ok) {
      setRoleBundle(result.roles || [])
      setPermissions(result.permissions || [])
      const created = (result.roles || []).find((role) => role.name === newRole.name.trim())
      if (created) setSelectedRoleKey(created.key)
      setNewRole({ name: '', description: '' })
      setMessage({ type: 'success', text: 'Custom role created. Now choose its permissions.' })
    } else {
      setMessage({ type: 'error', text: result.error || 'Could not create role.' })
    }
    setBusy(false)
  }

  const togglePermission = (code) => {
    setRoleDraft((current) => current.includes(code)
      ? current.filter((item) => item !== code)
      : [...current, code])
  }

  const saveRolePermissions = async () => {
    const selected = roleBundle.find((role) => role.key === selectedRoleKey)
    if (!selected || ['owner', 'admin'].includes(selected.key)) return
    setBusy(true)
    const result = await callRoles('PATCH', { key: selected.key, permissions: roleDraft })
    if (result.ok) {
      setRoleBundle(result.roles || [])
      setPermissions(result.permissions || [])
      setMessage({ type: 'success', text: `${selected.name} permissions updated.` })
    } else {
      setMessage({ type: 'error', text: result.error || 'Could not update permissions.' })
    }
    setBusy(false)
  }

  const deleteRole = async (role) => {
    if (role.is_system) return
    if (!window.confirm(`Delete the role "${role.name}"? Staff must be moved to another role first.`)) return
    const result = await callRoles('DELETE', { key: role.key })
    if (result.ok) {
      setRoleBundle(result.roles || [])
      setPermissions(result.permissions || [])
      setSelectedRoleKey(result.roles?.[0]?.key || '')
      setMessage({ type: 'success', text: 'Role deleted.' })
    } else {
      setMessage({ type: 'error', text: result.error || 'Could not delete role.' })
    }
  }

  const groupedPermissions = useMemo(() => {
    return permissions.reduce((groups, permission) => {
      if (!groups[permission.section]) groups[permission.section] = []
      groups[permission.section].push(permission)
      return groups
    }, {})
  }, [permissions])

  const activeCount = users.filter((user) => user.active !== false).length
  const pendingCount = invitations.length
  const selectedRole = roleBundle.find((role) => role.key === selectedRoleKey)
  const callerCanAssignOwner = ['owner', 'super_admin', 'system_admin'].includes(caller?.role)

  if (loading) return <main className="page-wrap text-muted">Loading staff access...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Administration</p>
          <h1 className="page-title">Staff & Access</h1>
          <p className="page-subtitle">Invite staff, assign business roles, control locations and manage exactly what each role can do.</p>
        </div>
      </div>

      {message && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>
          {message.text}
        </div>
      )}

      <div className="mb-5 flex gap-2 rounded-2xl bg-[var(--panel-2)] p-1">
        <button type="button" onClick={() => setTab('staff')} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-black ${tab === 'staff' ? 'bg-[var(--panel)] text-accent shadow-sm' : 'text-muted'}`}>Staff</button>
        <button type="button" disabled={!canManageRoles} onClick={() => setTab('roles')} className={`flex-1 rounded-xl px-4 py-2.5 text-sm font-black disabled:opacity-40 ${tab === 'roles' ? 'bg-[var(--panel)] text-accent shadow-sm' : 'text-muted'}`}>Roles & Permissions</button>
      </div>

      {tab === 'staff' && (
        <>
          <section className="mb-6 grid gap-3 sm:grid-cols-3">
            <div className="page-card p-4"><p className="text-sm text-muted">Staff accounts</p><p className="mt-2 text-2xl font-black">{users.length}</p></div>
            <div className="page-card p-4"><p className="text-sm text-muted">Active</p><p className="mt-2 text-2xl font-black text-emerald-500">{activeCount}</p></div>
            <div className="page-card p-4"><p className="text-sm text-muted">Pending invitations</p><p className="mt-2 text-2xl font-black text-amber-500">{pendingCount}</p></div>
          </section>

          <form onSubmit={inviteStaff} className="page-card mb-7 p-5 sm:p-6">
            <div className="mb-4">
              <h2 className="page-section-title">Invite staff member</h2>
              <p className="mt-1 text-xs text-muted">MGT emails the invitation. The employee chooses their own password; administrators never see it.</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <input required className="input-base" placeholder="Full name" value={invite.full_name} onChange={(event) => setInvite({ ...invite, full_name: event.target.value })} />
              <input required type="email" className="input-base" placeholder="Email address" value={invite.email} onChange={(event) => setInvite({ ...invite, email: event.target.value })} />
              <select className="input-base" value={invite.role} onChange={(event) => setInvite({ ...invite, role: event.target.value })}>
                {roles.filter((role) => callerCanAssignOwner || role.key !== 'owner').map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
              </select>
              <select className="input-base" value={invite.default_location_id} onChange={(event) => setInvite({ ...invite, default_location_id: event.target.value })}>
                <option value="">All / no default location</option>
                {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
              </select>
            </div>
            <button disabled={busy} className="btn-primary mt-4 rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Sending...' : 'Send invitation'}</button>
          </form>

          {pendingCount > 0 && (
            <section className="mb-7">
              <div className="mb-3"><h2 className="text-lg font-black">Pending invitations</h2><p className="text-xs text-muted">These people have been invited but have not completed account setup yet.</p></div>
              <div className="grid gap-3 md:grid-cols-2">
                {invitations.map((invitation) => (
                  <div key={invitation.id} className="page-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div><strong>{invitation.full_name}</strong><p className="mt-1 text-xs text-muted">{invitation.email}</p></div>
                      <span className="rounded-full bg-amber-500/10 px-2 py-1 text-[10px] font-black uppercase text-amber-600">Pending</span>
                    </div>
                    <p className="mt-3 text-xs text-muted">{prettyRole(invitation.role, roles)} · invited {prettyDate(invitation.invited_at)}</p>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section>
            <div className="mb-3"><h2 className="text-lg font-black">Accounts</h2><p className="text-xs text-muted">Changes to disabled accounts are enforced by MGT access checks and Supabase Auth.</p></div>
            <div className="space-y-3">
              {users.length === 0 && <div className="page-card p-6 text-center text-sm text-muted">No staff accounts found.</div>}
              {users.map((user) => (
                <article key={user.id} className={`page-card p-4 sm:p-5 ${user.active === false ? 'opacity-70' : ''}`}>
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="font-black">{user.full_name}</h3>
                        {user.id === caller?.id && <span className="rounded-full bg-[var(--accent-2)] px-2 py-1 text-[10px] font-black text-accent">YOU</span>}
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${user.active === false ? 'bg-red-500/10 text-red-500' : 'bg-emerald-500/10 text-emerald-600'}`}>{user.active === false ? 'Disabled' : 'Active'}</span>
                      </div>
                      <p className="mt-1 text-sm text-muted">{user.email || 'No email recorded'}</p>
                      <div className="mt-3 grid gap-1 text-xs text-muted sm:grid-cols-2"><p>Created: {prettyDate(user.auth_created_at || user.created_at)}</p><p>Last sign in: {prettyDate(user.last_sign_in_at)}</p></div>
                    </div>

                    <div className="grid gap-2 sm:grid-cols-2 xl:min-w-[520px] xl:grid-cols-[1fr_1fr_auto_auto]">
                      <select value={user.role} disabled={user.id === caller?.id} onChange={(event) => updateUser(user, { role: event.target.value })} className="input-base !py-2 text-xs disabled:opacity-50">
                        {roles.filter((role) => callerCanAssignOwner || role.key !== 'owner' || user.role === 'owner').map((role) => <option key={role.key} value={role.key}>{role.name}</option>)}
                      </select>
                      <select value={user.default_location_id || ''} onChange={(event) => updateUser(user, { default_location_id: event.target.value || null })} className="input-base !py-2 text-xs">
                        <option value="">No default location</option>
                        {locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                      </select>
                      <button type="button" disabled={user.id === caller?.id} onClick={() => updateUser(user, { active: user.active === false })} className={`rounded-xl px-3 py-2 text-xs font-bold text-white disabled:opacity-30 ${user.active === false ? 'bg-emerald-500' : 'bg-red-500'}`}>{user.active === false ? 'Reactivate' : 'Disable'}</button>
                      <button type="button" disabled={user.id === caller?.id} onClick={() => archiveUser(user)} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-bold text-red-500 disabled:opacity-30">Archive</button>
                    </div>
                  </div>
                  {rowMessages[user.id] && <div className={`mt-3 rounded-xl border px-3 py-2 text-xs ${rowMessages[user.id].type === 'success' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600' : 'border-red-500/30 bg-red-500/10 text-red-500'}`}>{rowMessages[user.id].text}</div>}
                </article>
              ))}
            </div>
          </section>
        </>
      )}

      {tab === 'roles' && canManageRoles && (
        <section className="grid gap-5 xl:grid-cols-[330px_1fr]">
          <div className="space-y-5">
            <form onSubmit={createRole} className="page-card p-5">
              <h2 className="font-black">Create custom role</h2>
              <p className="mt-1 text-xs text-muted">Useful when the built-in roles do not exactly match a business.</p>
              <input required className="input-base mt-4" placeholder="Role name" value={newRole.name} onChange={(event) => setNewRole({ ...newRole, name: event.target.value })} />
              <textarea className="input-base mt-3 min-h-20" placeholder="What is this role responsible for?" value={newRole.description} onChange={(event) => setNewRole({ ...newRole, description: event.target.value })} />
              <button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 text-sm font-black disabled:opacity-50">Create role</button>
            </form>

            <div className="page-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Business roles</strong></div>
              <div className="divide-y divide-[var(--line)]">
                {roleBundle.map((role) => (
                  <button key={role.key} type="button" onClick={() => setSelectedRoleKey(role.key)} className={`w-full p-4 text-left ${selectedRoleKey === role.key ? 'bg-[var(--accent-2)]' : ''}`}>
                    <div className="flex items-center justify-between gap-2"><strong>{role.name}</strong>{role.is_system && <span className="text-[9px] font-black uppercase text-muted">Built-in</span>}</div>
                    <p className="mt-1 text-xs text-muted">{role.description || 'Custom business role'}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="page-card p-5 sm:p-6">
            {!selectedRole ? <p className="text-sm text-muted">Select a role.</p> : (
              <>
                <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="page-eyebrow">Permission set</p>
                    <h2 className="text-xl font-black">{selectedRole.name}</h2>
                    <p className="mt-1 text-sm text-muted">{selectedRole.description}</p>
                  </div>
                  {!selectedRole.is_system && <button type="button" onClick={() => deleteRole(selectedRole)} className="rounded-xl border border-red-500/40 px-3 py-2 text-xs font-bold text-red-500">Delete role</button>}
                </div>

                {['owner', 'admin'].includes(selectedRole.key) ? (
                  <div className="rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-sm">
                    <strong>Full platform access</strong>
                    <p className="mt-1 text-muted">Owner and Administrator are protected roles and always retain all business permissions.</p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-5">
                      {Object.entries(groupedPermissions).map(([section, items]) => (
                        <div key={section}>
                          <h3 className="mb-2 text-sm font-black">{section}</h3>
                          <div className="grid gap-2 md:grid-cols-2">
                            {items.map((permission) => {
                              const checked = roleDraft.includes(permission.code)
                              return (
                                <label key={permission.code} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${checked ? 'border-[var(--accent)] bg-[var(--accent-2)]' : 'border-[var(--line)] bg-[var(--panel-2)]'}`}>
                                  <input type="checkbox" checked={checked} onChange={() => togglePermission(permission.code)} className="mt-1" />
                                  <div><strong className="text-sm">{permission.label}</strong><p className="mt-1 text-xs text-muted">{permission.description}</p></div>
                                </label>
                              )
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                    <button type="button" disabled={busy} onClick={saveRolePermissions} className="btn-primary mt-6 rounded-xl px-5 py-3 text-sm font-black disabled:opacity-50">{busy ? 'Saving...' : 'Save permissions'}</button>
                  </>
                )}
              </>
            )}
          </div>
        </section>
      )}
    </main>
  )
}
