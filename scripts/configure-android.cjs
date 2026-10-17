const fs = require('node:fs')
const run = Number(process.env.MGT_BUILD_NUMBER)
if (!Number.isSafeInteger(run) || run < 1 || run > 2099800000) throw new Error('MGT_BUILD_NUMBER must be a positive build number')
const path = 'android/app/build.gradle'
const source = fs.readFileSync(path, 'utf8')
if (!/versionCode\s+\d+/.test(source) || !/versionName\s+"[^"]+"/.test(source)) throw new Error('Unexpected Android Gradle template')
const updated = source.replace(/versionCode\s+\d+/, `versionCode ${200000 + run}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "1.1.${run}"`)
fs.writeFileSync(path, updated + `
android {
    buildTypes {
        debug {
            applicationIdSuffix ".test"
            versionNameSuffix "-test"
        }
    }
}
`)
