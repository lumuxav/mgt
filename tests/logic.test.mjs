import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { hasRoutePermission } from '../lib/routeAccess.js'
import { moduleForPath } from '../lib/platformConfig.js'
import { openingBalanceDue, salesBalanceDue, customerBalanceMap } from '../lib/balances.js'
import { resolveTarget } from '../lib/paymentTargets.js'
import { saveProviderStatus } from '../lib/serverPaymentLifecycle.js'
import { returnsAsOf, refundedBySale, returnedByItem, netItemCost } from '../lib/salesReporting.js'
import { createScopedMetadataCache } from '../lib/platformContextCache.js'

test('staff cannot open a hidden management route by typing its URL', () => {
  assert.equal(hasRoutePermission('/accounting', ['sales.view'], 'cashier'), false)
  assert.equal(hasRoutePermission('/inventory/history', ['sales.view'], 'cashier'), false)
  assert.equal(hasRoutePermission('/sales/abc/invoice', ['sales.view'], 'cashier'), true)
  assert.equal(hasRoutePermission('/system-control', ['system.admin'], 'owner'), false)
  assert.equal(hasRoutePermission('/system-control', [], 'system_admin'), true)
})

test('document and delivery subroutes respect module settings', () => {
  assert.equal(moduleForPath('/quotations/abc'), 'documents')
  assert.equal(moduleForPath('/statements/suppliers/abc'), 'documents')
  assert.equal(moduleForPath('/deliveries/abc/note'), 'fleet')
  assert.equal(moduleForPath('/salesman'), null)
})

test('balances include unpaid opening amounts and returns once', () => {
  assert.equal(openingBalanceDue({ opening_balance: 100, opening_balance_paid: 40 }), 60)
  assert.equal(salesBalanceDue({ total_amount: 100, amount_paid: 40, refunded_amount: 20 }), 40)
  assert.deepEqual(customerBalanceMap([{ customer_id: 'customer', balance_due: '95.00' }]), { customer: 95 })
})

test('historical sales profitability ignores future returns and reverses returned-item costs', () => {
  const returns = [{ sale_id: 's', total_amount: 30, created_at: '2026-09-10T10:00:00Z' }, { sale_id: 's', total_amount: 20, created_at: '2026-10-10T10:00:00Z' }]
  assert.equal(refundedBySale(returnsAsOf(returns, '2026-09-30')).s, 30)
  const quantities = returnedByItem([{ sale_item_id: 'i', quantity: 2 }])
  assert.equal(netItemCost([{ id: 'i', quantity: 5, unit_cost: 10 }], quantities), 30)
})

function paymentClient(tables = {}, balance = 0) {
  return {
    rpc: async () => ({ data: balance, error: null }),
    from: table => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({ data: tables[table], error: null }),
        then: (resolve, reject) => Promise.resolve({ data: tables[table] || [], error: null }).then(resolve, reject),
      }
      return query
    },
  }
}

test('external debt requests include opening debt using the full database balance', async () => {
  const client = paymentClient({ customers: { id: 'c', name: 'Customer', opening_balance: 100, opening_balance_paid: 5 } }, 95)
  const result = await resolveTarget(client, 'org', 'customer_debt', 'c', null, 95)
  assert.equal(result.balance, 95)
  await assert.rejects(resolveTarget(client, 'org', 'customer_debt', 'c', null, 96), /exceeds/)
})

test('quoted jobs accept external deposits before a final amount is set', async () => {
  const client = paymentClient({ work_orders: { id: 'w', location_id: 'l', status: 'open', quoted_amount: 100, final_amount: 0, amount_paid: 0 }, work_order_lines: [] })
  assert.equal((await resolveTarget(client, 'org', 'work_order', 'w', null, 20)).balance, 100)
})

test('void project invoices and foreign unallocated customers cannot receive requests', async () => {
  const client = paymentClient({ project_invoices: { id: 'i', status: 'void', total_amount: 100, amount_paid: 0 }, customers: null })
  await assert.rejects(resolveTarget(client, 'org', 'project_invoice', 'i', null, 10), /Only open/)
  await assert.rejects(resolveTarget(client, 'org', 'unallocated', null, 'foreign', 10), /this business/)
})

