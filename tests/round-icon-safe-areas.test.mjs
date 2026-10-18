import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const load = (path) => readFileSync(new URL('../'+path, import.meta.url), 'utf8')
test('standalone screens have status-bar safe-area padding', () => {
  for (const page of ['setup','onboarding','login','forgot-password','reset-password','install']) {
    assert.match(load('app/'+page+'/page.js'), /mgt-standalone-safe-page/, page)
  }
  const css=load('app/mobile-native.css')
  assert.match(css,/env\(safe-area-inset-top, 0px\)/)
  assert.match(css,/html\[data-mgt-native-android="true"\] \.mgt-standalone-safe-page/)
})
test('browser icon branding references current round PNGs with accurate MIME types', () => {
  assert.match(load('app/components/MgtMark.js'), /rounded-full/)
  const layout=load('app/layout.js')
  assert.match(layout, /mgt-icon-512\.png\?v=4", type: "image\/png"/)
  const manifest=load('app/manifest.js')
  assert.match(manifest, /mgt-icon-maskable-512\.png\?v=4/)
  assert.doesNotMatch(manifest, /image\/svg\+xml/)
  assert.match(load('public/sw.js'), /mgt-shell-v8/)
})
test('Android release generates padded launcher from the approved source', () => {
  const workflow=load('.github/workflows/build-android-apk.yml')
  assert.match(workflow, /generate-mgt-round-icons\.py --android/)
  const script=load('scripts/generate-mgt-round-icons.py')
  assert.match(script, /assets/)
  assert.match(script, /mgt-icon-maskable-512\.png/)
  assert.match(script, /ImageChops.multiply/)
})
