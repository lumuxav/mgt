import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'

const base='http://127.0.0.1:3000'
const fixture=JSON.parse(await fs.readFile('/tmp/mgt-e2e-fixtures.json','utf8'))
if(process.env.NEXT_PUBLIC_SUPABASE_URL!=='http://127.0.0.1:54321')throw Error('Browser writes require disposable localhost Supabase')
const admin=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}})
const browser=await chromium.launch({headless:true,args:['--no-sandbox']})
const roles=['owner','admin','manager','branch_manager','cashier','salesperson','storekeeper',
 'procurement_officer','accountant','hr_officer','production_staff','technician',
 'project_worker','delivery_driver','employee']
const workspaces={
 owner:'/users',admin:'/users',manager:'/sales',branch_manager:'/sales',
 cashier:'/pos',salesperson:'/sales',storekeeper:'/inventory',
 procurement_officer:'/purchasing',accountant:'/cashbook',hr_officer:'/hr',
 production_staff:'/production',technician:'/my-work',project_worker:'/my-work',
 delivery_driver:'/my-work',employee:'/my-work'
}
const deadline=25000
let checks=0
const failures=[]
const contexts={}
async function ready(page,path,heading){
 await page.goto(base+path,{waitUntil:'domcontentloaded',timeout:deadline})
 await page.getByRole('heading',{name:heading,exact:true}).first().waitFor({state:'visible',timeout:deadline})
}
function check(ok,msg){assert.ok(ok,msg);checks++}
try{
 for(const role of roles){
  const context=await browser.newContext({viewport:{width:role==='employee'?390:1280,height:850}})
  contexts[role]=context
  const page=await context.newPage()
  const errors=[]
  page.on('pageerror',e=>errors.push(e.message))
  const authCalls=[]
  const browserTrace=[]
  const failedRequests=[]
  page.on('console',message=>{
    if(message.text().startsWith('MGT_CI_LOGIN_'))browserTrace.push(message.text())
  })
  page.on('requestfailed',request=>failedRequests.push({
    url:request.url().split('?')[0],error:request.failure()?.errorText||'network error'
  }))
  page.on('response',response=>{
    if(response.url().includes('/auth/v1/') || response.url().includes('/rest/v1/') || response.url().includes('/rpc/')) {
      authCalls.push({status:response.status(),url:response.url().split('?')[0]})
    }
  })
  try{
   await page.goto(base+'/login',{waitUntil:'domcontentloaded',timeout:deadline})
   // Next.js may server-render the fields before React registers onChange.
   // Filling inputs before hydration causes signInWithPassword('','') without any HTTP request.
   await page.waitForFunction(()=>Boolean(document.querySelector('#email')?._valueTracker)
       && Boolean(document.querySelector('#password')?._valueTracker),undefined,{timeout:deadline})
   await page.locator('#email').fill(fixture.accounts[role].email)
   await page.locator('#password').fill(fixture.accounts[role].password)
   await page.getByRole('button',{name:'Sign in',exact:true}).click()
   await page.waitForURL(url=>new URL(url).pathname==='/',{timeout:deadline})
   check(true,role+' login')
   await ready(page,'/my-work','My Work')
   check(!(await page.getByRole('alert').allTextContents()).some(t=>/Could not load|failed|denied/i.test(t)),role+' My Work has no loading error')
   const target=workspaces[role]
   if(target!=='/my-work'){
     await page.goto(base+target,{waitUntil:'domcontentloaded',timeout:deadline})
     await page.waitForTimeout(1000)
     const denied=await page.getByText('Your role cannot open this workspace').count()
     check(denied===0,role+' authorized '+target+' screen accessible')
   }
   if(role==='owner'||role==='admin'){
     await ready(page,'/users','Staff & Access')
     check(true,role+' Staff & Access screen loaded')
   }else{
     await page.goto(base+'/users',{waitUntil:'domcontentloaded',timeout:deadline})
     await page.getByText('Your role cannot open this workspace').waitFor({state:'visible',timeout:deadline})
     check(true,role+' forbidden staff administration blocked')
     await page.goto(base+'/setup',{waitUntil:'domcontentloaded',timeout:deadline})
     await page.getByRole('heading',{name:'Business setup is restricted'}).waitFor({state:'visible',timeout:deadline})
     check(true,role+' standalone setup blocked')
   }
   if(errors.length)throw Error('Browser JS errors: '+errors.join(' | ').slice(0,600))
   console.log('PASS browser '+role+' auth, work area, primary module and restricted pages')
  }catch(e){
    const body=(await page.locator('body').innerText().catch(()=>''))?.slice(0,950)
    failures.push({role,error:e.message.slice(0,450),url:page.url(),screen:body,requests:authCalls.slice(0,12),browserTrace,networkFailures:failedRequests.slice(0,5),jsErrors:errors.slice(0,4)})
    console.log('DIAGNOSTIC '+role+': '+JSON.stringify(failures[failures.length-1]))
    await page.screenshot({path:'/tmp/mgt-browser-failure-'+role+'.png',fullPage:true}).catch(()=>{})
    console.log('FAIL browser '+role+': '+e.message.slice(0,1100))
  }finally{await page.close()}
  if(failures.length>=1){console.log('Stopping early on first failed sign-in/screen to identify the cause');break}
 }
 // The two operative workflows must change live data through real browser clicks.
 for(const [role,flow] of [
  ['cashier',async(page)=>{
   await page.goto(base+'/pos',{waitUntil:'domcontentloaded',timeout:deadline})
   await page.getByRole('button',{name:/CI Checkout Retry Item/}).waitFor({state:'visible',timeout:deadline})
   await page.getByPlaceholder('Opening cash').fill('0')
   await page.getByRole('button',{name:'Open',exact:true}).click()
   await page.getByPlaceholder('Counted cash').waitFor({state:'visible',timeout:deadline})
   await page.getByRole('button',{name:/CI Checkout Retry Item/}).click()
   await page.getByRole('button',{name:'Set full payment',exact:true}).click()
   const requests=[]
   await page.route('**/rest/v1/rpc/post_pos_sale_once',async route=>{
    requests.push(route.request().postDataJSON())
    const response=await route.fetch()
    check(response.ok(),'checkout request reached the database successfully')
    if(requests.length===1)await route.abort('failed') // Commit succeeds; browser loses the reply.
    else await route.fulfill({response})
   })
   await page.getByRole('button',{name:'Complete sale',exact:true}).click()
   await page.getByText(/Failed to fetch|NetworkError|fetch failed/i).first().waitFor({state:'visible',timeout:deadline})
   // Two clicks in the same event turn must still submit one retry.
   await page.getByRole('button',{name:'Complete sale',exact:true}).evaluate(button=>{button.click();button.click()})
   await page.getByText(/Sale .* completed successfully/).waitFor({state:'visible',timeout:deadline})
   check(requests.length===2,'double click submits only one retry')
   check(requests[0].p_request_id===requests[1].p_request_id,'lost response retry preserves request ID')
   const stock=await admin.from('stock_balances').select('quantity').eq('product_id',fixture.checkoutProductId).eq('location_id',fixture.officeId).single()
   if(stock.error)throw stock.error
   check(Number(stock.data.quantity)===9,'real browser checkout deducted stock once')
   const sales=await admin.from('sales').select('id,amount_paid').eq('organization_id',fixture.orgId).eq('sold_by',fixture.accounts.cashier.id)
   if(sales.error)throw sales.error
   check(sales.data.length===1&&Number(sales.data[0].amount_paid)===1000,'real browser checkout created one paid sale')
   const payments=await admin.from('payments').select('id').eq('sale_id',sales.data[0].id)
   if(payments.error)throw payments.error
   check(payments.data.length===1,'lost response did not record a second cash receipt')
  }],
  ['owner',async(page)=>{
   await page.goto(base+'/work-orders',{waitUntil:'domcontentloaded',timeout:deadline})
   await page.getByRole('button',{name:/CI Refund Retry Job/}).click({timeout:deadline})
   const form=page.locator('form').filter({has:page.getByRole('heading',{name:'Refund and cancel job',exact:true})})
   await form.getByLabel('Reason',{exact:true}).fill('Customer returned unused material')
   await form.getByLabel('Refund method',{exact:true}).selectOption('bank')
   await form.getByLabel('Refund account',{exact:true}).selectOption(fixture.refundBankId)
   await form.getByLabel('Completed refund reference',{exact:true}).fill('BROWSER-REFUND-001')
   await form.getByLabel('Job materials',{exact:true}).selectOption('returned')
   const requests=[]
   await page.route('**/rest/v1/rpc/cancel_service_work_order',async route=>{
    requests.push(route.request().postDataJSON())
    const response=await route.fetch()
    check(response.ok(),'refund request committed successfully')
    if(requests.length===1)await route.abort('failed')
    else await route.fulfill({response})
   })
   await form.getByRole('button',{name:'Record refund and cancel job',exact:true}).click()
   await page.getByText(/Failed to fetch|NetworkError|fetch failed/i).first().waitFor({state:'visible',timeout:deadline})
   await form.getByRole('button',{name:'Record refund and cancel job',exact:true}).evaluate(button=>{button.click();button.click()})
   await page.getByText(/Job cancelled. Refund recorded:/).waitFor({state:'visible',timeout:deadline})
   check(requests.length===2&&requests[0].p_request_id===requests[1].p_request_id,'refund lost-response retry preserves one request ID')
   const refunds=await admin.from('payments').select('id,amount').eq('work_order_id',fixture.refundJobId).eq('direction','out')
   if(refunds.error)throw refunds.error
   check(refunds.data.length===1&&Number(refunds.data[0].amount)===10,'browser cancellation refunded once')
   const stock=await admin.from('stock_balances').select('quantity').eq('product_id',fixture.refundProductId).single()
   if(stock.error)throw stock.error
   check(Number(stock.data.quantity)===5,'browser cancellation returned materials once')
  }],
  ['technician',async(page)=>{
   await ready(page,'/my-work','My Work')
   await page.getByText('CI Assigned Device Repair').waitFor({state:'visible',timeout:deadline})
   check((await page.getByText('CI Different Branch Device Repair').count())===0,
       'Technician other-branch job is not displayed')
   await page.getByRole('button',{name:'In Progress'}).first().click()
   await page.getByText('Work updated successfully.').waitFor({state:'visible',timeout:deadline})
   check(true,'technician updated assigned service job using the browser')
  }],
  ['delivery_driver',async(page)=>{
   await ready(page,'/my-work','My Work')
   await page.getByText('CI-E2E-DLV-001').waitFor({state:'visible',timeout:deadline})
   const deliveryCard=page.locator('article').filter({hasText:'CI-E2E-DLV-001'})
   console.log('DRIVER_CI_BEFORE '+JSON.stringify({
     card:(await deliveryCard.innerText()).slice(0,480),
     buttons:await deliveryCard.getByRole('button').allTextContents()
   }))
   const driverEvents=[]
   page.on('pageerror',e=>driverEvents.push('JS: '+e.message))
   page.on('console',msg=>{if(msg.type()==='error')driverEvents.push('Console: '+msg.text())})
   page.on('framenavigated',frame=>{if(frame===page.mainFrame())driverEvents.push('Navigation: '+frame.url())})
   const proofInput=deliveryCard.getByPlaceholder('Recipient name (for successful delivery)')
   await proofInput.fill('CI Receipt Tester')
   await page.waitForTimeout(150)
   const after={
     url:page.url(),
     body:(await page.locator('body').innerText({timeout:3000})).slice(0,900),
     cards:(await page.locator('article').allTextContents()).filter(x=>x.includes('CI-E2E-DLV-001')).slice(0,2),
     buttons:await page.getByRole('button').allTextContents(),
     events:driverEvents.slice(0,8)
   }
   console.log('DRIVER_CI_AFTER '+JSON.stringify(after))
   if(!after.buttons.some(x=>x.includes('Confirm delivered')))throw Error('Proof input removed delivery confirmation: '+JSON.stringify(after).slice(0,1300))
   await deliveryCard.getByRole('button',{name:'Confirm delivered'}).click({timeout:6000})
   await page.getByText('Work updated successfully.').waitFor({state:'visible',timeout:deadline})
   await page.getByText('CI-E2E-DLV-001').waitFor({state:'hidden',timeout:deadline})
   check(true,'driver confirmed successful delivery with recipient name')

   const failedCard=page.locator('article').filter({hasText:'CI-E2E-DLV-002'})
   await failedCard.getByPlaceholder('Failure reason (if unsuccessful)').fill('Customer was not available')
   await failedCard.getByRole('button',{name:'Report failed'}).click({timeout:6000})
   await page.getByText('CI-E2E-DLV-002').waitFor({state:'hidden',timeout:deadline})
   check(true,'driver reported failed delivery with failure reason only')
  }]
 ]){
  if(!contexts[role])continue
  const page=await contexts[role].newPage()
  try{await flow(page);console.log('PASS full worker workflow: '+role)}
  catch(e){failures.push({role:role+' workflow',error:e.message.slice(0,1200),url:page.url()});await page.screenshot({path:'/tmp/mgt-browser-flow-'+role+'.png',fullPage:true}).catch(()=>{});console.log('FAIL workflow '+role+': '+e.message.slice(0,1200))}
  finally{await page.close()}
 }
}finally{
 for(const context of Object.values(contexts))await context.close().catch(()=>{})
 await browser.close()
}
console.log('MGT CHROMIUM REAL BROWSER: '+checks+' checks completed; '+failures.length+' failures')
if(failures.length){
 console.error(JSON.stringify(failures,null,2))
 process.exitCode=1
}
