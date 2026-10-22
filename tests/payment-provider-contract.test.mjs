import { test } from 'node:test'
import assert from 'node:assert/strict'
import { requestProviderPayment,checkProviderPayment,paymentEndpoint } from '../lib/serverPaymentProviders.js'

const reference='c11aab64-478b-407a-9c4e-79d0fd903751'
const input={reference:'MGT-FIXTURE',providerReference:reference,phone:'256700000001',amount:12,currency:'UGX',callbackUrl:'https://mgt.example.test/callback',note:'Fixture only'}
const mtn={provider:'mtn_momo',environment:'sandbox',credentials:{api_user:'fixture-user',api_key:'fixture-key',subscription_key:'fixture-subscription'}}
const json=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}})

test('MTN collection and status check share the reference persisted before dispatch',async t=>{
  const calls=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options})
    if(url.endsWith('/token/'))return json({access_token:'fixture-token'})
    if(options.method==='POST')return new Response(null,{status:202})
    return json({status:'SUCCESSFUL',financialTransactionId:'fixture-receipt'})
  })
  const requested=await requestProviderPayment(mtn,input)
  assert.equal(requested.provider_reference,reference)
  assert.equal(calls[1].options.headers['X-Reference-Id'],reference)
  assert.equal(calls[1].options.redirect,'error')
  const status=await checkProviderPayment(mtn,{provider_reference:reference,currency:'UGX',amount:12})
  assert.equal(status.status,'succeeded')
  assert.ok(calls.at(-1).url.endsWith('/'+reference))
})

test('lost collection response and server errors remain unresolved; explicit rejection does not',async t=>{
  let outcome='network'
  t.mock.method(globalThis,'fetch',async url=>{
    if(url.endsWith('/token/'))return json({access_token:'fixture-token'})
    if(outcome==='network')throw new TypeError('connection reset after sending')
    return json({error:'fixture'},Number(outcome))
  })
  for(const value of ['network','503','409']){
    outcome=value
    await assert.rejects(requestProviderPayment(mtn,input),error=>error.providerRequestUncertain===true)
  }
  outcome='400'
  await assert.rejects(requestProviderPayment(mtn,input),error=>!error.providerRequestUncertain&&/rejected/.test(error.message))
})

test('failed token acquisition never sends a collection',async t=>{
  let calls=0
  t.mock.method(globalThis,'fetch',async()=>{calls++;return json({error:'invalid credential'},401)})
  await assert.rejects(requestProviderPayment(mtn,input),error=>!error.providerRequestUncertain)
  assert.equal(calls,1)
})

test('Airtel keeps the preallocated transaction reference and maps pending/failure outcomes',async t=>{
  const calls=[]
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls.push({url,options})
    if(url.endsWith('/token'))return json({access_token:'fixture-token'})
    return json({data:{transaction:{status:options.method==='POST'?'TIP':'TF'}}})
  })
  const connection={provider:'airtel_money',environment:'sandbox',credentials:{client_id:'fixture',client_secret:'fixture'}}
  const request=await requestProviderPayment(connection,input)
  assert.equal(request.status,'pending')
  assert.equal(JSON.parse(calls[1].options.body).transaction.id,reference)
  assert.equal((await checkProviderPayment(connection,{provider_reference:reference,currency:'UGX'})).status,'failed')
})

test('provider credentials cannot be redirected to a configured arbitrary origin',()=>{
  assert.equal(paymentEndpoint('mtn_momo','production'),'https://proxy.momoapi.mtn.com')
  assert.throws(()=>paymentEndpoint('mtn_momo','production','https://attacker.example.test'),/selected environment/)
  assert.throws(()=>paymentEndpoint('airtel_money','sandbox','http://127.0.0.1'),/selected environment/)
})

test('collection cannot begin without a persisted provider reference',async()=>{
  await assert.rejects(requestProviderPayment(mtn,{...input,providerReference:null}),/Persist a provider reference/)
  await assert.rejects(checkProviderPayment(mtn,{}),/no provider reference/)
})
