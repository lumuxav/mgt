import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL
if(url!=='http://127.0.0.1:54321')throw Error('Concurrency fixtures require disposable localhost Supabase')
const fixture=JSON.parse(await fs.readFile('/tmp/mgt-e2e-fixtures.json','utf8'))
const options={auth:{persistSession:false,autoRefreshToken:false}}
const admin=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,options)
const caller=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options)
async function ok(result){if(result.error)throw result.error;return result.data}
await ok(await caller.auth.signInWithPassword({email:fixture.accounts.owner.email,password:fixture.accounts.owner.password}))
const product=await ok(await admin.from('products').insert({organization_id:fixture.orgId,name:'Concurrent stock fixture',selling_price:10,cost_price:4,track_inventory:true}).select('id').single())
await ok(await admin.from('stock_balances').insert({product_id:product.id,location_id:fixture.officeId,quantity:2}))
const payload={p_request_id:randomUUID(),p_location_id:fixture.officeId,p_customer_id:null,p_items:[{product_id:product.id,quantity:1}],p_payments:[{method:'bank',amount:10}]}
const same=await Promise.all([caller.rpc('post_pos_sale_once',payload),caller.rpc('post_pos_sale_once',payload)])
for(const response of same)await ok(response)
assert.equal(same[0].data.sale_id,same[1].data.sale_id)
let stock=await ok(await admin.from('stock_balances').select('quantity').eq('product_id',product.id).eq('location_id',fixture.officeId).single())
assert.equal(Number(stock.quantity),1)
const payments=await ok(await admin.from('payments').select('id').eq('sale_id',same[0].data.sale_id))
assert.equal(payments.length,1)
console.log('PASS concurrent identical checkout: one sale, stock movement and payment')

const competing=await Promise.all([caller.rpc('post_pos_sale_once',{...payload,p_request_id:randomUUID()}),caller.rpc('post_pos_sale_once',{...payload,p_request_id:randomUUID()})])
assert.equal(competing.filter(x=>!x.error).length,1)
assert.match(competing.find(x=>x.error).error.message,/Insufficient stock/)
stock=await ok(await admin.from('stock_balances').select('quantity').eq('product_id',product.id).eq('location_id',fixture.officeId).single())
assert.equal(Number(stock.quantity),0)
console.log('PASS concurrent last-unit checkout: exactly one buyer succeeds')

const periods=await Promise.all([
 caller.rpc('create_payroll_period',{p_name:'Concurrent payroll A',p_start_date:'2026-03-01',p_end_date:'2026-03-31'}),
 caller.rpc('create_payroll_period',{p_name:'Concurrent payroll B',p_start_date:'2026-03-15',p_end_date:'2026-04-15'})
])
assert.equal(periods.filter(x=>!x.error).length,1)
assert.match(periods.find(x=>x.error).error.message,/overlaps/)
console.log('PASS concurrent payroll periods: overlapping request is rejected')
await caller.auth.signOut()
