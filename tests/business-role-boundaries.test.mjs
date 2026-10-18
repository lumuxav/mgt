import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
test('business setup verifies identity and rights before display and saving',()=>{
 const s=read('app/setup/page.js')
 assert.match(s,/supabase\.auth\.getUser\(\)/)
 assert.match(s,/allowed\.has\('settings.manage'\)/)
 assert.match(s,/allowed\.has\('locations.manage'\)/)
 assert.match(s,/freshAccess.organizationId !== access.organizationId/)
 assert.match(s,/access.state !== 'ready'/)
})
test('home requires fresh grants before sensitive queries and hides privileged links',()=>{
 const s=read('app/page.js')
 assert.ok(s.indexOf("supabase.rpc('current_permissions')") < s.indexOf("accessible('sales.view'"))
 for(const p of ['sales.view','finance.view','purchasing.view','reports.view','users.manage'])assert.ok(s.includes("can('"+p+"')")||s.includes("accessible('"+p+"'"))
 assert.doesNotMatch(s,/canOpenIntelligence/)
})
test('staff server forbids platform administrators and cross-business invitation takeover',()=>{
 const s=read('app/api/admin/users/route.js')
 assert.equal((s.match(/PLATFORM_ROLES\.has\(role\)/g)||[]).length,2)
 assert.match(s,/boundAccount\?\.organization_id/)
 assert.match(s,/update\(changes\)\.eq\('organization_id', organizationId\)/)
})
test('staff role and account status are protected by database migration',()=>{
 const s=read('supabase/migrations/20261018_0038_staff_identity_privilege_guard.sql')
 assert.match(s,/auth\.role\(\)/)
 for(const p of ['new.organization_id','new.role','new.active','new.archived_at']) assert.ok(s.includes(p))
})

test('only new businesses seed default permissions and existing roles stay customized',()=>{
 const s=read('supabase/migrations/20261018_0038_staff_identity_privilege_guard.sql')
 assert.match(s,/CREATE OR REPLACE FUNCTION public\.bootstrap_organization/i)
 assert.match(s,/Existing staff account cannot bootstrap another business/)
 assert.match(s,/if org_id is not null then return org_id; end if;/)
 assert.equal((s.match(/perform public\.seed_default_roles\(org_id\);/g)||[]).length,1)
 assert.match(s,/before insert on public\.users/)
})
test('owner staff access appears among the first dashboard shortcuts',()=>{
 const s=read('app/page.js')
 const head=s.indexOf("const quickActions = [")
 const staff=s.indexOf("can('users.manage') && ['/users'")
 const end=s.indexOf("].filter(Boolean).slice(0, 4)",head)
 assert.ok(head<staff && staff<end)
 const after=s.slice(head,staff).trim()
 assert.equal(after,"const quickActions = [")
})

test('direct role and staff table writes are not authorized for browser clients',()=>{
 const s=read('supabase/migrations/20261018_0038_staff_identity_privilege_guard.sql')
 for(const policy of ['users_admin_insert','users_admin_delete','roles_org_insert','roles_org_update','roles_org_delete','role_permissions_org_access']) {
   assert.ok(s.includes('drop policy if exists '+policy))
 }
 assert.match(s,/create policy role_permissions_org_select/)
 assert.match(s,/for select to authenticated/)
});
