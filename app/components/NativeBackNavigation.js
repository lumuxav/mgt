'use client'

import { useEffect, useRef } from 'react'
import { usePathname, useRouter } from 'next/navigation'

export default function NativeBackNavigation() {
  const pathname = usePathname()
  const router = useRouter()
  const pathnameRef = useRef(pathname)

  useEffect(() => {
    pathnameRef.current = pathname
  }, [pathname])

  useEffect(() => {
    let handle = null
    let cancelled = false

    const setup = async () => {
      if (typeof window === 'undefined') return

      const capacitor = window.Capacitor
      if (!capacitor?.isNativePlatform?.()) return

      // The App plugin is compiled into the native shell. registerPlugin is
      // available from the Capacitor bridge even though the live web app is
      // served remotely by Vercel.
      const App = capacitor.Plugins?.App || capacitor.registerPlugin?.('App')
      if (!App?.addListener) return

      try {
        handle = await App.addListener('backButton', ({ canGoBack } = {}) => {
          const currentPath = pathnameRef.current || '/'

          // Home is the only screen from which the Android system Back button
          // is allowed to leave MGT.
          if (currentPath === '/' || currentPath === '/login') {
            if (typeof App.exitApp === 'function') App.exitApp()
            return
          }

          // Prefer the real MGT browser history so Back behaves naturally.
          if (canGoBack && window.history.length > 1) {
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
      if (handle?.remove) handle.remove()
    }
  }, [router])

  return null
}
