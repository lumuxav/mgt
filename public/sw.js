const CACHE_NAME = 'mgt-shell-v5'
const OFFLINE_URL = '/offline.html'
const SHELL = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon-512.png', '/icon.svg']

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(SHELL)))
})

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(keys.filter(key => key.startsWith('mgt-shell-') && key !== CACHE_NAME).map(key => caches.delete(key)))
    if (self.registration.navigationPreload) await self.registration.navigationPreload.enable().catch(() => {})
    await self.clients.claim()
  })())
})

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting())
})

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return

  // Business HTML and API responses are never cached. The offline document
  // works without Next.js bundles or authentication.
  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return (await event.preloadResponse) || await fetch(request, { cache: 'no-store' })
      } catch {
        return (await (await caches.open(CACHE_NAME)).match(OFFLINE_URL)) || Response.error()
      }
    })())
    return
  }

  if (url.pathname.startsWith('/_next/static/') || SHELL.includes(url.pathname) || url.pathname.startsWith('/icons/')) {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_NAME)
      const cached = await cache.match(request)
      if (cached) return cached
      const response = await fetch(request)
      if (response.ok) {
        try { await cache.put(request, response.clone()) } catch { /* Storage quota is optional. */ }
      }
      return response
    })())
  }
})
