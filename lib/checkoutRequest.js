// Store only a payload digest and random request ID, scoped to this business/user.
// Preserve the ID after a lost response; clear it only after confirmed success.
export async function checkoutRequest(storage, cryptoApi, scope, payload) {
  const digest = await cryptoApi.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(payload)))
  const fingerprint = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
  const key = `mgt.checkout.${scope}`
  let saved
  try { saved = JSON.parse(storage.getItem(key) || 'null') } catch { /* A damaged entry starts a new attempt. */ }
  if (saved?.fingerprint === fingerprint && /^[0-9a-f-]{36}$/i.test(saved.requestId || '')) return saved.requestId
  const requestId = cryptoApi.randomUUID()
  // If storage is unavailable, fail before posting instead of losing retry safety.
  storage.setItem(key, JSON.stringify({ fingerprint, requestId }))
  return requestId
}

export function finishCheckout(storage, scope) {
  storage.removeItem(`mgt.checkout.${scope}`)
}
