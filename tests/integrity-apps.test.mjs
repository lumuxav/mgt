import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import vm from 'node:vm'
import { externalResourceQuery, parsePage, readAllPages, csvCell } from '../lib/externalApi.js'
import { markSettlementFailure } from '../lib/serverPaymentLifecycle.js'
import { nativeBackAction, isKeyboardOpen } from '../lib/mobileNavigation.js'
import { matchSetupLocation } from '../lib/setupLocations.js'
import { getDefaultLocation } from '../lib/platformConfig.js'
import { attachInstallEvents, dismissInstall, getInstallState, requestInstall } from '../lib/pwaInstall.js'

function querySpy(result) {
  const calls = []
  const query = { then: (resolve) => Promise.resolve(result).then(resolve) }
  for (const method of ['from', 'select', 'eq', 'neq', 'gt', 'order', 'range', 'update']) {
    query[method] = (...args) => { calls.push([method, ...args]); return query }
  }
  return { query, calls }
}

test('stock API filters through the product organization and uses stable composite pagination', () => {
  const { query, calls } = querySpy({ data: [] })
  externalResourceQuery(query, 'stock', 'my-org', { limit: 20, offset: 40, updatedAfter: '2026-10-01T00:00:00.000Z' })
  assert(calls.some(([method, field, value]) => method === 'eq' && field === 'products.organization_id' && value === 'my-org'))
  assert(!calls.some(([method, field]) => method === 'eq' && field === 'organization_id'))
  assert.deepEqual(calls.filter(([method]) => method === 'order'), [['order', 'product_id'], ['order', 'location_id']])
  assert.deepEqual(calls.at(-1), ['range', 40, 59])
})

test('API pagination rejects invalid ranges and timestamps before querying', () => {
  for (const input of ['limit=NaN', 'offset=-1', 'limit=0', 'limit=501', 'offset=1.5', 'limit=', 'updated_after=bad', 'offset=9007199254740991']) {
    assert.throws(() => parsePage(new URLSearchParams(input)))
  }
  assert.deepEqual(parsePage(new URLSearchParams()), { limit: 100, offset: 0, updatedAfter: null })
})

test('exports include more than the server row cap and surface page failures', async () => {
  const source = Array.from({ length: 1201 }, (_, id) => ({ id }))
  const rows = await readAllPages(() => ({ range: (start, end) => Promise.resolve({ data: source.slice(start, end + 1) }) }))
  assert.deepEqual(rows, source)
  await assert.rejects(readAllPages(() => ({ range: (start, end) => Promise.resolve(start ? { error: new Error('connection lost') } : { data: source.slice(start, end + 1) }) })), /connection lost/)
})

test('CSV export quotes text safely without turning numeric negatives into strings', () => {
  assert.equal(csvCell('=SUM(A1:A3)'), "'=SUM(A1:A3)")
  assert.equal(csvCell('+cmd'), "'+cmd")
  assert.equal(csvCell('-command'), "'-command")
  assert.equal(csvCell(-2), '-2')
  assert.equal(csvCell('a,"b"'), '"a,""b"""')
})

test('a late settlement error cannot overwrite a transaction already settled', async () => {
  const { query, calls } = querySpy({ error: null })
  await markSettlementFailure(query, { id: 'tx', organization_id: 'org' }, 'timeout')
  assert(calls.some(row => row[0] === 'neq' && row[1] === 'settlement_status' && row[2] === 'settled'))
  assert(calls.some(row => row[0] === 'eq' && row[1] === 'organization_id' && row[2] === 'org'))
})

test('native Back confirms exit and falls back safely for deep links', () => {
  assert.equal(nativeBackAction('/', true, 3, null, 5000), 'confirm')
  assert.equal(nativeBackAction('/', true, 3, 5000, 6000), 'exit')
  assert.equal(nativeBackAction('/', true, 3, 5000, 8000), 'confirm')
  assert.equal(nativeBackAction('/inventory', true, 3, 5000, 6000), 'back')
  assert.equal(nativeBackAction('/inventory', false, 1, null, 6000), 'home')
})

test('desktop resizing and pinch zoom do not hide controls as a mobile keyboard', () => {
  const input = { stableHeight: 800, viewportHeight: 440, touch: true, editing: true }
  assert.equal(isKeyboardOpen(input), true)
  assert.equal(isKeyboardOpen({ ...input, touch: false }), false)
  assert.equal(isKeyboardOpen({ ...input, editing: false }), false)
  assert.equal(isKeyboardOpen({ ...input, scale: 2 }), false)
})

test('renaming a saved location preserves its database identity', () => {
  const id = '12345678-1234-1234-1234-123456789abc'
  const original = { id, name: 'Old branch' }
  assert.equal(matchSetupLocation([original], { id, name: 'Renamed branch' }), original)
  assert.throws(() => matchSetupLocation([], { id, name: 'Renamed branch' }), /Reload setup/)
  assert.equal(getDefaultLocation({ defaultLocationId: 'old', locations: [{ id: 'old', active: false }, { id: 'new', active: true }] }).id, 'new')
})

