'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { Bars, ProgressBar, Sparkline } from '../components/ReportCharts'

const money=(value,currency)=>`${Number(value||0).toLocaleString(undefined,{maximumFractionDigits:0})} ${currency||'UGX'}`
const pct=value=>`${Number(value||0).toLocaleString(undefined,{maximumFractionDigits:1})}%`
const dayKey=value=>new Date(value).toISOString().slice(0,10)
const dateAgo=days=>{const d=new Date();d.setDate(d.getDate()-days);return d.toISOString().slice(0,10)}
const today=()=>new Date().toISOString().slice(0,10)
const inRange=(value,start,end)=>{if(!value)return false;const d=dayKey(value);return d>=start&&d<=end}
const num=value=>Number(value||0)
const growth=(current,previous)=>previous>0?(current-previous)/previous*100:(current>0?100:0)

export default function ExecutiveDashboardPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [sales,setSales]=useState([])
  const [saleItems,setSaleItems]=useState([])
  const [returns,setReturns]=useState([])
  const [expenses,setExpenses]=useState([])
  const [payments,setPayments]=useState([])
  const [locations,setLocations]=useState([])
  const [customers,setCustomers]=useState([])
  const [users,setUsers]=useState([])
  const [products,setProducts]=useState([])
  const [balances,setBalances]=useState([])
  const [stockMovements,setStockMovements]=useState([])
  const [purchases,setPurchases]=useState([])
  const [suppliers,setSuppliers]=useState([])
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
  const [projectTimesheets,setProjectTimesheets]=useState([])
  const [onlineOrders,setOnlineOrders]=useState([])
  const [startDate,setStartDate]=useState(dateAgo(29))
  const [endDate,setEndDate]=useState(today())
  const [locationFilter,setLocationFilter]=useState('')
  const [loading,setLoading]=useState(true)
  const [message,setMessage]=useState('')

  const currency=context?.organization?.currency||business.currency||'UGX'

  useEffect(()=>{
    ;(async()=>{
      try{
        const ctx=await getPlatformContext()
        setContext(ctx)
        if(!ctx.organization?.id)throw new Error('Complete business setup first.')
        const org=ctx.organization.id
        const [
          salesRes,itemRes,returnRes,expenseRes,paymentRes,locationRes,customerRes,userRes,productRes,balanceRes,movementRes,
          purchaseRes,supplierRes,jobRes,assignmentRes,productionRes,payrollRes,assetRes,maintenanceRes,vehicleRes,fuelRes,
          deliveryRes,projectRes,invoiceRes,timesheetRes,onlineRes
        ]=await Promise.all([
          supabase.from('sales').select('id,location_id,customer_id,sold_by,total_amount,amount_paid,refunded_amount,status,payment_status,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(7000),
          supabase.from('sale_items').select('id,sale_id,product_id,description,quantity,unit_cost,line_total,discount_amount').limit(20000),
          supabase.from('sale_returns').select('id,sale_id,total_amount,created_at').eq('organization_id',org).limit(5000),
          supabase.from('expenses').select('id,location_id,category,amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('payments').select('id,location_id,direction,payment_type,method,amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(10000),
          supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
          supabase.from('customers').select('id,name,customer_group,credit_limit,opening_balance').eq('organization_id',org).eq('active',true),
          supabase.from('users').select('id,full_name,role,default_location_id,active').eq('organization_id',org).eq('active',true),
          supabase.from('products').select('id,name,sku,cost_price,selling_price,reorder_level,track_inventory,active').eq('organization_id',org).eq('active',true),
          supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,updated_at,products(organization_id)').limit(15000),
          supabase.from('stock_movements').select('id,location_id,product_id,movement_type,quantity,unit_cost,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(20000),
          supabase.from('purchases').select('id,location_id,supplier_id,total_amount,amount_paid,status,payment_status,created_at,received_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(5000),
          supabase.from('suppliers').select('id,name,opening_balance,opening_balance_paid').eq('organization_id',org).eq('active',true),
          supabase.from('work_orders').select('id,location_id,customer_id,status,final_amount,amount_paid,final_cost,gross_profit,completed_at,due_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(5000),
          supabase.from('work_order_assignments').select('work_order_id,user_id,assigned_at').limit(10000),
          supabase.from('production_orders').select('id,location_id,planned_quantity,actual_quantity,waste_quantity,status,total_material_cost,unit_cost,output_variance,completed_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(5000),
          supabase.from('payroll_entries').select('id,user_id,location_id,gross_pay,net_pay,deductions,commissions,attendance_days,attendance_hours,payment_status,paid_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(8000),
          supabase.from('assets').select('id,location_id,name,category,status,purchase_cost,purchase_date,active').eq('organization_id',org).eq('active',true),
          supabase.from('asset_maintenance').select('id,asset_id,location_id,status,cost,downtime_hours,completed_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('vehicles').select('id,location_id,registration_number,make,model,odometer,status,active').eq('organization_id',org).eq('active',true),
          supabase.from('fuel_logs').select('id,vehicle_id,location_id,log_date,odometer,quantity,total_cost').eq('organization_id',org).order('log_date',{ascending:false}).limit(8000),
          supabase.from('deliveries').select('id,source_location_id,vehicle_id,driver_user_id,status,scheduled_at,dispatched_at,delivered_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(6000),
          supabase.from('projects').select('id,location_id,customer_id,manager_user_id,name,status,contract_value,budget_cost,total_cost,billed_amount,amount_paid,gross_profit,progress_percent,start_date,due_date,completed_at,created_at').eq('organization_id',org).limit(3000),
          supabase.from('project_invoices').select('id,project_id,location_id,customer_id,total_amount,amount_paid,status,issue_date,due_date').eq('organization_id',org).limit(5000),
          supabase.from('project_timesheets').select('id,project_id,user_id,status,hours,cost_amount,work_date').eq('organization_id',org).limit(10000),
          supabase.from('online_orders').select('id,location_id,status,payment_status,total_amount,created_at,completed_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(5000),
        ])

        const required=[salesRes,itemRes,expenseRes,paymentRes,locationRes,customerRes,userRes,productRes,balanceRes,movementRes,purchaseRes,supplierRes,jobRes,assignmentRes,productionRes,payrollRes,assetRes,maintenanceRes,vehicleRes,fuelRes,deliveryRes,projectRes,invoiceRes,timesheetRes]
        const fatal=required.find(r=>r.error)
        if(fatal?.error)throw fatal.error

        const saleIds=new Set((salesRes.data||[]).map(x=>x.id))
        const jobIds=new Set((jobRes.data||[]).map(x=>x.id))
        setSales(salesRes.data||[])
        setSaleItems((itemRes.data||[]).filter(x=>saleIds.has(x.sale_id)))
        setReturns(returnRes.error?[]:(returnRes.data||[]))
        setExpenses(expenseRes.data||[])
        setPayments(paymentRes.data||[])
        setLocations(locationRes.data||[])
        setCustomers(customerRes.data||[])
        setUsers(userRes.data||[])
        setProducts(productRes.data||[])
        setBalances((balanceRes.data||[]).filter(x=>x.products?.organization_id===org))
        setStockMovements(movementRes.data||[])
        setPurchases(purchaseRes.data||[])
        setSuppliers(supplierRes.data||[])
        setWorkOrders(jobRes.data||[])
        setAssignments((assignmentRes.data||[]).filter(x=>jobIds.has(x.work_order_id)))
        setProductionOrders(productionRes.data||[])
        setPayrollEntries(payrollRes.data||[])
        setAssets(assetRes.data||[])
        setMaintenance(maintenanceRes.data||[])
        setVehicles(vehicleRes.data||[])
        setFuelLogs(fuelRes.data||[])
        setDeliveries(deliveryRes.data||[])
        setProjects(projectRes.data||[])
        setProjectInvoices(invoiceRes.data||[])
        setProjectTimesheets(timesheetRes.data||[])
        setOnlineOrders(onlineRes.error?[]:(onlineRes.data||[]))
      }catch(error){setMessage(error.message||'Could not load executive dashboard.')}
      finally{setLoading(false)}
    })()
  },[])

  const names=useMemo(()=>({
    locations:Object.fromEntries(locations.map(x=>[x.id,x.name])),
    customers:Object.fromEntries(customers.map(x=>[x.id,x.name])),
    users:Object.fromEntries(users.map(x=>[x.id,x.full_name])),
    products:Object.fromEntries(products.map(x=>[x.id,x.name])),
    suppliers:Object.fromEntries(suppliers.map(x=>[x.id,x.name])),
  }),[locations,customers,users,products,suppliers])

  const metrics=useMemo(()=>{
    const selectedSales=sales.filter(x=>inRange(x.created_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const periodMs=Math.max(86400000,new Date(endDate+'T23:59:59').getTime()-new Date(startDate+'T00:00:00').getTime()+1)
    const previousEnd=new Date(new Date(startDate+'T00:00:00').getTime()-1)
    const previousStart=new Date(previousEnd.getTime()-periodMs+1)
    const prevStart=previousStart.toISOString().slice(0,10)
    const prevEnd=previousEnd.toISOString().slice(0,10)
    const prevSales=sales.filter(x=>inRange(x.created_at,prevStart,prevEnd)&&(!locationFilter||x.location_id===locationFilter))
    const selectedIds=new Set(selectedSales.map(x=>x.id))
    const prevIds=new Set(prevSales.map(x=>x.id))
    const selectedItems=saleItems.filter(x=>selectedIds.has(x.sale_id))
    const prevItems=saleItems.filter(x=>prevIds.has(x.sale_id))

    const productRevenue=selectedSales.reduce((s,x)=>s+Math.max(0,num(x.total_amount)-num(x.refunded_amount)),0)
    const prevRevenue=prevSales.reduce((s,x)=>s+Math.max(0,num(x.total_amount)-num(x.refunded_amount)),0)
    const productCogs=selectedItems.reduce((s,x)=>s+num(x.quantity)*num(x.unit_cost),0)
    const prevCogs=prevItems.reduce((s,x)=>s+num(x.quantity)*num(x.unit_cost),0)
    const productGross=productRevenue-productCogs
    const prevGross=prevRevenue-prevCogs

    const jobs=workOrders.filter(x=>x.status==='completed'&&x.completed_at&&inRange(x.completed_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const serviceRevenue=jobs.reduce((s,x)=>s+num(x.final_amount),0)
    const serviceCost=jobs.reduce((s,x)=>s+num(x.final_cost),0)
    const projectBills=projectInvoices.filter(x=>x.status!=='void'&&inRange(x.issue_date,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const projectRevenue=projectBills.reduce((s,x)=>s+num(x.total_amount),0)
    const rangeExpenses=expenses.filter(x=>inRange(x.created_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const expenseTotal=rangeExpenses.reduce((s,x)=>s+num(x.amount),0)
    const totalRevenue=productRevenue+serviceRevenue+projectRevenue
    const grossProfit=productGross+(serviceRevenue-serviceCost)+projects.filter(x=>!locationFilter||x.location_id===locationFilter).reduce((s,x)=>s+Math.max(0,num(x.gross_profit)),0)
    const operatingResult=productGross+(serviceRevenue-serviceCost)-expenseTotal
    const margin=totalRevenue>0?operatingResult/totalRevenue*100:0

    const rangePayments=payments.filter(x=>inRange(x.created_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const collected=rangePayments.filter(x=>x.direction==='in').reduce((s,x)=>s+num(x.amount),0)
    const paidOut=rangePayments.filter(x=>x.direction==='out').reduce((s,x)=>s+num(x.amount),0)

    const salesReceivables=sales.filter(x=>!locationFilter||x.location_id===locationFilter).reduce((s,x)=>s+Math.max(0,num(x.total_amount)-num(x.refunded_amount)-num(x.amount_paid)),0)
    const jobReceivables=workOrders.filter(x=>x.status!=='cancelled'&&(!locationFilter||x.location_id===locationFilter)).reduce((s,x)=>s+Math.max(0,num(x.final_amount)-num(x.amount_paid)),0)
    const projectReceivables=projectInvoices.filter(x=>x.status!=='void'&&(!locationFilter||x.location_id===locationFilter)).reduce((s,x)=>s+Math.max(0,num(x.total_amount)-num(x.amount_paid)),0)
    const receivables=salesReceivables+jobReceivables+projectReceivables

    const payables=purchases.filter(x=>!locationFilter||x.location_id===locationFilter).reduce((s,x)=>s+Math.max(0,num(x.total_amount)-num(x.amount_paid)),0)
    const inventoryValue=balances.filter(x=>!locationFilter||x.location_id===locationFilter).reduce((s,x)=>{
      const p=products.find(p=>p.id===x.product_id)
      return s+Math.max(0,num(x.quantity))*num(p?.cost_price)
    },0)

    const dailyMap={}
    for(const sale of selectedSales){const k=dayKey(sale.created_at);dailyMap[k]=(dailyMap[k]||0)+Math.max(0,num(sale.total_amount)-num(sale.refunded_amount))}
    const daily=Object.entries(dailyMap).sort(([a],[b])=>a.localeCompare(b)).map(([label,value])=>({label,value}))

    const locationMap={}
    for(const loc of locations)locationMap[loc.id]={id:loc.id,label:loc.name,revenue:0,gross:0,transactions:0,expenses:0}
    for(const sale of sales.filter(x=>inRange(x.created_at,startDate,endDate))){
      const row=locationMap[sale.location_id]||{id:sale.location_id,label:names.locations[sale.location_id]||'Location',revenue:0,gross:0,transactions:0,expenses:0}
      const revenue=Math.max(0,num(sale.total_amount)-num(sale.refunded_amount))
      row.revenue+=revenue;row.transactions+=1;locationMap[sale.location_id]=row
    }
    const saleCostById={}
    for(const item of saleItems)saleCostById[item.sale_id]=(saleCostById[item.sale_id]||0)+num(item.quantity)*num(item.unit_cost)
    for(const sale of sales.filter(x=>inRange(x.created_at,startDate,endDate))){
      const row=locationMap[sale.location_id];if(row)row.gross+=Math.max(0,num(sale.total_amount)-num(sale.refunded_amount))-num(saleCostById[sale.id])
    }
    for(const expense of rangeExpenses){
      const row=locationMap[expense.location_id];if(row)row.expenses+=num(expense.amount)
    }
    const branches=Object.values(locationMap).filter(x=>x.revenue||x.expenses).sort((a,b)=>b.revenue-a.revenue)

    const lowStock=[]
    const qtyByProduct={}
    for(const row of balances.filter(x=>!locationFilter||x.location_id===locationFilter))qtyByProduct[row.product_id]=(qtyByProduct[row.product_id]||0)+Math.max(0,num(row.quantity)-num(row.reserved_quantity))
    for(const p of products)if(p.track_inventory&&num(qtyByProduct[p.id])<=num(p.reorder_level))lowStock.push(p)

    const inventoryAge=[]
    const lastMovement={}
    for(const movement of stockMovements.filter(x=>!locationFilter||x.location_id===locationFilter))if(!lastMovement[movement.product_id])lastMovement[movement.product_id]=movement.created_at
    for(const p of products){
      const qty=Math.max(0,num(qtyByProduct[p.id]))
      if(qty<=0)continue
      const last=lastMovement[p.id]
      const days=last?Math.floor((Date.now()-new Date(last).getTime())/86400000):9999
      inventoryAge.push({id:p.id,label:p.name,days,value:qty*num(p.cost_price),qty})
    }
    const deadStock=inventoryAge.filter(x=>x.days>90)

    const completedProd=productionOrders.filter(x=>x.status==='completed'&&x.completed_at&&inRange(x.completed_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const planned=completedProd.reduce((s,x)=>s+num(x.planned_quantity),0)
    const actual=completedProd.reduce((s,x)=>s+num(x.actual_quantity),0)
    const waste=completedProd.reduce((s,x)=>s+num(x.waste_quantity),0)
    const productionYield=planned>0?actual/planned*100:0
    const wasteRate=actual+waste>0?waste/(actual+waste)*100:0

    const payroll=payrollEntries.filter(x=>(x.paid_at?inRange(x.paid_at,startDate,endDate):inRange(x.created_at,startDate,endDate))&&(!locationFilter||x.location_id===locationFilter))
    const payrollGross=payroll.reduce((s,x)=>s+num(x.gross_pay),0)
    const payrollNet=payroll.reduce((s,x)=>s+num(x.net_pay),0)

    const maint=maintenance.filter(x=>inRange(x.completed_at||x.created_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const maintenanceCost=maint.reduce((s,x)=>s+num(x.cost),0)
    const downtime=maint.reduce((s,x)=>s+num(x.downtime_hours),0)

    const fuel=fuelLogs.filter(x=>inRange(x.log_date,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const fuelCost=fuel.reduce((s,x)=>s+num(x.total_cost),0)
    const fuelQty=fuel.reduce((s,x)=>s+num(x.quantity),0)
    let km=0
    const byVehicle={}
    for(const x of fuel){
      if(!byVehicle[x.vehicle_id])byVehicle[x.vehicle_id]=[]
      byVehicle[x.vehicle_id].push(num(x.odometer))
    }
    for(const readings of Object.values(byVehicle)){const r=readings.filter(Boolean);if(r.length>1)km+=Math.max(...r)-Math.min(...r)}
    const kmPerLitre=fuelQty>0?km/fuelQty:0

    const deliveryRows=deliveries.filter(x=>inRange(x.delivered_at||x.created_at,startDate,endDate)&&(!locationFilter||x.source_location_id===locationFilter))
    const delivered=deliveryRows.filter(x=>x.status==='delivered').length
    const deliveryRate=deliveryRows.length?delivered/deliveryRows.length*100:0

    const activeProjects=projects.filter(x=>!['completed','cancelled'].includes(x.status)&&(!locationFilter||x.location_id===locationFilter))
    const overBudget=activeProjects.filter(x=>num(x.budget_cost)>0&&num(x.total_cost)>num(x.budget_cost))
    const online=onlineOrders.filter(x=>inRange(x.created_at,startDate,endDate)&&(!locationFilter||x.location_id===locationFilter))
    const onlineRevenue=online.filter(x=>x.status==='completed').reduce((s,x)=>s+num(x.total_amount),0)
    const onlineOpen=online.filter(x=>!['completed','cancelled'].includes(x.status)).length

    return {
      productRevenue,prevRevenue,productGross,prevGross,serviceRevenue,projectRevenue,totalRevenue,grossProfit,expenseTotal,operatingResult,margin,
      revenueGrowth:growth(productRevenue,prevRevenue),grossGrowth:growth(productGross,prevGross),collected,paidOut,receivables,payables,inventoryValue,
      daily,branches,lowStock,deadStock,deadStockValue:deadStock.reduce((s,x)=>s+x.value,0),productionYield,wasteRate,completedProd:completedProd.length,
      payrollGross,payrollNet,maintenanceCost,downtime,fuelCost,kmPerLitre,deliveryRate,deliveries:deliveryRows.length,activeProjects:activeProjects.length,
      overBudget:overBudget.length,onlineRevenue,onlineOpen
    }
  },[
    sales,saleItems,expenses,payments,locations,products,balances,stockMovements,purchases,workOrders,productionOrders,payrollEntries,
    maintenance,fuelLogs,deliveries,projects,projectInvoices,onlineOrders,startDate,endDate,locationFilter,names
  ])

  const executiveNotes=useMemo(()=>{
    const rows=[]
    if(metrics.revenueGrowth<=-10)rows.push({label:'Revenue pressure',detail:`Product-sales revenue is down ${pct(Math.abs(metrics.revenueGrowth))} against the previous comparable period.`,href:'/sales-report'})
    if(metrics.margin<10&&metrics.totalRevenue>0)rows.push({label:'Margin pressure',detail:`Operating result is only ${pct(metrics.margin)} of reported revenue in the selected window.`,href:'/accounting'})
    if(metrics.receivables>Math.max(metrics.collected,1))rows.push({label:'Collections risk',detail:`${money(metrics.receivables,currency)} is outstanding, above selected-period collections of ${money(metrics.collected,currency)}.`,href:'/customers'})
    if(metrics.lowStock.length)rows.push({label:'Stock risk',detail:`${metrics.lowStock.length} inventory item(s) are at or below reorder level.`,href:'/inventory'})
    if(metrics.deadStockValue>0)rows.push({label:'Working capital',detail:`${money(metrics.deadStockValue,currency)} is tied in stock with no movement for more than 90 days.`,href:'/inventory'})
    if(metrics.overBudget)rows.push({label:'Project control',detail:`${metrics.overBudget} active project(s) are over budget.`,href:'/projects'})
    if(metrics.onlineOpen>=5)rows.push({label:'Order backlog',detail:`${metrics.onlineOpen} e-commerce orders are still open.`,href:'/ecommerce'})
    return rows.slice(0,6)
  },[metrics,currency])

  if(loading)return <main className="page-wrap text-muted">Loading executive dashboard...</main>

  const presets=[
    ['7 days',dateAgo(6),today()],['30 days',dateAgo(29),today()],['90 days',dateAgo(89),today()],['This year',`${new Date().getFullYear()}-01-01`,today()]
  ]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Executive performance</p><h1 className="page-title">Executive Dashboard</h1><p className="page-subtitle">A management-level view of revenue, profitability, working capital, branches and operational efficiency across MGT.</p></div>
      <div className="flex gap-2"><Link href="/insights" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">MGT Intelligence</Link><Link href="/sales-report" className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">Detailed Reports</Link></div>
    </div>

    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}

    <section className="mb-6 page-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label><span className="mb-1 block text-xs font-bold text-muted">From</span><input className="input-base" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">To</span><input className="input-base" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Location</span><select className="input-base min-w-48" value={locationFilter} onChange={e=>setLocationFilter(e.target.value)}><option value="">All locations</option>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select></label>
        <div className="flex flex-wrap gap-2">{presets.map(([label,start,end])=><button key={label} type="button" onClick={()=>{setStartDate(start);setEndDate(end)}} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{label}</button>)}</div>
      </div>
    </section>

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
      <div className="page-card p-4 xl:col-span-2"><p className="text-xs text-muted">Product sales revenue</p><strong className="mt-2 block text-3xl">{money(metrics.productRevenue,currency)}</strong><p className={`mt-1 text-xs font-bold ${metrics.revenueGrowth>=0?'text-emerald-600':'text-red-500'}`}>{metrics.revenueGrowth>=0?'+':''}{pct(metrics.revenueGrowth)} vs previous comparable period</p></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Service revenue</p><strong className="mt-2 block text-xl">{money(metrics.serviceRevenue,currency)}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Project billings</p><strong className="mt-2 block text-xl">{money(metrics.projectRevenue,currency)}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Operating result</p><strong className={`mt-2 block text-xl ${metrics.operatingResult>=0?'text-emerald-600':'text-red-500'}`}>{money(metrics.operatingResult,currency)}</strong><p className="mt-1 text-xs text-muted">{pct(metrics.margin)} margin</p></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Collections</p><strong className="mt-2 block text-xl text-emerald-600">{money(metrics.collected,currency)}</strong></div>
    </section>

    <section className="mb-6 grid gap-5 xl:grid-cols-[1.45fr_.55fr]">
      <div className="page-card p-5">
        <div className="mb-4 flex items-start justify-between gap-4"><div><h2 className="font-black">Revenue trend</h2><p className="mt-1 text-xs text-muted">Daily product sales in the selected period.</p></div><strong>{money(metrics.productRevenue,currency)}</strong></div>
        <Sparkline points={metrics.daily} label="Daily sales revenue trend"/>
      </div>
      <div className="page-card p-5">
        <h2 className="font-black">Management attention</h2>
        <div className="mt-4 space-y-3">
          {!executiveNotes.length&&<div className="rounded-xl bg-emerald-500/10 p-4 text-sm text-emerald-600">No major executive exceptions are triggered by the selected period.</div>}
          {executiveNotes.map(item=><Link href={item.href} key={item.label} className="block rounded-xl bg-[var(--panel-2)] p-3"><strong className="text-sm">{item.label}</strong><p className="mt-1 text-xs leading-5 text-muted">{item.detail}</p></Link>)}
        </div>
      </div>
    </section>

    <section className="mb-6 grid gap-5 xl:grid-cols-3">
      <div className="page-card p-5"><h2 className="font-black">Working capital</h2><div className="mt-4 space-y-4"><div><span className="text-xs text-muted">Receivables</span><strong className="mt-1 block text-xl text-amber-600">{money(metrics.receivables,currency)}</strong></div><div><span className="text-xs text-muted">Supplier payables</span><strong className="mt-1 block text-xl text-red-500">{money(metrics.payables,currency)}</strong></div><div><span className="text-xs text-muted">Inventory at cost</span><strong className="mt-1 block text-xl">{money(metrics.inventoryValue,currency)}</strong></div><div><span className="text-xs text-muted">90+ day stock value</span><strong className="mt-1 block text-xl">{money(metrics.deadStockValue,currency)}</strong></div></div></div>

      <div className="page-card p-5"><h2 className="font-black">Operations scorecard</h2><div className="mt-4 space-y-4"><ProgressBar label="Production yield" value={metrics.productionYield}/><ProgressBar label="Delivery success" value={metrics.deliveryRate}/><ProgressBar label="Waste control" value={Math.max(0,100-metrics.wasteRate)} valueLabel={pct(metrics.wasteRate)+' waste'}/><div className="flex justify-between border-t border-[var(--line)] pt-3 text-sm"><span className="text-muted">Low-stock items</span><strong>{metrics.lowStock.length}</strong></div><div className="flex justify-between text-sm"><span className="text-muted">Open online orders</span><strong>{metrics.onlineOpen}</strong></div></div></div>

      <div className="page-card p-5"><h2 className="font-black">Cost control</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted">Operating expenses</span><strong>{money(metrics.expenseTotal,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Payroll gross</span><strong>{money(metrics.payrollGross,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Asset maintenance</span><strong>{money(metrics.maintenanceCost,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Fleet fuel</span><strong>{money(metrics.fuelCost,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Maintenance downtime</span><strong>{metrics.downtime.toLocaleString()} hrs</strong></div></div></div>
    </section>

    <section className="mb-6 grid gap-5 xl:grid-cols-2">
      <div className="page-card p-5">
        <div className="mb-4"><h2 className="font-black">Location comparison</h2><p className="mt-1 text-xs text-muted">Product-sales revenue by branch/location for the selected period.</p></div>
        <Bars rows={metrics.branches} valueKey="revenue" labelKey="label" format={v=>money(v,currency)} maxRows={10}/>
      </div>
      <div className="page-card overflow-hidden">
        <div className="border-b border-[var(--line)] p-4"><strong>Branch operating snapshot</strong></div>
        <div className="divide-y divide-[var(--line)]">{!metrics.branches.length&&<p className="p-5 text-sm text-muted">No branch activity in this period.</p>}{metrics.branches.slice(0,10).map(row=><div key={row.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto]"><div><strong>{row.label}</strong><p className="mt-1 text-xs text-muted">{row.transactions} product-sale transaction(s)</p></div><div className="text-right"><span className="text-xs text-muted">Gross profit</span><strong className="block">{money(row.gross,currency)}</strong></div><div className="text-right"><span className="text-xs text-muted">Expenses</span><strong className="block">{money(row.expenses,currency)}</strong></div></div>)}</div>
      </div>
    </section>

    <section className="grid gap-5 xl:grid-cols-4">
      <Link href="/production" className="page-card p-5"><p className="text-xs font-black uppercase text-muted">Manufacturing</p><strong className="mt-2 block text-2xl">{metrics.completedProd}</strong><p className="mt-1 text-xs text-muted">completed production orders · {pct(metrics.productionYield)} yield</p></Link>
      <Link href="/projects" className="page-card p-5"><p className="text-xs font-black uppercase text-muted">Projects</p><strong className="mt-2 block text-2xl">{metrics.activeProjects}</strong><p className="mt-1 text-xs text-muted">active · {metrics.overBudget} over budget</p></Link>
      <Link href="/fleet" className="page-card p-5"><p className="text-xs font-black uppercase text-muted">Fleet</p><strong className="mt-2 block text-2xl">{metrics.kmPerLitre.toLocaleString(undefined,{maximumFractionDigits:1})} km/L</strong><p className="mt-1 text-xs text-muted">{metrics.deliveries} delivery records in period</p></Link>
      <Link href="/ecommerce" className="page-card p-5"><p className="text-xs font-black uppercase text-muted">E-commerce</p><strong className="mt-2 block text-2xl">{money(metrics.onlineRevenue,currency)}</strong><p className="mt-1 text-xs text-muted">{metrics.onlineOpen} open online order(s)</p></Link>
    </section>
  </main>
}
