const initialState = { prompt: null, installed: false, dismissed: false }
let state = initialState
const listeners = new Set()
const dismissalKey = 'mgt-install-prompt-dismissed-at'

function update(changes) {
  state = { ...state, ...changes }
  listeners.forEach(listener => listener())
}

export const getInstallState = () => state
export const getServerInstallState = () => initialState
export const subscribeToInstall = listener => {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function attachInstallEvents(browser) {
  const displayMode = browser.matchMedia?.('(display-mode: standalone)')
  const installed = () => Boolean(displayMode?.matches || browser.navigator.standalone || browser.Capacitor?.isNativePlatform?.())
  let dismissed = false
  try {
    const timestamp = Number(browser.localStorage.getItem(dismissalKey))
    dismissed = timestamp > 0 && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000
  } catch { /* Installation also works when browser storage is unavailable. */ }
  update({ installed: installed(), dismissed })
  const onPrompt = event => {
    event.preventDefault()
    update({ prompt: event, installed: installed() })
  }
  const onInstalled = () => {
    update({ prompt: null, installed: true })
    try { browser.localStorage.removeItem(dismissalKey) } catch {}
  }
  const onDisplayMode = () => update({ installed: installed() })
  browser.addEventListener('beforeinstallprompt', onPrompt)
  browser.addEventListener('appinstalled', onInstalled)
  displayMode?.addEventListener?.('change', onDisplayMode)
  return () => {
    browser.removeEventListener('beforeinstallprompt', onPrompt)
    browser.removeEventListener('appinstalled', onInstalled)
    displayMode?.removeEventListener?.('change', onDisplayMode)
  }
}

export function dismissInstall(browser) {
  try { browser.localStorage.setItem(dismissalKey, String(Date.now())) } catch {}
  update({ dismissed: true })
}

export async function requestInstall() {
  const event = state.prompt
  if (!event || state.installed) return 'Use your browser menu to install MGT.'
  // A browser install event can be used only once, even after cancellation.
  update({ prompt: null })
  try {
    await event.prompt()
    const choice = await event.userChoice
    return choice?.outcome === 'accepted' ? 'Installation requested. Follow your browser instructions.' : 'You can install later from your browser menu.'
  } catch {
    return 'Installation was unavailable. Use your browser menu instead.'
  }
}
