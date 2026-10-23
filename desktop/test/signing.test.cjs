const { test } = require('node:test')
const assert = require('node:assert/strict')
const { signingPlan } = require('../build-release.cjs')
const production = { GITHUB_REF: 'refs/heads/universal-business-platform', GITHUB_EVENT_NAME: 'push' }

test('partial production credentials fail rather than publishing unsigned output', () => {
  assert.throws(() => signingPlan('Windows', { ...production, MGT_WINDOWS_CERTIFICATE_BASE64: 'certificate' }), /Incomplete signing configuration/)
  assert.throws(() => signingPlan('macOS', { ...production, MGT_MAC_CERTIFICATE_BASE64: 'certificate', MGT_MAC_CERTIFICATE_PASSWORD: 'password' }), /MGT_APPLE_API_KEY_BASE64/)
})
test('pull requests and nonproduction branches cannot enable signing', () => {
  const secrets = { MGT_WINDOWS_CERTIFICATE_BASE64: 'certificate', MGT_WINDOWS_CERTIFICATE_PASSWORD: 'password' }
  assert.equal(signingPlan('Windows', { ...production, ...secrets, GITHUB_EVENT_NAME: 'pull_request' }).signed, false)
  assert.equal(signingPlan('Windows', { ...production, ...secrets, GITHUB_REF: 'refs/heads/feature' }).signed, false)
})
test('signing status distinguishes missing credentials from configured credentials', () => {
  assert.equal(signingPlan('macOS', production).status, 'Ad-hoc signature; not notarized')
  assert.equal(signingPlan('Windows', { ...production, MGT_WINDOWS_CERTIFICATE_BASE64: 'certificate', MGT_WINDOWS_CERTIFICATE_PASSWORD: 'password' }).signed, true)
  assert.equal(signingPlan('Linux', production).signed, false)
})
