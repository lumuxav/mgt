import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { consumeServerRateLimit, verifyOrganizationPermission } from '../../../../lib/serverAccess'
import { normalizeUgandaPhone,requestProviderPayment } from '../../../../lib/serverPaymentProviders'

const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex')
const ref=()=>`MGT-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

async function resolveTarget(adminClient,organizationId,targetType,targetId,customerId,amount){
  const numeric=Number(amount)
  if(!Number.isFinite(numeric)||numeric<=0)throw new Error('Payment amount must be greater than zero.')

  if(targetType==='sale'){
    const {data,error}=await adminClient.from('sales').select('id,location_id,customer_id,total_amount,amount_paid,refunded_amount,sale_number').eq('organization_id',organizationId).eq('id',targetId).maybeSingle()
    if(error)throw error;if(!data)throw new Error('Sale not found.')
    const due=Math.max(0,Number(data.total_amount||0)-Number(data.refunded_amount||0)-Number(data.amount_paid||0))
    if(numeric>due+0.009)throw new Error('Payment exceeds the sale balance.')
    return {target:data,locationId:data.location_id,customerId:data.customer_id,balance:due,label:data.sale_number}
  }

  if(targetType==='customer_debt'){
    const {data:customer,error}=await adminClient.from('customers').select('id,name').eq('organization_id',organizationId).eq('id',customerId||targetId).eq('active',true).maybeSingle()
    if(error)throw error;if(!customer)throw new Error('Customer not found.')
    const {data:sales,error:salesError}=await adminClient.from('sales').select('total_amount,amount_paid,refunded_amount').eq('organization_id',organizationId).eq('customer_id',customer.id)
    if(salesError)throw salesError
    const due=(sales||[]).reduce((sum,s)=>sum+Math.max(0,Number(s.total_amount||0)-Number(s.refunded_amount||0)-Number(s.amount_paid||0)),0)
    if(numeric>due+0.009)throw new Error('Payment exceeds the customer balance.')
    return {target:customer,locationId:null,customerId:customer.id,balance:due,label:customer.name}
  }

  if(targetType==='work_order'){
    const {data,error}=await adminClient.from('work_orders').select('id,location_id,customer_id,job_number,title,status,final_amount,quoted_amount,amount_paid').eq('organization_id',organizationId).eq('id',targetId).maybeSingle()
    if(error)throw error;if(!data)throw new Error('Service job not found.')
    if(data.status==='cancelled')throw new Error('Cancelled service jobs cannot receive payments.')
    const {data:lines,error:lineError}=await adminClient.from('work_order_lines').select('line_total').eq('work_order_id',data.id)
    if(lineError)throw lineError
    const total=(lines||[]).reduce((sum,x)=>sum+Number(x.line_total||0),0)||Number(data.final_amount||data.quoted_amount||0)
    const due=Math.max(0,total-Number(data.amount_paid||0))
    if(numeric>due+0.009)throw new Error('Payment exceeds the service-job balance.')
    return {target:data,locationId:data.location_id,customerId:data.customer_id,balance:due,label:data.job_number||data.title}
  }

  if(targetType==='project_invoice'){
    const {data,error}=await adminClient.from('project_invoices').select('id,location_id,customer_id,invoice_number,total_amount,amount_paid,status').eq('organization_id',organizationId).eq('id',targetId).maybeSingle()
    if(error)throw error;if(!data)throw new Error('Project invoice not found.')
    const due=Math.max(0,Number(data.total_amount||0)-Number(data.amount_paid||0))
    if(numeric>due+0.009)throw new Error('Payment exceeds the project invoice balance.')
    return {target:data,locationId:data.location_id,customerId:data.customer_id,balance:due,label:data.invoice_number}
  }

  if(targetType==='online_order'){
    const {data,error}=await adminClient.from('online_orders').select('id,location_id,customer_id,order_number,total_amount,payment_status,status,customer_phone').eq('organization_id',organizationId).eq('id',targetId).maybeSingle()
    if(error)throw error;if(!data)throw new Error('Online order not found.')
    if(data.status==='cancelled')throw new Error('Cancelled online orders cannot receive payments.')
    if(data.payment_status==='paid')throw new Error('Online order is already paid.')
    if(Math.abs(numeric-Number(data.total_amount||0))>0.009)throw new Error('Online-order payment must equal the order total.')
    return {target:data,locationId:data.location_id,customerId:data.customer_id,balance:Number(data.total_amount||0),label:data.order_number,phone:data.customer_phone}
  }

  if(targetType==='unallocated'){
    return {target:null,locationId:null,customerId:customerId||null,balance:numeric,label:'Unallocated payment'}
  }

  throw new Error('Unsupported payment target.')
}

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'payments.view','payments')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  try{
    const {data,error}=await check.adminClient.from('external_payment_transactions')
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

    const target=await resolveTarget(adminClient,organizationId,targetType,targetId,body.customer_id||null,amount)
    const phone=normalizeUgandaPhone(body.payer_phone||target.phone||'')
    if(!/^256\d{9}$/.test(phone))throw new Error('Enter a valid Ugandan mobile-money number.')

    const externalReference=ref()
    const callbackToken=crypto.randomBytes(32).toString('hex')
    const origin=new URL(req.url).origin
    const currency=String(connectionRow.currency||body.currency||'UGX').toUpperCase()

    const {data:inserted,error:insertError}=await adminClient.from('external_payment_transactions').insert({
      organization_id:organizationId,connection_id:connectionRow.id,provider:connectionRow.provider,transaction_type:'collection',
      target_type:targetType,target_id:targetId,location_id:target.locationId||caller.default_location_id||null,
      customer_id:target.customerId||body.customer_id||null,amount,currency,payer_phone:phone,external_reference:externalReference,
      status:'created',settlement_status:'pending',client_token_hash:sha(callbackToken),initiated_by:caller.id,
      metadata:{label:target.label,balance_before:target.balance,created_from:'mgt_payments'},
    }).select('*').single()
    if(insertError)throw insertError
    transaction=inserted

    const {data:connection,error:secretError}=await adminClient.rpc('server_get_payment_provider_connection',{
      p_organization_id:organizationId,p_connection_id:connectionRow.id,
    })
    if(secretError)throw secretError

    const callbackUrl=`${origin}/api/payments/webhooks/${connectionRow.provider}?id=${inserted.id}&token=${callbackToken}`
    const providerResult=await requestProviderPayment(connection,{
      reference:externalReference,phone,amount,currency,callbackUrl,note:target.label,targetType,targetId,
    })

    const {data:updated,error:updateError}=await adminClient.from('external_payment_transactions').update({
      status:providerResult.status||'pending',
      provider_status:providerResult.provider_status||null,
      provider_reference:providerResult.provider_reference||null,
      request_payload:providerResult.request_payload||{},
      response_payload:providerResult.response_payload||{},
      updated_at:new Date().toISOString(),
    }).eq('organization_id',organizationId).eq('id',inserted.id).select('*').single()
    if(updateError)throw updateError

    await adminClient.from('external_payment_events').insert({
      organization_id:organizationId,transaction_id:inserted.id,event_type:'request_sent',
      status:updated.status,provider_status:updated.provider_status,payload:{provider_reference:updated.provider_reference}
    })

    return NextResponse.json({ok:true,transaction:updated})
  }catch(error){
    if(transaction?.id){
      await check.adminClient.from('external_payment_transactions').update({
        status:'failed',failure_reason:String(error.message||'Payment request failed').slice(0,500),updated_at:new Date().toISOString(),completed_at:new Date().toISOString(),
      }).eq('id',transaction.id).eq('organization_id',check.organizationId)
      await check.adminClient.from('external_payment_events').insert({
        organization_id:check.organizationId,transaction_id:transaction.id,event_type:'request_failed',status:'failed',payload:{error:String(error.message||'Payment request failed').slice(0,500)}
      })
    }
    return NextResponse.json({error:error.message||'Payment request failed.'},{status:400})
  }
}
