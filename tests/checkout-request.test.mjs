import test from 'node:test'
import assert from 'node:assert/strict'
import { webcrypto } from 'node:crypto'
import { checkoutRequest, finishCheckout } from '../lib/checkoutRequest.js'

function storage() {
  const entries = new Map()
  return { getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value), removeItem: key => entries.delete(key), entries }
}
test('lost checkout response retains the same request ID without storing customer/payment data', async () => {
  const s = storage(), payload = { customer: 'private-customer', amount: 5000 }
  const id = await checkoutRequest(s, webcrypto, 'business/user', payload)
  assert.equal(await checkoutRequest(s, webcrypto, 'business/user', payload), id)
  assert.ok(!JSON.stringify([...s.entries]).includes('private-customer'))
  assert.ok(!JSON.stringify([...s.entries]).includes('5000'))
  assert.notEqual(await checkoutRequest(s, webcrypto, 'business/other-user', payload), id)
  assert.notEqual(await checkoutRequest(s, webcrypto, 'other-business/user', payload), id)
})
test('a changed cart or a confirmed sale starts a new checkout', async () => {
  const s = storage()
  const first = await checkoutRequest(s, webcrypto, 'org/user', { quantity: 1 })
  const second = await checkoutRequest(s, webcrypto, 'org/user', { quantity: 2 })
  assert.notEqual(first, second)
  finishCheckout(s, 'org/user')
  assert.notEqual(await checkoutRequest(s, webcrypto, 'org/user', { quantity: 2 }), second)
})
test('corrupt cache recovers and unavailable storage stops before posting', async () => {
  const s = storage()
  s.setItem('mgt.checkout.org/user', '{broken')
  assert.match(await checkoutRequest(s, webcrypto, 'org/user', {}), /^[0-9a-f-]{36}$/)
  await assert.rejects(checkoutRequest({ getItem() {}, setItem() { throw Error('storage blocked') } }, webcrypto, 'org/user', {}), /storage blocked/)
})
