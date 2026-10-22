import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { consumeServerRateLimit, verifyOrganizationPermission } from '../../../../lib/serverAccess'
import { normalizeUgandaPhone,requestProviderPayment } from '../../../../lib/serverPaymentProviders'
import { resolveTarget } from '../../../../lib/paymentTargets'
import { saveProviderStatus } from '../../../../lib/serverPaymentLifecycle'
import { requirePaymentTargetAccess } from '../../../../lib/serverPaymentAccess'

const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex')
const ref=()=>`MGT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'payments.view','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const {data,error}=await check.scopedClient.from('external_payment_transactions')
      .select('id,connection_id,provider,transaction_type,target_type,target_id,location_id,customer_id,amount,currency,payer_phone,external_reference,provider_reference,provider_financial_id,status,settlement_status,provider_status,failure_reason,metadata,initiated_by,created_at,updated_at,completed_at,settled_at,settlement_result')
      .eq('organization_id',check.organizationId).order('created_at',{ascending:false}).limit(300)
    if(error)throw error
    return NextResponse.json({ok:true,transactions:data||[]})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'payments.request','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId,caller}=check
  let transaction=null
  let providerAccepted=false
  try{
    const rate=await consumeServerRateLimit(adminClient,{
      scope:'external_payment_request',
      key:organizationId+'|'+caller.id,
      limit:30,
      windowSeconds:600,
    })
    if(!rate.allowed)return NextResponse.json(
      {error:'Too many payment requests. Wait before sending another mobile-money prompt.'},
      {status:429,headers:{'Retry-After':String(rate.retry_after||60)}}
    )

    const body=await req.json()
    const targetType=String(body.target_type||'').trim()
    const targetId=body.target_id||null
    const amount=Number(body.amount)
    const connectionId=String(body.connection_id||'').trim()
    if(!connectionId)throw new Error('Choose a payment provider connection.')

    const {data:connectionRow,error:connectionError}=await adminClient.from('payment_provider_connections')
      .select('id,provider,name,environment,active,country_code,currency,public_config')
      .eq('organization_id',organizationId).eq('id',connectionId).maybeSingle()
    if(connectionError)throw connectionError
    if(!connectionRow||!connectionRow.active)throw new Error('Payment provider connection is not active.')
    const {data:organization,error:organizationError}=await adminClient.from('organizations').select('currency').eq('id',organizationId).single()
    if(organizationError)throw organizationError
    if(String(connectionRow.currency).toUpperCase()!==String(organization.currency).toUpperCase())throw new Error('Payment provider currency must match the business currency.')

    await requirePaymentTargetAccess(check,targetType,targetType==='customer_debt'?(body.customer_id||targetId):targetId)
    const target=await resolveTarget(adminClient,organizationId,targetType,targetId,body.customer_id||null,amount)
    const phone=normalizeUgandaPhone(body.payer_phone||target.phone||'')
    if(!/^256\d{9}$/.test(phone))throw new Error('Enter a valid Ugandan mobile-money number.')

    const externalReference=ref()
    const providerReference=crypto.randomUUID()
    const callbackToken=crypto.randomBytes(32).toString('hex')
    const origin=new URL(req.url).origin
    const currency=String(connectionRow.currency||body.currency||'UGX').toUpperCase()

    const {data:inserted,error:insertError}=await adminClient.from('external_payment_transactions').insert({
      organization_id:organizationId,connection_id:connectionRow.id,provider:connectionRow.provider,transaction_type:'collection',
      target_type:targetType,target_id:targetId,location_id:target.locationId||caller.default_location_id||null,
      customer_id:target.customerId||body.customer_id||null,amount,currency,payer_phone:phone,external_reference:externalReference,provider_reference:providerReference,
      status:'created',settlement_status:'pending',client_token_hash:sha(callbackToken),initiated_by:caller.id,
      metadata:{label:target.label,balance_before:target.balance,created_from:'mgt_payments'},
    }).select('*').single()
    if(insertError){
      if(insertError.code==='23505')throw new Error('An unresolved collection already exists for this account or document. Check its status before requesting another.')
      throw insertError
    }
    transaction=inserted

    const {data:connection,error:secretError}=await adminClient.rpc('server_get_payment_provider_connection',{
      p_organization_id:organizationId,p_connection_id:connectionRow.id,
    })
    if(secretError)throw secretError

    const callbackUrl=`${origin}/api/payments/webhooks/${connectionRow.provider}?id=${inserted.id}&token=${callbackToken}`
    const providerResult=await requestProviderPayment(connection,{
      reference:externalReference,providerReference,phone,amount,currency,callbackUrl,note:target.label,targetType,targetId,
    })
    providerAccepted=true

    const updated=await saveProviderStatus(adminClient,inserted,{
      status:providerResult.status||'pending',
      provider_status:providerResult.provider_status||null,
      provider_reference:providerResult.provider_reference||null,
      request_payload:providerResult.request_payload||{},
      response_payload:providerResult.response_payload||{},
      updated_at:new Date().toISOString(),
    })

    await adminClient.from('external_payment_events').insert({
      organization_id:organizationId,transaction_id:inserted.id,event_type:'request_sent',
      status:updated.status,provider_status:updated.provider_status,payload:{provider_reference:updated.provider_reference}
    })

    return NextResponse.json({ok:true,transaction:updated})
  }catch(error){
    if(transaction?.id){
      const unresolved=Boolean(error.providerRequestUncertain||providerAccepted)
      const failureStatus=unresolved?'pending':'failed'
      const warning='Provider response was not confirmed. Check this transaction status before requesting another collection.'
      try{
        const updated=await saveProviderStatus(check.adminClient,transaction,{
          status:failureStatus,failure_reason:unresolved?warning:String(error.message||'Payment request failed').slice(0,500),updated_at:new Date().toISOString(),completed_at:unresolved?null:new Date().toISOString(),
        })
        await check.adminClient.from('external_payment_events').insert({
          organization_id:check.organizationId,transaction_id:transaction.id,event_type:unresolved?'request_unconfirmed':'request_failed',status:updated.status,payload:{error:unresolved?warning:String(error.message||'Payment request failed').slice(0,500)}
        })
        if(unresolved)return NextResponse.json({ok:true,transaction:updated,warning},{status:202})
      }catch{
        // The persisted created row/reference still blocks a duplicate request.
        return NextResponse.json({error:'The provider result could not be saved. Check transaction history before retrying.',transaction_id:transaction.id},{status:503})
      }
    }
    return NextResponse.json({error:error.message||'Payment request failed.'},{status:400})
  }
}

