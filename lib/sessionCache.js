import { supabase } from './supabase'

let cachedUserId = null
let cachedProfile = null
let profilePromise = null
let cacheVersion = 0

async function fetchProfile(userId) {
  const result = await supabase
    .from('users')
    .select('full_name, role, active, organization_id, default_location_id')
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
  if (!forceProfile && cachedUserId === userId && cachedProfile) {
    return { session, profile: cachedProfile }
  }

  if (!forceProfile && profilePromise && cachedUserId === userId) {
    return { session, profile: await profilePromise }
  }

  const version = ++cacheVersion
  cachedUserId = userId
  cachedProfile = null
  const pending = fetchProfile(userId)
    .then((data) => {
      if (cacheVersion === version && cachedUserId === userId) cachedProfile = data
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
  cacheVersion += 1
  cachedUserId = userId
  cachedProfile = profile || null
  profilePromise = null
}

export function clearSessionProfileCache() {
  cacheVersion += 1
  cachedUserId = null
  cachedProfile = null
  profilePromise = null
}

