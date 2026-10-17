import { NextResponse } from 'next/server'
import { consumeServerRateLimit, getServerClients, requestClientAddress } from '../../../lib/serverAccess'

export const dynamic = 'force-dynamic'
export const revalidate = 0

const clean=(value,max=500)=>String(value||'').trim().slice(0,max)

async function ecommerceEnabled(adminClient,organizationId){
  const {data:organization,error:organizationError}=await adminClient.from('organizations').select('active').eq('id',organizationId).maybeSingle()
  if(organizationError)throw organizationError
  if(organization?.active!==true)return false
  const {data,error}=await adminClient
    .from('organization_modules')
    .select('enabled')
    .eq('organization_id',organizationId)
    .eq('module_key','ecommerce')
    .maybeSingle()
  if(error)throw error
  return data?.enabled===true
}

export async function GET(req){
  try{
    const {adminClient}=getServerClients()
    const slug=clean(new URL(req.url).searchParams.get('slug'),64).toLowerCase()
    if(!slug)return NextResponse.json({error:'Storefront is required.'},{status:400})

    const {data:store,error:storeError}=await adminClient
      .from('storefronts')
      .select('id,organization_id,location_id,name,slug,headline,description,contact_phone,contact_email,currency,delivery_fee,allow_pickup,allow_delivery')
      .ilike('slug',slug)
      .eq('active',true)
      .maybeSingle()
    if(storeError)throw storeError
    if(!store)return NextResponse.json({error:'Storefront not found.'},{status:404})
    if(!(await ecommerceEnabled(adminClient,store.organization_id)))return NextResponse.json({error:'This online store is currently unavailable.'},{status:404})

    const {data:listings,error:listError}=await adminClient
      .from('storefront_products')
      .select('id,product_id,featured,title_override,description,image_url,price_override,max_per_order,sort_order')
      .eq('storefront_id',store.id)
      .eq('organization_id',store.organization_id)
      .eq('published',true)
      .order('featured',{ascending:false})
      .order('sort_order',{ascending:true})
    if(listError)throw listError

    const productIds=(listings||[]).map(x=>x.product_id)
    if(!productIds.length)return NextResponse.json({ok:true,store,products:[]})

    const [productRes,stockRes]=await Promise.all([
      adminClient.from('products').select('id,name,sku,unit,selling_price,tax_rate,track_inventory').eq('organization_id',store.organization_id).eq('active',true).in('id',productIds),
      adminClient.from('stock_balances').select('product_id,quantity,reserved_quantity').eq('location_id',store.location_id).in('product_id',productIds),
    ])
    if(productRes.error)throw productRes.error
    if(stockRes.error)throw stockRes.error

    const productsById=new Map((productRes.data||[]).map(x=>[x.id,x]))
    const stockById=new Map((stockRes.data||[]).map(x=>[x.product_id,x]))
    const products=(listings||[]).map(listing=>{
      const product=productsById.get(listing.product_id)
      if(!product)return null
      const stock=stockById.get(product.id)
      const available=product.track_inventory?Math.max(Number(stock?.quantity||0)-Number(stock?.reserved_quantity||0),0):null
      return {
        id:product.id,
        name:listing.title_override||product.name,
        sku:product.sku,
        unit:product.unit,
        price:Number(listing.price_override??product.selling_price??0),
        tax_rate:Number(product.tax_rate||0),
        featured:Boolean(listing.featured),
        description:listing.description||'',
        image_url:listing.image_url||'',
        max_per_order:listing.max_per_order===null?null:Number(listing.max_per_order),
        available_quantity:available,
        in_stock:product.track_inventory?available>0:true,
      }
    }).filter(Boolean)

    return NextResponse.json({ok:true,store,products})
  }catch(error){
    return NextResponse.json({error:error.message||'Could not load storefront.'},{status:400})
  }
}

export async function POST(req){
  try{
    const {adminClient}=getServerClients()
    const body=await req.json()
    const slug=clean(body.slug,64).toLowerCase()
    const items=Array.isArray(body.items)?body.items.slice(0,100).map(item=>({
      product_id:clean(item.product_id,64),
      quantity:Number(item.quantity||0),
    })):[]
    if(!slug)return NextResponse.json({error:'Storefront is required.'},{status:400})
    if(!items.length)return NextResponse.json({error:'Your cart is empty.'},{status:400})

    const rate=await consumeServerRateLimit(adminClient,{
      scope:'storefront_order',
      key:requestClientAddress(req)+'|'+slug,
      limit:15,
      windowSeconds:600,
    })
    if(!rate.allowed)return NextResponse.json(
      {error:'Too many order attempts. Please wait a few minutes and try again.'},
      {status:429,headers:{'Retry-After':String(rate.retry_after||60)}}
    )

    const {data:store,error:storeError}=await adminClient
      .from('storefronts')
      .select('organization_id')
      .ilike('slug',slug)
      .eq('active',true)
      .maybeSingle()
    if(storeError)throw storeError
    if(!store||!(await ecommerceEnabled(adminClient,store.organization_id)))return NextResponse.json({error:'This online store is currently unavailable.'},{status:404})

    const {data,error}=await adminClient.rpc('create_online_order_public',{
      p_store_slug:slug,
      p_customer_name:clean(body.customer_name,160),
      p_customer_phone:clean(body.customer_phone,80),
      p_customer_email:clean(body.customer_email,180)||null,
      p_delivery_address:clean(body.delivery_address,500)||null,
      p_fulfillment_method:clean(body.fulfillment_method,20)||'pickup',
      p_payment_method:clean(body.payment_method,50)||null,
      p_notes:clean(body.notes,1000)||null,
      p_items:items,
    })
    if(error)throw error
    return NextResponse.json({ok:true,...data},{status:201})
  }catch(error){
    return NextResponse.json({error:error.message||'Could not place order.'},{status:400})
  }
}
