import { supabase } from './supabase'
import { platformMetadataCache } from './platformContextCache'

let cachedUserId = null
let cachedProfile = null
let profilePromise = null
let cacheVersion = 0
let profileExpiresAt = 0
const PROFILE_TTL_MS = 30000
let signOutPromise = null

async function fetchProfile(userId) {
  const result = await supabase
    .from('users')
    .select('id, full_name, role, active, archived_at, organization_id, default_location_id')
    .eq('id', userId)
    .maybeSingle()

  if (result.error) throw result.error
  return result.data || null
}

export async function getSessionProfile({ forceProfile = false } = {}) {
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error) throw error
  if (!session) {
    clearSessionProfileCache()
    return { session: null, profile: null }
  }

  const userId = session.user.id
  if (!forceProfile && cachedUserId === userId && cachedProfile && profileExpiresAt > Date.now()) {
    return { session, profile: cachedProfile }
  }

  if (!forceProfile && profilePromise && cachedUserId === userId) {
    return { session, profile: await profilePromise }
  }

  const version = ++cacheVersion
  if (cachedUserId !== userId) platformMetadataCache.clear()
  cachedUserId = userId
  cachedProfile = null
  profileExpiresAt = 0
  const pending = fetchProfile(userId)
    .then((data) => {
      if (cacheVersion === version && cachedUserId === userId) {
        cachedProfile = data
        profileExpiresAt = Date.now() + PROFILE_TTL_MS
      }
      return data
    })
    .finally(() => {
      if (profilePromise === pending) profilePromise = null
    })
  profilePromise = pending

  return { session, profile: await pending }
}

export function setCachedProfile(userId, profile) {
  if (!userId) return
  if (cachedUserId !== userId || cachedProfile?.organization_id !== profile?.organization_id || cachedProfile?.default_location_id !== profile?.default_location_id) {
    platformMetadataCache.clear()
  }
  cacheVersion += 1
  cachedUserId = userId
  cachedProfile = profile || null
  profilePromise = null
  profileExpiresAt = Date.now() + PROFILE_TTL_MS
}

export function clearSessionProfileCache() {
  platformMetadataCache.clear()
  cacheVersion += 1
  cachedUserId = null
  cachedProfile = null
  profilePromise = null
  profileExpiresAt = 0
}

export function isSigningOut() {
  return Boolean(signOutPromise)
}

export function signOutAndRedirect(redirectTo = '/login', delayMs = 0) {
  if (signOutPromise) return signOutPromise
  clearSessionProfileCache()
  const pending = Promise.resolve().then(async () => {
    const result = await supabase.auth.signOut()
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
    if (typeof window !== 'undefined') window.location.replace(redirectTo)
    return result
  }).finally(() => { if (signOutPromise === pending) signOutPromise = null })
  signOutPromise = pending
  return pending
}

if (typeof window !== 'undefined') {
  supabase.auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT' || (cachedUserId && session?.user?.id !== cachedUserId)) clearSessionProfileCache()
  })
}

