import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../../lib/serverAccess'
import { checkProviderPayment } from '../../../../../lib/serverPaymentProviders'
import { saveProviderStatus } from '../../../../../lib/serverPaymentLifecycle'

async function refreshTransaction(adminClient,organizationId,transaction){
  const {data:connection,error:connectionError}=await adminClient.rpc('server_get_payment_provider_connection',{
    p_organization_id:organizationId,p_connection_id:transaction.connection_id,
  })
  if(connectionError)throw connectionError

  const providerResult=await checkProviderPayment(connection,transaction)
  const completed=['succeeded','failed','cancelled','expired'].includes(providerResult.status)
  const updated=await saveProviderStatus(adminClient,transaction,{
    status:providerResult.status,
    provider_status:providerResult.provider_status||null,
    provider_financial_id:providerResult.provider_financial_id||transaction.provider_financial_id||null,
    failure_reason:providerResult.failure_reason||null,
    response_payload:providerResult.response_payload||{},
    completed_at:completed?new Date().toISOString():transaction.completed_at,
    updated_at:new Date().toISOString(),
  })

  await adminClient.from('external_payment_events').insert({
    organization_id:organizationId,transaction_id:transaction.id,event_type:'status_checked',
    status:updated.status,provider_status:updated.provider_status,payload:providerResult.response_payload||{}
  })

  let settlement=null
  if(updated.status==='succeeded'&&updated.settlement_status!=='settled'){
    const settled=await adminClient.rpc('server_settle_external_payment',{p_transaction_id:updated.id})
    if(settled.error){
      await adminClient.from('external_payment_transactions').update({
        settlement_status:'reconciliation_required',
        settlement_result:{settled:false,error:settled.error.message},
        updated_at:new Date().toISOString(),
      }).eq('id',updated.id)
      settlement={settled:false,error:settled.error.message}
    }else settlement=settled.data
  }

  const {data:final,error:finalError}=await adminClient.from('external_payment_transactions')
    .select('*').eq('organization_id',organizationId).eq('id',transaction.id).single()
  if(finalError)throw finalError
  return {transaction:final,settlement}
}

export async function POST(req,{params}){
  const check=await verifyOrganizationPermission(req,'payments.view','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const {id}=await params
    const {data:transaction,error}=await check.adminClient.from('external_payment_transactions')
      .select('*').eq('organization_id',check.organizationId).eq('id',id).maybeSingle()
    if(error)throw error
    if(!transaction)return NextResponse.json({error:'Payment transaction not found.'},{status:404})
    const own=transaction.initiated_by===check.caller.id
    if(!own){
      const permission=await verifyOrganizationPermission(req,'payments.manage','payments')
      if(permission.error)return NextResponse.json({error:permission.error},{status:permission.status})
    }
    return NextResponse.json({ok:true,...await refreshTransaction(check.adminClient,check.organizationId,transaction)})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function PATCH(req,{params}){
  const check=await verifyOrganizationPermission(req,'payments.manage','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const {id}=await params
    const body=await req.json()
    if(body.action!=='settle')return NextResponse.json({error:'Unsupported payment action.'},{status:400})
    const {data:transaction,error}=await check.adminClient.from('external_payment_transactions')
      .select('*').eq('organization_id',check.organizationId).eq('id',id).maybeSingle()
    if(error)throw error
    if(!transaction)return NextResponse.json({error:'Payment transaction not found.'},{status:404})
    if(transaction.status!=='succeeded')throw new Error('Only successful provider payments can be settled.')
    const {data:settlement,error:settlementError}=await check.adminClient.rpc('server_settle_external_payment',{p_transaction_id:id})
    if(settlementError)throw settlementError
    const {data:updated,error:updateError}=await check.adminClient.from('external_payment_transactions').select('*').eq('id',id).single()
    if(updateError)throw updateError
    return NextResponse.json({ok:true,transaction:updated,settlement})
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

