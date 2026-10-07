'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:0})+' '+(currency||'UGX')
const pct=value=>(Number.isFinite(value)?value:0).toLocaleString(undefined,{maximumFractionDigits:1})+'%'
const daysAgo=n=>{const d=new Date();d.setDate(d.getDate()-n);return d}
const stamp=d=>d.toISOString()
const severityRank={critical:4,warning:3,opportunity:2,positive:1,info:0}

export default function InsightsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [sales,setSales]=useState([])
  const [saleItems,setSaleItems]=useState([])
  const [expenses,setExpenses]=useState([])
  const [payments,setPayments]=useState([])
  const [products,setProducts]=useState([])
  const [balances,setBalances]=useState([])
  const [purchases,setPurchases]=useState([])
  const [workOrders,setWorkOrders]=useState([])
  const [projects,setProjects]=useState([])
  const [onlineOrders,setOnlineOrders]=useState([])
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
        const since90=stamp(daysAgo(90))
        const [salesRes,itemRes,expenseRes,paymentRes,productRes,balanceRes,purchaseRes,jobRes,projectRes,orderRes]=await Promise.all([
          supabase.from('sales').select('id,total_amount,amount_paid,refunded_amount,payment_status,created_at').eq('organization_id',org).gte('created_at',since90).order('created_at',{ascending:false}).limit(6000),
          supabase.from('sale_items').select('id,sale_id,product_id,description,quantity,unit_cost,line_total').limit(15000),
          supabase.from('expenses').select('id,amount,category,created_at').eq('organization_id',org).gte('created_at',since90).limit(5000),
          supabase.from('payments').select('id,direction,amount,method,created_at').eq('organization_id',org).gte('created_at',since90).limit(8000),
          supabase.from('products').select('id,name,sku,cost_price,selling_price,reorder_level,track_inventory,active').eq('organization_id',org).eq('active',true),
          supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,products(organization_id,name,cost_price,reorder_level,track_inventory)').limit(15000),
          supabase.from('purchases').select('id,total_amount,amount_paid,status,payment_status,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
          supabase.from('work_orders').select('id,status,final_amount,amount_paid,gross_profit,due_at,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
          supabase.from('projects').select('id,name,status,contract_value,budget_cost,total_cost,billed_amount,amount_paid,gross_profit,progress_percent').eq('organization_id',org).limit(2000),
          supabase.from('online_orders').select('id,status,payment_status,total_amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
        ])

        const optional=[orderRes]
        for(const r of [salesRes,itemRes,expenseRes,paymentRes,productRes,balanceRes,purchaseRes,jobRes,projectRes])if(r.error)throw r.error
        if(optional[0].error&&String(optional[0].error.message||'').includes('online_orders'))optional[0]={data:[]}

        const saleIds=new Set((salesRes.data||[]).map(x=>x.id))
        setSales(salesRes.data||[])
        setSaleItems((itemRes.data||[]).filter(x=>saleIds.has(x.sale_id)))
        setExpenses(expenseRes.data||[])
        setPayments(paymentRes.data||[])
        setProducts(productRes.data||[])
        setBalances((balanceRes.data||[]).filter(x=>x.products?.organization_id===org))
        setPurchases(purchaseRes.data||[])
        setWorkOrders(jobRes.data||[])
        setProjects(projectRes.data||[])
        setOnlineOrders(optional[0].data||[])
      }catch(error){setMessage(error.message||'Could not load business intelligence.')}
      finally{setLoading(false)}
    })()
  },[])

  const metrics=useMemo(()=>{
    const now=Date.now()
    const d30=30*86400000
    const currentSales=sales.filter(x=>now-new Date(x.created_at).getTime()<=d30)
    const previousSales=sales.filter(x=>{const age=now-new Date(x.created_at).getTime();return age>d30&&age<=d30*2})
    const currentIds=new Set(currentSales.map(x=>x.id))
    const previousIds=new Set(previousSales.map(x=>x.id))
    const currentItems=saleItems.filter(x=>currentIds.has(x.sale_id))
    const previousItems=saleItems.filter(x=>previousIds.has(x.sale_id))
    const sumSales=rows=>rows.reduce((s,x)=>s+Math.max(0,Number(x.total_amount||0)-Number(x.refunded_amount||0)),0)
    const currentRevenue=sumSales(currentSales)
    const previousRevenue=sumSales(previousSales)
    const currentCogs=currentItems.reduce((s,x)=>s+Number(x.quantity||0)*Number(x.unit_cost||0),0)
    const previousCogs=previousItems.reduce((s,x)=>s+Number(x.quantity||0)*Number(x.unit_cost||0),0)
    const currentGross=currentRevenue-currentCogs
    const previousGross=previousRevenue-previousCogs
    const currentExpense=expenses.filter(x=>now-new Date(x.created_at).getTime()<=d30).reduce((s,x)=>s+Number(x.amount||0),0)
    const previousExpense=expenses.filter(x=>{const age=now-new Date(x.created_at).getTime();return age>d30&&age<=d30*2}).reduce((s,x)=>s+Number(x.amount||0),0)
    const revenueGrowth=previousRevenue>0?(currentRevenue-previousRevenue)/previousRevenue*100:(currentRevenue>0?100:0)
    const margin=currentRevenue>0?currentGross/currentRevenue*100:0
    const previousMargin=previousRevenue>0?previousGross/previousRevenue*100:0
    const receivables=sales.reduce((s,x)=>s+Math.max(0,Number(x.total_amount||0)-Number(x.refunded_amount||0)-Number(x.amount_paid||0)),0)
      +workOrders.filter(x=>x.status!=='cancelled').reduce((s,x)=>s+Math.max(0,Number(x.final_amount||0)-Number(x.amount_paid||0)),0)
      +projects.reduce((s,x)=>s+Math.max(0,Number(x.billed_amount||0)-Number(x.amount_paid||0)),0)
    const payables=purchases.reduce((s,x)=>s+Math.max(0,Number(x.total_amount||0)-Number(x.amount_paid||0)),0)
    const inventoryValue=balances.reduce((s,x)=>s+Math.max(0,Number(x.quantity||0))*Number(x.products?.cost_price||0),0)
    const availableByProduct={}
    for(const row of balances)availableByProduct[row.product_id]=(availableByProduct[row.product_id]||0)+Math.max(0,Number(row.quantity||0)-Number(row.reserved_quantity||0))
    const lowStock=products.filter(p=>p.track_inventory&&Number(availableByProduct[p.id]||0)<=Number(p.reorder_level||0))
    const sold90={}
    for(const item of saleItems)if(item.product_id)sold90[item.product_id]=(sold90[item.product_id]||0)+Number(item.quantity||0)
    const deadStock=products.filter(p=>p.track_inventory&&Number(availableByProduct[p.id]||0)>0&&!sold90[p.id])
    const deadStockValue=deadStock.reduce((s,p)=>s+Number(availableByProduct[p.id]||0)*Number(p.cost_price||0),0)
    const productStats={}
    for(const item of currentItems){
      const key=item.product_id||item.description
      if(!productStats[key])productStats[key]={name:item.description,revenue:0,gross:0,qty:0}
      productStats[key].revenue+=Number(item.line_total||0)
      productStats[key].gross+=Number(item.line_total||0)-Number(item.quantity||0)*Number(item.unit_cost||0)
      productStats[key].qty+=Number(item.quantity||0)
    }
    const topProduct=Object.values(productStats).sort((a,b)=>b.revenue-a.revenue)[0]||null
    const collected30=payments.filter(x=>x.direction==='in'&&now-new Date(x.created_at).getTime()<=d30).reduce((s,x)=>s+Number(x.amount||0),0)
    const cashOut30=payments.filter(x=>x.direction==='out'&&now-new Date(x.created_at).getTime()<=d30).reduce((s,x)=>s+Number(x.amount||0),0)
    const overdueJobs=workOrders.filter(x=>!['completed','cancelled'].includes(x.status)&&x.due_at&&new Date(x.due_at).getTime()<now)
    const projectOverruns=projects.filter(x=>Number(x.budget_cost||0)>0&&Number(x.total_cost||0)>Number(x.budget_cost||0))
    const openOnline=onlineOrders.filter(x=>!['completed','cancelled'].includes(x.status))
    const forecast30=currentRevenue
    const forecastAnnual=currentRevenue*12

    return {currentRevenue,previousRevenue,currentGross,currentExpense,previousExpense,revenueGrowth,margin,previousMargin,receivables,payables,inventoryValue,lowStock,deadStock,deadStockValue,topProduct,collected30,cashOut30,overdueJobs,projectOverruns,openOnline,forecast30,forecastAnnual,currentSales:currentSales.length}
  },[sales,saleItems,expenses,payments,products,balances,purchases,workOrders,projects,onlineOrders])

  const insights=useMemo(()=>{
    const m=metrics
    const rows=[]
    const add=(severity,title,detail,action,href,score)=>rows.push({severity,title,detail,action,href,score})

    if(m.revenueGrowth<=-15)add('critical','Revenue has fallen '+pct(Math.abs(m.revenueGrowth)),'The latest 30 days are materially below the previous 30-day period.','Review product, location and customer sales reports to identify where the decline started.','/sales-report',95)
    else if(m.revenueGrowth<0)add('warning','Revenue is slightly down','The latest 30 days are '+pct(Math.abs(m.revenueGrowth))+' below the previous period.','Watch the trend and focus sales activity on the strongest products and customers.','/sales-report',75)
    else if(m.revenueGrowth>=15)add('positive','Revenue momentum is strong','Revenue increased '+pct(m.revenueGrowth)+' versus the previous 30 days.','Protect stock availability and repeat the channels driving growth.','/sales-report',70)

    if(m.currentRevenue>0&&m.margin<15)add('critical','Gross margin is thin at '+pct(m.margin),'Sales are generating limited gross profit before operating expenses.','Review selling prices, discounts and product costs before chasing more volume.','/sales-report',92)
    else if(m.currentRevenue>0&&m.margin<m.previousMargin-5)add('warning','Margin is deteriorating','Gross margin fell from '+pct(m.previousMargin)+' to '+pct(m.margin)+'.','Check price overrides, purchase costs and low-margin products.','/sales-report',82)

    if(m.receivables>Math.max(m.currentRevenue*.6,1))add('critical','Receivables are tying up cash',money(m.receivables,currency)+' is still due from customers compared with '+money(m.currentRevenue,currency)+' in recent sales.','Prioritize collections and tighten credit on slow-paying accounts.','/customers',94)
    else if(m.receivables>0)add('warning','Customer money is still outstanding',money(m.receivables,currency)+' remains uncollected across sales, jobs and projects.','Review ageing balances and follow up before they become overdue.','/customers',72)

    if(m.lowStock.length)add(m.lowStock.length>=5?'critical':'warning',m.lowStock.length+' item(s) at or below reorder level','Demand can be lost if fast-moving items become unavailable.','Replenish critical products and verify purchase orders.','/inventory',88)

    if(m.deadStockValue>0)add('opportunity','Slow stock is locking up '+money(m.deadStockValue,currency),m.deadStock.length+' stocked item(s) have had no recorded sale in the available 90-day window.','Consider promotions, transfers, bundling or reduced purchasing for these items.','/inventory',76)

    if(m.previousExpense>0&&m.currentExpense>m.previousExpense*1.2)add('warning','Operating expenses are rising','Recent expenses are '+pct((m.currentExpense-m.previousExpense)/m.previousExpense*100)+' above the previous 30 days.','Open Finance and review the categories causing the increase.','/cashbook',80)

    if(m.payables>m.collected30&&m.payables>0)add('warning','Supplier obligations exceed recent collections',money(m.payables,currency)+' is payable while recent incoming payments total '+money(m.collected30,currency)+'.','Sequence supplier payments and protect working cash.','/purchasing',84)

    if(m.overdueJobs.length)add('critical',m.overdueJobs.length+' service job(s) are overdue','Open work orders have passed their due dates.','Reassign, reschedule or close delayed jobs before customer impact grows.','/work-orders',90)

    if(m.projectOverruns.length)add('critical',m.projectOverruns.length+' project(s) are over budget','Actual project cost has exceeded the approved budget on active or historical projects.','Review materials, labour and expenses on the affected projects.','/projects',91)

    if(m.openOnline.length>=5)add('warning',m.openOnline.length+' online orders need attention','Open e-commerce orders are waiting in the fulfillment workflow.','Confirm and process online orders before stock reservations become stale.','/ecommerce',78)

    if(m.topProduct)add('opportunity',m.topProduct.name+' is your current revenue leader','It generated '+money(m.topProduct.revenue,currency)+' in the latest 30-day product-sales window.','Keep it stocked and test cross-sell or bundle opportunities.','/catalog',68)

    if(!rows.length)add('positive','No major management exceptions detected','The current data does not trigger any of MGT Intelligence’s major risk rules.','Continue monitoring reports and maintain data quality for stronger recommendations.','/sales-report',50)

    return rows.sort((a,b)=>(severityRank[b.severity]-severityRank[a.severity])||(b.score-a.score))
  },[metrics,currency])

  const health=useMemo(()=>{
    let score=100
    for(const x of insights){
      if(x.severity==='critical')score-=14
      if(x.severity==='warning')score-=7
      if(x.severity==='opportunity')score-=2
    }
    return Math.max(0,Math.min(100,score))
  },[insights])

  const summary=useMemo(()=>{
    const risk=insights.filter(x=>x.severity==='critical').length
    const warnings=insights.filter(x=>x.severity==='warning').length
    if(risk)return 'Management attention is required. '+risk+' high-priority risk'+(risk===1?'':'s')+' currently need action.'
    if(warnings)return 'The business is broadly stable, with '+warnings+' issue'+(warnings===1?'':'s')+' worth watching closely.'
    return 'Current operating signals are healthy. Focus on the identified growth opportunities and maintain discipline.'
  },[insights])

  if(loading)return <main className="page-wrap text-muted">Analyzing business data...</main>

  return <main className="page-wrap">
    <div className="page-header-row"><div><p className="page-eyebrow">Management advisory</p><h1 className="page-title">MGT Intelligence</h1><p className="page-subtitle">Automated business signals built from your live MGT records. Data stays inside your MGT environment.</p></div><div className="flex gap-2"><Link href="/executive-dashboard" className="btn-primary rounded-xl px-4 py-2.5 text-sm font-black">Executive Dashboard</Link><Link href="/sales-report" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Detailed Reports</Link></div></div>

    {message&&<div className="mb-5 rounded-xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-500">{message}</div>}

    <section className="mb-6 grid gap-4 xl:grid-cols-[1.2fr_.8fr]">
      <div className="page-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-black uppercase text-muted">Business health signal</p><div className="mt-2 flex items-end gap-2"><strong className={'text-5xl '+(health>=80?'text-emerald-600':health>=60?'text-amber-600':'text-red-500')}>{health}</strong><span className="pb-1 text-sm font-bold text-muted">/ 100</span></div></div><div className="rounded-2xl bg-[var(--panel-2)] px-4 py-3 text-right"><p className="text-xs text-muted">Signals generated</p><strong className="text-2xl">{insights.length}</strong></div></div>
        <p className="mt-5 max-w-3xl text-sm leading-7 text-muted">{summary}</p>
      </div>
      <div className="page-card p-6"><p className="text-xs font-black uppercase text-muted">30-day revenue outlook</p><strong className="mt-2 block text-3xl">{money(metrics.forecast30,currency)}</strong><p className="mt-2 text-xs leading-5 text-muted">Baseline forecast assumes the most recent 30-day revenue pace continues. It is a management estimate, not a guaranteed prediction.</p><div className="mt-4 flex justify-between border-t border-[var(--line)] pt-4 text-sm"><span className="text-muted">Annualized run rate</span><strong>{money(metrics.forecastAnnual,currency)}</strong></div></div>
    </section>

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Revenue · latest 30 days</p><strong className="mt-2 block text-xl">{money(metrics.currentRevenue,currency)}</strong><p className={'mt-1 text-xs font-bold '+(metrics.revenueGrowth>=0?'text-emerald-600':'text-red-500')}>{metrics.revenueGrowth>=0?'+':''}{pct(metrics.revenueGrowth)} vs previous period</p></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Gross margin</p><strong className="mt-2 block text-xl">{pct(metrics.margin)}</strong><p className="mt-1 text-xs text-muted">Previous {pct(metrics.previousMargin)}</p></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Receivables now</p><strong className="mt-2 block text-xl text-amber-600">{money(metrics.receivables,currency)}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Inventory at cost</p><strong className="mt-2 block text-xl">{money(metrics.inventoryValue,currency)}</strong></div>
    </section>

    <section className="mb-6">
      <div className="mb-3"><p className="text-xs font-black uppercase text-muted">Priority queue</p><h2 className="text-xl font-black">What management should act on</h2></div>
      <div className="space-y-3">{insights.map((item,index)=><article key={item.title} className="page-card p-5"><div className="grid gap-4 lg:grid-cols-[56px_1fr_auto] lg:items-start"><div className={'grid h-12 w-12 place-items-center rounded-2xl text-sm font-black '+(item.severity==='critical'?'bg-red-500/10 text-red-500':item.severity==='warning'?'bg-amber-500/10 text-amber-600':item.severity==='opportunity'?'bg-blue-500/10 text-blue-600':'bg-emerald-500/10 text-emerald-600')}>{index+1}</div><div><div className="flex flex-wrap items-center gap-2"><strong>{item.title}</strong><span className={'rounded-full px-2 py-1 text-[10px] font-black uppercase '+(item.severity==='critical'?'bg-red-500/10 text-red-500':item.severity==='warning'?'bg-amber-500/10 text-amber-600':item.severity==='opportunity'?'bg-blue-500/10 text-blue-600':'bg-emerald-500/10 text-emerald-600')}>{item.severity}</span></div><p className="mt-2 text-sm leading-6 text-muted">{item.detail}</p><div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><strong>Recommended action:</strong> <span className="text-muted">{item.action}</span></div></div><Link href={item.href} className="btn-secondary rounded-xl px-3 py-2 text-center text-xs font-black">Open area</Link></div></article>)}</div>
    </section>

    <section className="grid gap-5 xl:grid-cols-2">
      <div className="page-card p-5"><h2 className="font-black">Working-capital pressure</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted">Customer receivables</span><strong>{money(metrics.receivables,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Supplier payables</span><strong>{money(metrics.payables,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Incoming payments · 30 days</span><strong>{money(metrics.collected30,currency)}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Outgoing payments · 30 days</span><strong>{money(metrics.cashOut30,currency)}</strong></div></div></div>
      <div className="page-card p-5"><h2 className="font-black">Operational exceptions</h2><div className="mt-4 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Low-stock items</span><strong className="mt-1 block text-2xl">{metrics.lowStock.length}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Slow-stock items</span><strong className="mt-1 block text-2xl">{metrics.deadStock.length}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Overdue jobs</span><strong className="mt-1 block text-2xl">{metrics.overdueJobs.length}</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Projects over budget</span><strong className="mt-1 block text-2xl">{metrics.projectOverruns.length}</strong></div></div></div>
    </section>

    <div className="mt-6 rounded-2xl border border-[var(--line)] bg-[var(--panel-2)] p-4 text-xs leading-5 text-muted"><strong className="text-[var(--text)]">How this works:</strong> MGT Intelligence currently uses deterministic management rules and rolling-period comparisons over your own transaction data. That makes the recommendations explainable and keeps business records inside MGT. A future external AI provider can be connected through Integrations without replacing this audit-friendly foundation.</div>
  </main>
}
