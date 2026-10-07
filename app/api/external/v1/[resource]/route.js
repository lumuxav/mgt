import crypto from 'node:crypto'
import { NextResponse } from 'next/server'
import { getServerClients } from '../../../../../lib/serverAccess'

const RESOURCES={
  products:{table:'products',scope:'catalog.read',select:'id,name,sku,barcode,item_type,unit,track_inventory,cost_price,selling_price,wholesale_price,tax_rate,reorder_level,active,updated_at'},
  customers:{table:'customers',scope:'customers.read',select:'id,name,phone,email,address,customer_group,credit_limit,active,updated_at'},
  suppliers:{table:'suppliers',scope:'suppliers.read',select:'id,name,phone,email,address,active,updated_at'},
  sales:{table:'sales',scope:'sales.read',select:'id,location_id,customer_id,sale_number,channel,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,created_at,updated_at'},
  stock:{table:'stock_balances',scope:'inventory.read',select:'product_id,location_id,quantity,reserved_quantity,updated_at'},
  work_orders:{table:'work_orders',scope:'services.read',select:'id,job_number,location_id,customer_id,title,status,priority,quoted_amount,final_amount,amount_paid,payment_status,due_at,scheduled_at,completed_at,updated_at'},
  projects:{table:'projects',scope:'projects.read',select:'id,project_number,location_id,customer_id,name,status,priority,start_date,due_date,progress_percent,contract_value,budget_cost,created_at,updated_at'},
  deliveries:{table:'deliveries',scope:'fleet.read',select:'id,delivery_number,source_location_id,customer_id,sale_id,work_order_id,vehicle_id,driver_user_id,status,destination,scheduled_at,dispatched_at,delivered_at,updated_at'},
  online_orders:{table:'online_orders',scope:'ecommerce.read',select:'id,storefront_id,location_id,customer_id,order_number,status,payment_status,payment_method,customer_name,customer_phone,fulfillment_method,subtotal,tax_amount,delivery_fee,total_amount,sale_id,delivery_id,created_at,updated_at'}
}

const sha=(value)=>crypto.createHash('sha256').update(value).digest('hex')

export async function GET(req,{params}){
  const resource=(await params)?.resource
  const def=RESOURCES[resource]
  if(!def)return NextResponse.json({error:'Unknown resource.'},{status:404,headers:{'cache-control':'no-store'}})

  let clients
  try{clients=getServerClients()}catch(error){return NextResponse.json({error:error.message},{status:500})}
  const token=(req.headers.get('authorization')||'').replace(/^Bearer\s+/i,'').trim()
  if(!token||!token.startsWith('mgt_live_'))return NextResponse.json({error:'Valid MGT API key required.'},{status:401})

  const keyHash=sha(token)
  const {data:key,error:keyError}=await clients.adminClient
    .from('integration_api_keys')
    .select('id,organization_id,scopes,active,expires_at')
    .eq('key_hash',keyHash)
    .maybeSingle()
  if(keyError)return NextResponse.json({error:'API authentication failed.'},{status:500})
  if(!key||!key.active||key.revoked_at)return NextResponse.json({error:'API key is inactive.'},{status:401})
  if(key.expires_at&&new Date(key.expires_at)<=new Date())return NextResponse.json({error:'API key has expired.'},{status:401})
  if(!(key.scopes||[]).includes(def.scope))return NextResponse.json({error:`Missing scope: ${def.scope}`},{status:403})

  const url=new URL(req.url)
  const limit=Math.min(500,Math.max(1,Number(url.searchParams.get('limit')||100)))
  const offset=Math.max(0,Number(url.searchParams.get('offset')||0))
  let query=clients.adminClient.from(def.table).select(def.select).eq('organization_id',key.organization_id).range(offset,offset+limit-1)

  const updatedAfter=url.searchParams.get('updated_after')
  if(updatedAfter&&['products','customers','suppliers','sales','stock','work_orders','projects','deliveries','online_orders'].includes(resource)){
    const date=new Date(updatedAfter)
    if(!Number.isNaN(date.getTime()))query=query.gt('updated_at',date.toISOString())
  }

  const {data,error}=await query
  if(error)return NextResponse.json({error:error.message},{status:400,headers:{'cache-control':'no-store'}})

  await clients.adminClient.from('integration_api_keys').update({last_used_at:new Date().toISOString()}).eq('id',key.id)
  return NextResponse.json({ok:true,resource,count:(data||[]).length,offset,limit,data:data||[]},{
    headers:{'cache-control':'no-store','x-mgt-resource':resource}
  })
}
