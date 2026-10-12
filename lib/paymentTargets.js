import { openingBalanceDue } from './balances.js'

export async function resolveTarget(adminClient,organizationId,targetType,targetId,customerId,amount){
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
    const {data:customer,error}=await adminClient.from('customers').select('id,name,opening_balance,opening_balance_paid').eq('organization_id',organizationId).eq('id',customerId||targetId).eq('active',true).maybeSingle()
    if(error)throw error;if(!customer)throw new Error('Customer not found.')
    const {data:balance,error:balanceError}=await adminClient.rpc('server_customer_sales_balance',{p_organization_id:organizationId,p_customer_id:customer.id})
    if(balanceError)throw balanceError
    const due=Number(balance ?? openingBalanceDue(customer))
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
    if(!['issued','partial'].includes(data.status))throw new Error('Only open project invoices can receive payments.')
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
    if(customerId){
      const {data,error}=await adminClient.from('customers').select('id').eq('organization_id',organizationId).eq('id',customerId).maybeSingle()
      if(error)throw error
      if(!data)throw new Error('Customer not found in this business.')
    }
    return {target:null,locationId:null,customerId:customerId||null,balance:numeric,label:'Unallocated payment'}
  }

  throw new Error('Unsupported payment target.')
}
