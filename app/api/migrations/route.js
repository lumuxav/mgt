import { NextResponse } from 'next/server'
import { consumeServerRateLimit, verifyOrganizationPermission } from '../../../lib/serverAccess'

const clean=(value,max=500)=>String(value??'').trim().slice(0,max)
const normalizeEmail=value=>clean(value,180).toLowerCase()
const csvCell=value=>{
  if(value===null||value===undefined)return ''
  const s=String(value)
  return /[",\n\r]/.test(s)?`"${s.replaceAll('"','""')}"`:s
}
const asNumber=(value,label,{min=0,nullable=false}={})=>{
  if(value===null||value===undefined||String(value).trim()===''){
    if(nullable)return null
    return 0
  }
  const n=Number(value)
  if(!Number.isFinite(n))throw new Error(`${label} must be numeric`)
  if(n<min)throw new Error(`${label} must be at least ${min}`)
  return n
}
const asBoolean=(value,defaultValue=true)=>{
  if(value===undefined||value===null||String(value).trim()==='')return defaultValue
  if(typeof value==='boolean')return value
  const s=String(value).trim().toLowerCase()
  if(['1','true','yes','y'].includes(s))return true
  if(['0','false','no','n'].includes(s))return false
  throw new Error('Boolean values must be true/false, yes/no or 1/0')
}
const uniqueNonEmpty=(rows,key)=>{
  const seen=new Map(),errors=[]
  rows.forEach((row,index)=>{
    const v=clean(row[key],250).toLowerCase()
    if(!v)return
    if(seen.has(v))errors.push({row:index+1,error:`Duplicate ${key} "${row[key]}" also appears on row ${seen.get(v)}.`})
    else seen.set(v,index+1)
  })
  return errors
}

const IMPORT_DEFS={
  products:{
    title:'Products & Services',
    columns:['name','sku','barcode','item_type','unit','track_inventory','cost_price','selling_price','wholesale_price','tax_rate','reorder_level','active'],
    required:['name'],
    match:['sku','barcode'],
    template:[{name:'Example Product',sku:'SKU-001',barcode:'',item_type:'product',unit:'pieces',track_inventory:'true',cost_price:'10000',selling_price:'15000',wholesale_price:'13500',tax_rate:'0',reorder_level:'5',active:'true'}],
  },
  customers:{
    title:'Customers',
    columns:['name','phone','email','address','customer_group','credit_limit','active','notes'],
    required:['name'],
    match:['email','phone'],
    template:[{name:'Example Customer',phone:'0772123456',email:'customer@example.com',address:'Kampala',customer_group:'Retail',credit_limit:'0',active:'true',notes:''}],
  },
  suppliers:{
    title:'Suppliers',
    columns:['name','phone','email','address','active','notes'],
    required:['name'],
    match:['email','phone'],
    template:[{name:'Example Supplier',phone:'0700123456',email:'supplier@example.com',address:'Kampala',active:'true',notes:''}],
  },
  opening_stock:{
    title:'Opening Stock',
    columns:['product_sku','product_barcode','product_name','location_code','location_name','quantity','unit_cost','notes'],
    required:['quantity','unit_cost'],
    template:[{product_sku:'SKU-001',product_barcode:'',product_name:'Example Product',location_code:'MAIN',location_name:'Main Branch',quantity:'100',unit_cost:'10000',notes:'Opening stock from previous system'}],
  },
  customer_balances:{
    title:'Customer Opening Balances',
    columns:['customer_email','customer_phone','customer_name','opening_balance','as_of_date'],
    required:['opening_balance'],
    template:[{customer_email:'customer@example.com',customer_phone:'',customer_name:'Example Customer',opening_balance:'250000',as_of_date:'2026-10-01'}],
  },
  supplier_balances:{
    title:'Supplier Opening Balances',
    columns:['supplier_email','supplier_phone','supplier_name','opening_balance','as_of_date'],
    required:['opening_balance'],
    template:[{supplier_email:'supplier@example.com',supplier_phone:'',supplier_name:'Example Supplier',opening_balance:'400000',as_of_date:'2026-10-01'}],
  },
  staff:{
    title:'Staff Invitations',
    columns:['full_name','email','role','location_code','location_name'],
    required:['full_name','email','role'],
    template:[{full_name:'Example Staff Member',email:'staff@example.com',role:'employee',location_code:'MAIN',location_name:'Main Branch'}],
  },
}

const EXPORT_DEFS={
  products:{table:'products',columns:['name','sku','barcode','item_type','unit','track_inventory','cost_price','selling_price','wholesale_price','tax_rate','reorder_level','active']},
  customers:{table:'customers',columns:['name','phone','email','address','customer_group','credit_limit','opening_balance','opening_balance_paid','active','notes']},
  suppliers:{table:'suppliers',columns:['name','phone','email','address','opening_balance','opening_balance_paid','active','notes']},
  staff:{table:'users',columns:['full_name','email','role','active','default_location_id','created_at']},
  sales:{table:'sales',columns:['sale_number','location_id','customer_id','sale_type','subtotal','discount_amount','tax_amount','total_amount','amount_paid','payment_status','status','created_at']},
  payments:{table:'payments',columns:['location_id','customer_id','supplier_id','sale_id','purchase_id','work_order_id','project_id','project_invoice_id','direction','payment_type','method','amount','reference','notes','created_at']},
  stock_movements:{table:'stock_movements',columns:['location_id','product_id','movement_type','quantity','unit_cost','reference_type','reference_id','notes','created_at']},
  opening_stock:{table:'opening_stock_imports',columns:['location_id','product_id','opening_quantity','unit_cost','total_value','created_at','updated_at']},
}

function makeCsv(columns,rows){
  return [columns.join(','),...rows.map(row=>columns.map(col=>csvCell(row[col])).join(','))].join('\n')
}

async function findLocation(adminClient,organizationId,row){
  let query=adminClient.from('locations').select('id,name,code').eq('organization_id',organizationId).eq('active',true)
  const code=clean(row.location_code,80)
  const name=clean(row.location_name,160)
  if(code)query=query.ilike('code',code)
  else if(name)query=query.ilike('name',name)
  else return null
  const {data,error}=await query.limit(2)
  if(error)throw error
  if((data||[]).length!==1)throw new Error((data||[]).length?'Location lookup is ambiguous':'Location not found')
  return data[0]
}

async function findProduct(adminClient,organizationId,row){
  const candidates=[
    ['sku',clean(row.product_sku,160)],
    ['barcode',clean(row.product_barcode,160)],
    ['name',clean(row.product_name,250)],
  ].filter(([,v])=>v)
  if(!candidates.length)throw new Error('Provide product_sku, product_barcode or product_name')
  for(const [key,value] of candidates){
    const {data,error}=await adminClient.from('products').select('id,name,sku,barcode,track_inventory,active').eq('organization_id',organizationId).eq('active',true).ilike(key,value).limit(2)
    if(error)throw error
    if((data||[]).length===1)return data[0]
    if((data||[]).length>1)throw new Error(`Product lookup by ${key} is ambiguous`)
  }
  throw new Error('Product not found')
}

async function findParty(adminClient,organizationId,type,row){
  const table=type==='customer'?'customers':'suppliers'
  const prefix=type==='customer'?'customer':'supplier'
  const candidates=[
    ['email',normalizeEmail(row[`${prefix}_email`])],
    ['phone',clean(row[`${prefix}_phone`],80)],
    ['name',clean(row[`${prefix}_name`],250)],
  ].filter(([,v])=>v)
  if(!candidates.length)throw new Error(`Provide ${prefix}_email, ${prefix}_phone or ${prefix}_name`)
  for(const [key,value] of candidates){
    const {data,error}=await adminClient.from(table).select('id,name,email,phone,active').eq('organization_id',organizationId).eq('active',true).ilike(key,value).limit(2)
    if(error)throw error
    if((data||[]).length===1)return data[0]
    if((data||[]).length>1)throw new Error(`${type} lookup by ${key} is ambiguous`)
  }
  throw new Error(`${type==='customer'?'Customer':'Supplier'} not found`)
}

function basicRowValidation(entity,row,index){
  const def=IMPORT_DEFS[entity]
  const errors=[]
  for(const key of def.required){
    if(row[key]===undefined||row[key]===null||String(row[key]).trim()==='')errors.push({row:index+1,error:`${key} is required`})
  }
  if(entity==='products'){
    try{
      asNumber(row.cost_price,'cost_price',{min:0});asNumber(row.selling_price,'selling_price',{min:0})
      if(row.wholesale_price!==undefined&&String(row.wholesale_price).trim()!=='')asNumber(row.wholesale_price,'wholesale_price',{min:0})
      asNumber(row.tax_rate,'tax_rate',{min:0});asNumber(row.reorder_level,'reorder_level',{min:0})
      asBoolean(row.track_inventory,true);asBoolean(row.active,true)
    }catch(error){errors.push({row:index+1,error:error.message})}
  }
  if(entity==='customers'){
    try{asNumber(row.credit_limit,'credit_limit',{min:0});asBoolean(row.active,true)}catch(error){errors.push({row:index+1,error:error.message})}
  }
  if(entity==='suppliers'){
    try{asBoolean(row.active,true)}catch(error){errors.push({row:index+1,error:error.message})}
  }
  if(entity==='opening_stock'){
    try{asNumber(row.quantity,'quantity',{min:0});asNumber(row.unit_cost,'unit_cost',{min:0})}catch(error){errors.push({row:index+1,error:error.message})}
    if(!clean(row.product_sku)&&!clean(row.product_barcode)&&!clean(row.product_name))errors.push({row:index+1,error:'Provide product_sku, product_barcode or product_name'})
    if(!clean(row.location_code)&&!clean(row.location_name))errors.push({row:index+1,error:'Provide location_code or location_name'})
  }
  if(entity==='customer_balances'||entity==='supplier_balances'){
    try{asNumber(row.opening_balance,'opening_balance',{min:0})}catch(error){errors.push({row:index+1,error:error.message})}
  }
  if(entity==='staff'){
    const email=normalizeEmail(row.email)
    if(!email||!email.includes('@'))errors.push({row:index+1,error:'A valid email is required'})
  }
  return errors
}

async function validateRows(adminClient,organizationId,entity,rows,strategy){
  if(!Array.isArray(rows))throw new Error('Rows must be an array.')
  const limit=entity==='staff'?100:1000
  if(rows.length>limit)throw new Error(`This import is limited to ${limit} rows per batch.`)
  const errors=[]
  rows.forEach((row,index)=>errors.push(...basicRowValidation(entity,row,index)))
  if(entity==='products')errors.push(...uniqueNonEmpty(rows,'sku'),...uniqueNonEmpty(rows,'barcode'))
  if(entity==='customers'||entity==='suppliers')errors.push(...uniqueNonEmpty(rows,'email'),...uniqueNonEmpty(rows,'phone'))
  if(entity==='staff')errors.push(...uniqueNonEmpty(rows,'email'))
  if(errors.length)return {valid_rows:Math.max(0,rows.length-new Set(errors.map(e=>e.row)).size),errors}

  for(let i=0;i<rows.length;i++){
    try{
      const row=rows[i]
      if(entity==='opening_stock'){
        const [product,location]=await Promise.all([findProduct(adminClient,organizationId,row),findLocation(adminClient,organizationId,row)])
        if(!product.track_inventory)throw new Error('Product does not track inventory')
        if(!location)throw new Error('Location not found')
      }else if(['products','customers','suppliers'].includes(entity)){
        const def=IMPORT_DEFS[entity]
        let existing=null
        for(const key of def.match){
          const value=key==='email'?normalizeEmail(row[key]):clean(row[key],250)
          if(!value)continue
          const {data,error}=await adminClient.from(entity).select('id').eq('organization_id',organizationId).eq(key,value).limit(1)
          if(error)throw error
          if((data||[]).length){existing=data[0];break}
        }
        if(existing&&strategy==='append')throw new Error('Matching record already exists. Use Update or Skip strategy.')
      }else if(entity==='customer_balances')await findParty(adminClient,organizationId,'customer',row)
      else if(entity==='supplier_balances')await findParty(adminClient,organizationId,'supplier',row)
      else if(entity==='staff'){
        const role=clean(row.role,80).toLowerCase()
        const {data:roleRows,error:roleError}=await adminClient.from('roles').select('key').eq('organization_id',organizationId).eq('key',role).eq('active',true).limit(1)
        if(roleError)throw roleError
        if(!(roleRows||[]).length)throw new Error(`Role "${role}" does not exist or is inactive`)
        if(clean(row.location_code)||clean(row.location_name))await findLocation(adminClient,organizationId,row)
        const email=normalizeEmail(row.email)
        const {data:existing,error:existingError}=await adminClient.from('users').select('id').eq('organization_id',organizationId).ilike('email',email).limit(1)
        if(existingError)throw existingError
        if((existing||[]).length)throw new Error('A staff account with this email already exists')
      }
    }catch(error){errors.push({row:i+1,error:error.message})}
  }
  return {valid_rows:Math.max(0,rows.length-new Set(errors.map(e=>e.row)).size),errors}
}

async function createJob(adminClient,{organizationId,caller,entity,fileName,strategy,totalRows}){
  const {data,error}=await adminClient.from('data_migration_jobs').insert({
    organization_id:organizationId,entity_type:entity,file_name:fileName||null,strategy,status:'running',total_rows:totalRows,created_by:caller.id,
  }).select('id').single()
  if(error)throw error
  return data.id
}

async function finishJob(adminClient,organizationId,id,result){
  await adminClient.from('data_migration_jobs').update({
    status:result.failed_rows>0?'completed_with_errors':'completed',
    valid_rows:result.valid_rows,inserted_rows:result.inserted_rows,updated_rows:result.updated_rows,
    skipped_rows:result.skipped_rows,failed_rows:result.failed_rows,errors:result.errors,
    metadata:result.metadata||{},completed_at:new Date().toISOString(),
  }).eq('organization_id',organizationId).eq('id',id)
}

async function importMasterRows(adminClient,organizationId,entity,rows,strategy){
  const table=entity
  const def=IMPORT_DEFS[entity]
  let inserted=0,updated=0,skipped=0,failed=0
  const errors=[]
  for(let i=0;i<rows.length;i++){
    const row=rows[i]
    try{
      let payload
      if(entity==='products'){
        payload={
          name:clean(row.name,250),sku:clean(row.sku,160)||null,barcode:clean(row.barcode,160)||null,
          item_type:clean(row.item_type,40)||'product',unit:clean(row.unit,40)||'pieces',
          track_inventory:asBoolean(row.track_inventory,true),cost_price:asNumber(row.cost_price,'cost_price',{min:0}),
          selling_price:asNumber(row.selling_price,'selling_price',{min:0}),
          wholesale_price:row.wholesale_price===undefined||String(row.wholesale_price).trim()===''?null:asNumber(row.wholesale_price,'wholesale_price',{min:0}),
          tax_rate:asNumber(row.tax_rate,'tax_rate',{min:0}),reorder_level:asNumber(row.reorder_level,'reorder_level',{min:0}),active:asBoolean(row.active,true),
        }
      }else if(entity==='customers'){
        payload={name:clean(row.name,250),phone:clean(row.phone,80)||null,email:normalizeEmail(row.email)||null,address:clean(row.address,500)||null,customer_group:clean(row.customer_group,120)||null,credit_limit:asNumber(row.credit_limit,'credit_limit',{min:0}),active:asBoolean(row.active,true),notes:clean(row.notes,1000)||null}
      }else{
        payload={name:clean(row.name,250),phone:clean(row.phone,80)||null,email:normalizeEmail(row.email)||null,address:clean(row.address,500)||null,active:asBoolean(row.active,true),notes:clean(row.notes,1000)||null}
      }

      let existing=null
      if(strategy!=='append'){
        for(const key of def.match){
          const value=payload[key]
          if(value===null||value===undefined||String(value).trim()==='')continue
          const {data,error}=await adminClient.from(table).select('id').eq('organization_id',organizationId).eq(key,value).limit(1)
          if(error)throw error
          if((data||[]).length){existing=data[0];break}
        }
      }
      if(existing&&strategy==='skip'){skipped++;continue}
      if(existing){
        const {error}=await adminClient.from(table).update({...payload,updated_at:new Date().toISOString()}).eq('organization_id',organizationId).eq('id',existing.id)
        if(error)throw error
        updated++
      }else{
        const {error}=await adminClient.from(table).insert({...payload,organization_id:organizationId})
        if(error)throw error
        inserted++
      }
    }catch(error){failed++;if(errors.length<100)errors.push({row:i+1,error:error.message})}
  }
  return {inserted,updated,skipped,failed,errors}
}

export async function GET(req){
  const check=await verifyOrganizationPermission(req,'migration.view','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const url=new URL(req.url)
  const mode=url.searchParams.get('mode')||'history'
  try{
    if(mode==='template'){
      const entity=url.searchParams.get('entity')||''
      const def=IMPORT_DEFS[entity]
      if(!def)return NextResponse.json({error:'Unsupported migration template.'},{status:400})
      const csv=makeCsv(def.columns,def.template)
      return new NextResponse(csv,{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="mgt-template-${entity}.csv"`,'cache-control':'no-store'}})
    }
    if(mode==='export'){
      const entity=url.searchParams.get('entity')||''
      const format=(url.searchParams.get('format')||'csv').toLowerCase()
      const def=EXPORT_DEFS[entity]
      if(!def)return NextResponse.json({error:'Unsupported export entity.'},{status:400})
      let query=check.adminClient.from(def.table).select(def.columns.join(','))
      if(def.table==='users')query=query.eq('organization_id',check.organizationId).is('archived_at',null)
      else query=query.eq('organization_id',check.organizationId)
      const {data,error}=await query.limit(10000)
      if(error)throw error
      const rows=data||[]
      if(format==='json')return new NextResponse(JSON.stringify(rows,null,2),{headers:{'content-type':'application/json; charset=utf-8','content-disposition':`attachment; filename="mgt-${entity}.json"`,'cache-control':'no-store'}})
      return new NextResponse(makeCsv(def.columns,rows),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="mgt-${entity}.csv"`,'cache-control':'no-store'}})
    }

    const [jobsRes,locationsRes,rolesRes]=await Promise.all([
      check.adminClient.from('data_migration_jobs').select('id,entity_type,file_name,strategy,status,total_rows,valid_rows,inserted_rows,updated_rows,skipped_rows,failed_rows,errors,metadata,created_by,created_at,completed_at').eq('organization_id',check.organizationId).order('created_at',{ascending:false}).limit(100),
      check.adminClient.from('locations').select('id,name,code,type,active').eq('organization_id',check.organizationId).eq('active',true).order('name'),
      check.adminClient.from('roles').select('key,name,active').eq('organization_id',check.organizationId).eq('active',true).order('name'),
    ])
    for(const r of [jobsRes,locationsRes,rolesRes])if(r.error)throw r.error
    return NextResponse.json({
      ok:true,jobs:jobsRes.data||[],locations:locationsRes.data||[],roles:rolesRes.data||[],
      import_entities:Object.entries(IMPORT_DEFS).map(([key,value])=>({key,title:value.title,columns:value.columns,required:value.required})),
      export_entities:Object.keys(EXPORT_DEFS),
    })
  }catch(error){return NextResponse.json({error:error.message},{status:400})}
}

export async function POST(req){
  const check=await verifyOrganizationPermission(req,'migration.manage','integrations')
  if(check.error)return NextResponse.json({error:check.error},{status:check.status})
  const {adminClient,organizationId,caller}=check
  let jobId=null
  let jobEntity='migration'
  try{
    const body=await req.json()
    const entity=String(body.entity||'')
    jobEntity=entity||'migration'
    const def=IMPORT_DEFS[entity]
    if(!def)return NextResponse.json({error:'Unsupported migration entity.'},{status:400})
    const rows=Array.isArray(body.rows)?body.rows:[]
    if(!rows.length)return NextResponse.json({error:'No rows supplied.'},{status:400})

    if(entity==='staff'&&!['owner','super_admin','system_admin'].includes(caller.role)){
      const ownerRow=rows.findIndex(row=>clean(row.role,80).toLowerCase()==='owner')
      if(ownerRow>=0)return NextResponse.json({error:`Row ${ownerRow+1}: only an Owner can import another Owner account.`},{status:403})
    }

    const openingType=['opening_stock','customer_balances','supplier_balances'].includes(entity)
    const allowedStrategies=openingType?['add','replace']:['append','update','skip']
    const strategy=allowedStrategies.includes(body.strategy)?body.strategy:allowedStrategies[0]
    const validation=await validateRows(adminClient,organizationId,entity,rows,strategy)

    if(body.dry_run){
      return NextResponse.json({
        ok:validation.errors.length===0,dry_run:true,total_rows:rows.length,
        valid_rows:validation.valid_rows,failed_rows:rows.length-validation.valid_rows,errors:validation.errors.slice(0,100)
      })
    }

    if(validation.errors.length){
      return NextResponse.json({
        error:'Validation failed. Fix the rows before importing.',total_rows:rows.length,
        valid_rows:validation.valid_rows,failed_rows:rows.length-validation.valid_rows,errors:validation.errors.slice(0,100)
      },{status:400})
    }

    jobId=await createJob(adminClient,{
      organizationId,caller,entity,fileName:clean(body.file_name,250),strategy,totalRows:rows.length
    })

    let inserted=0,updated=0,skipped=0,failed=0,errors=[]
    const metadata={}

    if(['products','customers','suppliers'].includes(entity)){
      const result=await importMasterRows(adminClient,organizationId,entity,rows,strategy)
      inserted=result.inserted;updated=result.updated;skipped=result.skipped;failed=result.failed;errors=result.errors
    }else if(entity==='opening_stock'){
      for(let i=0;i<rows.length;i++){
        try{
          const [product,location]=await Promise.all([
            findProduct(adminClient,organizationId,rows[i]),
            findLocation(adminClient,organizationId,rows[i])
          ])
          const {error}=await adminClient.rpc('server_import_opening_stock',{
            p_organization_id:organizationId,p_actor_id:caller.id,p_product_id:product.id,p_location_id:location.id,
            p_quantity:asNumber(rows[i].quantity,'quantity',{min:0}),
            p_unit_cost:asNumber(rows[i].unit_cost,'unit_cost',{min:0}),
            p_strategy:strategy,p_notes:clean(rows[i].notes,1000)||null,p_migration_job_id:jobId,
          })
          if(error)throw error
          updated++
        }catch(error){
          failed++
          if(errors.length<100)errors.push({row:i+1,error:error.message})
        }
      }
    }else if(entity==='customer_balances'||entity==='supplier_balances'){
      const type=entity==='customer_balances'?'customer':'supplier'
      for(let i=0;i<rows.length;i++){
        try{
          const party=await findParty(adminClient,organizationId,type,rows[i])
          const rawDate=clean(rows[i].as_of_date,30)
          const asOf=rawDate||new Date().toISOString().slice(0,10)
          const {error}=await adminClient.rpc('server_set_opening_balance',{
            p_organization_id:organizationId,p_actor_id:caller.id,p_entity_type:type,p_entity_id:party.id,
            p_amount:asNumber(rows[i].opening_balance,'opening_balance',{min:0}),
            p_strategy:strategy,p_as_of_date:asOf,p_migration_job_id:jobId,
          })
          if(error)throw error
          updated++
        }catch(error){
          failed++
          if(errors.length<100)errors.push({row:i+1,error:error.message})
        }
      }
    }else if(entity==='staff'){
      const rate=await consumeServerRateLimit(adminClient,{
        scope:'migration_staff_invites',key:organizationId+'|'+caller.id,limit:100,windowSeconds:86400
      })
      if(!rate.allowed)throw new Error('Bulk staff invitation limit reached. Try again later.')

      const baseUrl=process.env.NEXT_PUBLIC_APP_URL||new URL(req.url).origin
      for(let i=0;i<rows.length;i++){
        const row=rows[i]
        let invitedUserId=null
        try{
          const email=normalizeEmail(row.email)
          const fullName=clean(row.full_name,180)
          const role=clean(row.role,80).toLowerCase()
          const location=(clean(row.location_code)||clean(row.location_name))
            ?await findLocation(adminClient,organizationId,row):null

          const {data:inviteData,error:inviteError}=await adminClient.auth.admin.inviteUserByEmail(email,{
            redirectTo:`${baseUrl.replace(/\/$/,'')}/accept-invite`,
            data:{
              full_name:fullName,organization_id:organizationId,default_location_id:location?.id||null,
              role,mgt_invited:true,mgt_migration:true,
            },
          })
          if(inviteError)throw inviteError
          invitedUserId=inviteData?.user?.id||null
          if(!invitedUserId)throw new Error('Supabase did not return an invited account')

          const {error:profileError}=await adminClient.from('users').upsert({
            id:invitedUserId,organization_id:organizationId,default_location_id:location?.id||null,
            full_name:fullName,email,role,active:true,archived_at:null,updated_at:new Date().toISOString(),
          },{onConflict:'id'})
          if(profileError)throw profileError

          const {error:invitationError}=await adminClient.from('staff_invitations').insert({
            organization_id:organizationId,email,full_name:fullName,role,
            default_location_id:location?.id||null,auth_user_id:invitedUserId,invited_by:caller.id,status:'pending'
          })
          if(invitationError)throw invitationError
          inserted++
        }catch(error){
          failed++
          if(invitedUserId){
            try{await adminClient.auth.admin.updateUserById(invitedUserId,{ban_duration:'876000h'})}catch{}
          }
          if(errors.length<100)errors.push({row:i+1,error:error.message})
        }
      }
    }

    const result={
      valid_rows:rows.length,inserted_rows:inserted,updated_rows:updated,skipped_rows:skipped,
      failed_rows:failed,errors,metadata
    }
    await finishJob(adminClient,organizationId,jobId,result)

    await adminClient.from('audit_log').insert({
      organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,
      action:'data_migration_completed',entity_type:entity,entity_id:jobId,
      summary:`Migration ${entity}: ${inserted} inserted, ${updated} updated, ${skipped} skipped, ${failed} failed`,
      metadata:{strategy,total_rows:rows.length,inserted,updated,skipped,failed,file_name:clean(body.file_name,250)||null},
    })

    return NextResponse.json({
      ok:failed===0,job_id:jobId,total_rows:rows.length,inserted,updated,skipped,failed,errors
    })
  }catch(error){
    if(jobId){
      try{
        await adminClient.from('data_migration_jobs').update({
          status:'failed',failed_rows:1,errors:[{row:0,error:String(error.message||'Migration failed').slice(0,500)}],
          completed_at:new Date().toISOString()
        }).eq('organization_id',organizationId).eq('id',jobId)

        await adminClient.from('audit_log').insert({
          organization_id:organizationId,location_id:caller.default_location_id,user_id:caller.id,
          action:'data_migration_failed',entity_type:jobEntity,entity_id:jobId,
          summary:`Migration failed: ${jobEntity}`,metadata:{error:String(error.message||'Migration failed').slice(0,500)}
        })
      }catch{}
    }
    return NextResponse.json({error:error.message||'Migration failed.'},{status:400})
  }
}