function lifecycleClient(current) {
  const calls = []
  return {
    calls,
    from: () => {
      let changes = null
      const filters = []
      const query = {
        update: value => { changes = value; return query },
        eq: (key, value) => { filters.push([key, value, true]); return query },
        neq: (key, value) => { filters.push([key, value, false]); return query },
        select: () => query,
        maybeSingle: async () => {
          calls.push(filters)
          const matches = filters.every(([key, value, equal]) => equal ? current[key] === value : current[key] !== value)
          return { data: matches ? Object.assign(current, changes) : null, error: null }
        },
        single: async () => ({ data: current, error: null }),
      }
      return query
    },
  }
}

test('stale provider responses cannot downgrade a successful or settled collection', async () => {
  for (const current of [{ id: 't', organization_id: 'org', status: 'succeeded', settlement_status: 'pending' }, { id: 't', organization_id: 'org', status: 'succeeded', settlement_status: 'settled' }]) {
    const client = lifecycleClient(current)
    const result = await saveProviderStatus(client, current, { status: 'pending' })
    assert.equal(result.status, 'succeeded')
    assert(client.calls[0].some(([key, value]) => key === 'organization_id' && value === 'org'))
  }
})

test('pending collections can still advance to succeeded', async () => {
  const current = { id: 't', organization_id: 'org', status: 'pending', settlement_status: 'pending' }
  assert.equal((await saveProviderStatus(lifecycleClient(current), current, { status: 'succeeded' })).status, 'succeeded')
})

async function cacheHarness() {
  let user = 'A'
  const requests = []
  const signOutRequests = []
  const mock = {
    auth: {
      getSession: async () => ({ data: { session: user ? { user: { id: user } } : null }, error: null }),
      signOut: () => new Promise((resolve) => signOutRequests.push(() => { user = null; resolve({ error: null }) })),
    },
    from: () => {
      let id
      const query = {
        select: () => query,
        eq: (_, value) => { id = value; return query },
        maybeSingle: () => new Promise(resolve => requests.push({ id, resolve: data => resolve({ data, error: null }) })),
      }
      return query
    },
  }
  const source = (await readFile(new URL('../lib/sessionCache.js', import.meta.url), 'utf8'))
    .replace("import { supabase } from './supabase'", 'const supabase = mock')
    .replace("import { platformMetadataCache } from './platformContextCache'", '')
    .replaceAll('export ', '')
  const cache = new Function('mock', 'platformMetadataCache', source + '\nreturn { getSessionProfile, setCachedProfile, clearSessionProfileCache, signOutAndRedirect, isSigningOut };')(mock, createScopedMetadataCache())
  return { ...cache, requests, signOutRequests, switchUser: value => { user = value } }
}

test('a slow previous account lookup cannot overwrite the current account cache', async () => {
  const h = await cacheHarness()
  const first = h.getSessionProfile()
  await Promise.resolve()
  h.switchUser('B')
  const second = h.getSessionProfile()
  await Promise.resolve()
  h.requests[1].resolve({ full_name: 'B' })
  await second
  h.requests[0].resolve({ full_name: 'A' })
  await first
  assert.equal((await h.getSessionProfile()).profile.full_name, 'B')
})

test('completion of an old lookup does not clear a newer lookup promise', async () => {
  const h = await cacheHarness()
  const first = h.getSessionProfile()
  await Promise.resolve()
  h.switchUser('B')
  const second = h.getSessionProfile()
  await Promise.resolve()
  h.requests[0].resolve({ full_name: 'A' })
  await first
  const third = h.getSessionProfile()
  await Promise.resolve()
  assert.equal(h.requests.length, 2)
  h.requests[1].resolve({ full_name: 'B' })
  await Promise.all([second, third])
})

test('realtime profile updates survive older in-flight responses', async () => {
  const h = await cacheHarness()
  const pending = h.getSessionProfile()
  await Promise.resolve()
  h.setCachedProfile('A', { full_name: 'Updated A' })
  h.requests[0].resolve({ full_name: 'Old A' })
  await pending
  assert.equal((await h.getSessionProfile()).profile.full_name, 'Updated A')
})

test('concurrent sign-outs share one operation and suppress a second auth-listener redirect', async () => {
  const h = await cacheHarness()
  h.setCachedProfile('A', { full_name: 'A' })
  const first = h.signOutAndRedirect()
  const second = h.signOutAndRedirect()
  assert.equal(first, second)
  assert.equal(h.isSigningOut(), true)
  await Promise.resolve()
  assert.equal(h.signOutRequests.length, 1)
  h.signOutRequests[0]()
  await first
  assert.equal(h.isSigningOut(), false)
  assert.deepEqual(await h.getSessionProfile(), { session: null, profile: null })
})
