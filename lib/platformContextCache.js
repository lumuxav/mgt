export function createScopedMetadataCache({ ttlMs = 30000, now = Date.now } = {}) {
  let scope = null
  let value = null
  let expiresAt = 0
  let pending = null
  let version = 0

  const clear = () => {
    version += 1
    scope = null
    value = null
    expiresAt = 0
    pending = null
  }

  const get = async (key, load, { force = false } = {}) => {
    if (scope !== key) {
      clear()
      scope = key
    }
    if (!force && expiresAt > now()) return value
    if (pending) return pending

    const requestVersion = version
    const request = Promise.resolve().then(load).then((result) => {
      if (scope === key && version === requestVersion) {
        value = result
        expiresAt = now() + ttlMs
      }
      return result
    }).finally(() => {
      if (pending === request) pending = null
    })
    pending = request
    return request
  }

  return { get, clear }
}

export const platformMetadataCache = createScopedMetadataCache()
