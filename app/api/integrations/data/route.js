import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'

const DEFINITIONS={
  products:{
    table:'products',
    columns:['name','sku','barcode','item_type','unit','track_inventory','cost_price','selling_price','wholesale_price','tax_rate','reorder_level','active'],
    required:['name'],
    numeric:['cost_price','selling_price','wholesale_price','tax_rate','reorder_level'],
    boolean:['track_inventory','active'],
    match:['sku','barcode']
  },
  customers:{
    table:'customers',
    columns:['name','phone','email','address','customer_group','credit_limit','opening_balance','active','notes'],
    required:['name'],
    numeric:['credit_limit','opening_balance'],
    boolean:['active'],
    match:['email','phone']
  },
  suppliers:{
    table:'suppliers',
    columns:['name','phone','email','address','opening_balance','active','notes'],
    required:['name'],
    numeric:['opening_balance'],
    boolean:['active'],
    match:['email','phone']
  }
}

const csvCell=(value)=>{
  if(value===null||value===undefined)return ''
  const text=String(value)
  return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text
}

function normalizeValue(value,column,def){
  if(value===undefined)return undefined
  if(value===null||value==='')return null
  if(def.numeric.includes(column)){
    const n=Number(value)
    if(!Number.isFinite(n))throw new Error(`${column} must be numeric`)
    return n
  }
  if(def.boolean.includes(column)){
    if(typeof value==='boolean')return value
    const s=String(value).trim().toLowerCase()
    if(['true','1','yes','y'].includes(s))return true
    if(['false','0','no','n'].includes(s))return false
    throw new Error(`${column} must be true/false`)
  }
  return String(value).trim()
}

function normalizeRows(rows,def){
  if(!Array.isArray(rows))throw new Error('Rows must be an array.')
  if(rows.length>500)throw new Error('Import is limited to 500 rows per batch.')
  return rows.map((row,index)=>{
    const out={}
    for(const col of def.columns){
      if(Object.prototype.hasOwnProperty.call(row,col)){
        const v=normalizeValue(row[col],col,def)
        if(v!==undefined)out[col]=v
      }
    }
    for(const required of def.required){
      if(!String(out[required]??'').trim())throw new Error(`Row ${index+1}: ${required} is required.`)
    }
    return out
  })
}

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'integrations.view','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const url=new URL(req.url)
  const entity=url.searchParams.get('entity')||'products'
  const format=(url.searchParams.get('format')||'csv').toLowerCase()
  const def=DEFINITIONS[entity]
  if(!def)return NextResponse.json({error:'Unsupported export entity.'},{status:400})

  try{
    const {data,error}=await check.adminClient.from(def.table).select(def.columns.join(',')).eq('organization_id',check.organizationId).order('created_at',{ascending:true})
    if(error)throw error
    const rows=data||[]
    if(format==='json'){
      return new NextResponse(JSON.stringify(rows,null,2),{
        headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="mgt-${entity}.json"`,'cache-control':'no-store'}
      })
    }
    const csv=[def.columns.join(','),...rows.map(row=>def.columns.map(col=>csvCell(row[col])).join(','))].join('\n')
    return new NextResponse(csv,{
      headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="mgt-${entity}.csv"`,'cache-control':'no-store'}
    })
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'migration.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  return NextResponse.json({
    error:'This legacy import endpoint has been retired. Use the Migration Center so imports are validated, audited and opening balances remain accounting-safe.'
  },{status:410})
}
