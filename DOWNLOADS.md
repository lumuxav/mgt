# MGT Business Suite — app downloads

**[Download the latest release](https://github.com/lumuxav/mgt/releases/latest)** and expand **Assets**. Android and all desktop packages are published together. This is a private repository: sign into a GitHub account with repository access to download. The in-app [installation page](https://mgt-lake.vercel.app/install) links here as well.

| Device | File in the latest release | Installation |
| --- | --- | --- |
| Android / Redmi | `MGT-Business-Suite-Test.apk` | Download on the phone, open the APK, and allow installation from that source if prompted. It is test-signed and uses a separate app identity. |
| Windows 10/11, Intel/AMD 64-bit | `MGT-Business-Suite-Windows-x64.exe` | Run the installer and choose the installation folder. The installer is unsigned; Windows may show an unknown-publisher warning. |
| Mac with Apple silicon | `MGT-Business-Suite-macOS-arm64.dmg` | Open the disk image and drag MGT to Applications. It has an ad-hoc signature, without Apple notarization. |
| Mac with Intel processor | `MGT-Business-Suite-macOS-x64.dmg` | Use the Intel image. Signing status is the same as the Apple-silicon package. |
| Linux, Intel/AMD 64-bit | `MGT-Business-Suite-Linux-x64.AppImage` | Mark the file executable and open it. AppImage support/FUSE may be required by the distribution. |
| iPhone / iPad | Browser installation | Open MGT in Safari, then **Share → Add to Home Screen → Add**. No installable IPA is published. |

The release includes `SHA256SUMS.txt` to verify the downloaded files. No installer disables operating-system security checks. Linux AppImages require working user namespaces for Chromium sandboxing; MGT refuses an unsandboxed launch. Use browser installation if your distribution or device policy does not permit the package.

## Browser installation

Open [MGT](https://mgt-lake.vercel.app/install). Android/Redmi Chrome and desktop Chrome/Edge offer **Install app** or the address-bar install icon. iPhone/iPad use Safari's **Add to Home Screen**; supported macOS Safari versions offer **File → Add to Dock**.

Sign in with the same MGT account across devices. Business records and permissions are stored centrally. Stock, sales and financial operations require connectivity; transactions are not queued offline. If a payment is interrupted, check its history before retrying.

## Updates

Web changes arrive through the production deployment. Finish work before choosing **Update now** when offered. Native icons, permissions and desktop runtime changes require installing a new package. In the desktop app, use **Help → Latest app downloads**. This private repository does not support anonymous installer downloads or automatic desktop binary updates.

The desktop application opens the MGT production HTTPS origin in a sandboxed window. It provides print, zoom, save-file dialogs and a bundled connection-recovery page. External HTTPS links ask before opening in your browser. Camera barcode scanning asks for permission. It does not grant Node.js or filesystem APIs to the web application.

## Android signing and upgrades

- Test application ID: `com.mgt.businesssuite.test`; production ID: `com.mgt.businesssuite`.
- The test signing key uses the existing Actions cache `mgt-android-test-keystore-v1`. Cache eviction can change this identity and prevent upgrading an older test install. Production upgrade continuity needs the existing production key.
- Release workflow versions use `1.1.<release run number>` and Android version codes `200000 + release run number`, above the earlier `100000 + run number` series. Keep the release workflow identity stable. Standalone validation artifacts are not release packages.
- Old test APKs used the production application ID; the separate test application can coexist. Confirm which app you are opening rather than removing a production install.

The production signing secrets are `MGT_ANDROID_KEYSTORE_BASE64`, `MGT_ANDROID_KEYSTORE_PASSWORD`, `MGT_ANDROID_KEY_ALIAS`, and `MGT_ANDROID_KEY_PASSWORD`. The workflow uses them only on the production branch. When all are configured, the same latest release also includes `MGT-Business-Suite-Release.apk` for direct installation and `MGT-Business-Suite-Release.aab` for Google Play. Never replace an existing signing key to solve an upgrade failure.

The prior fixed `mgt-test-latest` tag remains historical. New packages are published under versioned `mgt-v1.1.<run number>` tags, pointing to their source commit; use `/releases/latest` to find the current release.

## Build and publication

[Release MGT Apps](.github/workflows/release-apps.yml) runs on production-branch changes to native/desktop code, icons, package dependencies and app build workflows, or manually on that branch. It calls the Android and desktop builds with the same version, waits for all targets, verifies required files, creates checksums, uploads into a draft, then marks the complete release **Latest**. Failed builds leave the previous release available. Re-running a published release leaves its packages unchanged.

Pull requests validate packages without publishing releases. Desktop pull-request builds do not upload duplicate installers. Release-staging artifacts expire after one day; the published release assets remain available. iOS has a separate unsigned simulator validation workflow; TestFlight/App Store/device distribution requires Apple certificates and provisioning.

Local desktop commands:

```bash
cd desktop
npm ci
npm test
npm start
npm run dist -- --win --x64
# On macOS: npm run dist -- --mac --arm64
# On Linux: npm run dist -- --linux --x64
```

Use the matching operating system for each build. Root `npm ci` and the Android workflow generate the Capacitor project, icon and splash assets. Ordinary web updates do not need rebuilding every package. Desktop dependencies have a separate lockfile and do not increase the Vercel runtime dependency set.
