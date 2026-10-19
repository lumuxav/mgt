import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = path => readFileSync(new URL('../'+path,import.meta.url),'utf8')
const catalog = await import('data:text/javascript,'+encodeURIComponent(read('lib/workspaceCatalog.js')))
const {ROLE_MODULE_REQUIREMENTS,JOB_ROLE_KEYS,missingWorkModules,INDUSTRY_PRESETS}=catalog

test('every known staff role has a module readiness rule',()=>{
  for (const role of JOB_ROLE_KEYS) assert.ok(Object.prototype.hasOwnProperty.call(ROLE_MODULE_REQUIREMENTS,role),role)
})

test('job modules are per-role and per-business, without global activation',()=>{
  const retail = ['dashboard','sales','inventory','pos']
  const service = ['dashboard','sales','services']
  assert.deepEqual(missingWorkModules(['salesperson'],retail),[])
  assert.deepEqual(missingWorkModules(['salesperson'],service),['pos','inventory'])
  assert.deepEqual(missingWorkModules(['delivery_driver'],retail),['fleet'])
  assert.deepEqual(missingWorkModules(['delivery_driver'],[...retail,'fleet']),[])
  assert.deepEqual(missingWorkModules(['employee'],service),[])
  assert.deepEqual(missingWorkModules(['admin'],service),[])
})

test('combined roles activate only missing relevant modules once',()=>{
  const missing = missingWorkModules(['employee','cashier','delivery_driver'],['sales','dashboard'])
  assert.deepEqual(missing,['pos','inventory','fleet'])
  assert.equal(new Set(missing).size,missing.length)
})

test('industry presets never determine another business activation state',()=>{
  const retail = INDUSTRY_PRESETS.find(p=>p.id==='retail')
  const logistics = INDUSTRY_PRESETS.find(p=>p.id==='logistics')
  assert.equal(missingWorkModules(['delivery_driver'],retail.modules).includes('fleet'),true)
  assert.equal(missingWorkModules(['delivery_driver'],logistics.modules).includes('fleet'),false)
})

test('custom job roles derive suggestions from their saved grants, never admin privileges',()=>{
  assert.deepEqual(missingWorkModules(['custom_sales_agent'],[],['sales.create','catalog.view']),['pos','inventory'])
  assert.deepEqual(missingWorkModules(['custom_technician'],[],['services.assigned']),['services'])
  assert.deepEqual(missingWorkModules(['custom_role'],[],['users.manage','roles.manage']),[])
  assert.deepEqual(missingWorkModules(['employee','custom_sales_agent'],[],['sales.create','catalog.view']),['pos','inventory'])
})

test('staff UI requires owner confirmation and current organization-scoped configuration',()=>{
  const page = read('app/users/page.js')
  assert.match(page,/const current = await loadBusinessConfigFromDatabase\(\)/)
  assert.match(page,/current\.organizationId !== caller\.organization_id/)
  assert.match(page,/window\.confirm\(/)
  assert.match(page,/supabase\.rpc\('save_organization_modules'/)
  assert.match(page,/missingWorkModules\(roles,current\.enabledModules,grants\)/)
  assert.match(page,/setAuthoritativeBusiness\(verified\)/)
  assert.match(page,/callerGrants\.value\.data/)
  assert.doesNotMatch(page,/service_role|SUPABASE_SERVICE_ROLE_KEY/)
})

test('no privilege grants or new business setup happens on automatic role selection',()=>{
  const page=read('app/users/page.js')
  const actionStart=page.indexOf('const activateModulesForRoles')
  const actionEnd=page.indexOf('if (loading) return',actionStart)
  const action=page.slice(actionStart,actionEnd)
  assert.ok(action.includes('window.confirm'))
  assert.ok(action.includes("save_organization_modules"))
  assert.ok(!action.includes('server_manage_organization_role'))
  assert.ok(!action.includes('role_permissions'))
})
