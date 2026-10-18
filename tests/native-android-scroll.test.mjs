import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const css = readFileSync(new URL('../app/mobile-native.css', import.meta.url), 'utf8')
const nativeBlock = css.slice(css.indexOf('/* The installed Android WebView uses document scrolling'))
const nativeStyle = nativeBlock.split('/* Standalone screens need real safe-area')[0]

test('Android native root and body are not scroll locked', () => {
  assert.match(nativeStyle, /html\[data-mgt-native-android="true"\] body\s*\{/)
  assert.match(nativeStyle, /height: auto;/)
  assert.match(nativeStyle, /overflow-y: auto;/)
  assert.match(nativeStyle, /touch-action: pan-y pinch-zoom;/)
  assert.doesNotMatch(nativeStyle, /overflow:\s*hidden\s*;/)
})

test('Android pages use document scrolling, not nested height-constrained app-main', () => {
  assert.match(nativeStyle, /html\[data-mgt-native-android="true"\] \.app-shell\s*\{[^}]*height: auto;[^}]*max-height: none;[^}]*overflow: visible;/s)
  assert.match(nativeStyle, /html\[data-mgt-native-android="true"\] \.app-main\s*\{[^}]*height: auto;[^}]*overflow: visible;/s)
  assert.match(nativeStyle, /html\[data-mgt-native-android="true"\] \.app-content\s*\{[^}]*overflow: visible;/s)
})

test('safe-area, Android-only gating, and non-Android layouts remain in place', () => {
  assert.match(css, /html\[data-mgt-native-android="true"\] \.mgt-standalone-safe-page/)
  assert.match(css, /env\(safe-area-inset-top, 0px\)/)
  assert.match(nativeStyle, /@media \(max-width: 900px\)/)
  assert.doesNotMatch(nativeStyle, /(^|\n)\s*(?:html|body)\s*\{/) 
})

test('mobile CSS changes trigger both release builds and Android CI', () => {
  const workflows = [
    readFileSync(new URL('../.github/workflows/release-apps.yml', import.meta.url), 'utf8'),
    readFileSync(new URL('../.github/workflows/build-android-apk.yml', import.meta.url), 'utf8'),
  ]
  for (const workflow of workflows) assert.match(workflow, /app\/mobile-native\.css/)
})
