# MGT safe-area and round icon release

- Applies exclusively to `lumuxav/mgt`, not Maya. No schema/data/auth changes.
- Platform Setup, owner onboarding, sign-in, password-recovery and install pages include a standalone safe-area class. Android WebView receives an additional top inset to keep headings beneath the status bar. Desktop workspace layout is unchanged.
- The approved MGT logo's outer rectangular border is excluded from the circular launcher composition; its letterforms and upward-trending chart remain. Icons are deterministically regenerated from `assets/icon.png`. Web/PWA icons have transparent outer corners; the Android adaptive-mask version uses an opaque dark background and a smaller safe-zone mark.
- The build-android workflow regenerates the native round launcher only in its build checkout; the signed production Android APK/AAB still require Android keystore secrets. Native Windows/macOS/Linux apps use the regenerated desktop-facing icon.
- PNG metadata MIME declarations, versioned URLs and offline shell cache are updated. Reinstall an existing Android test application to refresh launcher caching where necessary.
- After merging, verify the Vercel deployment commit and all new GitHub release packages. Physical Android status-bar/icon validation remains a separate acceptance check.
