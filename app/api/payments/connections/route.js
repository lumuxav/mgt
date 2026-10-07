import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

const providerLabel=(provider)=>provider==='mtn_momo'?'MTN MoMo':provider==='airtel_money'?'Airtel Money':'Payment Gateway'

async function bundle(adminClient,organizationId){
  const {data,error}=await adminClient.from('payment_provider_connections')
    .select('id,provider,name,environment,active,country_code,currency,public_config,created_at,updated_at')
    .eq('organization_id',organizationId)
    .order('created_at',{ascending:false})
  if(error)throw error
  return data||[]
}

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'payments.view','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{return NextResponse.json({ok:true,connections:await bundle(check.adminClient,check.organizationId)})}
  catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'payments.manage','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const body=await req.json()
    const provider=String(body.provider||'').trim()
    if(!['mtn_momo','airtel_money','gateway'].includes(provider))return NextResponse.json({error:'Unsupported payment provider.'},{status:400})
    const name=String(body.name||'').trim()
    if(!name)return NextResponse.json({error:'Connection name is required.'},{status:400})
    const environment=body.environment==='production'?'production':'sandbox'
    const publicConfig=body.public_config&&typeof body.public_config==='object'?body.public_config:{}
    const credentials=body.credentials&&typeof body.credentials==='object'?body.credentials:{}
    const {data,error}=await check.adminClient.rpc('server_save_payment_provider_connection',{
      p_organization_id:check.organizationId,
      p_user_id:check.caller.id,
      p_connection_id:null,
      p_provider:provider,
      p_name:name,
      p_environment:environment,
      p_active:Boolean(body.active),
      p_country_code:String(body.country_code||'UG').toUpperCase(),
      p_currency:String(body.currency||'UGX').toUpperCase(),
      p_public_config:publicConfig,
      p_credentials:credentials,
    })
    if(error)throw error
    return NextResponse.json({ok:true,id:data,connections:await bundle(check.adminClient,check.organizationId)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function PATCH(req){
  const check=await verifyOrganizationPermission(req,'payments.manage','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const body=await req.json()
    const id=String(body.id||'').trim()
    if(!id)return NextResponse.json({error:'Connection id is required.'},{status:400})

    const {data:existing,error:readError}=await check.adminClient.from('payment_provider_connections')
      .select('id,provider,name,environment,active,country_code,currency,public_config')
      .eq('organization_id',check.organizationId).eq('id',id).maybeSingle()
    if(readError)throw readError
    if(!existing)return NextResponse.json({error:'Payment provider connection not found.'},{status:404})

    const {data,error}=await check.adminClient.rpc('server_save_payment_provider_connection',{
      p_organization_id:check.organizationId,
      p_user_id:check.caller.id,
      p_connection_id:id,
      p_provider:body.provider||existing.provider,
      p_name:body.name===undefined?existing.name:String(body.name||'').trim(),
      p_environment:body.environment||existing.environment,
      p_active:body.active===undefined?existing.active:Boolean(body.active),
      p_country_code:String(body.country_code||existing.country_code||'UG').toUpperCase(),
      p_currency:String(body.currency||existing.currency||'UGX').toUpperCase(),
      p_public_config:body.public_config===undefined?existing.public_config:(body.public_config||{}),
      p_credentials:body.credentials||{},
    })
    if(error)throw error

    await check.adminClient.from('audit_log').insert({
      organization_id:check.organizationId,location_id:check.caller.default_location_id,user_id:check.caller.id,
      action:'payment_provider_connection_updated',entity_type:'payment_provider_connection',entity_id:id,
      summary:`${providerLabel(existing.provider)} connection updated: ${existing.name}`
    })

    return NextResponse.json({ok:true,id:data,connections:await bundle(check.adminClient,check.organizationId)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function DELETE(req){
  const check=await verifyOrganizationPermission(req,'payments.manage','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const body=await req.json()
    const id=String(body.id||'').trim()
    if(!id)return NextResponse.json({error:'Connection id is required.'},{status:400})
    const {error}=await check.adminClient.rpc('server_delete_payment_provider_connection',{
      p_organization_id:check.organizationId,
      p_user_id:check.caller.id,
      p_connection_id:id,
    })
    if(error)throw error
    return NextResponse.json({ok:true,connections:await bundle(check.adminClient,check.organizationId)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}
