import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import { createScopedMetadataCache } from '../lib/platformContextCache.js'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

test('concurrent pages share one metadata request and reuse it until expiry', async () => {
  let time = 1000
  let requests = 0
  const pending = deferred()
  const cache = createScopedMetadataCache({ now: () => time })
  const load = () => { requests += 1; return pending.promise }
  const first = cache.get('user:org:location', load)
  const second = cache.get('user:org:location', load)
  await Promise.resolve()
  assert.equal(requests, 1)
  const metadata = { organization: { id: 'org' }, location: { id: 'location' } }
  pending.resolve(metadata)
  assert.deepEqual(await Promise.all([first, second]), [metadata, metadata])
  time = 30000
  assert.equal(await cache.get('user:org:location', load), metadata)
  assert.equal(requests, 1)
  time = 31001
  await cache.get('user:org:location', load)
  assert.equal(requests, 2)
  await cache.get('user:org:location', load, { force: true })
  assert.equal(requests, 3)
})

test('metadata from an old account cannot replace the current account after a slow response', async () => {
  const cache = createScopedMetadataCache()
  const old = deferred()
  const first = cache.get('A:org:location', () => old.promise)
  const current = { organization: { id: 'B-org' } }
  assert.equal(await cache.get('B:org:location', () => current), current)
  old.resolve({ organization: { id: 'A-org' } })
  await first
  assert.equal(await cache.get('B:org:location', () => { throw new Error('Unexpected refetch') }), current)
})

test('logout invalidation preserves a newer in-flight request for the same account', async () => {
  const cache = createScopedMetadataCache()
  const old = deferred()
  const fresh = deferred()
  const first = cache.get('A', () => old.promise)
  cache.clear()
  const second = cache.get('A', () => fresh.promise)
  old.resolve('old organization')
  await first
  const third = cache.get('A', () => { throw new Error('Duplicate request') })
  fresh.resolve('fresh organization')
  assert.deepEqual(await Promise.all([second, third]), ['fresh organization', 'fresh organization'])
  assert.equal(await cache.get('A', () => null), 'fresh organization')
})

test('failed metadata requests are retried and never cached as success', async () => {
  const cache = createScopedMetadataCache()
  await assert.rejects(cache.get('A', () => { throw new Error('offline') }), /offline/)
  assert.equal(await cache.get('A', () => 'reconnected'), 'reconnected')
})

async function contextHarness() {
  let session = { user: { id: 'A' } }
  let profile = { organization_id: 'org', default_location_id: 'location', active: true }
  const calls = []
  const client = {
    from: (table) => {
      const filters = []
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query },
        maybeSingle: async () => {
          calls.push({ table, filters })
          return { data: { id: table === 'organizations' ? profile.organization_id : profile.default_location_id, legal_name: 'Full database metadata', address: 'Business address' }, error: null }
        },
      }
      return query
    },
  }
  const source = (await readFile(new URL('../lib/platformDb.js', import.meta.url), 'utf8'))
    .replace(/^import .*$/gm, '')
    .replaceAll('export ', '')
  const getContext = new Function('supabase', 'getSessionProfile', 'platformMetadataCache', source + '\nreturn getPlatformContext;')(
    client, async () => ({ session, profile }), createScopedMetadataCache(),
  )
  return { getContext, calls, setSession: (value) => { session = value }, setProfile: (value) => { profile = value } }
}

test('page navigation reuses full business/location metadata and keeps the current profile', async () => {
  const h = await contextHarness()
  const first = await h.getContext()
  assert.equal(first.user.id, 'A')
  assert.equal(first.organization.address, 'Business address')
  assert.equal(first.location.address, 'Business address')
  assert.equal(h.calls.length, 2)
  assert(h.calls.find((call) => call.table === 'locations').filters.some(([key, value]) => key === 'organization_id' && value === 'org'))
  h.setProfile({ organization_id: 'org', default_location_id: 'location', active: true, role: 'cashier' })
  assert.equal((await h.getContext()).user.role, 'cashier')
  assert.equal(h.calls.length, 2)
  h.setProfile({ organization_id: 'other-org', default_location_id: 'other-location', active: true })
  assert.equal((await h.getContext()).organization.id, 'other-org')
  assert.equal(h.calls.length, 4)
})

test('cached metadata never lets disabled or signed-out users open a workspace', async () => {
  const h = await contextHarness()
  await h.getContext()
  h.setProfile({ organization_id: 'org', default_location_id: 'location', active: false })
  await assert.rejects(h.getContext(), /disabled/)
  h.setProfile({ organization_id: 'org', active: true, archived_at: '2026-10-12' })
  await assert.rejects(h.getContext(), /disabled/)
  h.setSession(null)
  assert.deepEqual(await h.getContext(), { session: null, user: null, organization: null, location: null })
  assert.equal(h.calls.length, 2)
})

test('cached immutable app files load without a duplicate network request', async () => {
  const listeners = {}
  let networkRequests = 0
  const cached = new Response('cached application script')
  const cache = { match: async () => cached, put: async () => {} }
  const worker = {
    URL, Response,
    self: { location: { origin: 'https://mgt.example' }, addEventListener: (event, fn) => { listeners[event] = fn } },
    caches: { open: async () => cache },
    fetch: async () => { networkRequests += 1; return new Response('network') },
  }
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), worker)
  let response
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://mgt.example/_next/static/immutable/chunks/app.js' }, respondWith: (pending) => { response = pending } })
  assert.equal(await (await response).text(), 'cached application script')
  assert.equal(networkRequests, 0)
  let intercepted = false
  const respondWith = () => { intercepted = true }
  listeners.fetch({ request: { method: 'GET', mode: 'cors', url: 'https://mgt.example/api/payments/transactions' }, respondWith })
  listeners.fetch({ request: { method: 'POST', mode: 'cors', url: 'https://mgt.example/sales' }, respondWith })
  assert.equal(intercepted, false)
})
