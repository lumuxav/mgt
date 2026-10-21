'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'
import { checkoutRequest, finishCheckout } from '../../lib/checkoutRequest'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()

export default function WorkOrdersPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [customers,setCustomers]=useState([])
  const [locations,setLocations]=useState([])
  const [products,setProducts]=useState([])
  const [staff,setStaff]=useState([])
  const [orders,setOrders]=useState([])
  const [lines,setLines]=useState([])
  const [assignments,setAssignments]=useState([])
  const [events,setEvents]=useState([])
  const [payments,setPayments]=useState([])
  const [tab,setTab]=useState('jobs')
  const [search,setSearch]=useState('')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [selected,setSelected]=useState(null)

  const [form,setForm]=useState({title:'',customer_id:'',location_id:'',description:'',quoted_amount:'',due_at:'',scheduled_at:'',priority:'normal',notes:''})
  const [assignedIds,setAssignedIds]=useState([])
  const [lineForm,setLineForm]=useState({line_type:'service',product_id:'',description:'',quantity:'1',unit_price:'',unit_cost:''})
  const [payForm,setPayForm]=useState({amount:'',method:'cash',reference:'',notes:''})
  const [statusNotes,setStatusNotes]=useState('')
  const [bankAccounts,setBankAccounts]=useState([])
  const [cancelForm,setCancelForm]=useState({reason:'',method:'cash',account:'',reference:'',materials:''})
  const cancelling=useRef(false)

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canManage=permissions.includes('services.manage')
  const canPay=permissions.includes('services.pay')||canManage||permissions.includes('finance.manage')
  const canSeeProfit=permissions.includes('reports.view')||permissions.includes('finance.view')||canManage

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,customerRes,locationRes,productRes,staffRes,orderRes,lineRes,assignRes,eventRes,paymentRes,bankRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('customers').select('id,name,phone,email').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('products').select('id,name,sku,item_type,unit,track_inventory,cost_price,selling_price').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('users').select('id,full_name,role,default_location_id').eq('organization_id',org).eq('active',true).order('full_name'),
        supabase.from('work_orders').select('id,job_number,location_id,customer_id,title,description,status,priority,quoted_amount,final_amount,amount_paid,payment_status,final_cost,gross_profit,due_at,scheduled_at,started_at,completed_at,notes,created_at,customers(name,phone,email),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
        supabase.from('work_order_lines').select('id,work_order_id,line_type,product_id,description,quantity,unit_price,unit_cost,line_total,cost_total,created_at,products(name,sku,unit)').eq('organization_id',org).order('created_at'),
        supabase.from('work_order_assignments').select('work_order_id,user_id,assigned_at'),
        supabase.from('work_order_events').select('id,work_order_id,event_type,description,metadata,user_id,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
        supabase.from('payments').select('id,work_order_id,direction,payment_type,method,amount,reference,notes,received_by,created_at').eq('organization_id',org).not('work_order_id','is',null).order('created_at',{ascending:false}).limit(2000),
        supabase.from('bank_accounts').select('id,name,account_type').eq('organization_id',org).eq('active',true).order('name'),
      ])
      for(const result of [permRes,customerRes,locationRes,productRes,staffRes,orderRes,lineRes,assignRes,eventRes,paymentRes,bankRes])if(result.error)throw result.error
      setPermissions((permRes.data||[]).map((row)=>row.permission))
      setCustomers(customerRes.data||[])
      setLocations(locationRes.data||[])
      setProducts(productRes.data||[])
      setBankAccounts(bankRes.data||[])
      setStaff(staffRes.data||[])
      setOrders(orderRes.data||[])
      const orderIds=new Set((orderRes.data||[]).map((row)=>row.id))
      setLines((lineRes.data||[]).filter((row)=>orderIds.has(row.work_order_id)))
      setAssignments((assignRes.data||[]).filter((row)=>orderIds.has(row.work_order_id)))
      setEvents((eventRes.data||[]).filter((row)=>orderIds.has(row.work_order_id)))
      setPayments((paymentRes.data||[]).filter((row)=>orderIds.has(row.work_order_id)))
      const defaultLocation=ctx.location?.id||locationRes.data?.[0]?.id||''
      setForm((value)=>({...value,location_id:value.location_id||defaultLocation}))
      if(selected){
        const fresh=(orderRes.data||[]).find((row)=>row.id===selected.id)
        if(fresh)setSelected(fresh)
      }
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load service jobs.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const createJob=async(event)=>{
    event.preventDefault()
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('create_service_work_order',{
      p_location_id:form.location_id,
      p_customer_id:form.customer_id||null,
      p_title:form.title,
      p_description:form.description||null,
      p_quoted_amount:form.quoted_amount===''?null:Number(form.quoted_amount),
      p_due_at:form.due_at?new Date(form.due_at).toISOString():null,
      p_scheduled_at:form.scheduled_at?new Date(form.scheduled_at).toISOString():null,
      p_priority:form.priority,
      p_notes:form.notes||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      if(assignedIds.length){
        const assign=await supabase.rpc('assign_work_order_staff',{p_work_order_id:data.work_order_id,p_user_ids:assignedIds})
        if(assign.error)setMessage({type:'error',text:`Job created, but staff assignment failed: ${assign.error.message}`})
        else setMessage({type:'success',text:`${data.job_number} created and assigned.`})
      }else setMessage({type:'success',text:`${data.job_number} created.`})
      setForm((value)=>({title:'',customer_id:'',location_id:value.location_id,description:'',quoted_amount:'',due_at:'',scheduled_at:'',priority:'normal',notes:''}))
      setAssignedIds([])
      setTab('jobs')
      await load()
    }
    setBusy(false)
  }

  const chooseLineProduct=(productId)=>{
    const product=products.find((item)=>item.id===productId)
    setLineForm((value)=>({...value,product_id:productId,description:product?.name||value.description,unit_price:product?String(product.selling_price||0):value.unit_price,unit_cost:product?String(product.cost_price||0):value.unit_cost}))
  }

  const lineProducts=useMemo(()=>{
    if(lineForm.line_type==='material')return products.filter((item)=>item.track_inventory&&item.item_type!=='service')
    if(lineForm.line_type==='service')return products.filter((item)=>item.item_type==='service')
    if(lineForm.line_type==='labor')return products.filter((item)=>item.item_type==='service')
    return products
  },[products,lineForm.line_type])

  const addLine=async(event)=>{
    event.preventDefault()
    if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('add_work_order_line',{
      p_work_order_id:selected.id,
      p_line_type:lineForm.line_type,
      p_product_id:lineForm.product_id||null,
      p_description:lineForm.description||null,
      p_quantity:Number(lineForm.quantity||0),
      p_unit_price:lineForm.unit_price===''?null:Number(lineForm.unit_price),
      p_unit_cost:lineForm.unit_cost===''?null:Number(lineForm.unit_cost),
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setLineForm({line_type:'service',product_id:'',description:'',quantity:'1',unit_price:'',unit_cost:''})
      setMessage({type:'success',text:'Job charge/material added.'})
      await load()
    }
    setBusy(false)
  }

  const removeLine=async(lineId)=>{
    if(!confirm('Remove this job line? Material stock will be restored if this is a material line.'))return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('remove_work_order_line',{p_line_id:lineId})
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:'Job line removed.'});await load()}
    setBusy(false)
  }

  const saveAssignments=async()=>{
    if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('assign_work_order_staff',{p_work_order_id:selected.id,p_user_ids:assignedIds})
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:'Assigned staff updated.'});await load()}
    setBusy(false)
  }

  const openJob=(order)=>{
    setSelected(order)
    setAssignedIds(assignments.filter((row)=>row.work_order_id===order.id).map((row)=>row.user_id))
    setLineForm({line_type:'service',product_id:'',description:'',quantity:'1',unit_price:'',unit_cost:''})
    setPayForm({amount:'',method:'cash',reference:'',notes:''})
    setStatusNotes('')
    setCancelForm({reason:'',method:'cash',account:'',reference:'',materials:''})
  }

  const setStatus=async(status)=>{
    if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('set_work_order_status',{p_work_order_id:selected.id,p_status:status,p_notes:statusNotes||null})
    if(error)setMessage({type:'error',text:error.message})
    else{setMessage({type:'success',text:`Job moved to ${status.replaceAll('_',' ')}.`});setStatusNotes('');await load()}
    setBusy(false)
  }

  const recordPayment=async(event)=>{
    event.preventDefault()
    if(!selected)return
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('record_work_order_payment',{
      p_work_order_id:selected.id,
      p_amount:Number(payForm.amount),
      p_method:payForm.method,
      p_reference:payForm.reference||null,
      p_notes:payForm.notes||null,
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:`Payment recorded. Job balance: ${money(data?.balance,currency)}.`})
      setPayForm({amount:'',method:'cash',reference:'',notes:''})
      await load()
    }
    setBusy(false)
  }

  const cancelJob=async(event)=>{
    event.preventDefault()
    if(!selected||cancelling.current)return
    cancelling.current=true;setBusy(true);setMessage(null)
    const scope=`service.cancel.${context.organization.id}.${context.user.id}.${selected.id}`
    try{
      const payload={p_work_order_id:selected.id,p_reason:cancelForm.reason.trim(),p_expected_refund_amount:Number(selected.amount_paid||0),p_refund_method:cancelForm.method,p_bank_account_id:cancelForm.method==='cash'?null:(cancelForm.account||null),p_reference:cancelForm.reference.trim()||null,p_restore_materials:cancelForm.materials==='returned'}
      const requestId=await checkoutRequest(sessionStorage,crypto,scope,payload)
      const {data,error}=await supabase.rpc('cancel_service_work_order',{p_request_id:requestId,...payload})
      if(error)throw error
      finishCheckout(sessionStorage,scope)
      setMessage({type:'success',text:`Job cancelled. Refund recorded: ${money(data.refunded_amount,currency)}.`})
      setCancelForm({reason:'',method:'cash',account:'',reference:'',materials:''})
      await load()
    }catch(error){setMessage({type:'error',text:error.message||'Cancellation could not be confirmed. Retry with the same details.'})}
    finally{cancelling.current=false;setBusy(false)}
  }

  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase()
    const list=tab==='history'?orders.filter((order)=>['completed','cancelled'].includes(order.status)):orders.filter((order)=>!['completed','cancelled'].includes(order.status))
    if(!term)return list
    return list.filter((order)=>[order.job_number,order.title,order.customers?.name,order.locations?.name,order.status].filter(Boolean).some((value)=>String(value).toLowerCase().includes(term)))
  },[orders,tab,search])

  const active=orders.filter((order)=>!['completed','cancelled'].includes(order.status))
  const overdue=active.filter((order)=>order.due_at&&new Date(order.due_at)<new Date())
  const outstanding=orders.reduce((sum,order)=>{
    const total=order.status==='cancelled'?0:Number(order.final_amount??order.quoted_amount??0)
    return sum+Math.max(0,total-Number(order.amount_paid||0))
  },0)
  const completedProfit=orders.filter((order)=>order.status==='completed').reduce((sum,order)=>sum+Number(order.gross_profit||0),0)

  if(loading)return <main className="page-wrap text-muted">Loading service jobs...</main>

  const selectedLines=selected?lines.filter((line)=>line.work_order_id===selected.id):[]
  const selectedEvents=selected?events.filter((event)=>event.work_order_id===selected.id):[]
  const selectedPayments=selected?payments.filter((payment)=>payment.work_order_id===selected.id):[]
  const selectedTotal=selected?Number(selected.final_amount??selected.quoted_amount??0):0
  const selectedBalance=selected?Math.max(0,selectedTotal-Number(selected.amount_paid||0)):0

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Services</p><h1 className="page-title">Jobs & Work Orders</h1><p className="page-subtitle">Quotes, technicians, materials, service charges, payments, profitability and customer job history.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/payments" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Payments</Link><Link href="/catalog" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Service Catalog</Link><Link href="/customers" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Customers</Link></div>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active jobs</p><strong className="mt-2 block text-2xl">{active.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Overdue jobs</p><strong className="mt-2 block text-2xl text-red-500">{overdue.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Job balances due</p><strong className="mt-2 block text-xl text-amber-600">{money(outstanding,currency)}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Completed gross profit</p><strong className="mt-2 block text-xl text-emerald-600">{canSeeProfit?money(completedProfit,currency):'Restricted'}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['jobs','Active jobs'],['new','New job'],['history','History']].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {(tab==='jobs'||tab==='history')&&<section className="space-y-4">
      <input className="input-base max-w-xl" placeholder="Search job number, title, customer, location or status…" value={search} onChange={(event)=>setSearch(event.target.value)}/>
      {!filtered.length&&<div className="page-card p-7 text-center text-sm text-muted">{tab==='history'?'No completed/cancelled jobs yet.':'No active service jobs.'}</div>}
      {filtered.map((order)=>{
        const total=order.status==='cancelled'?0:Number(order.final_amount??order.quoted_amount??0)
        const balance=Math.max(0,total-Number(order.amount_paid||0))
        const assigned=assignments.filter((row)=>row.work_order_id===order.id).map((row)=>staff.find((user)=>user.id===row.user_id)?.full_name).filter(Boolean)
        return <button key={order.id} type="button" onClick={()=>openJob(order)} className="page-card w-full p-4 text-left sm:p-5">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div><div className="flex flex-wrap items-center gap-2"><strong>{order.job_number||'Job'} · {order.title}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{order.status.replaceAll('_',' ')}</span><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${order.priority==='urgent'?'bg-red-500/10 text-red-500':order.priority==='high'?'bg-amber-500/10 text-amber-600':'bg-[var(--panel-2)] text-muted'}`}>{order.priority}</span></div><p className="mt-1 text-sm text-muted">{order.customers?.name||'Walk-in / no customer'} · {order.locations?.name||'Location'}</p><p className="mt-1 text-xs text-muted">{assigned.length?`Assigned: ${assigned.join(', ')}`:'Unassigned'}{order.due_at?` · due ${new Date(order.due_at).toLocaleString()}`:''}</p></div>
            <div className="text-left lg:text-right"><strong className="text-lg">{money(total,currency)}</strong><p className="mt-1 text-xs text-muted">Paid {money(order.amount_paid,currency)}</p>{balance>0.009&&<p className="mt-1 text-xs font-black text-red-500">Balance {money(balance,currency)}</p>}</div>
          </div>
        </button>
      })}
    </section>}

    {tab==='new'&&<form onSubmit={createJob} className="page-card mx-auto max-w-4xl p-5">
      <h2 className="font-black">Create service job</h2><p className="mt-1 text-sm text-muted">Create the job first, then add services, labour, materials, staff and payments from the job workspace.</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-muted">Job title</span><input required className="input-base" value={form.title} onChange={(event)=>setForm({...form,title:event.target.value})} placeholder="e.g. Repair generator / Website maintenance / Hair appointment"/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Customer</span><select className="input-base" value={form.customer_id} onChange={(event)=>setForm({...form,customer_id:event.target.value})}><option value="">Walk-in / no customer</option>{customers.map((customer)=><option key={customer.id} value={customer.id}>{customer.name}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Location</span><select className="input-base" value={form.location_id} onChange={(event)=>setForm({...form,location_id:event.target.value})}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Priority</span><select className="input-base" value={form.priority} onChange={(event)=>setForm({...form,priority:event.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Quoted amount</span><input className="input-base" type="number" min="0" step="0.01" value={form.quoted_amount} onChange={(event)=>setForm({...form,quoted_amount:event.target.value})} placeholder="Optional"/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Scheduled for</span><input className="input-base" type="datetime-local" value={form.scheduled_at} onChange={(event)=>setForm({...form,scheduled_at:event.target.value})}/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Due by</span><input className="input-base" type="datetime-local" value={form.due_at} onChange={(event)=>setForm({...form,due_at:event.target.value})}/></label>
        <label className="sm:col-span-2"><span className="mb-1 block text-xs font-bold text-muted">Description</span><textarea className="input-base min-h-24" value={form.description} onChange={(event)=>setForm({...form,description:event.target.value})} placeholder="Customer request, scope of work, problem description…"/></label>
      </div>
      <div className="mt-5"><p className="text-xs font-black uppercase tracking-wide text-muted">Assign staff / technicians</p><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{staff.map((user)=><label key={user.id} className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={assignedIds.includes(user.id)} onChange={(event)=>setAssignedIds(event.target.checked?[...assignedIds,user.id]:assignedIds.filter((id)=>id!==user.id))}/><span><strong>{user.full_name}</strong><small className="block text-muted capitalize">{user.role.replaceAll('_',' ')}</small></span></label>)}</div></div>
      <textarea className="input-base mt-4 min-h-20" placeholder="Internal notes" value={form.notes} onChange={(event)=>setForm({...form,notes:event.target.value})}/>
      <button disabled={busy||!canManage} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Creating...':canManage?'Create job':'Service management permission required'}</button>
    </form>}

    {selected&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-3 sm:p-8">
      <div className="mx-auto max-w-6xl rounded-3xl bg-[var(--panel)] p-4 shadow-2xl sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 sm:flex-row sm:items-start sm:justify-between">
          <div><div className="flex flex-wrap items-center gap-2"><p className="page-eyebrow">{selected.job_number||'Service job'}</p><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{selected.status.replaceAll('_',' ')}</span></div><h2 className="text-2xl font-black">{selected.title}</h2><p className="mt-1 text-sm text-muted">{selected.customers?.name||'Walk-in / no customer'} · {selected.locations?.name||'Location'}</p></div>
          <div className="flex flex-wrap gap-2"><Link href={`/work-orders/${selected.id}/invoice`} className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Invoice</Link><Link href={`/work-orders/${selected.id}/job-card`} className="btn-secondary rounded-xl px-3 py-2 text-sm font-bold">Job card</Link><button type="button" onClick={()=>setSelected(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div>
        </div>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Job total</span><strong className="mt-1 block">{money(selectedTotal,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Paid</span><strong className="mt-1 block text-emerald-600">{money(selected.amount_paid,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Balance</span><strong className="mt-1 block text-red-500">{money(selectedBalance,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Job cost</span><strong className="mt-1 block">{canSeeProfit?money(selected.final_cost,currency):'Restricted'}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">Gross profit</span><strong className="mt-1 block text-emerald-600">{canSeeProfit?money(selected.gross_profit,currency):'Restricted'}</strong></div>
        </section>

        <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_380px]">
          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--line)] overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Services, labour & materials</strong><p className="mt-1 text-xs text-muted">Material lines deduct stock immediately from {selected.locations?.name||'the job location'}.</p></div>
              <div className="divide-y divide-[var(--line)]">
                {!selectedLines.length&&<p className="p-5 text-sm text-muted">No job charges or materials added yet.</p>}
                {selectedLines.map((line)=><div key={line.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{line.description}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{line.line_type}</span></div><p className="mt-1 text-xs text-muted">{Number(line.quantity).toLocaleString()} × {money(line.unit_price,currency)}{line.products?.sku?` · ${line.products.sku}`:''}</p></div><strong>{money(line.line_total,currency)}</strong>{canManage&&!['completed','cancelled'].includes(selected.status)&&<button disabled={busy} type="button" onClick={()=>removeLine(line.id)} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-black text-red-500">Remove</button>}</div>)}
              </div>
            </section>

            {canManage&&!['completed','cancelled'].includes(selected.status)&&<form onSubmit={addLine} className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="font-black">Add job line</h3>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <select className="input-base" value={lineForm.line_type} onChange={(event)=>setLineForm({line_type:event.target.value,product_id:'',description:'',quantity:'1',unit_price:'',unit_cost:''})}><option value="service">Service</option><option value="labor">Labour</option><option value="material">Material / part</option><option value="other">Other charge</option></select>
                <select className="input-base" value={lineForm.product_id} onChange={(event)=>chooseLineProduct(event.target.value)}><option value="">Custom line / choose catalog item</option>{lineProducts.map((product)=><option key={product.id} value={product.id}>{product.name}{product.sku?` — ${product.sku}`:''}</option>)}</select>
                <input required className="input-base sm:col-span-2" placeholder="Description" value={lineForm.description} onChange={(event)=>setLineForm({...lineForm,description:event.target.value})}/>
                <input required className="input-base" type="number" min="0.001" step="0.001" placeholder="Quantity" value={lineForm.quantity} onChange={(event)=>setLineForm({...lineForm,quantity:event.target.value})}/>
                <input className="input-base" type="number" min="0" step="0.01" placeholder="Customer price / unit" value={lineForm.unit_price} onChange={(event)=>setLineForm({...lineForm,unit_price:event.target.value})}/>
                <input className="input-base sm:col-span-2" type="number" min="0" step="0.01" placeholder="Internal cost / unit" value={lineForm.unit_cost} onChange={(event)=>setLineForm({...lineForm,unit_cost:event.target.value})}/>
              </div>
              <button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Adding...':'Add to job'}</button>
            </form>}

            <section className="rounded-2xl border border-[var(--line)] overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Job timeline</strong></div>
              <div className="max-h-80 divide-y divide-[var(--line)] overflow-y-auto">
                {!selectedEvents.length&&<p className="p-5 text-sm text-muted">No timeline events.</p>}
                {selectedEvents.map((event)=>{const actor=staff.find((user)=>user.id===event.user_id);return <div key={event.id} className="p-4"><strong className="capitalize">{event.event_type.replaceAll('_',' ')}</strong><p className="mt-1 text-sm text-muted">{event.description}</p><p className="mt-1 text-xs text-muted">{actor?.full_name||'System'} · {new Date(event.created_at).toLocaleString()}</p></div>})}
              </div>
            </section>
          </div>

          <div className="space-y-5">
            <section className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="font-black">Job status</h3>
              <p className="mt-1 text-xs text-muted">Scheduled {selected.scheduled_at?new Date(selected.scheduled_at).toLocaleString():'—'} · due {selected.due_at?new Date(selected.due_at).toLocaleString():'—'}</p>
              <textarea className="input-base mt-3 min-h-16" placeholder="Status note (optional)" value={statusNotes} onChange={(event)=>setStatusNotes(event.target.value)}/>
              {canManage&&!['completed','cancelled'].includes(selected.status)&&<div className="mt-3 grid grid-cols-2 gap-2"><button disabled={busy} type="button" onClick={()=>setStatus('in_progress')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">In progress</button><button disabled={busy} type="button" onClick={()=>setStatus('on_hold')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">On hold</button><button disabled={busy} type="button" onClick={()=>setStatus('completed')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">Complete</button></div>}
            </section>

            <section className="rounded-2xl border border-[var(--line)] p-4">
              <div className="flex items-center justify-between gap-3"><div><h3 className="font-black">Assigned staff</h3><p className="mt-1 text-xs text-muted">Technicians, consultants or employees working on this job.</p></div></div>
              <div className="mt-3 max-h-52 space-y-2 overflow-y-auto">{staff.map((user)=><label key={user.id} className="flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input disabled={!canManage||['completed','cancelled'].includes(selected.status)} type="checkbox" checked={assignedIds.includes(user.id)} onChange={(event)=>setAssignedIds(event.target.checked?[...assignedIds,user.id]:assignedIds.filter((id)=>id!==user.id))}/><span>{user.full_name}<small className="ml-2 text-muted capitalize">{user.role.replaceAll('_',' ')}</small></span></label>)}</div>
              {canManage&&!['completed','cancelled'].includes(selected.status)&&<button disabled={busy} type="button" onClick={saveAssignments} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 text-sm font-black">Save assignments</button>}
            </section>

            {canPay&&selectedBalance>0.009&&selected.status!=='cancelled'&&<form onSubmit={recordPayment} className="rounded-2xl border border-[var(--line)] p-4">
              <h3 className="font-black">Receive job payment</h3><p className="mt-1 text-xs text-muted">Cash payments require the receiving user's till to be open.</p>
              <input required className="input-base mt-3" type="number" min="0.01" max={selectedBalance} step="0.01" placeholder="Amount" value={payForm.amount} onChange={(event)=>setPayForm({...payForm,amount:event.target.value})}/>
              <select className="input-base mt-3" value={payForm.method} onChange={(event)=>setPayForm({...payForm,method:event.target.value})}><option value="cash">Cash</option><option value="mobile_money">Mobile Money</option><option value="bank">Bank</option><option value="card">Card</option><option value="cheque">Cheque</option></select>
              <input className="input-base mt-3" placeholder="Reference / transaction ID" value={payForm.reference} onChange={(event)=>setPayForm({...payForm,reference:event.target.value})}/>
              <textarea className="input-base mt-3 min-h-16" placeholder="Payment notes" value={payForm.notes} onChange={(event)=>setPayForm({...payForm,notes:event.target.value})}/>
              <button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Recording...':'Record payment'}</button>
            </form>}

            {canManage&&!['completed','cancelled'].includes(selected.status)&&<form onSubmit={cancelJob} className="rounded-2xl border border-red-500/30 p-4">
              <h3 className="font-black">Refund and cancel job</h3>
              <p className="mt-2 text-sm text-muted">Refund due: <strong>{money(selected.amount_paid,currency)}</strong>. This records money already returned to the customer. Mobile money, card and bank refunds must be completed with the provider first.</p>
              <label className="mt-3 block text-sm">Reason<textarea required className="input-base mt-1" value={cancelForm.reason} onChange={e=>setCancelForm({...cancelForm,reason:e.target.value})}/></label>
              {Number(selected.amount_paid)>0&&<>
                <label className="mt-3 block text-sm">Refund method<select className="input-base mt-1" value={cancelForm.method} onChange={e=>setCancelForm({...cancelForm,method:e.target.value,account:''})}><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile money</option><option value="card">Card</option><option value="cheque">Cheque</option></select></label>
                {cancelForm.method!=='cash'&&<><label className="mt-3 block text-sm">Refund account<select required className="input-base mt-1" value={cancelForm.account} onChange={e=>setCancelForm({...cancelForm,account:e.target.value})}><option value="">Choose account</option>{bankAccounts.filter(a=>a.account_type===(cancelForm.method==='mobile_money'?'mobile_money':'bank')).map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label><label className="mt-3 block text-sm">Completed refund reference<input required className="input-base mt-1" value={cancelForm.reference} onChange={e=>setCancelForm({...cancelForm,reference:e.target.value})}/></label></>}
              </>}
              {selectedLines.some(l=>l.line_type==='material')&&<label className="mt-3 block text-sm">Job materials<select required className="input-base mt-1" value={cancelForm.materials} onChange={e=>setCancelForm({...cancelForm,materials:e.target.value})}><option value="">Choose what happened</option><option value="returned">All issued materials physically returned to stock</option><option value="consumed">Materials consumed or not returned; keep their cost</option></select></label>}
              <button disabled={busy} className="mt-4 w-full rounded-xl bg-red-600 px-4 py-3 font-bold text-white disabled:opacity-50">{busy?'Recording...':'Record refund and cancel job'}</button>
            </form>}

            <section className="rounded-2xl border border-[var(--line)] overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Payments</strong></div>
              <div className="max-h-64 divide-y divide-[var(--line)] overflow-y-auto">{!selectedPayments.length&&<p className="p-4 text-sm text-muted">No payments yet.</p>}{selectedPayments.map((payment)=><div key={payment.id} className="flex justify-between gap-3 p-4"><div><strong className="capitalize">{payment.payment_type.replaceAll('_',' ')}</strong><p className="mt-1 text-xs text-muted">{payment.method.replaceAll('_',' ')} · {new Date(payment.created_at).toLocaleString()}</p></div><strong className={payment.direction==='out'?'text-red-500':'text-emerald-600'}>{payment.direction==='out'?'-':'+'}{money(payment.amount,currency)}</strong></div>)}</div>
            </section>
          </div>
        </div>
      </div>
    </div>}
  </main>
}
