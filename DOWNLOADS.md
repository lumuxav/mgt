# MGT Business Suite — mobile and desktop apps

Open [MGT Business Suite](https://mgt-lake.vercel.app). The live [`/install` guide](https://mgt-lake.vercel.app/install) provides device instructions and the install button when supported. The login page links to that guide.

## Install on your device

| Device | Installation |
| --- | --- |
| Android, including Redmi | Open MGT in Chrome and choose **Install app** / **Add to Home screen**, or use the in-app Install button. |
| iPhone / iPad | Open MGT in Safari, then **Share → Add to Home Screen → Add**. |
| Windows / Linux | Open MGT in Chrome or Edge and choose the address-bar install icon or the browser's Install app menu. Pin the resulting app window as desired. |
| Mac | Install with Chrome/Edge, or choose **File → Add to Dock** in Safari on a supported macOS version. |

Browser app installation creates a standalone window and launcher icon. Desktop `.exe`/`.dmg` installers are not generated. If installation is unavailable in a browser, use the web app or a supported browser. Sign in with the same account on each device; business data and permissions are stored centrally.

Stock, sales, finance and other live operations require an internet connection. The app does not queue transactions offline. Reconnect to use the workspace; check transaction history before retrying an interrupted payment. When an update is ready, finish your work and choose **Update now**.

## Android APK

The [Android workflow](.github/workflows/build-android-apk.yml) generates test APK artifacts on pull requests. The production-branch build for release `5864a13` passed in [run 39057736752](https://github.com/lumuxav/mgt/actions/runs/39057736752) and updated the latest test APK on 17 October 2026 at 18:24 UTC. It includes the new MGT native icon and loads the updated production app. Signed production APK/AAB steps were skipped because the release signing configuration is incomplete; this APK remains a test-signed package. Production-branch builds publish [the latest test release](https://github.com/lumuxav/mgt/releases/tag/mgt-test-latest). This repository is private, so GitHub downloads require repository access. Build results must be checked before relying on a release asset; older assets may predate this revision.

- Test application ID: `com.mgt.businesssuite.test`.
- Signed production application ID: `com.mgt.businesssuite`.
- APK version codes increase with the workflow run number (`100000 + run_number`). Keep the workflow identity stable to preserve ordering.
- The test keystore is cached in GitHub Actions. Cache eviction can change its signing identity, requiring removal of the previous test install. Stable production upgrades depend on the production signing key.
- Older test builds used the production application ID. The new test package installs alongside them; confirm which icon/package you are opening. Do not remove a production install as a routine test-upgrade step.

These existing repository secrets enable signed APK/AAB generation on the production branch:

- `MGT_ANDROID_KEYSTORE_BASE64`
- `MGT_ANDROID_KEYSTORE_PASSWORD`
- `MGT_ANDROID_KEY_ALIAS`
- `MGT_ANDROID_KEY_PASSWORD`

Keep the keystore and passwords backed up securely. Signed packages are published to [the stable release](https://github.com/lumuxav/mgt/releases/tag/mgt-latest) only when signing is configured. Pull-request builds do not publish releases.

## iOS native build

The [iOS workflow](.github/workflows/validate-ios.yml) builds an unsigned simulator app with the camera usage description and pinned Capacitor plugins. An unsigned simulator build is not an installable iPhone package. TestFlight, physical-device and App Store distribution need Apple signing and provisioning. The Safari installation option above is available independently.

## Icon and web updates

This release uses the new MGT lettermark on mobile and desktop. Web changes follow the production deployment; choose **Update now** when offered. An installed PWA may retain its launcher icon until the browser refreshes the manifest; reinstalling the PWA can refresh it. Native Android/iOS launcher icons require the new package built from `assets/logo.svg`. The public install guide does not link to debug builds.

## Maintainers

Capacitor tools are pinned in `package-lock.json`; use `npm ci`. The workflows generate platform projects, icons and splash assets. Native shells load the MGT HTTPS deployment; ordinary web changes become available through that deployment, while changes to plugins, permissions, signing, native configuration or packaged fallback assets require a new native build.

`server.errorPath` loads the bundled recovery page if the native shell cannot open the remote application. Camera scanning always retains manual entry. Android hardware Back navigates within the app and asks for a second press before closing at Home or Login.

See [the audit and verification limits](docs/UNIVERSAL_INTEGRITY_AND_APPS_AUDIT.md) before production distribution.
