# Android scrolling regression and release hotfix (18 October 2026)

**Regression:** MGT 1.1.4 installed Android WebView set `overflow: hidden` on both `html` and `body` and required `.app-main` to scroll internally. Standalone routes such as Setup/Login/Onboarding are rendered without `.app-shell`, leaving no scrollable ancestor and preventing access to the bottom of forms. On some authenticated routes, nested scroll containment could also make gestures appear ineffective.

**Repair:** Android-only CSS now uses a normal vertically scrolling document. The shell and main page grow naturally instead of pinning a fixed-height overflow area. The bottom navigation stays fixed and the mobile header remains sticky. Login, registration, setup, recovery and installation pages retain the safe-area top padding from 1.1.4. The corrected Android rules remain behind the native Capacitor platform check, so desktop, iOS and mobile browser styles are unchanged.

Both Android pull-request CI and the coordinated app-release workflow now trigger on changes to `app/mobile-native.css` or `app/components/MobileViewport.js`, so Android layout hotfixes reliably produce a fresh APK.

**Validation:** Automated source-level regression tests verify native document scrolling, isolated Android selectors, preserved safe-area spacing and future release triggers. Browser-level/physical-device swipe testing is still required before claiming device acceptance; do not mistake CI compilation for physical verification. No database/auth changes, and Maya is untouched.
