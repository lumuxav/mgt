import crypto from 'node:crypto'

const clean=(value)=>String(value??'').trim()
const jsonHeaders={'content-type':'application/json','accept':'application/json'}
const textExcerpt=(value,max=1200)=>String(value||'').slice(0,max)

export function normalizeUgandaPhone(value){
  let digits=clean(value).replace(/\D/g,'')
  if(digits.startsWith('256'))return digits
  if(digits.startsWith('0'))digits=digits.slice(1)
  if(digits.length===9)return '256'+digits
  if(digits.length===10&&digits.startsWith('0'))return '256'+digits.slice(1)
  return digits
}

export function providerLabel(provider){
  if(provider==='mtn_momo')return 'MTN MoMo'
  if(provider==='airtel_money')return 'Airtel Money'
  return 'Payment Gateway'
}

const safeJson=async(response)=>{
  const text=await response.text()
  try{return {json:JSON.parse(text||'{}'),text}}catch{return {json:{raw:text},text}}
}

async function mtnToken(connection){
  const credentials=connection.credentials||{}
  const config=connection.public_config||{}
  const base=clean(config.base_url)||(connection.environment==='production'?'https://proxy.momoapi.mtn.com':'https://sandbox.momodeveloper.mtn.com')
  const user=clean(credentials.api_user)
  const key=clean(credentials.api_key)
  const subscription=clean(credentials.subscription_key)
  if(!user||!key||!subscription)throw new Error('MTN connection requires api_user, api_key and subscription_key.')
  const response=await fetch(base+'/collection/token/',{
    method:'POST',
    headers:{
      'authorization':'Basic '+Buffer.from(user+':'+key).toString('base64'),
      'Ocp-Apim-Subscription-Key':subscription,
    },
    signal:AbortSignal.timeout(15000),
  })
  const body=await safeJson(response)
  if(!response.ok||!body.json?.access_token)throw new Error('MTN token request failed: '+textExcerpt(body.text||response.status))
  return {token:body.json.access_token,base,subscription,target:clean(config.target_environment)||(connection.environment==='production'?'mtnuganda':'sandbox')}
}

async function mtnRequest(connection,{reference,phone,amount,currency,callbackUrl,note}){
  const auth=await mtnToken(connection)
  const providerReference=crypto.randomUUID()
  const headers={
    ...jsonHeaders,
    'authorization':'Bearer '+auth.token,
    'Ocp-Apim-Subscription-Key':auth.subscription,
    'X-Target-Environment':auth.target,
    'X-Reference-Id':providerReference,
  }
  if(callbackUrl)headers['X-Callback-Url']=callbackUrl
  const payload={
    amount:Number(amount).toFixed(2),
    currency,
    externalId:reference,
    payer:{partyIdType:'MSISDN',partyId:phone},
    payerMessage:note||reference,
    payeeNote:note||reference,
  }
  const response=await fetch(auth.base+'/collection/v1_0/requesttopay',{
    method:'POST',headers,body:JSON.stringify(payload),signal:AbortSignal.timeout(20000),
  })
  const body=await safeJson(response)
  if(!response.ok&&response.status!==202)throw new Error('MTN Request-to-Pay failed: '+textExcerpt(body.text||response.status))
  return {status:'pending',provider_status:String(response.status),provider_reference:providerReference,request_payload:payload,response_payload:body.json}
}

async function mtnStatus(connection,transaction){
  const auth=await mtnToken(connection)
  const response=await fetch(auth.base+'/collection/v1_0/requesttopay/'+encodeURIComponent(transaction.provider_reference),{
    headers:{
      'authorization':'Bearer '+auth.token,
      'Ocp-Apim-Subscription-Key':auth.subscription,
      'X-Target-Environment':auth.target,
    },
    signal:AbortSignal.timeout(15000),
  })
  const body=await safeJson(response)
  if(!response.ok)throw new Error('MTN status check failed: '+textExcerpt(body.text||response.status))
  const raw=String(body.json?.status||'').toUpperCase()
  const status=raw==='SUCCESSFUL'?'succeeded':raw==='FAILED'?'failed':raw==='REJECTED'?'cancelled':raw==='EXPIRED'?'expired':'pending'
  return {
    status,
    provider_status:raw||String(response.status),
    provider_financial_id:body.json?.financialTransactionId||transaction.provider_financial_id||null,
    failure_reason:body.json?.reason||null,
    response_payload:body.json,
  }
}

async function airtelToken(connection){
  const credentials=connection.credentials||{}
  const config=connection.public_config||{}
  const base=clean(config.base_url)||(connection.environment==='production'?'https://openapi.airtel.africa':'https://openapiuat.airtel.africa')
  const clientId=clean(credentials.client_id)
  const clientSecret=clean(credentials.client_secret)
  if(!clientId||!clientSecret)throw new Error('Airtel connection requires client_id and client_secret.')
  const response=await fetch(base+'/auth/oauth2/token',{
    method:'POST',headers:jsonHeaders,
    body:JSON.stringify({client_id:clientId,client_secret:clientSecret,grant_type:'client_credentials'}),
    signal:AbortSignal.timeout(15000),
  })
  const body=await safeJson(response)
  if(!response.ok||!body.json?.access_token)throw new Error('Airtel token request failed: '+textExcerpt(body.text||response.status))
  return {token:body.json.access_token,base}
}

