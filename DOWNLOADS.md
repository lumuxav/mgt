# MGT Business Suite — Downloads

MGT release packages are generated from the `universal-business-platform` branch.

## Android

The Android GitHub Actions workflow produces a directly installable test APK.

When these repository secrets are configured:

- `MGT_ANDROID_KEYSTORE_BASE64`
- `MGT_ANDROID_KEYSTORE_PASSWORD`
- `MGT_ANDROID_KEY_ALIAS`
- `MGT_ANDROID_KEY_PASSWORD`

the workflow can additionally produce signed release APK/AAB packages.

## PWA

Open the deployed MGT site in a supported browser and choose the browser's install / Add to Home Screen option.

## iOS

The repository validates the iOS Capacitor project using an unsigned simulator build. Physical-device or App Store distribution requires Apple Developer signing credentials.
