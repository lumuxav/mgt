'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2})+' '+(currency||'UGX')
const today=()=>new Date().toISOString().slice(0,10)
const future=days=>{const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10)}
const newLine=()=>({product_id:'',description:'',quantity:'1',unit_price:'',discount_amount:'0',tax_amount:'0'})

export default function DocumentsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [locations,setLocations]=useState([])
  const [customers,setCustomers]=useState([])
  const [products,setProducts]=useState([])
  const [quotations,setQuotations]=useState([])
  const [sales,setSales]=useState([])
  const [purchases,setPurchases]=useState([])
  const [jobs,setJobs]=useState([])
  const [projectInvoices,setProjectInvoices]=useState([])
  const [deliveries,setDeliveries]=useState([])
  const [payroll,setPayroll]=useState([])
  const [tab,setTab]=useState('library')
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [quote,setQuote]=useState({location_id:'',customer_id:'',issue_date:today(),valid_until:future(14),notes:'',terms:'',lines:[newLine()]})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canManage=permissions.includes('documents.manage')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permRes,locRes,custRes,prodRes,quoteRes,saleRes,purchaseRes,jobRes,invoiceRes,deliveryRes,payrollRes,periodRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('locations').select('id,name').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('customers').select('id,name,phone,email').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('products').select('id,name,sku,selling_price,item_type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('quotations').select('id,quotation_number,customer_id,location_id,status,issue_date,valid_until,total_amount,created_at,customers(name),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(100),
        supabase.from('sales').select('id,sale_number,customer_id,location_id,total_amount,amount_paid,payment_status,created_at,customers(name),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.from('purchases').select('id,purchase_number,supplier_id,location_id,total_amount,status,created_at,suppliers(name),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.from('work_orders').select('id,job_number,title,customer_id,location_id,status,final_amount,created_at,customers(name),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.from('project_invoices').select('id,invoice_number,project_id,customer_id,location_id,status,total_amount,issue_date,projects(project_number,name),customers(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.from('deliveries').select('id,delivery_number,customer_id,source_location_id,status,destination,created_at,customers(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.from('payroll_entries').select('id,user_id,payroll_period_id,net_pay,payment_status,created_at,users(full_name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(30),
        supabase.rpc('get_scoped_payroll_periods').select('id,name'),
      ])
      for(const r of [permRes,locRes,custRes,prodRes,quoteRes,saleRes,purchaseRes,jobRes,invoiceRes,deliveryRes,payrollRes,periodRes])if(r.error)throw r.error
      setPermissions((permRes.data||[]).map(x=>x.permission))
      setLocations(locRes.data||[]);setCustomers(custRes.data||[]);setProducts(prodRes.data||[])
      setQuotations(quoteRes.data||[]);setSales(saleRes.data||[]);setPurchases(purchaseRes.data||[]);setJobs(jobRes.data||[])
      setProjectInvoices(invoiceRes.data||[]);setDeliveries(deliveryRes.data||[]);setPayroll((payrollRes.data||[]).map(row=>({...row,payroll_periods:periodRes.data?.find(period=>period.id===row.payroll_period_id)||null})))
      setQuote(q=>({...q,location_id:q.location_id||ctx.location?.id||locRes.data?.[0]?.id||'',terms:q.terms||ctx.organization.document_terms||''}))
    }catch(error){setMessage({type:'error',text:error.message||'Could not load business documents.'})}
    finally{setLoading(false)}
  }
  useEffect(()=>{load()},[])

  const totals=useMemo(()=>quote.lines.reduce((a,line)=>{
    const qty=Number(line.quantity||0),price=Number(line.unit_price||0),discount=Number(line.discount_amount||0),tax=Number(line.tax_amount||0)
    a.subtotal+=qty*price;a.discount+=discount;a.tax+=tax;a.total+=Math.max(0,qty*price-discount+tax);return a
  },{subtotal:0,discount:0,tax:0,total:0}),[quote.lines])

  const changeLine=(index,key,value)=>setQuote(q=>({...q,lines:q.lines.map((line,i)=>i===index?{...line,[key]:value}:line)}))
  const chooseProduct=(index,id)=>{
    const p=products.find(x=>x.id===id)
    setQuote(q=>({...q,lines:q.lines.map((line,i)=>i===index?{...line,product_id:id,description:p?.name||line.description,unit_price:p?.selling_price??line.unit_price}:line)}))
  }

  const createQuote=async event=>{
    event.preventDefault()
    setBusy(true);setMessage(null)
    const lines=quote.lines.filter(x=>x.description.trim()&&Number(x.quantity)>0).map(x=>({
      product_id:x.product_id||null,description:x.description.trim(),quantity:Number(x.quantity),unit_price:Number(x.unit_price||0),
      discount_amount:Number(x.discount_amount||0),tax_amount:Number(x.tax_amount||0)
    }))
    const {data,error}=await supabase.rpc('create_quotation',{
      p_location_id:quote.location_id||null,p_customer_id:quote.customer_id||null,p_issue_date:quote.issue_date,
      p_valid_until:quote.valid_until||null,p_notes:quote.notes||null,p_terms:quote.terms||null,p_lines:lines
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setMessage({type:'success',text:'Quotation created.'})
      setQuote(q=>({...q,customer_id:'',issue_date:today(),valid_until:future(14),notes:'',lines:[newLine()]}))
      await load();setTab('library')
      if(data)window.setTimeout(()=>{window.location.href='/quotations/'+data},250)
    }
    setBusy(false)
  }

  const updateStatus=async(id,status)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('update_quotation_status',{p_quotation_id:id,p_status:status})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Quotation marked '+status+'.'});await load()}
    setBusy(false)
  }

  if(loading)return <main className="page-wrap text-muted">Loading business documents...</main>

  const groups=[
    {title:'Sales invoices & receipts',rows:sales.map(x=>({id:x.id,title:x.sale_number,subtitle:(x.customers?.name||'Walk-in customer')+' · '+new Date(x.created_at).toLocaleDateString(),amount:x.total_amount,links:[['Invoice','/sales/'+x.id+'/invoice'],['Receipt','/sales/'+x.id+'/receipt']]}))},
    {title:'Purchase orders',rows:purchases.map(x=>({id:x.id,title:x.purchase_number,subtitle:(x.suppliers?.name||'Supplier')+' · '+String(x.status).replaceAll('_',' '),amount:x.total_amount,links:[['Purchase order','/purchasing/'+x.id+'/order']]}))},
    {title:'Service documents',rows:jobs.map(x=>({id:x.id,title:x.job_number||x.title,subtitle:(x.customers?.name||'Customer')+' · '+String(x.status).replaceAll('_',' '),amount:x.final_amount,links:[['Invoice','/work-orders/'+x.id+'/invoice'],['Job card','/work-orders/'+x.id+'/job-card']]}))},
    {title:'Project invoices',rows:projectInvoices.map(x=>({id:x.id,title:x.invoice_number,subtitle:(x.projects?.project_number||'Project')+' · '+(x.customers?.name||'Client'),amount:x.total_amount,links:[['Invoice','/projects/invoices/'+x.id],['Project summary','/projects/'+x.project_id+'/document']]}))},
    {title:'Delivery notes',rows:deliveries.map(x=>({id:x.id,title:x.delivery_number,subtitle:(x.customers?.name||x.destination||'Delivery')+' · '+String(x.status).replaceAll('_',' '),links:[['Delivery note','/deliveries/'+x.id+'/note']]}))},
    {title:'Payslips',rows:payroll.map(x=>({id:x.id,title:x.users?.full_name||'Employee',subtitle:(x.payroll_periods?.name||'Payroll period')+' · '+String(x.payment_status).replaceAll('_',' '),amount:x.net_pay,links:[['Payslip','/hr/payslips/'+x.id]]}))},
  ]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Business documents</p><h1 className="page-title">Documents</h1><p className="page-subtitle">Create quotations and open professional invoices, receipts, purchase orders, delivery notes, statements, payslips, job cards and project documents.</p></div>
      <Link href="/settings/documents" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Document Profile</Link>
    </div>
    {message&&<div className={'mb-5 rounded-xl border px-4 py-3 text-sm '+(message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600')}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <button onClick={()=>setTab('library')} className={'page-card p-4 text-left '+(tab==='library'?'ring-2 ring-[var(--accent)]':'')}><p className="text-xs text-muted">Document library</p><strong className="mt-2 block text-xl">Recent records</strong></button>
      <button onClick={()=>setTab('quotations')} className={'page-card p-4 text-left '+(tab==='quotations'?'ring-2 ring-[var(--accent)]':'')}><p className="text-xs text-muted">Quotations</p><strong className="mt-2 block text-xl">{quotations.length}</strong></button>
      <Link href="/statements/customers" className="page-card p-4"><p className="text-xs text-muted">Customer statements</p><strong className="mt-2 block text-xl">Receivables</strong></Link>
      <Link href="/statements/suppliers" className="page-card p-4"><p className="text-xs text-muted">Supplier statements</p><strong className="mt-2 block text-xl">Payables</strong></Link>
    </section>

    {tab==='library'&&<section className="grid gap-5 xl:grid-cols-2">
      {groups.map(group=><div key={group.title} className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>{group.title}</strong></div><div className="max-h-[520px] divide-y divide-[var(--line)] overflow-y-auto">{!group.rows.length&&<p className="p-5 text-sm text-muted">No records available yet.</p>}{group.rows.slice(0,20).map(row=><div key={row.id} className="p-4"><div className="flex items-start justify-between gap-4"><div><strong>{row.title}</strong><p className="mt-1 text-xs text-muted">{row.subtitle}</p></div>{row.amount!=null&&<strong>{money(row.amount,currency)}</strong>}</div><div className="mt-3 flex flex-wrap gap-2">{row.links.map(([label,href])=><Link key={href} href={href} className="btn-secondary rounded-lg px-3 py-1.5 text-xs font-black">{label}</Link>)}</div></div>)}</div></div>)}
    </section>}

    {tab==='quotations'&&<section className="grid gap-5 xl:grid-cols-[430px_1fr]">
      {canManage&&<form onSubmit={createQuote} className="page-card h-fit p-5">
        <h2 className="font-black">New quotation</h2><p className="mt-1 text-xs text-muted">Build a formal quote using catalog items or free-form service lines.</p>
        <select className="input-base mt-4" value={quote.customer_id} onChange={e=>setQuote({...quote,customer_id:e.target.value})}><option value="">Walk-in / prospective customer</option>{customers.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select required className="input-base mt-3" value={quote.location_id} onChange={e=>setQuote({...quote,location_id:e.target.value})}>{locations.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <div className="mt-3 grid grid-cols-2 gap-2"><label><span className="mb-1 block text-[10px] font-black uppercase text-muted">Issue date</span><input className="input-base" type="date" value={quote.issue_date} onChange={e=>setQuote({...quote,issue_date:e.target.value})}/></label><label><span className="mb-1 block text-[10px] font-black uppercase text-muted">Valid until</span><input className="input-base" type="date" value={quote.valid_until} onChange={e=>setQuote({...quote,valid_until:e.target.value})}/></label></div>
        <div className="mt-4 space-y-3">{quote.lines.map((line,index)=><div key={index} className="rounded-xl bg-[var(--panel-2)] p-3">
          <select className="input-base" value={line.product_id} onChange={e=>chooseProduct(index,e.target.value)}><option value="">Free-form line / select catalog item</option>{products.map(p=><option key={p.id} value={p.id}>{p.name}{p.sku?' · '+p.sku:''}</option>)}</select>
          <input required className="input-base mt-2" placeholder="Description" value={line.description} onChange={e=>changeLine(index,'description',e.target.value)}/>
          <div className="mt-2 grid grid-cols-2 gap-2"><input required className="input-base" type="number" min="0.001" step="0.001" placeholder="Qty" value={line.quantity} onChange={e=>changeLine(index,'quantity',e.target.value)}/><input required className="input-base" type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={e=>changeLine(index,'unit_price',e.target.value)}/></div>
          <div className="mt-2 grid grid-cols-2 gap-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Discount" value={line.discount_amount} onChange={e=>changeLine(index,'discount_amount',e.target.value)}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Tax" value={line.tax_amount} onChange={e=>changeLine(index,'tax_amount',e.target.value)}/></div>
          {quote.lines.length>1&&<button type="button" onClick={()=>setQuote(q=>({...q,lines:q.lines.filter((_,i)=>i!==index)}))} className="mt-2 text-xs font-black text-red-500">Remove line</button>}
        </div>)}</div>
        <button type="button" onClick={()=>setQuote(q=>({...q,lines:[...q.lines,newLine()]}))} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 text-xs font-black">Add line</button>
        <textarea className="input-base mt-3 min-h-20" placeholder="Quotation notes" value={quote.notes} onChange={e=>setQuote({...quote,notes:e.target.value})}/>
        <textarea className="input-base mt-3 min-h-20" placeholder="Terms" value={quote.terms} onChange={e=>setQuote({...quote,terms:e.target.value})}/>
        <div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><div className="flex justify-between"><span>Subtotal</span><strong>{money(totals.subtotal,currency)}</strong></div><div className="mt-1 flex justify-between"><span>Discount</span><strong>{money(totals.discount,currency)}</strong></div><div className="mt-1 flex justify-between"><span>Tax</span><strong>{money(totals.tax,currency)}</strong></div><div className="mt-2 flex justify-between border-t border-[var(--line)] pt-2 text-base"><strong>Total</strong><strong>{money(totals.total,currency)}</strong></div></div>
        <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Creating...':'Create quotation'}</button>
      </form>}

      <div className="space-y-3">{!quotations.length&&<div className="page-card p-6 text-sm text-muted">No quotations yet.</div>}{quotations.map(q=><article key={q.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{q.quotation_number}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase">{q.status}</span></div><p className="mt-1 text-sm">{q.customers?.name||'Prospective / walk-in customer'}</p><p className="mt-1 text-xs text-muted">Issued {q.issue_date}{q.valid_until?' · valid until '+q.valid_until:''} · {q.locations?.name||'Business'}</p></div><strong>{money(q.total_amount,currency)}</strong></div><div className="mt-3 flex flex-wrap gap-2"><Link href={'/quotations/'+q.id} className="btn-primary rounded-lg px-3 py-1.5 text-xs font-black">Open / print</Link>{canManage&&['draft','sent'].includes(q.status)&&<><button disabled={busy} onClick={()=>updateStatus(q.id,'sent')} className="btn-secondary rounded-lg px-3 py-1.5 text-xs font-black">Mark sent</button><button disabled={busy} onClick={()=>updateStatus(q.id,'accepted')} className="btn-secondary rounded-lg px-3 py-1.5 text-xs font-black">Accepted</button><button disabled={busy} onClick={()=>updateStatus(q.id,'rejected')} className="btn-secondary rounded-lg px-3 py-1.5 text-xs font-black">Rejected</button></>}</div></article>)}</div>
    </section>}
  </main>
}
