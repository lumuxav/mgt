'use client'

import { useEffect } from 'react'

const THEME_CHROME = {
  light: { color: '#f4f6fa', systemStyle: 'LIGHT', scheme: 'light' },
  dark: { color: '#0d0f13', systemStyle: 'DARK', scheme: 'dark' },
  blue: { color: '#0b1730', systemStyle: 'DARK', scheme: 'dark' },
}

export default function SystemChrome() {
  useEffect(() => {
    let disposed = false

    const sync = async () => {
      if (disposed) return
      const theme = document.documentElement.dataset.theme || localStorage.getItem('mgt-theme') || 'light'
      const chrome = THEME_CHROME[theme] || THEME_CHROME.light

      document.documentElement.style.backgroundColor = chrome.color
      document.documentElement.style.colorScheme = chrome.scheme
      if (document.body) document.body.style.backgroundColor = chrome.color

      let themeMeta = document.querySelector('meta[name="theme-color"]')
      if (!themeMeta) {
        themeMeta = document.createElement('meta')
        themeMeta.setAttribute('name', 'theme-color')
        document.head.appendChild(themeMeta)
      }
      themeMeta.setAttribute('content', chrome.color)

      try {
        const systemBars = window.Capacitor?.Plugins?.SystemBars
        if (systemBars?.setStyle) {
          await systemBars.setStyle({ style: chrome.systemStyle })
        }
      } catch {
        // Browser/PWA environments do not expose the native Capacitor bridge.
      }
    }

    sync()

    const observer = new MutationObserver((mutations) => {
      if (mutations.some((mutation) => mutation.attributeName === 'data-theme')) sync()
    })
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })

    const onStorage = (event) => {
      if (event.key === 'mgt-theme') sync()
    }
    window.addEventListener('storage', onStorage)

    return () => {
      disposed = true
      observer.disconnect()
      window.removeEventListener('storage', onStorage)
    }
  }, [])

  return null
}
