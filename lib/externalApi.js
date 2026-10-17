export const EXTERNAL_RESOURCES = {
  products: { table: 'products', scope: 'catalog.read', modules: ['inventory','services'], select: 'id,name,sku,barcode,item_type,unit,track_inventory,cost_price,selling_price,wholesale_price,tax_rate,reorder_level,active,updated_at' },
  customers: { table: 'customers', scope: 'customers.read', modules: ['customers'], select: 'id,name,phone,email,address,customer_group,credit_limit,active,updated_at' },
  suppliers: { table: 'suppliers', scope: 'suppliers.read', modules: ['suppliers'], select: 'id,name,phone,email,address,active,updated_at' },
  sales: { table: 'sales', scope: 'sales.read', modules: ['sales','pos'], select: 'id,location_id,customer_id,sale_number,channel,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,created_at,updated_at' },
  stock: { table: 'stock_balances', scope: 'inventory.read', modules: ['inventory'], select: 'product_id,location_id,quantity,reserved_quantity,updated_at,products!inner(organization_id)' },
  work_orders: { table: 'work_orders', scope: 'services.read', modules: ['services'], select: 'id,job_number,location_id,customer_id,title,status,priority,quoted_amount,final_amount,amount_paid,payment_status,due_at,scheduled_at,completed_at,updated_at' },
  projects: { table: 'projects', scope: 'projects.read', modules: ['projects'], select: 'id,project_number,location_id,customer_id,name,status,priority,start_date,due_date,progress_percent,contract_value,budget_cost,created_at,updated_at' },
  deliveries: { table: 'deliveries', scope: 'fleet.read', modules: ['fleet'], select: 'id,delivery_number,source_location_id,customer_id,sale_id,work_order_id,vehicle_id,driver_user_id,status,destination,scheduled_at,dispatched_at,delivered_at,updated_at' },
  online_orders: { table: 'online_orders', scope: 'ecommerce.read', modules: ['ecommerce'], select: 'id,storefront_id,location_id,customer_id,order_number,status,payment_status,payment_method,customer_name,customer_phone,fulfillment_method,subtotal,tax_amount,delivery_fee,total_amount,sale_id,delivery_id,created_at,updated_at' },
}

export function parsePage(searchParams) {
  const integer = (key, fallback, min, max) => {
    const raw = searchParams.get(key)
    const value = raw === null ? fallback : Number(raw)
    if (raw === '' || !Number.isSafeInteger(value) || value < min || value > max) {
      throw new Error(`${key} must be an integer between ${min} and ${max}.`)
    }
    return value
  }
  const limit = integer('limit', 100, 1, 500)
  const offset = integer('offset', 0, 0, Number.MAX_SAFE_INTEGER - 500)
  const rawDate = searchParams.get('updated_after')
  let updatedAfter = null
  if (rawDate !== null) {
    const date = new Date(rawDate)
    if (Number.isNaN(date.getTime())) throw new Error('updated_after must be a valid date.')
    updatedAfter = date.toISOString()
  }
  return { limit, offset, updatedAfter }
}

export function externalResourceQuery(client, resource, organizationId, { limit, offset, updatedAfter }) {
  const def = EXTERNAL_RESOURCES[resource]
  let query = client.from(def.table).select(def.select)
    .eq(resource === 'stock' ? 'products.organization_id' : 'organization_id', organizationId)
  query = resource === 'stock'
    ? query.order('product_id').order('location_id')
    : query.order('id')
  if (updatedAfter) query = query.gt('updated_at', updatedAfter)
  return query.range(offset, offset + limit - 1)
}

export async function readAllPages(makeQuery, pageSize = 500) {
  const rows = []
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await makeQuery().range(offset, offset + pageSize - 1)
    if (error) throw error
    rows.push(...(data || []))
    if (!data || data.length < pageSize) return rows
  }
}

export const csvCell=(value)=>{
  if(value===null||value===undefined)return ''
  const raw=String(value)
  const text=typeof value==='string'&&/^[=+@\-\t\r]/.test(raw)?"'"+raw:raw
  return /[",\n\r]/.test(text)?`"${text.replaceAll('"','""')}"`:text
}

