export const isSavedLocation = location => /^[0-9a-f]{8}-[0-9a-f-]{27}$/i.test(location.id)

export function matchSetupLocation(existing, location) {
  if (isSavedLocation(location)) {
    const match = existing.find(item => item.id === location.id)
    if (!match) throw new Error('A saved location is unavailable. Reload setup before saving.')
    return match
  }
  return existing.find(item => item.name.toLowerCase() === location.name.trim().toLowerCase())
}
