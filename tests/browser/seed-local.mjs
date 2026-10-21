import { createClient } from '@supabase/supabase-js'
import fs from 'node:fs/promises'

const url=process.env.NEXT_PUBLIC_SUPABASE_URL
const secret=process.env.SUPABASE_SERVICE_ROLE_KEY
if(url!=='http://127.0.0.1:54321'||!secret)throw Error('CI fixtures require disposable localhost Supabase only')
const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}})
const roles=['owner','admin','manager','branch_manager','cashier','salesperson','storekeeper',
  'procurement_officer','accountant','hr_officer','production_staff','technician',
  'project_worker','delivery_driver','employee']
const modules=['dashboard','pos','inventory','sales','customers','suppliers','purchasing','services',
'manufacturing','finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','payments','integrations','insights']
const password='MgtTemporaryBrowserOnly!9416'
async function checked(result,desc){
 if(result.error)throw Error(desc+': '+result.error.message)
 return result.data
}
const company=await checked(await admin.from('organizations').insert({name:'CI MGT Browser Acceptance',short_name:'CI MGT',active:true,timezone:'Africa/Kampala'}).select('id').single(),'create local company')
const foreign=await checked(await admin.from('organizations').insert({name:'CI Unrelated Tenant',active:true}).select('id').single(),'create unrelated company')
await checked(await admin.rpc('seed_default_roles',{p_organization_id:company.id}),'initialize default roles')
await checked(await admin.rpc('seed_default_roles',{p_organization_id:foreign.id}),'initialize foreign roles')
const office=await checked(await admin.from('locations').insert({organization_id:company.id,name:'Acceptance Main Branch',type:'branch',active:true}).select('id').single(),'create main branch')
const otherOffice=await checked(await admin.from('locations').insert({organization_id:company.id,name:'Acceptance Second Branch',type:'branch',active:true}).select('id').single(),'create second branch')
const foreignOffice=await checked(await admin.from('locations').insert({organization_id:foreign.id,name:'Foreign Branch',type:'branch',active:true}).select('id').single(),'create unrelated branch')
await checked(await admin.from('organization_modules').upsert(modules.map(module_key=>({organization_id:company.id,module_key,enabled:true})),{onConflict:'organization_id,module_key'}),'enable local modules')
const accounts={}
for(const role of [...roles,'foreign_owner']){
 const email='ci-'+role+'@mgt-browser.invalid'
 const d=await checked(await admin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:'CI '+role}}),'create local auth identity for '+role)
 const user=d.user
 if(!user?.id)throw Error('Auth identity missing for '+role)
 const separate=role==='foreign_owner'
 const roleName=separate?'owner':role
 const orgId=separate?foreign.id:company.id
 const locId=separate?foreignOffice.id:office.id
 await checked(await admin.from('users').upsert({
 id:user.id,email,full_name:'CI '+role,role:roleName,organization_id:orgId,
 default_location_id:locId,active:true,archived_at:null
 },{onConflict:'id'}),'upsert local MGT profile '+role)
 accounts[role]={email,password,id:user.id,role:roleName}
}
const checkoutProduct=await checked(await admin.from('products').insert({
 organization_id:company.id,name:'CI Checkout Retry Item',selling_price:1000,cost_price:400,
 track_inventory:true,item_type:'product',active:true
}).select('id').single(),'create checkout test product')
await checked(await admin.from('stock_balances').insert({
 product_id:checkoutProduct.id,location_id:office.id,quantity:10,reserved_quantity:0
}),'seed checkout stock')
const workOrder=await checked(await admin.from('work_orders').insert({
 organization_id:company.id,location_id:office.id,title:'CI Assigned Device Repair',
 assigned_to:accounts.technician.id,quoted_amount:90000
}).select('id').single(),'create assigned technician work')
await checked(await admin.from('work_orders').insert({
 organization_id:company.id,location_id:otherOffice.id,title:'CI Different Branch Device Repair',
 assigned_to:accounts.technician.id,quoted_amount:130000
}),'create out-of-branch technician work')
await checked(await admin.from('user_work_scope').upsert({
 organization_id:company.id,user_id:accounts.technician.id,
 scope:'location',location_id:office.id
 },{onConflict:'organization_id,user_id'}),'restrict technician to assigned branch')
const delivery=await checked(await admin.from('deliveries').insert({
 organization_id:company.id,source_location_id:office.id,driver_user_id:accounts.delivery_driver.id,
 delivery_number:'CI-E2E-DLV-001',status:'dispatched',destination:'CI Customer Test Address'
}).select('id').single(),'create assigned driver delivery')
const failedDelivery=await checked(await admin.from('deliveries').insert({
 organization_id:company.id,source_location_id:office.id,driver_user_id:accounts.delivery_driver.id,
 delivery_number:'CI-E2E-DLV-002',status:'dispatched',destination:'CI Failed Delivery Address'
}).select('id').single(),'create second assigned delivery for failed-proof test')
await checked(await admin.from('work_orders').insert({
 organization_id:foreign.id,location_id:foreignOffice.id,title:'Unrelated Company Confidential Job',
 assigned_to:accounts.foreign_owner.id,quoted_amount:555000
}),'create foreign private work order')
// Verify the public browser key can authenticate a real seeded account.
const publicKey=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if(!publicKey)throw Error('Local browser anon key unavailable')
const anonymous=createClient(url,publicKey,{auth:{persistSession:false,autoRefreshToken:false}})
const trial=await anonymous.auth.signInWithPassword({email:accounts.owner.email,password})
if(trial.error||!trial.data?.session?.access_token){
 throw Error('Disposable account password authentication failed before browser launch: '+(trial.error?.message||'no session'))
}
await anonymous.auth.signOut()
console.log('Local Supabase public-key owner password authentication verified')
const data={accounts,orgId:company.id,officeId:office.id,otherOfficeId:otherOffice.id,
 checkoutProductId:checkoutProduct.id,
 workOrderId:workOrder.id,deliveryId:delivery.id,failedDeliveryId:failedDelivery.id}
await fs.writeFile('/tmp/mgt-e2e-fixtures.json',JSON.stringify(data))
console.log('Prepared '+roles.length+' disposable staff logins, one external tenant, branch-scoped service work and an assigned delivery')
