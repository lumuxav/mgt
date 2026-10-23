'use client'

import { useEffect,useMemo,useState } from 'react'
import { adminApi } from '../../lib/adminApi'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { useOnlineStatus } from '../../lib/useOnlineStatus'
import { customerBalanceMap } from '../../lib/balances'

const money=(value,currency='UGX')=>`${Number(value||0).toLocaleString()} ${currency}`
const providerLabel=p=>p==='mtn_momo'?'MTN MoMo':p==='airtel_money'?'Airtel Money':'Payment Gateway'
const statusTone=status=>status==='succeeded'?'bg-emerald-500/10 text-emerald-600':status==='failed'||status==='cancelled'||status==='expired'?'bg-red-500/10 text-red-500':status==='pending'?'bg-amber-500/10 text-amber-600':'bg-[var(--panel-2)] text-muted'

const blankConnection=()=>({
  provider:'mtn_momo',name:'',environment:'sandbox',active:false,country_code:'UG',currency:'UGX',
  public_config:{target_environment:'sandbox',base_url:'',collection_path:'',status_path:'',request_url:'',status_url:'',api_key_header:''},
  credentials:{api_user:'',api_key:'',subscription_key:'',client_id:'',client_secret:'',bearer_token:''},
})

export default function PaymentsPage(){
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [connections,setConnections]=useState([])
  const [transactions,setTransactions]=useState([])
  const [sales,setSales]=useState([])
  const [customers,setCustomers]=useState([])
  const [customerBalances,setCustomerBalances]=useState([])
  const [jobs,setJobs]=useState([])
  const [invoices,setInvoices]=useState([])
  const [orders,setOrders]=useState([])
  const [tab,setTab]=useState('collect')
  const [connectionForm,setConnectionForm]=useState(blankConnection)
  const [editingConnection,setEditingConnection]=useState(null)
  const [collect,setCollect]=useState({connection_id:'',target_key:'',amount:'',payer_phone:'',customer_id:''})
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const canManage=permissions.includes('payments.manage')
  const online=useOnlineStatus()
  const canRequest=permissions.includes('payments.request')
  const currency=context?.organization?.currency||'UGX'

  const load=async()=>{
    setLoading(true);setMessage(null)
    try{
      const ctx=await getPlatformContext()
      setLoading(true)
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [permissionRes,salesRes,customerRes,jobRes,invoiceRes,orderRes,connectionsRes,transactionsRes,balancesRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('sales').select('id,sale_number,customer_id,location_id,total_amount,amount_paid,refunded_amount,payment_status,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(250),
        supabase.from('customers').select('id,name,phone,email,active').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('work_orders').select('id,job_number,title,customer_id,location_id,status,final_amount,quoted_amount,amount_paid,payment_status,created_at').eq('organization_id',org).neq('status','cancelled').order('created_at',{ascending:false}).limit(250),
        supabase.from('project_invoices').select('id,invoice_number,project_id,customer_id,location_id,total_amount,amount_paid,status,created_at').eq('organization_id',org).in('status',['issued','partial']).order('created_at',{ascending:false}).limit(250),
        supabase.from('online_orders').select('id,order_number,customer_id,location_id,total_amount,payment_status,status,customer_name,customer_phone,created_at').eq('organization_id',org).neq('status','cancelled').order('created_at',{ascending:false}).limit(250),
        adminApi('/api/payments/connections'),
        adminApi('/api/payments/transactions'),
        supabase.rpc('get_customer_sales_balances'),
      ])
      for(const r of [permissionRes,salesRes,customerRes,jobRes,invoiceRes,orderRes,balancesRes])if(r.error)throw r.error
      setCustomerBalances(balancesRes.data||[])
      setPermissions((permissionRes.data||[]).map(x=>x.permission))
      setSales(salesRes.data||[]);setCustomers(customerRes.data||[]);setJobs(jobRes.data||[]);setInvoices(invoiceRes.data||[]);setOrders(orderRes.data||[])
      if(connectionsRes.ok){
        setConnections(connectionsRes.connections||[])
        const active=(connectionsRes.connections||[]).find(x=>x.active)
        setCollect(v=>({...v,connection_id:v.connection_id||active?.id||''}))
      }else if(connectionsRes.status!==403)throw new Error(connectionsRes.error||'Could not load payment providers.')
      if(transactionsRes.ok)setTransactions(transactionsRes.transactions||[])
      else if(transactionsRes.status!==403)throw new Error(transactionsRes.error||'Could not load payment transactions.')
    }catch(error){setMessage({type:'error',text:error.message})}
    setLoading(false)
  }

  useEffect(()=>{load()},[])

  const customerMap=useMemo(()=>Object.fromEntries(customers.map(c=>[c.id,c])),[customers])
  const customerDebt=useMemo(()=>{
    return customerBalanceMap(customerBalances)
  },[customerBalances])

  const targets=useMemo(()=>{
    const list=[]
    for(const s of sales){
      const due=Math.max(0,Number(s.total_amount||0)-Number(s.refunded_amount||0)-Number(s.amount_paid||0))
      if(due>0.009)list.push({key:'sale:'+s.id,type:'sale',id:s.id,label:`Sale ${s.sale_number}`,amount:due,customer_id:s.customer_id,phone:customerMap[s.customer_id]?.phone})
    }
    for(const c of customers){
      const due=Number(customerDebt[c.id]||0)
      if(due>0.009)list.push({key:'customer_debt:'+c.id,type:'customer_debt',id:c.id,label:`Customer debt · ${c.name}`,amount:due,customer_id:c.id,phone:c.phone})
    }
    for(const j of jobs){
      const total=Number(j.final_amount||j.quoted_amount||0)
      const due=Math.max(0,total-Number(j.amount_paid||0))
      if(due>0.009)list.push({key:'work_order:'+j.id,type:'work_order',id:j.id,label:`Job ${j.job_number||j.title}`,amount:due,customer_id:j.customer_id,phone:customerMap[j.customer_id]?.phone})
    }
    for(const i of invoices){
      const due=Math.max(0,Number(i.total_amount||0)-Number(i.amount_paid||0))
      if(due>0.009)list.push({key:'project_invoice:'+i.id,type:'project_invoice',id:i.id,label:`Project invoice ${i.invoice_number}`,amount:due,customer_id:i.customer_id,phone:customerMap[i.customer_id]?.phone})
    }
    for(const o of orders){
      if(o.payment_status!=='paid')list.push({key:'online_order:'+o.id,type:'online_order',id:o.id,label:`Online order ${o.order_number}`,amount:Number(o.total_amount||0),customer_id:o.customer_id,phone:o.customer_phone})
    }
    return list
  },[sales,customers,customerDebt,jobs,invoices,orders,customerMap])

  const selectTarget=value=>{
    const target=targets.find(x=>x.key===value)
    setCollect(v=>({...v,target_key:value,amount:target?String(target.amount):'',payer_phone:target?.phone||v.payer_phone,customer_id:target?.customer_id||''}))
  }

  const requestPayment=async e=>{
    e.preventDefault()
    if(!online)return setMessage({type:'error',text:'You are offline. Mobile-money prompts cannot be sent until the connection returns.'})
    const target=targets.find(x=>x.key===collect.target_key)
    if(!target)return setMessage({type:'error',text:'Choose what this payment is for.'})
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/payments/transactions',{method:'POST',body:JSON.stringify({
      connection_id:collect.connection_id,target_type:target.type,target_id:target.id,customer_id:target.customer_id||null,
      amount:Number(collect.amount),payer_phone:collect.payer_phone,currency,
    })})
    if(result.ok){
      setMessage({type:result.warning?'error':'success',text:result.warning||`Payment request ${result.transaction.external_reference} sent. Ask the customer to approve it on their phone.`})
      setTransactions(v=>[result.transaction,...v.filter(x=>x.id!==result.transaction.id)])
      setCollect(v=>({...v,target_key:'',amount:'',payer_phone:'',customer_id:''}))
      setTab('transactions')
    }else setMessage({type:'error',text:result.error||'Could not request payment.'})
    setBusy(false)
  }

  const refreshTransaction=async id=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Provider status cannot be checked until the connection returns.'})
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/payments/transactions/'+id,{method:'POST',body:JSON.stringify({})})
    if(result.ok){
      setTransactions(v=>v.map(x=>x.id===id?result.transaction:x))
      setMessage({type:result.transaction.status==='succeeded'?'success':'info',text:`Payment status: ${result.transaction.status.replaceAll('_',' ')} · settlement ${result.transaction.settlement_status.replaceAll('_',' ')}.`})
      if(result.transaction.status==='succeeded')await load()
    }else setMessage({type:'error',text:result.error||'Could not refresh payment.'})
    setBusy(false)
  }

  const saveConnection=async e=>{
    e.preventDefault();
    if(!online)return setMessage({type:'error',text:'You are offline. Provider settings cannot be changed until the connection returns.'})
    setBusy(true);setMessage(null)
    const payload={
      ...connectionForm,
      public_config:Object.fromEntries(Object.entries(connectionForm.public_config||{}).filter(([,v])=>String(v||'').trim()!=='')),
      credentials:Object.fromEntries(Object.entries(connectionForm.credentials||{}).filter(([,v])=>String(v||'').trim()!=='')),
    }
    const result=await adminApi('/api/payments/connections',{
      method:editingConnection?'PATCH':'POST',
      body:JSON.stringify(editingConnection?{id:editingConnection,...payload}:payload),
    })
    if(result.ok){
      setConnections(result.connections||[]);setConnectionForm(blankConnection());setEditingConnection(null)
      setMessage({type:'success',text:'Payment provider connection saved securely.'})
    }else setMessage({type:'error',text:result.error||'Could not save provider connection.'})
    setBusy(false)
  }

  const editConnection=row=>{
    setEditingConnection(row.id)
    setConnectionForm({
      provider:row.provider,name:row.name,environment:row.environment,active:row.active,country_code:row.country_code||'UG',currency:row.currency||'UGX',
      public_config:{...blankConnection().public_config,...(row.public_config||{})},
      credentials:{...blankConnection().credentials},
    })
  }

  const toggleConnection=async row=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Provider settings cannot be changed until the connection returns.'})
    setBusy(true);setMessage(null)
    const result=await adminApi('/api/payments/connections',{method:'PATCH',body:JSON.stringify({id:row.id,active:!row.active})})
    if(result.ok){setConnections(result.connections||[]);setMessage({type:'success',text:`${row.name} ${row.active?'disabled':'enabled'}.`})}
    else setMessage({type:'error',text:result.error})
    setBusy(false)
  }

  const deleteConnection=async row=>{
    if(!online)return setMessage({type:'error',text:'You are offline. Provider settings cannot be changed until the connection returns.'})
    if(!window.confirm(`Remove ${row.name}? Existing transaction history will be preserved.`))return
    setBusy(true)
    const result=await adminApi('/api/payments/connections',{method:'DELETE',body:JSON.stringify({id:row.id})})
    if(result.ok){setConnections(result.connections||[]);setMessage({type:'success',text:'Payment provider removed/disabled.'})}
    else setMessage({type:'error',text:result.error})
    setBusy(false)
  }

  const pConfig=(key,value)=>setConnectionForm(f=>({...f,public_config:{...f.public_config,[key]:value}}))
  const credential=(key,value)=>setConnectionForm(f=>({...f,credentials:{...f.credentials,[key]:value}}))

  if(loading)return <main className="page-wrap text-muted">Loading payments...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Payments</p><h1 className="page-title">External Payments</h1><p className="page-subtitle">Request and reconcile MTN MoMo, Airtel Money and gateway payments across MGT.</p></div>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':message.type==='success'?'border-emerald-500/30 bg-emerald-500/10 text-emerald-600':'border-blue-500/30 bg-blue-500/10 text-blue-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active providers</p><strong className="mt-2 block text-2xl">{connections.filter(x=>x.active).length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Pending requests</p><strong className="mt-2 block text-2xl text-amber-600">{transactions.filter(x=>x.status==='pending'||x.status==='created').length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Successful payments</p><strong className="mt-2 block text-2xl text-emerald-600">{transactions.filter(x=>x.status==='succeeded').length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Needs reconciliation</p><strong className="mt-2 block text-2xl text-red-500">{transactions.filter(x=>x.settlement_status==='reconciliation_required').length}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {[['collect','Request payment'],['transactions','Transactions'],['providers','Providers']].map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='collect'&&<section className="grid gap-5 xl:grid-cols-[430px_1fr]">
      <form onSubmit={requestPayment} className="page-card h-fit p-5">
        <h2 className="font-black">Request mobile-money payment</h2>
        <p className="mt-1 text-xs leading-5 text-muted">The customer receives a provider prompt and approves the debit on their own phone. MGT never asks for or stores the customer&apos;s PIN.</p>
        <select required className="input-base mt-4" value={collect.connection_id} onChange={e=>setCollect({...collect,connection_id:e.target.value})}><option value="">Choose provider</option>{connections.filter(x=>x.active).map(x=><option key={x.id} value={x.id}>{x.name} · {providerLabel(x.provider)}</option>)}</select>
        <select required className="input-base mt-3" value={collect.target_key} onChange={e=>selectTarget(e.target.value)}><option value="">What is being paid?</option>{targets.map(x=><option key={x.key} value={x.key}>{x.label} · {money(x.amount,currency)}</option>)}</select>
        <input required className="input-base mt-3" type="number" min="0.01" step="0.01" placeholder="Amount" value={collect.amount} onChange={e=>setCollect({...collect,amount:e.target.value})}/>
        <input required className="input-base mt-3" inputMode="tel" placeholder="Customer phone e.g. 0772 123456" value={collect.payer_phone} onChange={e=>setCollect({...collect,payer_phone:e.target.value})}/>
        <button disabled={busy||!online||!canRequest||!connections.some(x=>x.active)} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-40">{busy?'Sending...':'Send payment request'}</button>
        {!connections.some(x=>x.active)&&<p className="mt-3 text-xs text-amber-600">No active payment provider is configured yet. Open the Providers tab first.</p>}
      </form>

      <div className="space-y-4">
        <div className="page-card p-5"><h2 className="font-black">Automatic settlement</h2><p className="mt-2 text-sm leading-6 text-muted">Once the provider confirms a successful payment, MGT posts it to the linked sale, customer debt, service job, project invoice or online order and creates the normal Finance payment record. Provider status and MGT settlement status remain separate so reconciliation problems stay visible.</p></div>
        <div className="page-card p-5"><h2 className="font-black">Uganda number handling</h2><p className="mt-2 text-sm leading-6 text-muted">Local numbers such as 0772… or 0701… are normalized to the international 256 format before the provider request. The provider still decides whether the number belongs to its network and whether the wallet can pay.</p></div>
      </div>
    </section>}

    {tab==='transactions'&&<section className="space-y-3">
      {!transactions.length&&<div className="page-card p-6 text-sm text-muted">No external-payment requests yet.</div>}
      {transactions.map(tx=><article key={tx.id} className="page-card p-4">
        <div className="grid gap-4 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2"><strong>{tx.external_reference}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${statusTone(tx.status)}`}>{tx.status}</span><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{tx.settlement_status.replaceAll('_',' ')}</span></div>
            <p className="mt-1 text-sm">{providerLabel(tx.provider)} · {money(tx.amount,tx.currency)} · {tx.payer_phone||'No phone'}</p>
            <p className="mt-1 text-xs text-muted">{tx.target_type.replaceAll('_',' ')} · created {new Date(tx.created_at).toLocaleString()}{tx.provider_financial_id?` · provider ID ${tx.provider_financial_id}`:''}</p>
            {tx.failure_reason&&<p className="mt-2 text-xs text-red-500">{tx.failure_reason}</p>}
          </div>
          <button disabled={busy||!online||['failed','cancelled','expired'].includes(tx.status)} onClick={()=>refreshTransaction(tx.id)} className="btn-secondary rounded-xl px-4 py-2 text-xs font-black disabled:opacity-40">{tx.status==='succeeded'?'Recheck / reconcile':'Check provider status'}</button>
        </div>
      </article>)}
    </section>}

    {tab==='providers'&&<section className="grid gap-5 xl:grid-cols-[460px_1fr]">
      {canManage&&<form onSubmit={saveConnection} className="page-card h-fit p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="font-black">{editingConnection?'Edit provider':'Add payment provider'}</h2><p className="mt-1 text-xs text-muted">Secrets are encrypted in Supabase Vault and are never returned to the browser.</p></div>{editingConnection&&<button type="button" onClick={()=>{setEditingConnection(null);setConnectionForm(blankConnection())}} className="text-xs font-black text-muted">Cancel</button>}</div>
        <select disabled={Boolean(editingConnection)} className="input-base mt-4" value={connectionForm.provider} onChange={e=>setConnectionForm({...blankConnection(),provider:e.target.value})}><option value="mtn_momo">MTN MoMo</option><option value="airtel_money">Airtel Money</option><option value="gateway">Generic gateway</option></select>
        <input required className="input-base mt-3" placeholder="Connection name" value={connectionForm.name} onChange={e=>setConnectionForm({...connectionForm,name:e.target.value})}/>
        <div className="mt-3 grid grid-cols-2 gap-2"><select className="input-base" value={connectionForm.environment} onChange={e=>setConnectionForm({...connectionForm,environment:e.target.value})}><option value="sandbox">Sandbox / UAT</option><option value="production">Production</option></select><input className="input-base" value={connectionForm.currency} onChange={e=>setConnectionForm({...connectionForm,currency:e.target.value.toUpperCase()})} placeholder="UGX"/></div>
        <label className="mt-3 flex items-center justify-between rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span>Active</span><input type="checkbox" checked={connectionForm.active} onChange={e=>setConnectionForm({...connectionForm,active:e.target.checked})}/></label>

        {connectionForm.provider==='mtn_momo'&&<div className="mt-4 space-y-3"><p className="text-xs font-black uppercase text-muted">MTN credentials</p><input className="input-base" placeholder={editingConnection?'API user — leave blank to keep current':'API user'} value={connectionForm.credentials.api_user} onChange={e=>credential('api_user',e.target.value)}/><input className="input-base" type="password" placeholder={editingConnection?'API key — leave blank to keep current':'API key'} value={connectionForm.credentials.api_key} onChange={e=>credential('api_key',e.target.value)}/><input className="input-base" type="password" placeholder={editingConnection?'Subscription key — leave blank to keep current':'Collection subscription key'} value={connectionForm.credentials.subscription_key} onChange={e=>credential('subscription_key',e.target.value)}/><input className="input-base" placeholder="Target environment e.g. sandbox / mtnuganda" value={connectionForm.public_config.target_environment} onChange={e=>pConfig('target_environment',e.target.value)}/><input className="input-base" placeholder="Optional API base URL override" value={connectionForm.public_config.base_url} onChange={e=>pConfig('base_url',e.target.value)}/></div>}

        {connectionForm.provider==='airtel_money'&&<div className="mt-4 space-y-3"><p className="text-xs font-black uppercase text-muted">Airtel credentials</p><input className="input-base" placeholder={editingConnection?'Client ID — leave blank to keep current':'Client ID'} value={connectionForm.credentials.client_id} onChange={e=>credential('client_id',e.target.value)}/><input className="input-base" type="password" placeholder={editingConnection?'Client secret — leave blank to keep current':'Client secret'} value={connectionForm.credentials.client_secret} onChange={e=>credential('client_secret',e.target.value)}/><input className="input-base" placeholder="Optional API base URL override" value={connectionForm.public_config.base_url} onChange={e=>pConfig('base_url',e.target.value)}/><input className="input-base" placeholder="Collection path override (optional)" value={connectionForm.public_config.collection_path} onChange={e=>pConfig('collection_path',e.target.value)}/><input className="input-base" placeholder="Status path override (optional)" value={connectionForm.public_config.status_path} onChange={e=>pConfig('status_path',e.target.value)}/></div>}

        {connectionForm.provider==='gateway'&&<div className="mt-4 space-y-3"><p className="text-xs font-black uppercase text-muted">Gateway configuration</p><input required className="input-base" placeholder="Request URL" value={connectionForm.public_config.request_url} onChange={e=>pConfig('request_url',e.target.value)}/><input required className="input-base" placeholder="Status URL, use {reference}" value={connectionForm.public_config.status_url} onChange={e=>pConfig('status_url',e.target.value)}/><input className="input-base" type="password" placeholder={editingConnection?'Bearer token — blank keeps current':'Bearer token (optional)'} value={connectionForm.credentials.bearer_token} onChange={e=>credential('bearer_token',e.target.value)}/><input className="input-base" type="password" placeholder={editingConnection?'API key — blank keeps current':'API key (optional)'} value={connectionForm.credentials.api_key} onChange={e=>credential('api_key',e.target.value)}/><input className="input-base" placeholder="API-key header e.g. x-api-key" value={connectionForm.public_config.api_key_header} onChange={e=>pConfig('api_key_header',e.target.value)}/></div>}

        <button disabled={busy||!online} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Saving...':'Save provider connection'}</button>
      </form>}

      <div className="space-y-3">
        {!connections.length&&<div className="page-card p-6 text-sm text-muted">No payment providers configured.</div>}
        {connections.map(row=><article key={row.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{row.name}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${row.active?'bg-emerald-500/10 text-emerald-600':'bg-red-500/10 text-red-500'}`}>{row.active?'active':'disabled'}</span><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{row.environment}</span></div><p className="mt-1 text-sm">{providerLabel(row.provider)}</p><p className="mt-1 text-xs text-muted">{row.country_code} · {row.currency} · updated {new Date(row.updated_at).toLocaleString()}</p></div>{canManage&&<div className="flex flex-wrap gap-2"><button onClick={()=>editConnection(row)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Edit</button><button onClick={()=>toggleConnection(row)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{row.active?'Disable':'Enable'}</button><button onClick={()=>deleteConnection(row)} className="rounded-xl border border-red-500/30 px-3 py-2 text-xs font-black text-red-500">Remove</button></div>}</div></article>)}
      </div>
    </section>}
  </main>
}

