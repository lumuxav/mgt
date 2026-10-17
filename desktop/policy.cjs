const APP_URL = 'https://mgt-lake.vercel.app'
const RELEASES_URL = 'https://github.com/lumuxav/mgt/releases/latest'

function isAppUrl(value) {
  try {
    const url = new URL(value)
    return url.origin === APP_URL && !url.username && !url.password
  } catch { return false }
}

function isExternalUrl(value) {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && !url.username && !url.password
  } catch { return false }
}

function canRequestCamera(topUrl, permission, details = {}) {
  return isAppUrl(topUrl) && isAppUrl(details.requestingUrl) && details.isMainFrame === true &&
    permission === 'media' && Array.isArray(details.mediaTypes) &&
    details.mediaTypes.length > 0 && details.mediaTypes.every(type => type === 'video')
}

module.exports = { APP_URL, RELEASES_URL, isAppUrl, isExternalUrl, canRequestCamera }
