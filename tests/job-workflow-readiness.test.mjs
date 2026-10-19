import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8')
const { ROLE_TEMPLATES, jobWorkflowReadiness } = await import('data:text/javascript,' + encodeURIComponent(read('lib/workspaceCatalog.js')))

test('cashier and seller templates show stock but cannot edit stock without another grant', () => {
  for (const role of ['cashier','salesperson']) {
    const grants = ROLE_TEMPLATES.find(item => item.key === role).permissions
    assert.ok(grants.includes('inventory.view'))
    assert.ok(grants.includes('catalog.view'))
    assert.ok(grants.includes('sales.create'))
    assert.ok(!grants.includes('inventory.adjust'))
    assert.ok(!grants.includes('inventory.transfer'))
  }
})
test('workflow readiness requires module and every permission, no implicit grant', () => {
  const [incomplete] = jobWorkflowReadiness(['salesperson'],['sales.create'],['pos']).filter(item => item.label === 'Make a sale')
  assert.equal(incomplete.ready,false)
  assert.deepEqual(incomplete.missingPermissions,['catalog.view'])
  const [ready] = jobWorkflowReadiness(['salesperson'],['sales.create','catalog.view'],['pos']).filter(item => item.label === 'Make a sale')
  assert.equal(ready.ready,true)
  assert.equal(jobWorkflowReadiness(['salesperson'],['sales.create','catalog.view'],[]).find(item => item.label === 'Make a sale').ready,false)
  const stock = jobWorkflowReadiness(['salesperson'],['sales.create','catalog.view'],['inventory']).find(item => item.label === 'Check stock availability')
  assert.equal(stock.ready,false)
  assert.deepEqual(stock.missingPermissions,['inventory.view'])
})
test('driver only receives assigned-work rights and never fleet dispatch', () => {
  const permissions = ROLE_TEMPLATES.find(item => item.key === 'delivery_driver').permissions
  assert.ok(permissions.includes('fleet.assigned'))
  assert.ok(!permissions.includes('fleet.dispatch'))
  assert.ok(!permissions.includes('fleet.manage'))
  assert.equal(jobWorkflowReadiness(['delivery_driver'],permissions,['fleet','dashboard']).find(flow => flow.label === 'My assigned deliveries').ready,true)
})
test('owner staff page shows module and permission blockers without auto-grant', () => {
  const users = read('app/users/page.js')
  assert.match(users,/invitationReadiness/)
  assert.match(users,/jobWorkflowReadiness/)
  assert.match(users,/Permissions follow the chosen role/)
  assert.doesNotMatch(users,/autoGrant|grantAllPermissions/)
})

test('all fifteen built-in business roles have mapped operational actions', () => {
  for (const role of ['owner','admin','manager','branch_manager','cashier','salesperson','storekeeper','procurement_officer','accountant','hr_officer','production_staff','technician','delivery_driver','project_worker','employee']) {
    const workflows = jobWorkflowReadiness([role],[],[])
    assert.ok(workflows.length >= 2, role + ' should show both work and relevant setup information')
    assert.ok(workflows.some(flow => flow.href === '/my-work'), role + ' must have a personal workspace')
  }
})
test('custom roles with a usable grant can see an authorized workflow', () => {
  const flows = jobWorkflowReadiness(['bespoke_shop_staff'], ['sales.create','catalog.view'],['pos'])
  assert.ok(flows.some(flow => flow.href === '/pos' && flow.ready))
})
