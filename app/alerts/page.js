'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { reportRows } from '../../lib/reportRows'
import { purchasePayable } from '../../lib/balances'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()

export default function AlertsPage() {
  const business = getBusinessConfig()
  const [context,setContext] = useState(null)
  const [products,setProducts] = useState([])
  const [locations,setLocations] = useState([])
  const [balances,setBalances] = useState([])
  const [purchases,setPurchases] = useState([])
  const [customers,setCustomers] = useState([])
  const [customerBalances,setCustomerBalances] = useState([])
  const [workOrders,setWorkOrders] = useState([])
  const [assets,setAssets] = useState([])
  const [maintenance,setMaintenance] = useState([])
  const [vehicles,setVehicles] = useState([])
  const [deliveries,setDeliveries] = useState([])
  const [projects,setProjects] = useState([])
  const [projectTasks,setProjectTasks] = useState([])
  const [projectMilestones,setProjectMilestones] = useState([])
  const [projectInvoices,setProjectInvoices] = useState([])
  const [message,setMessage] = useState('')
  const [loading,setLoading] = useState(true)
  const loadRequest = useRef(0)

  const currency = context?.organization?.currency || business.currency || 'UGX'

  const load = async ({quiet=false}={}) => {
    const request=++loadRequest.current
    if(!quiet)setLoading(true)
    try {
      const ctx = await getPlatformContext()
      if(!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id

      const [permissionRes,productRes,locationRes,balanceRes,purchaseRes,customerRes,workOrderRes,assetRes,maintenanceRes,vehicleRes,deliveryRes,projectRes,projectTaskRes,projectMilestoneRes,projectInvoiceRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        reportRows(supabase.from('products').select('id,name,sku,reorder_level,cost_price').eq('organization_id',org).eq('active',true).eq('track_inventory',true),['id']),
        reportRows(supabase.from('locations').select('id,name').eq('organization_id',org).eq('active',true),['id']),
        reportRows(supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity,products!inner(organization_id)').eq('products.organization_id',org),['product_id','location_id']),
        reportRows(supabase.from('purchases').select('id,purchase_number,supplier_id,status,approval_status,payment_status,total_amount,amount_paid,due_date,created_at,suppliers(name),locations(name)').eq('organization_id',org),['id']),
        reportRows(supabase.from('customers').select('id,name,credit_limit').eq('organization_id',org).eq('active',true),['id']),
        reportRows(supabase.from('work_orders').select('id,job_number,title,status,priority,due_at,scheduled_at,customer_id,customers(name),locations(name)').eq('organization_id',org),['id']),
        reportRows(supabase.from('assets').select('id,asset_number,name,status,next_service_date,location_id,locations(name)').eq('organization_id',org).eq('active',true),['id']),
        reportRows(supabase.from('asset_maintenance').select('id,maintenance_number,asset_id,status,priority,scheduled_date,description,assets(name,asset_number)').eq('organization_id',org),['id']),
        reportRows(supabase.from('vehicles').select('id,registration_number,status,odometer,service_due_odometer,insurance_expiry,license_expiry').eq('organization_id',org).eq('active',true),['id']),
        reportRows(supabase.from('deliveries').select('id,delivery_number,status,destination,scheduled_at,vehicle_id,driver_user_id').eq('organization_id',org),['id']),
        reportRows(supabase.from('projects').select('id,project_number,name,status,priority,due_date,progress_percent,customer_id,customers(name),locations(name)').eq('organization_id',org),['id']),
        reportRows(supabase.from('project_tasks').select('id,project_id,title,status,priority,due_date,assigned_user_id,projects(project_number,name)').eq('organization_id',org),['id']),
        reportRows(supabase.from('project_milestones').select('id,project_id,name,status,due_date,projects(project_number,name)').eq('organization_id',org),['id']),
        reportRows(supabase.from('project_invoices').select('id,invoice_number,project_id,status,total_amount,amount_paid,due_date,projects(project_number,name),customers(name)').eq('organization_id',org),['id']),
      ])

      for (const result of [permissionRes,productRes,locationRes,balanceRes,purchaseRes,customerRes,workOrderRes,assetRes,maintenanceRes,vehicleRes,deliveryRes,projectRes,projectTaskRes,projectMilestoneRes,projectInvoiceRes]) if(result.error) throw result.error

      const permissions=(permissionRes.data||[]).map((row)=>row.permission)
      const canViewCustomerBalances=['sales.view','sales.create','finance.view','customers.view','payments.view','payments.request','reports.view']
        .some((permission)=>permissions.includes(permission))
      const customerBalanceRes=canViewCustomerBalances
        ?await supabase.rpc('get_customer_sales_balances')
        :{data:[],error:null}
      if(customerBalanceRes.error)throw customerBalanceRes.error

      const nextProducts=productRes.data||[]
      const nextLocations=locationRes.data||[]
      const currentBalances=new Map((balanceRes.data||[]).map((row)=>[`${row.product_id}:${row.location_id}`,row]))
      const completeBalances=[]
      for(const location of nextLocations)for(const product of nextProducts){
        const row=currentBalances.get(`${product.id}:${location.id}`)
        completeBalances.push({
          ...(row||{quantity:0,reserved_quantity:0}),
          product_id:product.id,
          location_id:location.id,
          products:{...product,organization_id:org},
          locations:{...location,organization_id:org},
        })
      }

      if(request!==loadRequest.current)return
      setContext(ctx)
      setMessage('')
      setProducts(nextProducts)
      setLocations(nextLocations)
      setBalances(completeBalances)
      setPurchases(purchaseRes.data||[])
      setCustomers(customerRes.data||[])
      setCustomerBalances(customerBalanceRes.data||[])
      setWorkOrders(workOrderRes.data||[])
      setAssets(assetRes.data||[])
      setMaintenance(maintenanceRes.data||[])
      setVehicles(vehicleRes.data||[])
      setDeliveries(deliveryRes.data||[])
      setProjects(projectRes.data||[])
      setProjectTasks(projectTaskRes.data||[])
      setProjectMilestones(projectMilestoneRes.data||[])
      setProjectInvoices(projectInvoiceRes.data||[])
    } catch(error) {
      if(request===loadRequest.current)setMessage(error.message || 'Could not load alerts.')
    } finally {
      if(request===loadRequest.current)setLoading(false)
    }
  }

  useEffect(()=>{
    void load()
    const refresh=()=>{if(document.visibilityState==='visible')void load({quiet:true})}
    const interval=window.setInterval(refresh,60000)
    window.addEventListener('focus',refresh)
    document.addEventListener('visibilitychange',refresh)
    return ()=>{
      loadRequest.current+=1
      window.clearInterval(interval)
      window.removeEventListener('focus',refresh)
      document.removeEventListener('visibilitychange',refresh)
    }
  },[])

  const alerts = useMemo(()=>{
    const list = []
    const productMap = Object.fromEntries(products.map((product)=>[product.id,product]))

    for(const row of balances){
      const product = productMap[row.product_id]
      if(!product) continue
      const available = Number(row.quantity||0)-Number(row.reserved_quantity||0)
      const reorder = Number(product.reorder_level||0)
      if(reorder>0 && available<=reorder){
        list.push({
          key:`stock-${row.product_id}-${row.location_id}`,
          tone:available<=0?'red':'amber',
          type:available<=0?'Out of stock':'Low stock',
          title:`${product.name} has ${available.toLocaleString()} available`,
          detail:`${row.locations?.name || 'Location'} · reorder level ${reorder.toLocaleString()} · stock value ${money(Math.max(0,Number(row.quantity||0))*Number(product.cost_price||0),currency)}`,
          href:'/inventory',
          action:'Open inventory',
        })
      }
    }

    const now = new Date()
    for(const purchase of purchases){
      const due = Math.max(0,Number(purchase.total_amount||0)-Number(purchase.amount_paid||0))
      const purchaseEligible=['not_required','approved'].includes(purchase.approval_status)
        && !['draft','pending_approval','rejected','cancelled'].includes(purchase.status)
      const payable=purchasePayable(purchase)
      if(payable>0.009 && purchase.due_date && purchase.payment_status!=='paid' && new Date(purchase.due_date+'T23:59:59')<now){
        list.push({
          key:`purchase-due-${purchase.id}`,
          tone:'red',
          type:'Overdue supplier payment',
          title:`${purchase.suppliers?.name || 'Supplier'} is owed ${money(due,currency)}`,
          detail:`${purchase.purchase_number || 'Purchase'} · due ${new Date(purchase.due_date+'T00:00:00').toLocaleDateString()} · ${purchase.locations?.name || 'Location'}`,
          href:'/suppliers',
          action:'Open supplier account',
        })
      }
      if(purchaseEligible && ['ordered','partial'].includes(purchase.status)){
        const ageDays = Math.floor((now-new Date(purchase.created_at))/86400000)
        if(ageDays>=7){
          list.push({
            key:`purchase-open-${purchase.id}`,
            tone:'amber',
            type:'Purchase order awaiting stock',
            title:`${purchase.purchase_number || 'Purchase order'} has been open ${ageDays} days`,
            detail:`${purchase.suppliers?.name || 'Supplier'} · ${purchase.locations?.name || 'Location'} · status ${purchase.status}`,
            href:'/purchasing',
            action:'Open purchasing',
          })
        }
      }
    }

    for(const job of workOrders){
      if(['completed','cancelled'].includes(job.status)) continue
      if(job.due_at && new Date(job.due_at)<now){
        list.push({
          key:`job-overdue-${job.id}`,tone:'red',type:'Overdue service job',
          title:`${job.job_number || 'Job'} · ${job.title}`,
          detail:`${job.customers?.name || 'No customer'} · ${job.locations?.name || 'Location'} · due ${new Date(job.due_at).toLocaleString()}`,
          href:'/work-orders',action:'Open service jobs',
        })
      } else if(job.priority==='urgent'){
        list.push({
          key:`job-urgent-${job.id}`,tone:'amber',type:'Urgent service job',
          title:`${job.job_number || 'Job'} · ${job.title}`,
          detail:`${job.customers?.name || 'No customer'} · ${job.locations?.name || 'Location'}${job.scheduled_at ? ` · scheduled ${new Date(job.scheduled_at).toLocaleString()}` : ''}`,
          href:'/work-orders',action:'Open service jobs',
        })
      }
    }

    const soon7 = new Date(Date.now()+7*86400000)
    const soon30 = new Date(Date.now()+30*86400000)

    for(const asset of assets){
      if(asset.next_service_date){
        const due=new Date(asset.next_service_date+'T23:59:59')
        if(due<=soon7){
          list.push({
            key:`asset-service-${asset.id}`,
            tone:due<now?'red':'amber',
            type:due<now?'Asset service overdue':'Asset service due',
            title:`${asset.asset_number} · ${asset.name}`,
            detail:`${asset.locations?.name || 'Location'} · service ${due<now?'was due':'due'} ${new Date(asset.next_service_date+'T00:00:00').toLocaleDateString()}`,
            href:'/assets',action:'Open assets',
          })
        }
      }
    }

    for(const m of maintenance){
      if(['scheduled','in_progress'].includes(m.status) && m.scheduled_date && new Date(m.scheduled_date+'T23:59:59')<now){
        list.push({
          key:`maintenance-overdue-${m.id}`,tone:'red',type:'Maintenance overdue',
          title:`${m.maintenance_number} · ${m.assets?.name || 'Asset'}`,
          detail:`${m.assets?.asset_number || ''} · ${m.description || m.priority} · scheduled ${new Date(m.scheduled_date+'T00:00:00').toLocaleDateString()}`,
          href:'/assets',action:'Open maintenance',
        })
      }
    }

    for(const v of vehicles){
      if(v.service_due_odometer!=null && Number(v.odometer||0)>=Number(v.service_due_odometer)){
        list.push({
          key:`vehicle-service-${v.id}`,tone:'amber',type:'Vehicle service mileage reached',
          title:`${v.registration_number} is due for service`,
          detail:`Odometer ${Number(v.odometer||0).toLocaleString()} km · service due at ${Number(v.service_due_odometer||0).toLocaleString()} km`,
          href:'/fleet',action:'Open fleet',
        })
      }
      for(const [kind,value] of [['Insurance',v.insurance_expiry],['Licence',v.license_expiry]]){
        if(value){
          const expiry=new Date(value+'T23:59:59')
          if(expiry<=soon30){
            list.push({
              key:`vehicle-doc-${kind}-${v.id}`,tone:expiry<now?'red':'amber',
              type:`${kind} ${expiry<now?'expired':'expiring'}`,
              title:`${v.registration_number} · ${kind}`,
              detail:`${expiry<now?'Expired':'Expires'} ${new Date(value+'T00:00:00').toLocaleDateString()}`,
              href:'/fleet',action:'Open fleet',
            })
          }
        }
      }
    }

    for(const d of deliveries){
      if(!['delivered','cancelled','failed'].includes(d.status) && d.scheduled_at && new Date(d.scheduled_at)<now){
        list.push({
          key:`delivery-late-${d.id}`,tone:'red',type:'Delivery overdue',
          title:`${d.delivery_number} · ${d.destination}`,
          detail:`Scheduled ${new Date(d.scheduled_at).toLocaleString()} · status ${d.status.replaceAll('_',' ')}`,
          href:'/fleet',action:'Open deliveries',
        })
      }
    }

        for(const p of projects){
      if(['completed','cancelled'].includes(p.status)) continue
      if(p.due_date && new Date(p.due_date+'T23:59:59')<now){
        list.push({
          key:`project-overdue-${p.id}`,tone:'red',type:'Project overdue',
          title:`${p.project_number} · ${p.name}`,
          detail:`${p.customers?.name || 'No client'} · ${p.locations?.name || 'Location'} · ${Number(p.progress_percent||0).toLocaleString()}% complete · due ${new Date(p.due_date+'T00:00:00').toLocaleDateString()}`,
          href:'/projects',action:'Open projects',
        })
      } else if(p.priority==='urgent'){
        list.push({
          key:`project-urgent-${p.id}`,tone:'amber',type:'Urgent project',
          title:`${p.project_number} · ${p.name}`,
          detail:`${Number(p.progress_percent||0).toLocaleString()}% complete${p.due_date?` · due ${new Date(p.due_date+'T00:00:00').toLocaleDateString()}`:''}`,
          href:'/projects',action:'Open projects',
        })
      }
    }

    for(const task of projectTasks){
      if(['completed','cancelled'].includes(task.status)) continue
      if(task.due_date && new Date(task.due_date+'T23:59:59')<now){
        list.push({
          key:`project-task-overdue-${task.id}`,tone:'red',type:'Project task overdue',
          title:task.title,
          detail:`${task.projects?.project_number || 'Project'} · ${task.projects?.name || ''} · due ${new Date(task.due_date+'T00:00:00').toLocaleDateString()}`,
          href:'/projects',action:'Open project tasks',
        })
      }
    }

    for(const milestone of projectMilestones){
      if(['completed','cancelled'].includes(milestone.status)) continue
      if(milestone.due_date && new Date(milestone.due_date+'T23:59:59')<now){
        list.push({
          key:`project-milestone-overdue-${milestone.id}`,tone:'red',type:'Project milestone overdue',
          title:milestone.name,
          detail:`${milestone.projects?.project_number || 'Project'} · ${milestone.projects?.name || ''} · due ${new Date(milestone.due_date+'T00:00:00').toLocaleDateString()}`,
          href:'/projects',action:'Open milestones',
        })
      }
    }

    for(const invoice of projectInvoices){
      const balance=Math.max(0,Number(invoice.total_amount||0)-Number(invoice.amount_paid||0))
      if(['issued','partial'].includes(invoice.status) && balance>0.009 && invoice.due_date && new Date(invoice.due_date+'T23:59:59')<now){
        list.push({
          key:`project-invoice-overdue-${invoice.id}`,tone:'red',type:'Project invoice overdue',
          title:`${invoice.invoice_number} · ${invoice.customers?.name || 'Client'}`,
          detail:`${invoice.projects?.project_number || 'Project'} · balance ${money(balance,currency)} · due ${new Date(invoice.due_date+'T00:00:00').toLocaleDateString()}`,
          href:'/projects',action:'Open project billing',
        })
      }
    }

    const debtMap=Object.fromEntries(customerBalances.map((row)=>[row.customer_id,Number(row.balance_due||0)]))
    for(const customer of customers){
      const owed = Number(debtMap[customer.id]||0)
      const limit = Number(customer.credit_limit||0)
      if(owed>0.009 && limit>0 && owed>=limit*0.8){
        list.push({
          key:`credit-${customer.id}`,
          tone:owed>limit?'red':'amber',
          type:owed>limit?'Credit limit exceeded':'Credit limit warning',
          title:`${customer.name} owes ${money(owed,currency)}`,
          detail:`Credit limit ${money(limit,currency)} · ${Math.round((owed/limit)*100)}% used`,
          href:'/sales',
          action:'Open customer credit',
        })
      }
    }

    const rank={red:0,amber:1,blue:2}
    return list.sort((a,b)=>(rank[a.tone]??9)-(rank[b.tone]??9))
  },[products,balances,purchases,customers,customerBalances,workOrders,assets,maintenance,vehicles,deliveries,projects,projectTasks,projectMilestones,projectInvoices,currency])

  const redCount=alerts.filter((item)=>item.tone==='red').length
  const amberCount=alerts.filter((item)=>item.tone==='amber').length

  if(loading) return <main className="page-wrap text-muted">Loading alerts...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Attention</p>
          <h1 className="page-title">Business Alerts</h1>
          <p className="page-subtitle">Inventory, purchasing, credit, service jobs, projects, maintenance, fleet documents and delivery exceptions.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/notifications" className="btn-primary rounded-xl px-4 py-2 text-sm font-bold">Notification Center</Link><Link href="/" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Dashboard</Link></div>
      </div>

      {message && <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-500">{message}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-3">
        <div className="page-card p-4"><p className="text-xs text-muted">Needs attention</p><strong className="mt-2 block text-2xl">{alerts.length}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Critical</p><strong className="mt-2 block text-2xl text-red-500">{redCount}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Warnings</p><strong className="mt-2 block text-2xl text-amber-600">{amberCount}</strong></div>
      </section>

      <section className="space-y-3">
        {!alerts.length && <div className="page-card p-8 text-center"><strong>No active alerts</strong><p className="mt-2 text-sm text-muted">No current inventory, purchasing, credit, service, project, maintenance or fleet exceptions need attention.</p></div>}
        {alerts.map((item)=>(
          <article key={item.key} className={`rounded-2xl border p-4 sm:p-5 ${item.tone==='red'?'border-red-500/30 bg-red-500/10':item.tone==='amber'?'border-amber-500/30 bg-amber-500/10':'border-[var(--line)] bg-[var(--panel)]'}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className={`text-[10px] font-black uppercase tracking-[0.16em] ${item.tone==='red'?'text-red-500':'text-amber-600'}`}>{item.type}</p>
                <h2 className="mt-1 font-black">{item.title}</h2>
                <p className="mt-1 text-sm text-muted">{item.detail}</p>
              </div>
              <Link href={item.href} className="btn-secondary rounded-xl px-3 py-2 text-center text-xs font-black">{item.action}</Link>
            </div>
          </article>
        ))}
      </section>
    </main>
  )
}
