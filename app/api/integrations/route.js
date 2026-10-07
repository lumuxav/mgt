import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../lib/serverAccess'

const AVAILABLE_SCOPES = [
  'catalog.read','customers.read','suppliers.read','sales.read','inventory.read',
  'services.read','projects.read','fleet.read','finance.read','ecommerce.read'
]

const AVAILABLE_EVENTS = [
  '*',
  'product.created','product.updated',
  'customer.created','customer.updated',
  'supplier.created','supplier.updated',
  'sale.created','sale.updated',
  'payment.created',
  'purchase.created','purchase.updated',
  'work_order.created','work_order.updated',
  'project.created','project.updated',
  'project_invoice.created','project_invoice.updated',
  'delivery.created','delivery.updated',
  'online_order.created','online_order.updated',
  'stock_movement.created'
]

const randomToken=(prefix,bytes=32)=>`${prefix}_${crypto.randomBytes(bytes).toString('base64url')}`
const hash=(value)=>crypto.createHash('sha256').update(value).digest('hex')
const safeUrl=(value)=>{
  try{
    const url=new URL(String(value||''))
    return ['https:','http:'].includes(url.protocol)?url.toString():null
  }catch{return null}
}

async function bundle(adminClient,organizationId){
  const [keys,endpoints,deliveries,events,notificationDeliverySettings,notificationDeliveries]=await Promise.all([
    adminClient.from('integration_api_keys').select('id,name,key_prefix,scopes,active,expires_at,last_used_at,created_by,created_at,revoked_at').eq('organization_id',organizationId).order('created_at',{ascending:false}),
    adminClient.from('webhook_endpoints').select('id,name,url,events,active,failure_count,last_delivery_at,last_success_at,created_by,created_at,updated_at,deleted_at').eq('organization_id',organizationId).is('deleted_at',null).order('created_at',{ascending:false}),
    adminClient.from('integration_event_deliveries').select('id,event_id,endpoint_id,endpoint_url,status,attempt_count,next_attempt_at,last_attempt_at,response_code,response_excerpt,error_message,delivered_at,created_at,updated_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(200),
    adminClient.from('integration_events').select('id,event_type,entity_type,entity_id,status,created_at,processed_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(200),
    adminClient.from('notification_delivery_settings').select('organization_id,email_enabled,email_min_severity,email_categories,sender_name,reply_to_email,updated_at').eq('organization_id',organizationId).maybeSingle(),
    adminClient.from('notification_deliveries').select('id,notification_id,user_id,channel,recipient,status,attempt_count,next_attempt_at,last_attempt_at,provider,provider_message_id,response_code,error_message,delivered_at,created_at,updated_at').eq('organization_id',organizationId).order('created_at',{ascending:false}).limit(200),
  ])
  for(const r of [keys,endpoints,deliveries,events,notificationDeliverySettings,notificationDeliveries])if(r.error)throw r.error
  return {
    api_keys:keys.data||[],
    webhooks:endpoints.data||[],
    deliveries:deliveries.data||[],
    events:events.data||[],
    notification_delivery_settings:notificationDeliverySettings.data||null,
    notification_deliveries:notificationDeliveries.data||[],
    available_scopes:AVAILABLE_SCOPES,
    available_events:AVAILABLE_EVENTS
  }
}

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'integrations.view','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{return NextResponse.json({ok:true,...await bundle(check.adminClient,check.organizationId)})}
  catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'integrations.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId,caller}=check
  try{
    const body=await req.json()
    if(body.type==='api_key'){
      const permission=await verifyOrganizationPermission(req,'integrations.api','integrations')
      if(permission.error)return NextResponse.json({error:permission.error},{status:permission.status})
      const name=String(body.name||'').trim()
      const scopes=[...new Set((Array.isArray(body.scopes)?body.scopes:[]).map(String))].filter(x=>AVAILABLE_SCOPES.includes(x))
      if(!name)return NextResponse.json({error:'API key name is required.'},{status:400})
      if(!scopes.length)return NextResponse.json({error:'Choose at least one API scope.'},{status:400})
      const raw=randomToken('mgt_live')
      const prefix=raw.slice(0,18)
      const expiresAt=body.expires_at?new Date(body.expires_at).toISOString():null
      const {data,error}=await adminClient.from('integration_api_keys').insert({
        organization_id:organizationId,name,key_prefix:prefix,key_hash:hash(raw),scopes,active:true,expires_at:expiresAt,created_by:caller.id
      }).select('id,name,key_prefix,scopes,active,expires_at,created_at').single()
      if(error)throw error
      await adminClient.from('audit_log').insert({organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,action:'integration_api_key_created',entity_type:'integration_api_key',entity_id:data.id,summary:`API key created: ${name}`,metadata:{scopes}})
      return NextResponse.json({ok:true,created:data,secret:raw,...await bundle(adminClient,organizationId)})
    }
    if(body.type==='webhook'){
      const name=String(body.name||'').trim()
      const url=safeUrl(body.url)
      const events=[...new Set((Array.isArray(body.events)?body.events:[]).map(String))].filter(x=>AVAILABLE_EVENTS.includes(x))
      if(!name||!url)return NextResponse.json({error:'Webhook name and a valid HTTP(S) URL are required.'},{status:400})
      if(!events.length)return NextResponse.json({error:'Choose at least one webhook event.'},{status:400})
      const signingSecret=randomToken('whsec',32)
      const {data,error}=await adminClient.from('webhook_endpoints').insert({
        organization_id:organizationId,name,url,events,signing_secret:signingSecret,active:true,created_by:caller.id
      }).select('id,name,url,events,active,created_at').single()
      if(error)throw error
      await adminClient.from('audit_log').insert({organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,action:'webhook_created',entity_type:'webhook_endpoint',entity_id:data.id,summary:`Webhook created: ${name}`,metadata:{events,url}})
      return NextResponse.json({ok:true,created:data,signing_secret:signingSecret,...await bundle(adminClient,organizationId)})
    }
    return NextResponse.json({error:'Unknown integration type.'},{status:400})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function PATCH(req){
  const check=await verifyOrganizationPermission(req,'integrations.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId,caller}=check
  try{
    const body=await req.json()
    if(body.type==='api_key'){
      const {data:row,error:readError}=await adminClient.from('integration_api_keys').select('id,name').eq('organization_id',organizationId).eq('id',body.id).maybeSingle()
      if(readError)throw readError
      if(!row)return NextResponse.json({error:'API key not found.'},{status:404})
      const changes={}
      if(body.active!==undefined){changes.active=Boolean(body.active);changes.revoked_at=body.active?null:new Date().toISOString()}
      if(body.name!==undefined)changes.name=String(body.name||'').trim()||row.name
      const {error}=await adminClient.from('integration_api_keys').update(changes).eq('organization_id',organizationId).eq('id',row.id)
      if(error)throw error
      await adminClient.from('audit_log').insert({organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,action:'integration_api_key_updated',entity_type:'integration_api_key',entity_id:row.id,summary:`API key updated: ${row.name}`})
    }else if(body.type==='webhook'){
      const {data:row,error:readError}=await adminClient.from('webhook_endpoints').select('id,name').eq('organization_id',organizationId).eq('id',body.id).is('deleted_at',null).maybeSingle()
      if(readError)throw readError
      if(!row)return NextResponse.json({error:'Webhook not found.'},{status:404})
      const changes={updated_at:new Date().toISOString()}
      if(body.active!==undefined)changes.active=Boolean(body.active)
      if(body.name!==undefined)changes.name=String(body.name||'').trim()||row.name
      if(body.url!==undefined){const url=safeUrl(body.url);if(!url)return NextResponse.json({error:'Invalid webhook URL.'},{status:400});changes.url=url}
      if(Array.isArray(body.events)){const ev=[...new Set(body.events.map(String))].filter(x=>AVAILABLE_EVENTS.includes(x));if(!ev.length)return NextResponse.json({error:'Choose at least one webhook event.'},{status:400});changes.events=ev}
      const {error}=await adminClient.from('webhook_endpoints').update(changes).eq('organization_id',organizationId).eq('id',row.id)
      if(error)throw error
      await adminClient.from('audit_log').insert({organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,action:'webhook_updated',entity_type:'webhook_endpoint',entity_id:row.id,summary:`Webhook updated: ${row.name}`})
    }else return NextResponse.json({error:'Unknown integration type.'},{status:400})
    return NextResponse.json({ok:true,...await bundle(adminClient,organizationId)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function DELETE(req){
  const check=await verifyOrganizationPermission(req,'integrations.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId,caller}=check
  try{
    const body=await req.json()
    if(body.type==='api_key'){
      const {error}=await adminClient.from('integration_api_keys').update({active:false,revoked_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',body.id)
      if(error)throw error
    }else if(body.type==='webhook'){
      const {error}=await adminClient.from('webhook_endpoints').update({active:false,deleted_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',body.id)
      if(error)throw error
    }else return NextResponse.json({error:'Unknown integration type.'},{status:400})
    await adminClient.from('audit_log').insert({organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,action:'integration_removed',entity_type:body.type,entity_id:String(body.id||''),summary:`Integration removed: ${body.type}`})
    return NextResponse.json({ok:true,...await bundle(adminClient,organizationId)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}