test('installation survives unavailable browser storage and consumes a prompt once', async () => {
  const handlers = {}
  const browser = {
    navigator: {}, matchMedia: () => ({ matches: false }),
    localStorage: { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } },
    addEventListener: (name, fn) => { handlers[name] = fn },
    removeEventListener: name => { delete handlers[name] },
  }
  const detach = attachInstallEvents(browser)
  let prompts = 0
  handlers.beforeinstallprompt({ preventDefault() {}, prompt: async () => { prompts += 1 }, userChoice: Promise.resolve({ outcome: 'accepted' }) })
  dismissInstall(browser)
  assert.equal(getInstallState().dismissed, true)
  assert(getInstallState().prompt, 'Dismissal must preserve the install-page button')
  await requestInstall()
  await requestInstall()
  assert.equal(prompts, 1)
  handlers.appinstalled()
  assert.equal(getInstallState().installed, true)
  detach()
  assert.equal(Object.keys(handlers).length, 0)
})

async function workerHarness({ offline = false } = {}) {
  const handlers = {}, deleted = [], writes = []
  const cache = {
    match: async request => request === '/offline.html' ? new Response('offline recovery') : undefined,
    put: async request => { writes.push(request.url) }, addAll: async () => {},
  }
  vm.runInNewContext(await readFile(new URL('../public/sw.js', import.meta.url), 'utf8'), {
    URL, Response,
    self: { location: { origin: 'https://mgt.test' }, registration: {}, clients: { claim: async () => {} }, addEventListener: (name, fn) => { handlers[name] = fn } },
    caches: { open: async () => cache, keys: async () => ['mgt-shell-v4', 'mgt-shell-v5', 'unrelated-app'], delete: async key => { deleted.push(key) } },
    fetch: async () => { if (offline) throw new Error('offline'); return new Response('private page') },
  })
  const navigate = async () => {
    let result
    handlers.fetch({ request: { method: 'GET', mode: 'navigate', url: 'https://mgt.test/cashbook' }, respondWith: promise => { result = promise } })
    return (await result).text()
  }
  return { handlers, navigate, deleted, writes }
}

test('offline navigation works without business HTML or JavaScript caches', async () => {
  const h = await workerHarness({ offline: true })
  assert.equal(await h.navigate(), 'offline recovery')
  assert.deepEqual(h.writes, [])
})

test('online business pages are never persisted and cache cleanup is scoped to MGT', async () => {
  const h = await workerHarness()
  assert.equal(await h.navigate(), 'private page')
  assert.deepEqual(h.writes, [])
  let activated
  h.handlers.activate({ waitUntil: promise => { activated = promise } })
  await activated
  assert.deepEqual(h.deleted, ['mgt-shell-v4', 'mgt-shell-v5'])
})

test('Android packaging emits increasing versions and a separate test app ID', async () => {
  const path = await mkdtemp(join(tmpdir(), 'mgt-packaging-'))
  try {
    await mkdir(join(path, 'android/app'), { recursive: true })
    await writeFile(join(path, 'android/app/build.gradle'), 'android { defaultConfig { versionCode 1\n versionName "1.0" } }')
    execFileSync(process.execPath, [new URL('../scripts/configure-android.cjs', import.meta.url).pathname], { cwd: path, env: { ...process.env, MGT_BUILD_NUMBER: '42' } })
    const gradle = await readFile(join(path, 'android/app/build.gradle'), 'utf8')
    assert.match(gradle, /versionCode 200042/)
    assert.match(gradle, /applicationIdSuffix ".test"/)
    assert.match(gradle, /versionName "1.1.42"/)
  } finally { await rm(path, { recursive: true, force: true }) }
})

test('staff changes rejected by the database never ban the authentication account', async () => {
  const source = (await readFile(new URL('../app/api/admin/users/route.js', import.meta.url), 'utf8')).replace(/^import .*$/gm, '').replaceAll('export ', '')
  let authWrites = 0
  const client = {
    from(table) {
      let operation = 'read', count = false
      const q = {
        select(fields, options) { count = Boolean(options?.count); return q },
        eq() { return q }, neq() { return q }, is() { return q },
        maybeSingle: async () => ({ data: { id: 'target', role: 'owner', active: true } }),
        update() { operation = 'update'; return q },
        then(resolve) { return Promise.resolve(operation === 'update' ? { error: { message: 'Last active owner protected' } } : count ? { count: 1 } : { data: [] }).then(resolve) },
      }
      return q
    },
    auth: { admin: { getUserById: async () => ({ data: { user: {} } }), updateUserById: async () => { authWrites++; return {} } } },
  }
  const { PATCH, DELETE } = new Function('NextResponse', 'verifyOrganizationPermission', 'canManageOwner', source + '\nreturn { PATCH, DELETE }')(
    { json: (body, options) => ({ body, status: options?.status || 200 }) },
    async () => ({ adminClient: client, organizationId: 'org', caller: { id: 'actor', role: 'owner' } }), () => true,
  )
  const req = { json: async () => ({ user_id: 'target', active: false }) }
  assert.equal((await PATCH(req)).status, 400)
  assert.equal((await DELETE(req)).status, 500)
  assert.equal(authWrites, 0)
})
