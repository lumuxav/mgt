import test from 'node:test'
import assert from 'node:assert/strict'
import { purchasePayable } from '../lib/balances.js'

test('supplier debt includes approved orders and excludes drafts or rejected approvals', () => {
  const order = { status: 'ordered', approval_status: 'approved', total_amount: 100, amount_paid: 30 }
  assert.equal(purchasePayable(order), 70)
  assert.equal(purchasePayable({ ...order, approval_status: 'not_required' }), 70)
  for (const status of ['draft','pending_approval','rejected','cancelled']) {
    assert.equal(purchasePayable({ ...order, status }), 0)
  }
  for (const approval_status of ['pending','rejected']) {
    assert.equal(purchasePayable({ ...order, approval_status }), 0)
  }
  assert.equal(purchasePayable({ ...order, amount_paid: 100 }), 0)
})
