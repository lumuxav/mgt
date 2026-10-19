import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
const read = file => readFileSync(new URL('../' + file, import.meta.url),'utf8')

test('home shows effective combined roles rather than only primary employee label',()=>{
  const page=read('app/page.js')
  assert.match(page,/supabase\.rpc\('mgt_current_roles'\)/)
  assert.match(page,/jobRoles\.map\(role => role\.replaceAll/)
  assert.match(page,/loadBusinessConfigFromDatabase/)
})

test('sales page never sends a worker to a disabled POS checkout',()=>{
  const page=read('app/sales/page.js')
  assert.match(page,/const posReady = moduleEnabled\(business, 'pos'\)/)
  assert.match(page,/canSell && posReady && <Link href="\/pos"/)
  assert.match(page,/Point of Sale is disabled in this business/)
  assert.match(page,/has no active products or services to sell/)
  assert.doesNotMatch(page,/<Link href="\/pos" className="btn-primary[^"]*">Open POS<\/Link>/)
})

test('My Work explains disabled modules and missing work without granting authority',()=>{
  const page=read('app/my-work/page.js')
  assert.match(page,/Work setup needed/)
  assert.match(page,/No active delivery trip is assigned to you/)
  assert.match(page,/The business owner must enable POS/)
  assert.match(page,/granted\.includes\('catalog.view'\)/)
  assert.doesNotMatch(page,/update\('role_permissions'\)|insert\('role_permissions'\)/)
})

test('existing transaction and assignment security remain in charge',()=>{
  const workspace=read('app/my-work/page.js')
  assert.match(workspace,/supabase\.rpc\('mgt_update_assigned_delivery'/)
  assert.match(workspace,/supabase\.rpc\('mgt_my_work'/)
  const pos=read('app/pos/page.js')
  assert.match(pos,/supabase\.rpc\('post_pos_sale'/)
})
