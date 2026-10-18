import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8')
const sql=read('supabase/migrations/20261018_0045_modular_staff_workspaces.sql')

test('only business-owned modules are represented in industry presets',()=>{
 const catalog=read('lib/workspaceCatalog.js')
 const platform=read('lib/platformConfig.js')
 assert.match(catalog,/MODULE_CATEGORIES/)
 assert.match(catalog,/INDUSTRY_PRESETS/)
 assert.match(catalog,/ROLE_TEMPLATES/)
 assert.match(platform,/industryPreset/)
 for(const category of ['administration','sales','stock','finance','people','operations','projects','logistics','commerce']){
  assert.ok(catalog.includes("id:'"+category+"'"),category)
 }
 for(const industry of ['retail','restaurant','hotel','manufacturing','agriculture','logistics','construction']){
  assert.ok(catalog.includes("id:'"+industry+"'"),industry)
 }
})

test('personal worker route has authenticated navigation and never exports pricing data',()=>{
 const shell=read('app/components/AppShell.js')
 const page=read('app/my-work/page.js')
 const routes=read('lib/routeAccess.js')
 assert.match(shell,/href: '\/my-work', label: 'My Work'/)
 assert.match(routes,/\['\/my-work', 'workspace.tasks'\]/)
 assert.match(page,/supabase\.rpc\('mgt_my_work'\)/)
 assert.match(page,/supabase\.rpc\('mgt_update_assigned_job'/)
 assert.match(page,/supabase\.rpc\('update_project_task'/)
 assert.doesNotMatch(sql.slice(sql.indexOf('create or replace function public.mgt_my_work'),sql.indexOf('create or replace function public.mgt_update_assigned_job')), /gross_profit|final_cost|quoted_amount|bank_account_number/)
})

test('assigned technicians cannot edit costs or finish and cancel orders',()=>{
 assert.match(sql,/p_status not in \('in_progress','on_hold'\)/)
 assert.match(sql,/work_order_assignments wa/)
 assert.match(sql,/Job is not assigned to you/)
 assert.match(sql,/public.has_permission\('services.assigned'\)/)
 assert.match(sql,/Services module not enabled/)
})

test('role combinations and work scopes are business scoped, audited and server-only',()=>{
 const server=read('app/api/admin/staff-work-access/route.js')
 const users=read('app/api/admin/users/route.js')
 const access=read('lib/serverAccess.js')
 assert.match(server,/verifyOrganizationPermission\(req,'roles.manage'\)/)
 assert.match(server,/server_set_staff_work_access/)
 assert.match(users,/user_additional_roles/)
 assert.match(users,/user_work_scope/)
 assert.match(access,/from\('user_additional_roles'\)/)
 for(const check of ["coalesce(auth.role(),'')<>'service_role'","p_actor_id=p_user_id","no_privileged_extra_role","public.has_organization_access(organization_id)","server_set_staff_work_access","p_scope not in ('organization','location','assigned')"])assert.ok(sql.includes(check),check)
 assert.match(sql,/create policy sales_org_select/)
 assert.match(sql,/create policy work_orders_select/)
 assert.match(sql,/mgt_initialize_staff_scope_on_create/)
})

test('existing role grants are not reset and approval segregation is opt-in',()=>{
 assert.match(sql,/on conflict\(organization_id,role,permission\) do nothing/)
 assert.doesNotMatch(sql,/delete from public\.role_permissions/)
 assert.match(sql,/require_separate_approvers boolean not null default false/)
 assert.match(sql,/A different authorized staff member must approve this request/)
 const approvals=read('app/approvals/page.js')
 assert.match(approvals,/configureApprovers/)
 assert.match(approvals,/require_separate_approvers/)
})

test('owner can configure job templates, scopes, and preview the resulting module list',()=>{
 const users=read('app/users/page.js')
 assert.match(users,/ROLE_TEMPLATES/)
 assert.match(users,/visibleModulesForRole/)
 assert.match(users,/saveStaffWorkAccess/)
 assert.match(users,/additional_roles/)
 const setup=read('app/setup/page.js')
 assert.match(setup,/MODULE_CATEGORIES/)
 assert.match(setup,/INDUSTRY_PRESETS/)
 assert.match(setup,/chooseIndustry/)
})

test('assigned drivers can update only allocated trips with proof and status limits',()=>{
 const sql=read('supabase/migrations/20261018_0045_modular_staff_workspaces.sql')
 const page=read('app/my-work/page.js')
 assert.match(sql,/fleet.assigned/)
 assert.match(sql,/mgt_update_assigned_delivery/)
 assert.match(sql,/d.driver_user_id=v_me/)
 assert.match(sql,/p_status not in \('in_transit','delivered','failed'\)/)
 assert.match(sql,/Recipient name is required as proof of delivery/)
 assert.match(page,/My assigned deliveries/)
 assert.match(page,/mgt_update_assigned_delivery/)
});
