'use client'

import { useEffect } from 'react'
import { isKeyboardOpen } from '../../lib/mobileNavigation'

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
      const active = document.activeElement
      const editing = Boolean(active?.matches('input:not([type="button"]):not([type="checkbox"]):not([type="radio"]):not([type="submit"]), textarea') || active?.isContentEditable)
      const keyboardOpen = isKeyboardOpen({
        stableHeight, viewportHeight, editing,
        touch: navigator.maxTouchPoints > 0,
        scale: visualViewport?.scale || 1,
      })

      if (!editing) stableHeight = Math.max(window.innerHeight, viewportHeight)
      else if (!keyboardOpen) stableHeight = Math.max(stableHeight, window.innerHeight, viewportHeight)

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
    document.addEventListener('focusin', sync)
    document.addEventListener('focusout', sync)
    visualViewport?.addEventListener('resize', sync, { passive: true })
    visualViewport?.addEventListener('scroll', sync, { passive: true })

    return () => {
      if (orientationTimer) window.clearTimeout(orientationTimer)
      window.removeEventListener('resize', sync)
      window.removeEventListener('orientationchange', resetAfterOrientation)
      document.removeEventListener('focusin', sync)
      document.removeEventListener('focusout', sync)
      visualViewport?.removeEventListener('resize', sync)
      visualViewport?.removeEventListener('scroll', sync)
      delete root.dataset.keyboard
      delete root.dataset.deviceClass
      delete root.dataset.orientation
    }
  }, [])

  return null
}
