import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { consumeServerRateLimit, getServerClients } from '../../../../../lib/serverAccess'

import { EXTERNAL_RESOURCES, externalResourceQuery, parsePage } from '../../../../../lib/externalApi'

const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex')

export async function GET(req,{params}){
  const resource=(await params)?.resource
  const def=EXTERNAL_RESOURCES[resource]
  if(!def)return NextResponse.json({error:'Unknown resource.'},{status:404,headers:{'cache-control':'no-store'}})

  let clients
  try{clients=getServerClients()}catch(error){return NextResponse.json({error:error.message},{status:500})}
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  if(!token||!token.startsWith('mgt_live_'))return NextResponse.json({error:'Valid MGT API key required.'},{status:401})

  const keyHash=sha(token)
  const {data:key,error:keyError}=await clients.adminClient
    .from('integration_api_keys')
    .select('id,organization_id,scopes,active,expires_at,revoked_at')
    .eq('key_hash',keyHash)
    .maybeSingle()
  if(keyError)return NextResponse.json({error:'API authentication failed.'},{status:500})
  if(!key||!key.active||key.revoked_at)return NextResponse.json({error:'API key is inactive.'},{status:401})
  if(key.expires_at&&new Date(key.expires_at)<=new Date())return NextResponse.json({error:'API key has expired.'},{status:401})
  if(!(key.scopes||[]).includes(def.scope))return NextResponse.json({error:`Missing scope: ${def.scope}`},{status:403})

  try {
    const {data:organization,error:organizationError}=await clients.adminClient.from('organizations').select('active').eq('id',key.organization_id).maybeSingle()
    if(organizationError)throw organizationError
    if(organization?.active!==true)return NextResponse.json({error:'This business is not active.'},{status:403})
    const {data:modules,error:moduleError}=await clients.adminClient.from('organization_modules')
      .select('module_key,enabled').eq('organization_id',key.organization_id).in('module_key',['integrations',...def.modules])
    if(moduleError)throw moduleError
    const enabled=new Set((modules||[]).filter(row=>row.enabled).map(row=>row.module_key))
    if(!enabled.has('integrations')||!def.modules.some(module=>enabled.has(module)))return NextResponse.json({error:'This integration or resource module is disabled.'},{status:403})
    const rate=await consumeServerRateLimit(clients.adminClient,{scope:'external_api',key:key.id,limit:300,windowSeconds:60})
    if(!rate.allowed)return NextResponse.json({error:'Too many API requests.'},{status:429,headers:{'Retry-After':String(rate.retry_after||60)}})
    const page=parsePage(new URL(req.url).searchParams)
    const {limit,offset}=page
    const query=externalResourceQuery(clients.adminClient,resource,key.organization_id,page)

    const {data,error}=await query
    if(error)throw error
    const rows=(data||[]).map(record=>{
      if(resource!=='stock')return record
      const row={...record}
      delete row.products
      return row
    })
    await clients.adminClient.from('integration_api_keys').update({last_used_at:new Date().toISOString()}).eq('id',key.id)
    return NextResponse.json({ok:true,resource,count:rows.length,offset,limit,data:rows},{
      headers:{'cache-control':'no-store','x-mgt-resource':resource}
    })
  } catch(error) {
    return NextResponse.json({error:error.message},{status:400})
  }
}
