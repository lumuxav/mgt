import { supabase } from './supabase'

let cachedUserId = null
let cachedProfile = null
let profilePromise = null

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
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) {
    cachedUserId = null
    cachedProfile = null
    profilePromise = null
    return { session: null, profile: null }
  }

  const userId = session.user.id
  if (!forceProfile && cachedUserId === userId && cachedProfile) {
    return { session, profile: cachedProfile }
  }

  if (!forceProfile && profilePromise && cachedUserId === userId) {
    return { session, profile: await profilePromise }
  }

  cachedUserId = userId
  profilePromise = fetchProfile(userId)
    .then((data) => {
      cachedProfile = data
      return cachedProfile
    })
    .finally(() => {
      profilePromise = null
    })

  return { session, profile: await profilePromise }
}

export function setCachedProfile(userId, profile) {
  if (!userId) return
  cachedUserId = userId
  cachedProfile = profile || null
}

export function clearSessionProfileCache() {
  cachedUserId = null
  cachedProfile = null
  profilePromise = null
}
