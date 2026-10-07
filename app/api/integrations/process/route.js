import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

const MAX_BATCH=25
const MAX_RESPONSE=500

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'integrations.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId}=check

  try{
    const {data:queue,error:queueError}=await adminClient
      .from('integration_event_deliveries')
      .select('id,event_id,endpoint_id,endpoint_url,status,attempt_count,next_attempt_at')
      .eq('organization_id',organizationId)
      .in('status',['queued','failed'])
      .lte('next_attempt_at',new Date().toISOString())
      .order('created_at',{ascending:true})
      .limit(MAX_BATCH)

    if(queueError)throw queueError
    let delivered=0,failed=0

    for(const item of queue||[]){
      const [eventRes,endpointRes]=await Promise.all([
        adminClient.from('integration_events').select('id,event_type,entity_type,entity_id,payload,created_at').eq('organization_id',organizationId).eq('id',item.event_id).maybeSingle(),
        item.endpoint_id
          ? adminClient.from('webhook_endpoints').select('id,name,url,signing_secret,active,deleted_at,failure_count').eq('organization_id',organizationId).eq('id',item.endpoint_id).maybeSingle()
          : Promise.resolve({data:null,error:null})
      ])
      if(eventRes.error)throw eventRes.error
      if(endpointRes.error)throw endpointRes.error

      const event=eventRes.data,endpoint=endpointRes.data
      if(!event||!endpoint||!endpoint.active||endpoint.deleted_at){
        await adminClient.from('integration_event_deliveries').update({
          status:'abandoned',error_message:'Webhook endpoint is missing or inactive.',last_attempt_at:new Date().toISOString(),updated_at:new Date().toISOString()
        }).eq('id',item.id).eq('organization_id',organizationId)
        failed++
        continue
      }

      const body=JSON.stringify({
        id:event.id,type:event.event_type,entity_type:event.entity_type,entity_id:event.entity_id,
        created_at:event.created_at,data:event.payload
      })
      const signature=crypto.createHmac('sha256',endpoint.signing_secret).update(body).digest('hex')
      const attempt=Number(item.attempt_count||0)+1
      const now=new Date()

      try{
        const response=await fetch(endpoint.url,{
          method:'POST',
          headers:{
            'content-type':'application/json',
            'user-agent':'MGT-Business-Suite-Webhooks/1.0',
            'x-mgt-event':event.event_type,
            'x-mgt-delivery':item.id,
            'x-mgt-signature':`sha256=${signature}`
          },
          body,
          signal:AbortSignal.timeout(12000)
        })
        const responseText=(await response.text()).slice(0,MAX_RESPONSE)

        if(response.ok){
          delivered++
          await adminClient.from('integration_event_deliveries').update({
            status:'delivered',attempt_count:attempt,last_attempt_at:now.toISOString(),
            response_code:response.status,response_excerpt:responseText,error_message:null,delivered_at:now.toISOString(),updated_at:now.toISOString()
          }).eq('id',item.id).eq('organization_id',organizationId)
          await adminClient.from('webhook_endpoints').update({
            failure_count:0,last_delivery_at:now.toISOString(),last_success_at:now.toISOString(),updated_at:now.toISOString()
          }).eq('id',endpoint.id).eq('organization_id',organizationId)
        }else{
          failed++
          const delayMinutes=Math.min(60,Math.pow(2,Math.min(attempt,6)))
          await adminClient.from('integration_event_deliveries').update({
            status:attempt>=8?'abandoned':'failed',attempt_count:attempt,last_attempt_at:now.toISOString(),
            next_attempt_at:new Date(now.getTime()+delayMinutes*60000).toISOString(),
            response_code:response.status,response_excerpt:responseText,error_message:`HTTP ${response.status}`,updated_at:now.toISOString()
          }).eq('id',item.id).eq('organization_id',organizationId)
          await adminClient.from('webhook_endpoints').update({
            failure_count:Number(endpoint.failure_count||0)+1,last_delivery_at:now.toISOString(),updated_at:now.toISOString()
          }).eq('id',endpoint.id).eq('organization_id',organizationId)
        }
      }catch(error){
        failed++
        const delayMinutes=Math.min(60,Math.pow(2,Math.min(attempt,6)))
        await adminClient.from('integration_event_deliveries').update({
          status:attempt>=8?'abandoned':'failed',attempt_count:attempt,last_attempt_at:now.toISOString(),
          next_attempt_at:new Date(now.getTime()+delayMinutes*60000).toISOString(),
          error_message:String(error.message||'Webhook delivery failed').slice(0,500),updated_at:now.toISOString()
        }).eq('id',item.id).eq('organization_id',organizationId)
        await adminClient.from('webhook_endpoints').update({
          failure_count:Number(endpoint.failure_count||0)+1,last_delivery_at:now.toISOString(),updated_at:now.toISOString()
        }).eq('id',endpoint.id).eq('organization_id',organizationId)
      }

      const {data:remaining}=await adminClient.from('integration_event_deliveries').select('id').eq('event_id',event.id).in('status',['queued','failed']).limit(1)
      if(!(remaining||[]).length){
        const {data:failedRows}=await adminClient.from('integration_event_deliveries').select('id').eq('event_id',event.id).eq('status','abandoned').limit(1)
        await adminClient.from('integration_events').update({
          status:(failedRows||[]).length?'failed':'delivered',processed_at:new Date().toISOString()
        }).eq('id',event.id).eq('organization_id',organizationId)
      }
    }

    return NextResponse.json({ok:true,processed:(queue||[]).length,delivered,failed})
  }catch(error){
    return NextResponse.json({error:error.message},{status:400})
  }
}
