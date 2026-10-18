import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

test('Android viewport overrides are gated to the native Android Capacitor environment', () => {
  const viewport = read('app/components/MobileViewport.js')
  const css = read('app/mobile-native.css')
  assert.match(viewport, /Capacitor\?\.isNativePlatform\?\.\(\)/)
  assert.match(viewport, /getPlatform\?\.\(\) === 'android'/)
  assert.match(viewport, /delete root\.dataset\.mgtNativeAndroid/)
  assert.match(css, /html\[data-mgt-native-android="true"\] \.app-main/)
  assert.match(css, /html\[data-mgt-native-android="true"\]\[data-keyboard="open"\]/)
})

test('the More sheet closes when tapping any module and when pressing Escape', () => {
  const shell = read('app/components/AppShell.js')
  assert.equal((shell.match(/href=\{item\.href\} onClick=\{\(\)=>setMobileMenuOpen\(false\)\}/g) || []).length, 3)
  assert.match(shell, /moduleNavigation\.map\(category/)
  assert.match(shell, /personalNavigation\.map\(item/)
  assert.match(shell, /event\.key === 'Escape'/)
  assert.match(shell, /href="\/users" onClick=\{\(\)=>setMobileMenuOpen\(false\)\}/)
})

test('Intelligence Home shortcut is available only with its module and permission', () => {
  const home = read('app/page.js')
  assert.match(home, /supabase\.rpc\('current_permissions'\)/)
  assert.match(home, /const grants = new Set\(\(rows \|\| \[\]\)\.map\(row => row.permission\)\)/)
  assert.match(home, /moduleEnabled\(business, 'insights'\) && can\('insights.view'\)/)
})
