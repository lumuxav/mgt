'use client'

import { useEffect } from 'react'

const classifyWidth = (width) => {
  if (width < 380) return 'compact'
  if (width < 600) return 'phone'
  if (width < 1024) return 'tablet'
  return 'large'
}

export default function MobileViewport() {
  useEffect(() => {
    const root = document.documentElement
    const visualViewport = window.visualViewport
    let stableHeight = Math.max(window.innerHeight, visualViewport?.height || 0)
    let orientationTimer = null

    const sync = () => {
      const viewportHeight = visualViewport?.height || window.innerHeight
      const viewportWidth = visualViewport?.width || window.innerWidth
      const offsetTop = visualViewport?.offsetTop || 0
      const keyboardThreshold = Math.max(120, stableHeight * 0.18)
      const keyboardOpen = stableHeight - viewportHeight > keyboardThreshold

      if (!keyboardOpen && window.innerHeight >= stableHeight - 40) {
        stableHeight = Math.max(stableHeight, window.innerHeight, viewportHeight)
      }

      root.style.setProperty('--mgt-viewport-height', `${viewportHeight}px`)
      root.style.setProperty('--mgt-viewport-width', `${viewportWidth}px`)
      root.style.setProperty('--mgt-viewport-offset-top', `${offsetTop}px`)
      root.dataset.keyboard = keyboardOpen ? 'open' : 'closed'
      root.dataset.deviceClass = classifyWidth(window.innerWidth)
      root.dataset.orientation = window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'
    }

    const resetAfterOrientation = () => {
      if (orientationTimer) window.clearTimeout(orientationTimer)
      orientationTimer = window.setTimeout(() => {
        stableHeight = Math.max(window.innerHeight, window.visualViewport?.height || 0)
        sync()
      }, 250)
    }

    sync()
    window.addEventListener('resize', sync, { passive: true })
    window.addEventListener('orientationchange', resetAfterOrientation, { passive: true })
    visualViewport?.addEventListener('resize', sync, { passive: true })
    visualViewport?.addEventListener('scroll', sync, { passive: true })

    return () => {
      if (orientationTimer) window.clearTimeout(orientationTimer)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', resetAfterOrientation)
      visualViewport?.removeEventListener('resize', sync)
      visualViewport?.removeEventListener('scroll', sync)
      delete root.dataset.keyboard
      delete root.dataset.deviceClass
      delete root.dataset.orientation
    }
  }, [])

  return null
}