async function airtelRequest(connection,{reference,phone,amount,currency,callbackUrl}){
  const auth=await airtelToken(connection)
  const config=connection.public_config||{}
  const country=clean(connection.country_code||config.country_code||'UG').toUpperCase()
  const transactionId=crypto.randomUUID()
  const path=(clean(config.collection_path)||'/merchant/v2/payments/{country}').replace('{country}',country)
  const payload={
    reference,
    subscriber:{country,currency,msisdn:phone},
    transaction:{amount:Number(amount).toFixed(2),country,currency,id:transactionId,type:'MerchantPayment'},
  }
  if(callbackUrl)payload.callback_url=callbackUrl
  const response=await fetch(auth.base+path,{
    method:'POST',
    headers:{...jsonHeaders,'authorization':'Bearer '+auth.token,'X-Country':country,'X-Currency':currency},
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(20000),
  })
  const body=await safeJson(response)
  if(!response.ok)throw new Error('Airtel payment request failed: '+textExcerpt(body.text||response.status))
  const providerStatus=body.json?.data?.transaction?.status||body.json?.status?.message||String(response.status)
  return {status:'pending',provider_status:String(providerStatus),provider_reference:transactionId,request_payload:payload,response_payload:body.json}
}

async function airtelStatus(connection,transaction){
  const auth=await airtelToken(connection)
  const config=connection.public_config||{}
  const country=clean(connection.country_code||config.country_code||'UG').toUpperCase()
  const path=(clean(config.status_path)||'/standard/v1/payments/{id}').replace('{id}',encodeURIComponent(transaction.provider_reference))
  const response=await fetch(auth.base+path,{
    headers:{...jsonHeaders,'authorization':'Bearer '+auth.token,'X-Country':country,'X-Currency':transaction.currency},
    signal:AbortSignal.timeout(15000),
  })
  const body=await safeJson(response)
  if(!response.ok)throw new Error('Airtel payment status failed: '+textExcerpt(body.text||response.status))
  const tx=body.json?.data?.transaction||body.json?.transaction||{}
  const raw=String(tx.status||body.json?.status?.message||'').toUpperCase()
  const status=['TS','SUCCESS','SUCCESSFUL','COMPLETED'].includes(raw)?'succeeded':['TF','FAILED'].includes(raw)?'failed':['REJECTED','CANCELLED'].includes(raw)?'cancelled':['EXPIRED'].includes(raw)?'expired':'pending'
  return {
    status,
    provider_status:raw||String(response.status),
    provider_financial_id:tx.airtel_money_id||tx.airtelMoneyId||tx.id||transaction.provider_financial_id||null,
    failure_reason:tx.message||body.json?.status?.message||null,
    response_payload:body.json,
  }
}

function gatewayHeaders(connection){
  const credentials=connection.credentials||{}
  const config=connection.public_config||{}
  const headers={...jsonHeaders}
  if(credentials.bearer_token)headers.authorization='Bearer '+credentials.bearer_token
  if(credentials.api_key)headers[clean(config.api_key_header)||'x-api-key']=credentials.api_key
  return headers
}

async function gatewayRequest(connection,input){
  const config=connection.public_config||{}
  const url=clean(config.request_url)
  if(!url)throw new Error('Gateway request_url is not configured.')
  const providerReference=crypto.randomUUID()
  const payload={
    reference:input.reference,transaction_id:providerReference,amount:Number(input.amount),currency:input.currency,
    phone:input.phone,callback_url:input.callbackUrl,target_type:input.targetType,target_id:input.targetId,
  }
  const response=await fetch(url,{method:'POST',headers:gatewayHeaders(connection),body:JSON.stringify(payload),signal:AbortSignal.timeout(20000)})
  const body=await safeJson(response)
  if(!response.ok)throw new Error('Gateway payment request failed: '+textExcerpt(body.text||response.status))
  return {
    status:'pending',
    provider_status:String(body.json?.status||response.status),
    provider_reference:String(body.json?.reference||body.json?.transaction_id||providerReference),
    request_payload:payload,response_payload:body.json,
  }
}

async function gatewayStatus(connection,transaction){
  const config=connection.public_config||{}
  const template=clean(config.status_url)
  if(!template)throw new Error('Gateway status_url is not configured.')
  const url=template.replace('{reference}',encodeURIComponent(transaction.provider_reference||transaction.external_reference))
  const response=await fetch(url,{headers:gatewayHeaders(connection),signal:AbortSignal.timeout(15000)})
  const body=await safeJson(response)
  if(!response.ok)throw new Error('Gateway status check failed: '+textExcerpt(body.text||response.status))
  const raw=String(body.json?.status||'').toLowerCase()
  const status=['success','successful','succeeded','paid','completed'].includes(raw)?'succeeded':['failed','failure'].includes(raw)?'failed':['cancelled','canceled'].includes(raw)?'cancelled':['expired'].includes(raw)?'expired':'pending'
  return {status,provider_status:raw||String(response.status),provider_financial_id:body.json?.financial_id||body.json?.id||null,failure_reason:body.json?.message||null,response_payload:body.json}
}

export async function requestProviderPayment(connection,input){
  if(connection.provider==='mtn_momo')return mtnRequest(connection,input)
  if(connection.provider==='airtel_money')return airtelRequest(connection,input)
  return gatewayRequest(connection,input)
}

export async function checkProviderPayment(connection,transaction){
  if(connection.provider==='mtn_momo')return mtnStatus(connection,transaction)
  if(connection.provider==='airtel_money')return airtelStatus(connection,transaction)
  return gatewayStatus(connection,transaction)
}
