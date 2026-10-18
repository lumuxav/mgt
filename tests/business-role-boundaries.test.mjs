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
