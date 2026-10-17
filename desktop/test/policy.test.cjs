const test = require('node:test')
const assert = require('node:assert/strict')
const { isAppUrl, isExternalUrl, canRequestCamera } = require('../policy.cjs')

test('only the production HTTPS origin can navigate inside the desktop app', () => {
  assert.ok(isAppUrl('https://mgt-lake.vercel.app/pos?barcode=123'))
  for (const url of ['http://mgt-lake.vercel.app', 'https://mgt-lake.vercel.app.evil.invalid', 'https://mgt-lake.vercel.app@evil.invalid', 'https://user@mgt-lake.vercel.app', 'file:///etc/passwd', 'javascript:alert(1)', 'https://mgt-lake.vercel.app:8443']) assert.equal(isAppUrl(url), false, url)
})
test('external links reject protocols that can launch local applications or execute code', () => {
  assert.ok(isExternalUrl('https://github.com/lumuxav/mgt/releases/latest'))
  for (const url of ['javascript:alert(1)', 'file:///tmp/app', 'ms-settings:privacy', 'http://example.com', 'https://user:password@example.com', 'invalid']) assert.equal(isExternalUrl(url), false, url)
})
test('camera permission requires the main production frame and video only', () => {
  const top = 'https://mgt-lake.vercel.app/pos'
  const details = {requestingUrl:top,isMainFrame:true,mediaTypes:['video']}
  assert.ok(canRequestCamera(top, 'media', details))
  for (const change of [{isMainFrame:false},{requestingUrl:'https://evil.invalid'},{mediaTypes:['audio']},{mediaTypes:['video','audio']},{mediaTypes:[]},{mediaTypes:undefined}]) assert.equal(canRequestCamera(top, 'media', {...details,...change}), false)
  assert.equal(canRequestCamera('https://evil.invalid', 'media', details), false)
  assert.equal(canRequestCamera(top, 'geolocation', details), false)
})
