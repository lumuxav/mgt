import { NextResponse } from 'next/server'
import { verifyOrganizationPermission } from '../../../../lib/serverAccess'
import { csvCell, readAllPages } from '../../../../lib/externalApi'

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

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'integrations.view','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const url=new URL(req.url)
  const entity=url.searchParams.get('entity')||'products'
  const format=(url.searchParams.get('format')||'csv').toLowerCase()
  const def=DEFINITIONS[entity]
  if(!def)return NextResponse.json({error:'Unsupported export entity.'},{status:400})

  try{
    const rows=await readAllPages(()=>check.adminClient.from(def.table).select(def.columns.join(',')).eq('organization_id',check.organizationId).order('id'))
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
