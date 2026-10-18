# Android, navigation, and Intelligence follow-up — 18 October 2026

This change applies to the MGT Business Suite repository and not to Maya.

- The native Android Capacitor WebView is explicitly detected and receives scoped scrolling/viewport styles. Mobile browsers, PWAs, and desktop instances do not receive the native-only overrides. The purpose is to prevent scroll container shifts when Android chrome, keyboard, or orientation changes.
- The mobile More sheet closes immediately when a destination is selected, including the active route. Escape also dismisses it. This fixes navigation remaining over the current page.
- Home now links to MGT Intelligence in its quick actions only when the Intelligence module is enabled and the session has insights.view. The underlying Intelligence RPC continues to enforce access in the database.
- The packaged Android connection-recovery page uses the shell's dark theme color.

These are navigation and presentation changes, with no database schema changes. The established Windows/macOS/Linux/Android release workflow will create updated downloadable packages from the merged commit. Physical Android installation and status-bar behavior should also be checked on a device after the CI build; simulator/browser test success is not a claim of completed physical-device verification.
