import { NextResponse } from 'next/server'
import { getServerClients } from '../../../../lib/serverAccess'

async function verifySystemAdmin(req) {
  let clients
  try {
    clients = getServerClients()
  } catch (error) {
    return { error: error.message, status: 500 }
  }

  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  if (!token) return { error: 'No session token sent.', status: 401 }

  const { data: authData, error: authError } = await clients.authClient.auth.getUser(token)
  if (authError || !authData?.user) return { error: 'Session expired — sign in again.', status: 401 }

  const { data: caller, error: callerError } = await clients.adminClient
    .from('users')
    .select('id, role, active, archived_at')
    .eq('id', authData.user.id)
    .maybeSingle()

  if (callerError) return { error: callerError.message, status: 500 }
  if (!caller || caller.active === false || caller.archived_at) return { error: 'This account is not active.', status: 403 }
  if (!['super_admin', 'system_admin'].includes(caller.role)) return { error: 'System Administrator only.', status: 403 }

  return { ...clients, caller }
}

const safeRows = async (promise) => {
  try {
    const result = await promise
    return { data: result.data || [], error: result.error?.message || null }
  } catch (error) {
    return { data: [], error: error?.message || 'Query failed' }
  }
}

export async function GET(req) {
  const check = await verifySystemAdmin(req)
  if (check.error) return NextResponse.json({ error: check.error }, { status: check.status || 403 })

  const { adminClient } = check
  const now = new Date()
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()

  const [
    usersR,
    organizationsR,
    salesR,
    expensesR,
    bankingsR,
    productionR,
    stocktakesR,
    balancesR,
    saleItemsR,
    productsR,
    auditR,
    authR,
  ] = await Promise.all([
    safeRows(adminClient.from('users').select('id,organization_id,default_location_id,full_name,email,role,active,archived_at,created_at')),
    safeRows(adminClient.from('organizations').select('id,name,short_name,active,created_at')),
    safeRows(adminClient.from('sales').select('id,organization_id,location_id,sale_number,total_amount,status,payment_status,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.from('expenses').select('id,organization_id,location_id,amount,category,description,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.from('banking_transactions').select('id,organization_id,location_id,transaction_type,amount,status,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.from('production_orders').select('id,organization_id,location_id,production_number,status,planned_quantity,actual_quantity,output_variance,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.from('stocktakes').select('id,organization_id,location_id,stocktake_number,status,total_variance_units,total_variance_value,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity')),
    safeRows(adminClient.from('sale_items').select('id,sale_id,product_id').limit(5000)),
    safeRows(adminClient.from('products').select('id,organization_id,name,active').limit(5000)),
    safeRows(adminClient.from('audit_log').select('id,organization_id,location_id,user_id,action,entity_type,entity_id,summary,created_at').order('created_at',{ascending:false}).limit(1000)),
    safeRows(adminClient.auth.admin.listUsers({ page: 1, perPage: 1000 })),
  ])

  const orgMap = Object.fromEntries(organizationsR.data.map((row) => [row.id, row]))
  const productIds = new Set(productsR.data.map((row) => row.id))
  const authUsers = authR.data?.users || authR.data || []
  const authMap = Object.fromEntries(authUsers.map((user) => [user.id, user]))

  const users = usersR.data.map((user) => ({
    ...user,
    organization_name: orgMap[user.organization_id]?.name || null,
    email: user.email || authMap[user.id]?.email || null,
    last_sign_in_at: authMap[user.id]?.last_sign_in_at || null,
    auth_created_at: authMap[user.id]?.created_at || null,
  }))

  const todayAudit = auditR.data.filter((row) => row.created_at >= dayStart)
  const pendingBankings = bankingsR.data.filter((row) => row.status === 'pending')
  const productionFlags = productionR.data.filter((row) =>
    row.status === 'completed' && Math.abs(Number(row.output_variance || 0)) > 0.000001
  )
  const stockFlags = stocktakesR.data.filter((row) => Math.abs(Number(row.total_variance_units || 0)) > 0.000001)
  const negativeStock = balancesR.data.filter((row) => Number(row.quantity || 0) < 0)
  const orphanSaleItems = saleItemsR.data.filter((row) => row.product_id && !productIds.has(row.product_id))

  const recentActivity = todayAudit.slice(0, 40).map((row) => ({
    type: row.entity_type || 'audit',
    time: row.created_at,
    text: row.summary || String(row.action || 'Business activity').replaceAll('_', ' '),
  }))

  const queryErrors = [
    usersR, organizationsR, salesR, expensesR, bankingsR, productionR,
    stocktakesR, balancesR, saleItemsR, productsR, auditR, authR,
  ].map((row) => row.error).filter(Boolean)

  return NextResponse.json({
    ok: true,
    generated_at: new Date().toISOString(),
    users,
    organizations: organizationsR.data,
    summary: {
      active_users: users.filter((row) => row.active !== false && !row.archived_at).length,
      disabled_users: users.filter((row) => row.active === false || row.archived_at).length,
      active_organizations: organizationsR.data.filter((row) => row.active !== false).length,
      actions_today: todayAudit.length,
      pending_bankings: pendingBankings.length,
      production_flags: productionFlags.length,
      stock_flags: stockFlags.length,
      negative_stock: negativeStock.length,
      orphan_sales: orphanSaleItems.length,
      query_errors: queryErrors.length,
    },
    integrity: {
      negative_stock: negativeStock.length,
      orphan_sales: orphanSaleItems.length,
      pending_bankings: pendingBankings.length,
      production_flags: productionFlags.length,
      stocktake_differences: stockFlags.length,
      query_errors: queryErrors,
    },
    recent_activity: recentActivity,
  })
}
