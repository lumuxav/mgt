'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { returnsAsOf, refundedBySale } from '../../lib/salesReporting'
import { getBusinessConfig } from '../../lib/platformConfig'
import { Bars, ProgressBar } from '../components/ReportCharts'

const money=(value,currency)=>`${Number(value||0).toLocaleString(undefined,{maximumFractionDigits:0})} ${currency||'UGX'}`
const pct=value=>`${Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1})}%`
const dayKey=value=>new Date(value).toISOString().slice(0,10)
const dateAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)}
const today=()=>new Date().toISOString().slice(0,10)
const inRange=(value,start,end)=>{if(!value)return false;const d=dayKey(value);return d>=start&&d<=end}
const num=value=>Number(value||0)

export default function ReportsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [tab,setTab]=useState('sales')
  const [startDate,setStartDate]=useState(dateAgo(29))
  const [endDate,setEndDate]=useState(today())
  const [locationFilter,setLocationFilter]=useState('')
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  const [locations,setLocations]=useState([])
  const [users,setUsers]=useState([])
  const [customers,setCustomers]=useState([])
  const [suppliers,setSuppliers]=useState([])
  const [products,setProducts]=useState([])
  const [sales,setSales]=useState([])
  const [saleItems,setSaleItems]=useState([])
  const [returns,setReturns]=useState([])
  const [returnItems,setReturnItems]=useState([])
  const [expenses,setExpenses]=useState([])
  const [payments,setPayments]=useState([])
  const [purchases,setPurchases]=useState([])
  const [balances,setBalances]=useState([])
  const [stockMovements,setStockMovements]=useState([])
  const [workOrders,setWorkOrders]=useState([])
  const [assignments,setAssignments]=useState([])
  const [productionOrders,setProductionOrders]=useState([])
  const [payrollEntries,setPayrollEntries]=useState([])
  const [assets,setAssets]=useState([])
  const [maintenance,setMaintenance]=useState([])
  const [vehicles,setVehicles]=useState([])
  const [fuelLogs,setFuelLogs]=useState([])
  const [deliveries,setDeliveries]=useState([])
  const [projects,setProjects]=useState([])
  const [projectInvoices,setProjectInvoices]=useState([])
  const [projectMaterials,setProjectMaterials]=useState([])
  const [projectTimesheets,setProjectTimesheets]=useState([])
  const [projectExpenses,setProjectExpenses]=useState([])

  const currency=context?.organization?.currency||business.currency||'UGX'

  useEffect(()=>{
    ;(async()=>{
      try{
        const ctx=await getPlatformContext()
        setContext(ctx)
        if(!ctx.organization?.id)throw new Error('Complete business setup first.')
        const org=ctx.organization.id
        const [
          locationRes,userRes,customerRes,supplierRes,productRes,salesRes,itemRes,returnRes,returnItemRes,expenseRes,paymentRes,purchaseRes,
          balanceRes,movementRes,jobRes,assignmentRes,productionRes,payrollRes,assetRes,maintenanceRes,vehicleRes,fuelRes,deliveryRes,
          projectRes,invoiceRes,materialRes,timesheetRes,projectExpenseRes
        ]=await Promise.all([
          supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
          supabase.from('users').select('id,full_name,role,default_location_id,active').eq('organization_id',org).eq('active',true),
          supabase.rpc('get_scoped_customers').select('id,name,customer_group,credit_limit,opening_balance,opening_balance_paid').eq('organization_id',org).eq('active',true),
          supabase.rpc('get_scoped_suppliers').select('id,name,opening_balance,opening_balance_paid').eq('organization_id',org).eq('active',true),
          supabase.from('products').select('id,name,sku,cost_price,selling_price,reorder_level,track_inventory,active').eq('organization_id',org).eq('active',true),
          supabase.from('sales').select('id,sale_number,location_id,customer_id,sold_by,total_amount,amount_paid,refunded_amount,status,payment_status,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(8000),
          supabase.from('sale_items').select('id,sale_id,product_id,description,quantity,unit_price,unit_cost,discount_amount,tax_amount,line_total').limit(25000),
          supabase.from('sale_returns').select('id,sale_id,total_amount,created_at').eq('organization_id',org).limit(6000),
          supabase.from('sale_return_items').select('return_id,sale_item_id,product_id,quantity,unit_refund,line_total').limit(15000),
          supabase.from('expenses').select('id,location_id,category,description,amount,payment_method,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(7000),
          supabase.from('payments').select('id,location_id,direction,payment_type,method,amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(12000),
          supabase.from('purchases').select('id,location_id,supplier_id,purchase_number,total_amount,amount_paid,status,payment_status,created_at,received_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,updated_at,products(organization_id)').limit(15000),
          supabase.from('stock_movements').select('id,location_id,product_id,movement_type,quantity,unit_cost,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(25000),
          supabase.from('work_orders').select('id,job_number,title,location_id,customer_id,status,final_amount,amount_paid,final_cost,gross_profit,completed_at,due_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('work_order_assignments').select('work_order_id,user_id,assigned_at').limit(12000),
          supabase.from('production_orders').select('id,production_number,location_id,planned_quantity,actual_quantity,waste_quantity,status,total_material_cost,unit_cost,output_variance,completed_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('payroll_entries').select('id,user_id,location_id,gross_pay,net_pay,deductions,commissions,attendance_days,attendance_hours,payment_status,paid_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(9000),
          supabase.from('assets').select('id,location_id,asset_number,name,category,status,purchase_cost,purchase_date,active').eq('organization_id',org).eq('active',true),
          supabase.from('asset_maintenance').select('id,asset_id,location_id,maintenance_number,status,cost,downtime_hours,completed_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(7000),
          supabase.from('vehicles').select('id,location_id,registration_number,make,model,odometer,status,active').eq('organization_id',org).eq('active',true),
          supabase.from('fuel_logs').select('id,vehicle_id,location_id,log_date,odometer,quantity,total_cost').eq('organization_id',org).order('log_date',{ascending:false}).limit(9000),
          supabase.from('deliveries').select('id,source_location_id,vehicle_id,driver_user_id,status,scheduled_at,dispatched_at,delivered_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(7000),
          supabase.from('projects').select('id,project_number,name,location_id,customer_id,manager_user_id,status,contract_value,budget_cost,total_cost,billed_amount,amount_paid,gross_profit,progress_percent,start_date,due_date,completed_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(4000),
          supabase.from('project_invoices').select('id,project_id,location_id,customer_id,invoice_number,total_amount,amount_paid,status,issue_date,due_date').eq('organization_id',org).limit(7000),
          supabase.from('project_materials').select('id,project_id,location_id,product_id,description,quantity,unit_cost,cost_total,status,issued_at').eq('organization_id',org).limit(12000),
          supabase.from('project_timesheets').select('id,project_id,user_id,work_date,hours,cost_amount,billable_amount,status').eq('organization_id',org).limit(14000),
          supabase.from('project_expenses').select('id,project_id,location_id,expense_date,category,amount,status').eq('organization_id',org).limit(10000),
        ])
        const all=[locationRes,userRes,customerRes,supplierRes,productRes,salesRes,itemRes,returnRes,returnItemRes,expenseRes,paymentRes,purchaseRes,balanceRes,movementRes,jobRes,assignmentRes,productionRes,payrollRes,assetRes,maintenanceRes,vehicleRes,fuelRes,deliveryRes,projectRes,invoiceRes,materialRes,timesheetRes,projectExpenseRes]
        const fatal=all.find(r=>r.error)
        if(fatal?.error)throw fatal.error

        const saleIds=new Set((salesRes.data||[]).map(x=>x.id))
        const returnIds=new Set((returnRes.data||[]).map(x=>x.id))
        const jobIds=new Set((jobRes.data||[]).map(x=>x.id))
        setLocations(locationRes.data||[]);setUsers(userRes.data||[]);setCustomers(customerRes.data||[]);setSuppliers(supplierRes.data||[]);setProducts(productRes.data||[])
        setSales(salesRes.data||[]);setSaleItems((itemRes.data||[]).filter(x=>saleIds.has(x.sale_id)));setReturns(returnRes.data||[]);setReturnItems((returnItemRes.data||[]).filter(x=>returnIds.has(x.return_id)))
        setExpenses(expenseRes.data||[]);setPayments(paymentRes.data||[]);setPurchases(purchaseRes.data||[]);setBalances((balanceRes.data||[]).filter(x=>x.products?.organization_id===org));setStockMovements(movementRes.data||[])
        setWorkOrders(jobRes.data||[]);setAssignments((assignmentRes.data||[]).filter(x=>jobIds.has(x.work_order_id)));setProductionOrders(productionRes.data||[]);setPayrollEntries(payrollRes.data||[])
        setAssets(assetRes.data||[]);setMaintenance(maintenanceRes.data||[]);setVehicles(vehicleRes.data||[]);setFuelLogs(fuelRes.data||[]);setDeliveries(deliveryRes.data||[])
        setProjects(projectRes.data||[]);setProjectInvoices(invoiceRes.data||[]);setProjectMaterials(materialRes.data||[]);setProjectTimesheets(timesheetRes.data||[]);setProjectExpenses(projectExpenseRes.data||[])
      }catch(error){setMessage(error.message||'Could not load reports.')}
      finally{setLoading(false)}
    })()
  },[])

  const names=useMemo(()=>({
    locations:Object.fromEntries(locations.map(x=>[x.id,x.name])),
    users:Object.fromEntries(users.map(x=>[x.id,x.full_name])),
    customers:Object.fromEntries(customers.map(x=>[x.id,x.name])),
    suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x.name])),
    products:Object.fromEntries(products.map(x=>[x.id,x.name])),
    assets:Object.fromEntries(assets.map(x=>[x.id,x.name])),
    vehicles:Object.fromEntries(vehicles.map(x=>[x.id,`${x.registration_number} · ${x.make||''} ${x.model||''}`.trim()])),
  }),[locations,users,customers,suppliers,products,assets,vehicles])

  const report=useMemo(()=>{
    const locationOk=id=>!locationFilter||id===locationFilter
    const rangeSales=sales.filter(x=>inRange(x.created_at,startDate,endDate)&&locationOk(x.location_id))
    const saleIds=new Set(rangeSales.map(x=>x.id))
    const rangeItems=saleItems.filter(x=>saleIds.has(x.sale_id))
    const eligibleReturns=returnsAsOf(returns,endDate)
    const eligibleReturnIds=new Set(eligibleReturns.map(row=>row.id))
    const refunds=refundedBySale(eligibleReturns)
    const returned={}
    for(const item of returnItems.filter(row=>eligibleReturnIds.has(row.return_id)))returned[item.sale_item_id]=(returned[item.sale_item_id]||0)+num(item.quantity)
    const saleCost={}
    const saleRevenue={}
    for(const sale of rangeSales)saleRevenue[sale.id]=Math.max(0,num(sale.total_amount)-num(refunds[sale.id]))
    for(const item of rangeItems){
      const sold=num(item.quantity),back=Math.min(sold,num(returned[item.id])),net=Math.max(0,sold-back)
      saleCost[item.sale_id]=(saleCost[item.sale_id]||0)+net*num(item.unit_cost)
    }

    const productMap={}
    const itemTotals={}
    for(const item of rangeItems)itemTotals[item.sale_id]=(itemTotals[item.sale_id]||0)+num(item.line_total)
    const saleTotals=Object.fromEntries(rangeSales.map(sale=>[sale.id,num(sale.total_amount)]))
    for(const item of rangeItems){
      const sold=num(item.quantity),back=Math.min(sold,num(returned[item.id])),qty=Math.max(0,sold-back),ratio=sold>0?qty/sold:0
      const key=item.product_id||item.description
      if(!productMap[key])productMap[key]={id:key,label:names.products[item.product_id]||item.description,qty:0,revenue:0,gross:0}
      const revenue=num(item.line_total)*ratio*(itemTotals[item.sale_id]>0?saleTotals[item.sale_id]/itemTotals[item.sale_id]:0)
      productMap[key].qty+=qty;productMap[key].revenue+=revenue;productMap[key].gross+=revenue-qty*num(item.unit_cost)
    }
    const productsReport=Object.values(productMap).sort((a,b)=>b.revenue-a.revenue)

    const branchMap={}
    for(const loc of locations)branchMap[loc.id]={id:loc.id,label:loc.name,revenue:0,gross:0,transactions:0,expenses:0,collections:0}
    for(const sale of rangeSales){
      const row=branchMap[sale.location_id]||{id:sale.location_id,label:names.locations[sale.location_id]||'Location',revenue:0,gross:0,transactions:0,expenses:0,collections:0}
      row.revenue+=saleRevenue[sale.id]||0;row.gross+=(saleRevenue[sale.id]||0)-num(saleCost[sale.id]);row.transactions++;branchMap[sale.location_id]=row
    }
    for(const x of expenses.filter(x=>inRange(x.created_at,startDate,endDate)))if(branchMap[x.location_id])branchMap[x.location_id].expenses+=num(x.amount)
    for(const x of payments.filter(x=>x.direction==='in'&&inRange(x.created_at,startDate,endDate)))if(branchMap[x.location_id])branchMap[x.location_id].collections+=num(x.amount)
    const branches=Object.values(branchMap).filter(x=>x.revenue||x.expenses||x.collections).sort((a,b)=>b.revenue-a.revenue)

    const staffMap={}
    const ensureStaff=id=>{
      const key=id||'unassigned'
      if(!staffMap[key])staffMap[key]={id:key,label:names.users[id]||'Unassigned',salesRevenue:0,salesGross:0,sales:0,serviceRevenue:0,serviceGross:0,jobs:0,projectHours:0,projectCost:0}
      return staffMap[key]
    }
    for(const sale of rangeSales){const row=ensureStaff(sale.sold_by);row.salesRevenue+=saleRevenue[sale.id]||0;row.salesGross+=(saleRevenue[sale.id]||0)-num(saleCost[sale.id]);row.sales++}
    const rangeJobs=workOrders.filter(x=>x.status==='completed'&&x.completed_at&&inRange(x.completed_at,startDate,endDate)&&locationOk(x.location_id))
    const assignmentsByJob={}
    for(const a of assignments){if(!assignmentsByJob[a.work_order_id])assignmentsByJob[a.work_order_id]=[];assignmentsByJob[a.work_order_id].push(a.user_id)}
    for(const job of rangeJobs){
      const people=assignmentsByJob[job.id]?.length?assignmentsByJob[job.id]:[null]
      for(const id of people){const row=ensureStaff(id);row.serviceRevenue+=num(job.final_amount)/people.length;row.serviceGross+=num(job.gross_profit)/people.length;row.jobs+=1/people.length}
    }
    for(const t of projectTimesheets.filter(x=>x.status==='approved'&&inRange(x.work_date,startDate,endDate))){
      const project=projects.find(p=>p.id===t.project_id);if(project&&!locationOk(project.location_id))continue
      const row=ensureStaff(t.user_id);row.projectHours+=num(t.hours);row.projectCost+=num(t.cost_amount)
    }
    const staff=Object.values(staffMap).map(x=>({...x,totalContribution:x.salesGross+x.serviceGross})).sort((a,b)=>b.totalContribution-a.totalContribution)

    const customerMap={}
    const ensureCustomer=id=>{const key=id||'walkin';if(!customerMap[key])customerMap[key]={id:key,label:names.customers[id]||'Walk-in / Unassigned',revenue:0,gross:0,sales:0,serviceRevenue:0,serviceGross:0,projectBillings:0,receivable:0};return customerMap[key]}
    if(!locationFilter)for(const c of customers)ensureCustomer(c.id).receivable+=Math.max(0,num(c.opening_balance)-num(c.opening_balance_paid))
    for(const sale of rangeSales){const row=ensureCustomer(sale.customer_id);row.revenue+=saleRevenue[sale.id]||0;row.gross+=(saleRevenue[sale.id]||0)-num(saleCost[sale.id]);row.sales++}
    for(const job of rangeJobs){const row=ensureCustomer(job.customer_id);row.serviceRevenue+=num(job.final_amount);row.serviceGross+=num(job.gross_profit)}
    for(const inv of projectInvoices.filter(x=>x.status!=='void'&&inRange(x.issue_date,startDate,endDate)&&locationOk(x.location_id))){const row=ensureCustomer(inv.customer_id);row.projectBillings+=num(inv.total_amount)}
    for(const sale of sales.filter(x=>locationOk(x.location_id))){const row=ensureCustomer(sale.customer_id);row.receivable+=Math.max(0,num(sale.total_amount)-num(sale.refunded_amount)-num(sale.amount_paid))}
    for(const job of workOrders.filter(x=>x.status!=='cancelled'&&locationOk(x.location_id))){const row=ensureCustomer(job.customer_id);row.receivable+=Math.max(0,num(job.final_amount)-num(job.amount_paid))}
    for(const inv of projectInvoices.filter(x=>x.status!=='void'&&locationOk(x.location_id))){const row=ensureCustomer(inv.customer_id);row.receivable+=Math.max(0,num(inv.total_amount)-num(inv.amount_paid))}
    const customerProfit=Object.values(customerMap).map(x=>({...x,totalRevenue:x.revenue+x.serviceRevenue+x.projectBillings,totalContribution:x.gross+x.serviceGross})).sort((a,b)=>b.totalContribution-a.totalContribution)

    const supplierMap={}
    for(const s of suppliers)supplierMap[s.id]={id:s.id,label:s.name,spend:0,orders:0,outstanding:Math.max(0,num(s.opening_balance)-num(s.opening_balance_paid))}
    for(const p of purchases.filter(x=>locationOk(x.location_id))){
      if(!supplierMap[p.supplier_id])supplierMap[p.supplier_id]={id:p.supplier_id,label:names.suppliers[p.supplier_id]||'Supplier',spend:0,orders:0,outstanding:0}
      const row=supplierMap[p.supplier_id]
      if(inRange(p.received_at||p.created_at,startDate,endDate)){row.spend+=num(p.total_amount);row.orders++}
      row.outstanding+=Math.max(0,num(p.total_amount)-num(p.amount_paid))
    }
    const supplierAnalysis=Object.values(supplierMap).filter(x=>x.spend||x.outstanding).sort((a,b)=>b.spend-a.spend)

    const qtyByProduct={}
    for(const b of balances.filter(x=>locationOk(x.location_id)))qtyByProduct[b.product_id]=(qtyByProduct[b.product_id]||0)+Math.max(0,num(b.quantity)-num(b.reserved_quantity))
    const lastMove={}
    for(const m of stockMovements.filter(x=>locationOk(x.location_id)))if(!lastMove[m.product_id])lastMove[m.product_id]=m.created_at
    const inventory=products.filter(p=>p.track_inventory).map(p=>{
      const qty=num(qtyByProduct[p.id]);const last=lastMove[p.id];const days=last?Math.max(0,Math.floor((Date.now()-new Date(last).getTime())/86400000)):9999
      return {id:p.id,label:p.name,sku:p.sku,qty,reorder:num(p.reorder_level),value:qty*num(p.cost_price),days,last}
    }).sort((a,b)=>b.value-a.value)
    const inventoryAge={'0–30':0,'31–60':0,'61–90':0,'90+':0,'No movement':0}
    for(const x of inventory.filter(x=>x.qty>0)){
      const key=!x.last?'No movement':x.days<=30?'0–30':x.days<=60?'31–60':x.days<=90?'61–90':'90+'
      inventoryAge[key]+=x.value
    }

    const service=rangeJobs.map(job=>({
      id:job.id,label:job.job_number||job.title,customer:names.customers[job.customer_id]||'Customer',
      revenue:num(job.final_amount),cost:num(job.final_cost),gross:num(job.gross_profit),
      margin:num(job.final_amount)>0?num(job.gross_profit)/num(job.final_amount)*100:0
    })).sort((a,b)=>b.gross-a.gross)

    const production=productionOrders.filter(x=>x.status==='completed'&&x.completed_at&&inRange(x.completed_at,startDate,endDate)&&locationOk(x.location_id)).map(x=>({
      id:x.id,label:x.production_number||'Production',planned:num(x.planned_quantity),actual:num(x.actual_quantity),waste:num(x.waste_quantity),
      materialCost:num(x.total_material_cost),yield:num(x.planned_quantity)>0?num(x.actual_quantity)/num(x.planned_quantity)*100:0,
      wasteRate:num(x.actual_quantity)+num(x.waste_quantity)>0?num(x.waste_quantity)/(num(x.actual_quantity)+num(x.waste_quantity))*100:0
    }))
    const productionSummary={
      planned:production.reduce((s,x)=>s+x.planned,0),actual:production.reduce((s,x)=>s+x.actual,0),waste:production.reduce((s,x)=>s+x.waste,0),
      materialCost:production.reduce((s,x)=>s+x.materialCost,0)
    }

    const payroll=payrollEntries.filter(x=>locationOk(x.location_id)&&(x.paid_at?inRange(x.paid_at,startDate,endDate):inRange(x.created_at,startDate,endDate)))
    const payrollByStaff={}
    for(const x of payroll){
      const key=x.user_id||'unknown';if(!payrollByStaff[key])payrollByStaff[key]={id:key,label:names.users[x.user_id]||'Employee',gross:0,net:0,deductions:0,commissions:0,hours:0,days:0}
      const row=payrollByStaff[key];row.gross+=num(x.gross_pay);row.net+=num(x.net_pay);row.deductions+=num(x.deductions);row.commissions+=num(x.commissions);row.hours+=num(x.attendance_hours);row.days+=num(x.attendance_days)
    }
    const payrollRows=Object.values(payrollByStaff).sort((a,b)=>b.gross-a.gross)

    const assetMap={}
    for(const a of assets.filter(x=>locationOk(x.location_id)))assetMap[a.id]={id:a.id,label:a.name,category:a.category,purchaseCost:num(a.purchase_cost),maintenance:0,downtime:0}
    for(const m of maintenance.filter(x=>inRange(x.completed_at||x.created_at,startDate,endDate)&&locationOk(x.location_id))){
      if(!assetMap[m.asset_id])assetMap[m.asset_id]={id:m.asset_id,label:names.assets[m.asset_id]||'Asset',category:'',purchaseCost:0,maintenance:0,downtime:0}
      assetMap[m.asset_id].maintenance+=num(m.cost);assetMap[m.asset_id].downtime+=num(m.downtime_hours)
    }
    const assetCosts=Object.values(assetMap).filter(x=>x.maintenance||x.downtime).sort((a,b)=>b.maintenance-a.maintenance)

    const fleetMap={}
    for(const v of vehicles.filter(x=>locationOk(x.location_id)))fleetMap[v.id]={id:v.id,label:names.vehicles[v.id],fuelCost:0,litres:0,readings:[],deliveries:0,delivered:0}
    for(const f of fuelLogs.filter(x=>inRange(x.log_date,startDate,endDate)&&locationOk(x.location_id))){
      if(!fleetMap[f.vehicle_id])fleetMap[f.vehicle_id]={id:f.vehicle_id,label:names.vehicles[f.vehicle_id]||'Vehicle',fuelCost:0,litres:0,readings:[],deliveries:0,delivered:0}
      const row=fleetMap[f.vehicle_id];row.fuelCost+=num(f.total_cost);row.litres+=num(f.quantity);if(num(f.odometer)>0)row.readings.push(num(f.odometer))
    }
    for(const d of deliveries.filter(x=>inRange(x.delivered_at||x.created_at,startDate,endDate)&&locationOk(x.source_location_id))){
      if(!fleetMap[d.vehicle_id])continue
      fleetMap[d.vehicle_id].deliveries++;if(d.status==='delivered')fleetMap[d.vehicle_id].delivered++
    }
    const fleet=Object.values(fleetMap).map(x=>{
      const km=x.readings.length>1?Math.max(...x.readings)-Math.min(...x.readings):0
      return {...x,km,kmPerLitre:x.litres>0?km/x.litres:0,costPerKm:km>0?x.fuelCost/km:0,success:x.deliveries?x.delivered/x.deliveries*100:0}
    }).filter(x=>x.fuelCost||x.deliveries).sort((a,b)=>b.fuelCost-a.fuelCost)

    const projectRows=projects.filter(x=>locationOk(x.location_id)).map(p=>{
      const invoices=projectInvoices.filter(x=>x.project_id===p.id&&x.status!=='void'&&inRange(x.issue_date,startDate,endDate))
      const materials=projectMaterials.filter(x=>x.project_id===p.id&&x.status==='issued'&&inRange(x.issued_at,startDate,endDate))
      const times=projectTimesheets.filter(x=>x.project_id===p.id&&x.status==='approved'&&inRange(x.work_date,startDate,endDate))
      const costs=projectExpenses.filter(x=>x.project_id===p.id&&x.status!=='cancelled'&&inRange(x.expense_date,startDate,endDate))
      const billed=invoices.reduce((s,x)=>s+num(x.total_amount),0)
      const material=materials.reduce((s,x)=>s+num(x.cost_total),0)
      const labour=times.reduce((s,x)=>s+num(x.cost_amount),0)
      const expense=costs.reduce((s,x)=>s+num(x.amount),0)
      return {id:p.id,label:`${p.project_number} · ${p.name}`,status:p.status,client:names.customers[p.customer_id]||'Client',manager:names.users[p.manager_user_id]||'Unassigned',
        billed,periodCost:material+labour+expense,periodProfit:billed-material-labour-expense,budget:num(p.budget_cost),totalCost:num(p.total_cost),gross:num(p.gross_profit),progress:num(p.progress_percent)}
    }).filter(x=>x.billed||x.periodCost||!['completed','cancelled'].includes(x.status)).sort((a,b)=>b.periodProfit-a.periodProfit)

    const overall={
      netSales:rangeSales.reduce((s,x)=>s+(saleRevenue[x.id]||0),0),
      cogs:Object.values(saleCost).reduce((s,x)=>s+x,0),
      expenses:expenses.filter(x=>inRange(x.created_at,startDate,endDate)&&locationOk(x.location_id)).reduce((s,x)=>s+num(x.amount),0),
      collections:payments.filter(x=>x.direction==='in'&&inRange(x.created_at,startDate,endDate)&&locationOk(x.location_id)).reduce((s,x)=>s+num(x.amount),0),
      refunds:returns.filter(x=>inRange(x.created_at,startDate,endDate)).reduce((s,x)=>s+num(x.total_amount),0)
    }
    overall.gross=overall.netSales-overall.cogs
    overall.margin=overall.netSales>0?overall.gross/overall.netSales*100:0

    return {overall,productsReport,branches,staff,customerProfit,supplierAnalysis,inventory,inventoryAge,service,production,productionSummary,payrollRows,assetCosts,fleet,projectRows}
  },[
    locationFilter,startDate,endDate,sales,saleItems,returns,returnItems,expenses,payments,purchases,balances,stockMovements,workOrders,assignments,
    productionOrders,payrollEntries,assets,maintenance,vehicles,fuelLogs,deliveries,projects,projectInvoices,projectMaterials,projectTimesheets,projectExpenses,
    products,suppliers,locations,names
  ])

  if(loading)return <main className="page-wrap text-muted">Loading advanced reports...</main>

  const tabs=[
    ['sales','Sales'],['branches','Branches'],['staff','Staff'],['customers','Customers'],['suppliers','Suppliers'],['inventory','Inventory'],
    ['services','Services'],['manufacturing','Manufacturing'],['payroll','Payroll'],['assets','Assets & Fleet'],['projects','Projects']
  ]
  const presets=[['7 days',dateAgo(6),today()],['30 days',dateAgo(29),today()],['90 days',dateAgo(89),today()],['This year',`${new Date().getFullYear()}-01-01`,today()]]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Reporting & analytics</p><h1 className="page-title">Advanced Reports</h1><p className="page-subtitle">Detailed profitability, branch, staff, customer, supplier, inventory, service, manufacturing, payroll, asset, fleet and project analysis.</p></div>
      <div className="flex gap-2"><Link href="/executive-dashboard" className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">Executive Dashboard</Link><Link href="/accounting" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Accounting</Link></div>
    </div>

    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}

    <section className="mb-5 page-card p-4"><div className="flex flex-wrap items-end gap-3">
      <label><span className="mb-1 block text-xs font-bold text-muted">From</span><input className="input-base" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
      <label><span className="mb-1 block text-xs font-bold text-muted">To</span><input className="input-base" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
      <label><span className="mb-1 block text-xs font-bold text-muted">Location</span><select className="input-base min-w-48" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
      <div className="flex flex-wrap gap-2">{presets.map(([label,start,end])=><button key={label} type="button" onClick={()=>{setStartDate(start);setEndDate(end)}} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{label}</button>)}</div>
    </div></section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">{tabs.map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}</div>

    {tab==='sales'&&<section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        <div className="page-card p-4"><p className="text-xs text-muted">Net product sales</p><strong className="mt-2 block text-xl">{money(report.overall.netSales,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">COGS</p><strong className="mt-2 block text-xl">{money(report.overall.cogs,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Gross profit</p><strong className="mt-2 block text-xl text-emerald-600">{money(report.overall.gross,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Gross margin</p><strong className="mt-2 block text-xl">{pct(report.overall.margin)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Collections</p><strong className="mt-2 block text-xl">{money(report.overall.collections,currency)}</strong></div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2"><div className="page-card p-5"><h2 className="font-black">Top products by revenue</h2><div className="mt-4"><Bars rows={report.productsReport} valueKey="revenue" labelKey="label" format={v=>money(v,currency)} maxRows={10}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Product profitability</strong></div><div className="max-h-[560px] divide-y divide-[var(--line)] overflow-y-auto">{report.productsReport.slice(0,20).map(x=><div key={x.id} className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.qty.toLocaleString()} unit(s)</p></div><div className="text-right"><span className="text-xs text-muted">Revenue</span><strong className="block">{money(x.revenue,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Gross</span><strong className={x.gross>=0?'text-emerald-600':'text-red-500'}>{money(x.gross,currency)}</strong></div></div>)}</div></div></div>
    </section>}

    {tab==='branches'&&<section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="page-card p-5"><h2 className="font-black">Revenue by location</h2><div className="mt-4"><Bars rows={report.branches} valueKey="revenue" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Branch comparison</strong></div><div className="divide-y divide-[var(--line)]">{report.branches.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(4,auto)] md:items-center"><strong>{x.label}</strong><div className="text-right"><span className="text-xs text-muted">Revenue</span><strong className="block">{money(x.revenue,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Gross</span><strong className="block">{money(x.gross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Expenses</span><strong className="block">{money(x.expenses,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Collections</span><strong className="block">{money(x.collections,currency)}</strong></div></div>)}</div></div></section>}

    {tab==='staff'&&<section className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]"><div className="page-card p-5"><h2 className="font-black">Staff contribution</h2><p className="mt-1 text-xs text-muted">Product-sales gross profit plus allocated completed-job gross profit.</p><div className="mt-4"><Bars rows={report.staff} valueKey="totalContribution" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Staff performance detail</strong></div><div className="max-h-[650px] divide-y divide-[var(--line)] overflow-y-auto">{report.staff.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(4,auto)]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.sales.toLocaleString()} sale(s) · {x.jobs.toLocaleString(undefined,{maximumFractionDigits:1})} job share(s)</p></div><div className="text-right"><span className="text-xs text-muted">Sales revenue</span><strong className="block">{money(x.salesRevenue,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Sales gross</span><strong className="block">{money(x.salesGross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Service gross</span><strong className="block">{money(x.serviceGross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Project hours</span><strong className="block">{x.projectHours.toLocaleString(undefined,{maximumFractionDigits:1})}</strong></div></div>)}</div></div></section>}

    {tab==='customers'&&<section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="page-card p-5"><h2 className="font-black">Customer contribution</h2><p className="mt-1 text-xs text-muted">Product and completed-service gross contribution in the selected period.</p><div className="mt-4"><Bars rows={report.customerProfit} valueKey="totalContribution" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Customer profitability & exposure</strong></div><div className="max-h-[650px] divide-y divide-[var(--line)] overflow-y-auto">{report.customerProfit.slice(0,30).map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(3,auto)]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.sales} product sale(s) · project billings {money(x.projectBillings,currency)}</p></div><div className="text-right"><span className="text-xs text-muted">Revenue</span><strong className="block">{money(x.totalRevenue,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Contribution</span><strong className={x.totalContribution>=0?'text-emerald-600':'text-red-500'}>{money(x.totalContribution,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Outstanding</span><strong className="block text-amber-600">{money(x.receivable,currency)}</strong></div></div>)}</div></div></section>}

    {tab==='suppliers'&&<section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="page-card p-5"><h2 className="font-black">Supplier spend</h2><div className="mt-4"><Bars rows={report.supplierAnalysis} valueKey="spend" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Supplier analysis</strong></div><div className="divide-y divide-[var(--line)]">{report.supplierAnalysis.map(x=><div key={x.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.orders} purchase(s) in period</p></div><div className="text-right"><span className="text-xs text-muted">Period spend</span><strong className="block">{money(x.spend,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Outstanding</span><strong className="block text-red-500">{money(x.outstanding,currency)}</strong></div></div>)}</div></div></section>}

    {tab==='inventory'&&<section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{Object.entries(report.inventoryAge).map(([bucket,value])=><div key={bucket} className="page-card p-4"><p className="text-xs text-muted">{bucket}</p><strong className="mt-2 block text-xl">{money(value,currency)}</strong></div>)}</div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Inventory ageing & stock exposure</strong><p className="mt-1 text-xs text-muted">Age uses the latest stock movement currently available for each stocked product.</p></div><div className="max-h-[680px] divide-y divide-[var(--line)] overflow-y-auto">{report.inventory.filter(x=>x.qty>0).map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_auto_auto_auto]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.sku||'No SKU'} · {x.last?`last movement ${x.days} day(s) ago`:'no recorded movement'}</p></div><div className="text-right"><span className="text-xs text-muted">Available</span><strong className={x.qty<=x.reorder?'text-red-500':''}>{x.qty.toLocaleString()}</strong></div><div className="text-right"><span className="text-xs text-muted">Reorder</span><strong>{x.reorder.toLocaleString()}</strong></div><div className="text-right"><span className="text-xs text-muted">Value</span><strong>{money(x.value,currency)}</strong></div></div>)}</div></div>
    </section>}

    {tab==='services'&&<section className="grid gap-5 xl:grid-cols-[.8fr_1.2fr]"><div className="page-card p-5"><h2 className="font-black">Most profitable jobs</h2><div className="mt-4"><Bars rows={report.service} valueKey="gross" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Completed service profitability</strong></div><div className="max-h-[650px] divide-y divide-[var(--line)] overflow-y-auto">{report.service.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(3,auto)]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.customer}</p></div><div className="text-right"><span className="text-xs text-muted">Revenue</span><strong className="block">{money(x.revenue,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Gross profit</span><strong className={x.gross>=0?'text-emerald-600':'text-red-500'}>{money(x.gross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Margin</span><strong>{pct(x.margin)}</strong></div></div>)}</div></div></section>}

    {tab==='manufacturing'&&<section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><div className="page-card p-4"><p className="text-xs text-muted">Completed orders</p><strong className="mt-2 block text-xl">{report.production.length}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Planned output</p><strong className="mt-2 block text-xl">{report.productionSummary.planned.toLocaleString()}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Actual output</p><strong className="mt-2 block text-xl">{report.productionSummary.actual.toLocaleString()}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Material cost</p><strong className="mt-2 block text-xl">{money(report.productionSummary.materialCost,currency)}</strong></div></div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Manufacturing efficiency</strong></div><div className="divide-y divide-[var(--line)]">{report.production.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(4,auto)]"><strong>{x.label}</strong><div className="text-right"><span className="text-xs text-muted">Yield</span><strong className="block">{pct(x.yield)}</strong></div><div className="text-right"><span className="text-xs text-muted">Waste</span><strong className="block">{pct(x.wasteRate)}</strong></div><div className="text-right"><span className="text-xs text-muted">Actual</span><strong className="block">{x.actual.toLocaleString()}</strong></div><div className="text-right"><span className="text-xs text-muted">Material cost</span><strong className="block">{money(x.materialCost,currency)}</strong></div></div>)}</div></div>
    </section>}

    {tab==='payroll'&&<section className="grid gap-5 xl:grid-cols-[.75fr_1.25fr]"><div className="page-card p-5"><h2 className="font-black">Payroll cost by employee</h2><div className="mt-4"><Bars rows={report.payrollRows} valueKey="gross" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Payroll analysis</strong></div><div className="max-h-[650px] divide-y divide-[var(--line)] overflow-y-auto">{report.payrollRows.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(4,auto)]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.days.toLocaleString()} attendance day(s) · {x.hours.toLocaleString(undefined,{maximumFractionDigits:1})} hrs</p></div><div className="text-right"><span className="text-xs text-muted">Gross</span><strong className="block">{money(x.gross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Deductions</span><strong className="block">{money(x.deductions,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Net</span><strong className="block">{money(x.net,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Commission</span><strong className="block">{money(x.commissions,currency)}</strong></div></div>)}</div></div></section>}

    {tab==='assets'&&<section className="grid gap-5 xl:grid-cols-2">
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Asset maintenance cost</strong></div><div className="divide-y divide-[var(--line)]">{!report.assetCosts.length&&<p className="p-5 text-sm text-muted">No maintenance cost in this period.</p>}{report.assetCosts.map(x=><div key={x.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.category||'Asset'}</p></div><div className="text-right"><span className="text-xs text-muted">Maintenance</span><strong className="block">{money(x.maintenance,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Downtime</span><strong className="block">{x.downtime.toLocaleString()} hrs</strong></div></div>)}</div></div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Fleet fuel efficiency</strong></div><div className="divide-y divide-[var(--line)]">{!report.fleet.length&&<p className="p-5 text-sm text-muted">No fleet activity in this period.</p>}{report.fleet.map(x=><div key={x.id} className="grid gap-3 p-4 md:grid-cols-[1fr_repeat(4,auto)]"><strong>{x.label}</strong><div className="text-right"><span className="text-xs text-muted">Fuel</span><strong className="block">{money(x.fuelCost,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">km/L</span><strong className="block">{x.kmPerLitre.toLocaleString(undefined,{maximumFractionDigits:1})}</strong></div><div className="text-right"><span className="text-xs text-muted">Cost/km</span><strong className="block">{money(x.costPerKm,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Delivery success</span><strong className="block">{pct(x.success)}</strong></div></div>)}</div></div>
    </section>}

    {tab==='projects'&&<section className="space-y-5">
      <div className="page-card p-5"><h2 className="font-black">Project profitability · selected period</h2><div className="mt-4"><Bars rows={report.projectRows} valueKey="periodProfit" labelKey="label" format={v=>money(v,currency)} maxRows={12}/></div></div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Project control</strong></div><div className="max-h-[700px] divide-y divide-[var(--line)] overflow-y-auto">{report.projectRows.map(x=><div key={x.id} className="grid gap-3 p-4 lg:grid-cols-[1.2fr_repeat(4,auto)]"><div><strong>{x.label}</strong><p className="text-xs text-muted">{x.client} · manager {x.manager} · {x.status.replaceAll('_',' ')}</p><div className="mt-2 max-w-48"><ProgressBar label="Progress" value={x.progress}/></div></div><div className="text-right"><span className="text-xs text-muted">Period billed</span><strong className="block">{money(x.billed,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Period cost</span><strong className="block">{money(x.periodCost,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Period profit</span><strong className={x.periodProfit>=0?'text-emerald-600':'text-red-500'}>{money(x.periodProfit,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Budget usage</span><strong className={x.budget>0&&x.totalCost>x.budget?'text-red-500':''}>{x.budget>0?pct(x.totalCost/x.budget*100):'—'}</strong></div></div>)}</div></div>
    </section>}
  </main>
}

