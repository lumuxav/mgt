import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServerClients } from '../../../../../lib/serverAccess'
import { checkProviderPayment } from '../../../../../lib/serverPaymentProviders'
import { saveProviderStatus } from '../../../../../lib/serverPaymentLifecycle'

const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex')

export async function POST(req,{params}){
  try{
    const {provider}=await params
    if(!['mtn_momo','airtel_money','gateway'].includes(provider))return NextResponse.json({error:'Unsupported provider.'},{status:404})
    const url=new URL(req.url)
    const id=url.searchParams.get('id')
    const token=url.searchParams.get('token')||''
    if(!id||!token)return NextResponse.json({error:'Invalid callback.'},{status:400})

    const {adminClient}=getServerClients()
    const {data:transaction,error}=await adminClient.from('external_payment_transactions').select('*').eq('id',id).eq('provider',provider).maybeSingle()
    if(error)throw error
    if(!transaction||!transaction.client_token_hash||transaction.client_token_hash!==sha(token))return NextResponse.json({error:'Invalid callback.'},{status:403})

    let callbackPayload={}
    try{callbackPayload=await req.json()}catch{}

    await adminClient.from('external_payment_events').insert({
      organization_id:transaction.organization_id,transaction_id:transaction.id,event_type:'provider_callback_received',
      status:transaction.status,provider_status:transaction.provider_status,payload:callbackPayload||{}
    })

    const {data:connection,error:connectionError}=await adminClient.rpc('server_get_payment_provider_connection',{
      p_organization_id:transaction.organization_id,p_connection_id:transaction.connection_id,
    })
    if(connectionError)throw connectionError

    const providerResult=await checkProviderPayment(connection,transaction)
    const completed=['succeeded','failed','cancelled','expired'].includes(providerResult.status)
    const updated=await saveProviderStatus(adminClient,transaction,{
      status:providerResult.status,
      provider_status:providerResult.provider_status||null,
      provider_financial_id:providerResult.provider_financial_id||transaction.provider_financial_id||null,
      failure_reason:providerResult.failure_reason||null,
      response_payload:providerResult.response_payload||callbackPayload||{},
      completed_at:completed?new Date().toISOString():transaction.completed_at,
      updated_at:new Date().toISOString(),
    })

    if(updated.status==='succeeded'&&updated.settlement_status!=='settled'){
      const settled=await adminClient.rpc('server_settle_external_payment',{p_transaction_id:updated.id})
      if(settled.error){
        await adminClient.from('external_payment_transactions').update({
          settlement_status:'reconciliation_required',
          settlement_result:{settled:false,error:settled.error.message},
          updated_at:new Date().toISOString(),
        }).eq('id',updated.id)
      }
    }

    await adminClient.from('external_payment_events').insert({
      organization_id:transaction.organization_id,transaction_id:transaction.id,event_type:'provider_callback_processed',
      status:updated.status,provider_status:updated.provider_status,payload:providerResult.response_payload||{}
    })

    return NextResponse.json({ok:true})
  }catch(error){
    return NextResponse.json({error:error.message||'Callback processing failed.'},{status:400})
  }
}

