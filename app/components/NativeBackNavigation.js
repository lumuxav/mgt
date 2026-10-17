'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { nativeBackAction } from '../../lib/mobileNavigation'

export default function NativeBackNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const pathnameRef = useRef(pathname)
  const [showHint, setShowHint] = useState(false)
  const lastPress = useRef(null)

  useEffect(() => {
    pathnameRef.current = pathname
    lastPress.current = null
  }, [pathname])

  useEffect(() => {
    let handle = null
    let cancelled = false
    let hintTimer = null

    const setup = async () => {
      if (typeof window === 'undefined') return

      const capacitor = window.Capacitor
      if (!capacitor?.isNativePlatform?.()) return
      if (capacitor.getPlatform?.() !== 'android') return

      // The App plugin is compiled into the native shell. registerPlugin is
      // available from the Capacitor bridge even though the live web app is
      // served remotely by Vercel.
      const App = capacitor.Plugins?.App || capacitor.registerPlugin?.('App')
      if (!App?.addListener) return

      try {
        handle = await App.addListener('backButton', ({ canGoBack } = {}) => {
          const currentPath = pathnameRef.current || '/'

          const now = Date.now()
          const action = nativeBackAction(currentPath, canGoBack, window.history.length, lastPress.current, now)
          if (action === 'confirm') {
            lastPress.current = now
            setShowHint(true)
            window.clearTimeout(hintTimer)
            hintTimer = window.setTimeout(() => setShowHint(false), 2000)
            return
          }
          if (action === 'exit') {
            if (typeof App.exitApp === 'function') App.exitApp()
            return
          }

          // Prefer the real MGT browser history so Back behaves naturally.
          if (action === 'back') {
            window.history.back()
            return
          }

          // A deep-linked page may have no useful history. In that case the
          // first Back press takes the user to MGT Home instead of exiting.
          router.replace('/')
        })

        if (cancelled && handle?.remove) handle.remove()
      } catch {
        // Browser/PWA and older shells simply keep their normal Back behavior.
      }
    }

    setup()

    return () => {
      cancelled = true
      window.clearTimeout(hintTimer)
      if (handle?.remove) handle.remove()
    }
  }, [router])

  return showHint ? <div className="mgt-back-hint" role="status">Press Back again to close MGT</div> : null
}
