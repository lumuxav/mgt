import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { stripTypeScriptTypes } from 'node:module'

// Exercise the deployed handler with a compare-and-set queue and a fake email provider.
const source=stripTypeScriptTypes(readFileSync(new URL('../supabase/functions/mgt-notification-email-dispatch/index.ts',import.meta.url),'utf8').replace(/^import .*\n/gm,''))
const token='fixture-dispatch-token'

function fixture({eligible=true,claimFails=false,queueReaders=1}={}){
  const delivery={id:'delivery-1',organization_id:'org-1',notification_id:'notification-1',user_id:'user-1',recipient:'staff@fixture.invalid',channel:'email',status:'queued',attempt_count:0,next_attempt_at:'2000-01-01T00:00:00Z'}
  let handler,sent=0,reads=0,snapshots=0,release
  const queueBarrier=new Promise(resolve=>{release=resolve})
  const admin={from(table){
    let mutation=null,single=false
    const filters=[]
    const query={
      select(){return query},
      update(value){mutation=value;return query},
      eq(key,value){filters.push(row=>row[key]===value);return query},
      in(key,values){filters.push(row=>values.includes(row[key]));return query},
      lte(){return query},order(){return query},limit(){return query},
      maybeSingle(){single=true;return query},
      then(resolve,reject){return Promise.resolve().then(async()=>{
        reads++
        if(table==='notification_dispatch_auth')return {data:{token_hash:createHash('sha256').update(token).digest('hex')}}
        if(table==='notifications')return {data:{id:'notification-1',title:'Fixture notice',body:'Test only',category:'system'}}
        if(table==='notification_delivery_settings')return {data:{email_enabled:true,sender_name:'Fixture'}}
        if(table==='organizations')return {data:{name:'Fixture business'}}
        assert.equal(table,'notification_deliveries')
        if(!mutation){
          const data=filters.every(filter=>filter(delivery))?[{...delivery}]:[]
          if(++snapshots===queueReaders)release()
          await queueBarrier
          return {data}
        }
        if(mutation?.status==='processing'&&claimFails)return {data:null,error:{message:'Fixture database failure'}}
        if(!filters.every(filter=>filter(delivery)))return {data:single?null:[]}
        if(mutation){
          Object.assign(delivery,mutation)
          if(mutation.status==='processing'&&!eligible)delivery.status='skipped'
        }
        return {data:single?{...delivery}:[{...delivery}]}
      }).then(resolve,reject)},
    }
    return query
  }}
  const env={SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-only',RESEND_API_KEY:'fixture-only',MGT_NOTIFICATION_FROM_EMAIL:'noreply@fixture.invalid'}
  const deno={env:{get:key=>env[key]},serve:value=>{handler=value}}
  const send=async()=>{sent++;return new Response(JSON.stringify({id:'fixture-receipt'}),{status:200})}
  new Function('Deno','createClient','fetch',source)(deno,()=>admin,send)
  return {
    request:(authorized=true)=>handler(new Request('https://fixture.invalid/dispatch',{method:'POST',headers:authorized?{'x-mgt-dispatch-token':token}:{}})),
    get sent(){return sent},get reads(){return reads},delivery,
  }
}

test('notification dispatcher requires its own dispatch authentication',async()=>{
  const f=fixture()
  assert.equal((await f.request(false)).status,401)
  assert.equal(f.reads,0)
  assert.equal(f.sent,0)
})

test('notification dispatcher observes database scope exclusion before sending',async()=>{
  const f=fixture({eligible:false})
  assert.equal((await f.request()).status,200)
  assert.equal(f.delivery.status,'skipped')
  assert.equal(f.sent,0)
})

test('simultaneous notification workers send one email for a single queued attempt',{timeout:3000},async()=>{
  const f=fixture({queueReaders:2})
  const responses=await Promise.all([f.request(),f.request()])
  assert.ok(responses.every(response=>response.status===200))
  assert.equal(f.sent,1)
  assert.equal(f.delivery.status,'delivered')
  assert.equal(f.delivery.attempt_count,1)
})

test('a failed notification claim cannot dispatch an unclaimed email',async()=>{
  const f=fixture({claimFails:true})
  assert.equal((await f.request()).status,500)
  assert.equal(f.sent,0)
  assert.equal(f.delivery.status,'queued')
})
