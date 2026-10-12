const CACHE_NAME='mgt-shell-v4'
const SHELL=['/offline','/icon.svg','/manifest.webmanifest']

self.addEventListener('install',event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)))
})

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys()
    await Promise.all(keys.filter(key=>key!==CACHE_NAME).map(key=>caches.delete(key)))
    if(self.registration.navigationPreload)await self.registration.navigationPreload.enable().catch(()=>{})
    await self.clients.claim()
  })())
})

self.addEventListener('message',event=>{
  if(event.data?.type==='SKIP_WAITING')self.skipWaiting()
})

self.addEventListener('fetch',event=>{
  const request=event.request
  if(request.method!=='GET')return

  const url=new URL(request.url)
  if(url.origin!==self.location.origin)return
  if(url.pathname.startsWith('/api/'))return

  if(request.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const preload=await event.preloadResponse
        if(preload)return preload
        return await fetch(request,{cache:'no-store'})
      }catch{
        return (await caches.match('/offline'))||Response.error()
      }
    })())
    return
  }

  const cacheable=url.pathname==='/icon.svg'
    ||url.pathname==='/manifest.webmanifest'
    ||url.pathname.startsWith('/_next/static/')

  if(cacheable){
    event.respondWith((async()=>{
      const cache=await caches.open(CACHE_NAME)
      const cached=await cache.match(request)
      if(cached&&url.pathname.startsWith('/_next/static/'))return cached
      const network=fetch(request).then(response=>{
        if(response.ok)cache.put(request,response.clone())
        return response
      }).catch(()=>null)
      return cached||(await network)||Response.error()
    })())
  }
})

