import fs from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium } from 'playwright'

const base='http://127.0.0.1:3000'
const fixture=JSON.parse(await fs.readFile('/tmp/mgt-e2e-fixtures.json','utf8'))
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
   const proofInput=deliveryCard.getByPlaceholder('Recipient name (for successful delivery)')
   await proofInput.fill('CI Receipt Tester')
   console.log('DRIVER_CI_AFTER '+JSON.stringify({
     card:(await deliveryCard.innerText()).slice(0,480),
     proof:await proofInput.inputValue(),
     buttons:await deliveryCard.getByRole('button').allTextContents()
   }))
   await deliveryCard.getByRole('button',{name:'Confirm delivered'}).click({timeout:6000})
   await page.getByText('Work updated successfully.').waitFor({state:'visible',timeout:deadline})
   check(true,'driver submitted proof of delivery through the real browser')
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
