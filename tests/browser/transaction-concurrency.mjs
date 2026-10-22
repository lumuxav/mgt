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
const worker=createClient(url,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,options)
await ok(await worker.auth.signInWithPassword({email:fixture.accounts.project_worker.email,password:fixture.accounts.project_worker.password}))
const project=await ok(await caller.rpc('create_project',{p_location_id:fixture.officeId,p_customer_id:null,p_name:'Concurrent worker time'}))
await ok(await caller.rpc('assign_project_member',{p_project_id:project.project_id,p_user_id:fixture.accounts.project_worker.id}))
const time={p_project_id:project.project_id,p_task_id:null,p_work_date:'2026-10-20',p_hours:1,p_description:'Concurrent worker regression'}
const logged=await Promise.all([caller.rpc('log_project_time',time),worker.rpc('log_project_time',time)])
for(const response of logged)await ok(response)
const timesheets=await ok(await admin.from('project_timesheets').select('hours').eq('project_id',project.project_id))
assert.equal(timesheets.reduce((sum,row)=>sum+Number(row.hours),0),2)
console.log('PASS concurrent workers on one project: both timesheets and totals commit without lock-upgrade deadlocks')
const refundBank=await ok(await admin.from('bank_accounts').insert({organization_id:fixture.orgId,name:'Concurrent refund bank',account_type:'bank',opening_balance:100}).select('id').single())
const refundProduct=await ok(await admin.from('products').insert({organization_id:fixture.orgId,name:'Concurrent refund material',selling_price:10,cost_price:4,track_inventory:true}).select('id').single())
await ok(await admin.from('stock_balances').insert({product_id:refundProduct.id,location_id:fixture.officeId,quantity:5}))
const refundJob=await ok(await caller.rpc('create_service_work_order',{p_location_id:fixture.officeId,p_customer_id:null,p_title:'Concurrent refund job'}))
await ok(await caller.rpc('add_work_order_line',{p_work_order_id:refundJob.work_order_id,p_line_type:'material',p_product_id:refundProduct.id,p_description:'Refund material',p_quantity:1,p_unit_price:10,p_unit_cost:4}))
await ok(await caller.rpc('record_work_order_payment',{p_work_order_id:refundJob.work_order_id,p_amount:10,p_method:'bank'}))
const cancellation={p_request_id:randomUUID(),p_work_order_id:refundJob.work_order_id,p_reason:'Concurrent return',p_expected_refund_amount:10,p_refund_method:'bank',p_bank_account_id:refundBank.id,p_reference:'CONCURRENT-REFUND',p_restore_materials:true}
const refunds=await Promise.all([caller.rpc('cancel_service_work_order',cancellation),caller.rpc('cancel_service_work_order',cancellation)])
for(const result of refunds)await ok(result)
assert.equal(refunds[0].data.payment_id,refunds[1].data.payment_id)
const out=await ok(await admin.from('payments').select('id').eq('work_order_id',refundJob.work_order_id).eq('direction','out'))
assert.equal(out.length,1)
const restored=await ok(await admin.from('stock_balances').select('quantity').eq('product_id',refundProduct.id).single())
assert.equal(Number(restored.quantity),5)
const bank=await ok(await caller.rpc('get_bank_account_summaries').eq('id',refundBank.id).single())
assert.equal(Number(bank.balance),90)
console.log('PASS concurrent cancellation retries: one refund, one bank withdrawal, one stock return')
await worker.auth.signOut()
await caller.auth.signOut()
