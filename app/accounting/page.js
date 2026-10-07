'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const today=()=>new Date().toISOString().slice(0,10)
const yearStart=()=>`${new Date().getFullYear()}-01-01`
const money=(value,currency)=>`${Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2})} ${currency||'UGX'}`
const ageBucket=(date)=>{
  const days=Math.max(0,Math.floor((Date.now()-new Date(date).getTime())/86400000))
  if(days<=30)return '0–30'
  if(days<=60)return '31–60'
  if(days<=90)return '61–90'
  return '90+'
}
const signedBalance=(account,debit,credit)=>account?.normal_balance==='credit'?Number(credit||0)-Number(debit||0):Number(debit||0)-Number(credit||0)

export default function AccountingPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [accounts,setAccounts]=useState([])
  const [journals,setJournals]=useState([])
  const [ledger,setLedger]=useState([])
  const [periods,setPeriods]=useState([])
  const [taxCodes,setTaxCodes]=useState([])
  const [settings,setSettings]=useState(null)
  const [expenseMappings,setExpenseMappings]=useState([])
  const [locations,setLocations]=useState([])
  const [sales,setSales]=useState([])
  const [workOrders,setWorkOrders]=useState([])
  const [projectInvoices,setProjectInvoices]=useState([])
  const [purchases,setPurchases]=useState([])
  const [tab,setTab]=useState('overview')
  const [startDate,setStartDate]=useState(yearStart())
  const [endDate,setEndDate]=useState(today())
  const [accountFilter,setAccountFilter]=useState('')
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)
  const [message,setMessage]=useState(null)

  const [accountForm,setAccountForm]=useState({code:'',name:'',account_type:'expense',subtype:'',normal_balance:'debit',cash_flow_category:'operating'})
  const [mappingForm,setMappingForm]=useState({category:'',account_id:''})
  const [journalForm,setJournalForm]=useState({
    journal_date:today(),description:'',reference:'',cash_flow_category:'operating',location_id:'',
    lines:[{account_id:'',debit:'',credit:'',memo:''},{account_id:'',debit:'',credit:'',memo:''}]
  })
  const [periodForm,setPeriodForm]=useState({name:'',start_date:yearStart(),end_date:today()})
  const [taxForm,setTaxForm]=useState({tax_registered:false,tax_number:'',tax_filing_frequency:'monthly',fiscal_year_start_month:'1',accounting_basis:'accrual'})
  const [taxCodeForm,setTaxCodeForm]=useState({code:'',name:'',rate:'',scope:'both'})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const canManage=permissions.includes('accounting.manage')
  const canClose=permissions.includes('accounting.close')
  const canTax=permissions.includes('accounting.tax')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id

      const core=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('accounting_accounts').select('*').eq('organization_id',org).order('code'),
        supabase.from('accounting_journals').select('*').eq('organization_id',org).order('journal_date',{ascending:false}).order('created_at',{ascending:false}).limit(2500),
        supabase.from('accounting_general_ledger_v').select('*').eq('organization_id',org).order('journal_date',{ascending:false}).limit(15000),
        supabase.from('accounting_periods').select('*').eq('organization_id',org).order('start_date',{ascending:false}),
        supabase.from('accounting_tax_codes').select('*').eq('organization_id',org).order('code'),
        supabase.from('accounting_settings').select('*').eq('organization_id',org).maybeSingle(),
        supabase.from('accounting_expense_mappings').select('*').eq('organization_id',org).order('category_key'),
        supabase.from('locations').select('id,name').eq('organization_id',org).eq('active',true).order('name'),
      ])
      for(const r of core)if(r.error)throw r.error

      setPermissions((core[0].data||[]).map(x=>x.permission))
      setAccounts(core[1].data||[])
      setJournals(core[2].data||[])
      setLedger(core[3].data||[])
      setPeriods(core[4].data||[])
      setTaxCodes(core[5].data||[])
      setSettings(core[6].data||null)
      setExpenseMappings(core[7].data||[])
      setLocations(core[8].data||[])

      const sourceResults=await Promise.all([
        supabase.from('sales').select('id,sale_number,customer_id,total_amount,amount_paid,refunded_amount,created_at,customers(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(4000),
        supabase.from('work_orders').select('id,job_number,customer_id,final_amount,amount_paid,due_at,created_at,status,customers(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
        supabase.from('project_invoices').select('id,invoice_number,customer_id,total_amount,amount_paid,due_date,issue_date,status,customers(name)').eq('organization_id',org).order('issue_date',{ascending:false}).limit(3000),
        supabase.from('purchases').select('id,purchase_number,supplier_id,total_amount,amount_paid,due_date,created_at,status,suppliers(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
      ])
      setSales(sourceResults[0].error?[]:(sourceResults[0].data||[]))
      setWorkOrders(sourceResults[1].error?[]:(sourceResults[1].data||[]))
      setProjectInvoices(sourceResults[2].error?[]:(sourceResults[2].data||[]))
      setPurchases(sourceResults[3].error?[]:(sourceResults[3].data||[]))

      const defaultAccount=(core[1].data||[]).find(x=>x.allow_manual_entries)?.id||core[1].data?.[0]?.id||''
      const defaultExpense=(core[1].data||[]).find(x=>x.account_type==='expense')?.id||''
      const defaultLocation=ctx.location?.id||core[8].data?.[0]?.id||''
      setJournalForm(f=>({...f,location_id:f.location_id||defaultLocation,lines:f.lines.map(line=>({...line,account_id:line.account_id||defaultAccount}))}))
      setMappingForm(f=>({...f,account_id:f.account_id||defaultExpense}))
      const s=core[6].data
      if(s)setTaxForm({
        tax_registered:Boolean(s.tax_registered),tax_number:s.tax_number||'',tax_filing_frequency:s.tax_filing_frequency||'monthly',
        fiscal_year_start_month:String(s.fiscal_year_start_month||1),accounting_basis:s.accounting_basis||'accrual'
      })
    }catch(error){setMessage({type:'error',text:error.message||'Could not load accounting.'})}
    finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const rangeLedger=useMemo(()=>ledger.filter(row=>row.journal_date>=startDate&&row.journal_date<=endDate),[ledger,startDate,endDate])
  const asOfLedger=useMemo(()=>ledger.filter(row=>row.journal_date<=endDate),[ledger,endDate])

  const trialBalance=useMemo(()=>{
    const map={}
    for(const row of asOfLedger){
      if(!map[row.account_id])map[row.account_id]={account_id:row.account_id,code:row.account_code,name:row.account_name,type:row.account_type,normal_balance:row.normal_balance,debit:0,credit:0}
      map[row.account_id].debit+=Number(row.debit||0)
      map[row.account_id].credit+=Number(row.credit||0)
    }
    return Object.values(map).map(row=>{
      const net=Number(row.debit)-Number(row.credit)
      return {...row,balance_debit:Math.max(net,0),balance_credit:Math.max(-net,0)}
    }).sort((a,b)=>a.code.localeCompare(b.code))
  },[asOfLedger])

  const statements=useMemo(()=>{
    const plRows=rangeLedger.filter(row=>row.source_type!=='period_close')
    const income=plRows.filter(row=>row.account_type==='income').reduce((s,row)=>s+Number(row.credit||0)-Number(row.debit||0),0)
    const expenses=plRows.filter(row=>row.account_type==='expense').reduce((s,row)=>s+Number(row.debit||0)-Number(row.credit||0),0)
    const assets=asOfLedger.filter(row=>row.account_type==='asset').reduce((s,row)=>s+Number(row.debit||0)-Number(row.credit||0),0)
    const liabilities=asOfLedger.filter(row=>row.account_type==='liability').reduce((s,row)=>s+Number(row.credit||0)-Number(row.debit||0),0)
    const equity=asOfLedger.filter(row=>row.account_type==='equity').reduce((s,row)=>s+Number(row.credit||0)-Number(row.debit||0),0)
    const currentEarnings=asOfLedger.filter(row=>['income','expense'].includes(row.account_type)&&row.source_type!=='period_close').reduce((s,row)=>s+(row.account_type==='income'?Number(row.credit||0)-Number(row.debit||0):-(Number(row.debit||0)-Number(row.credit||0))),0)

    const cashAccounts=new Set(accounts.filter(a=>['1000','1010','1020','1090'].includes(a.code)).map(a=>a.id))
    const cashFlow={operating:0,investing:0,financing:0,noncash:0}
    for(const row of rangeLedger){
      if(!cashAccounts.has(row.account_id))continue
      const key=row.cash_flow_category||'operating'
      cashFlow[key]=(cashFlow[key]||0)+Number(row.debit||0)-Number(row.credit||0)
    }
    const outputTax=rangeLedger.filter(row=>row.account_code==='2100').reduce((s,row)=>s+Number(row.credit||0)-Number(row.debit||0),0)
    const inputTax=rangeLedger.filter(row=>row.account_code==='1150').reduce((s,row)=>s+Number(row.debit||0)-Number(row.credit||0),0)
    return {income,expenses,netIncome:income-expenses,assets,liabilities,equity,currentEarnings,cashFlow,outputTax,inputTax,netTax:outputTax-inputTax}
  },[rangeLedger,asOfLedger,accounts])

  const accountBalances=useMemo(()=>{
    const by={}
    for(const row of asOfLedger){
      by[row.account_id]||(by[row.account_id]={debit:0,credit:0})
      by[row.account_id].debit+=Number(row.debit||0)
      by[row.account_id].credit+=Number(row.credit||0)
    }
    return by
  },[asOfLedger])

  const filteredLedger=useMemo(()=>rangeLedger.filter(row=>!accountFilter||row.account_id===accountFilter),[rangeLedger,accountFilter])

  const ageing=useMemo(()=>{
    const ar=[]
    for(const x of sales){
      const due=Math.max(0,Number(x.total_amount||0)-Number(x.refunded_amount||0)-Number(x.amount_paid||0))
      if(due>0.009)ar.push({id:'sale-'+x.id,type:'Sale',number:x.sale_number||'Sale',party:x.customers?.name||'Customer',date:x.created_at,amount:due})
    }
    for(const x of workOrders){
      if(x.status==='cancelled')continue
      const due=Math.max(0,Number(x.final_amount||0)-Number(x.amount_paid||0))
      if(due>0.009)ar.push({id:'job-'+x.id,type:'Service',number:x.job_number||'Job',party:x.customers?.name||'Customer',date:x.due_at||x.created_at,amount:due})
    }
    for(const x of projectInvoices){
      if(x.status==='void')continue
      const due=Math.max(0,Number(x.total_amount||0)-Number(x.amount_paid||0))
      if(due>0.009)ar.push({id:'project-'+x.id,type:'Project',number:x.invoice_number||'Invoice',party:x.customers?.name||'Customer',date:x.due_date||x.issue_date,amount:due})
    }
    const ap=[]
    for(const x of purchases){
      if(x.status==='cancelled')continue
      const due=Math.max(0,Number(x.total_amount||0)-Number(x.amount_paid||0))
      if(due>0.009)ap.push({id:'purchase-'+x.id,type:'Purchase',number:x.purchase_number||'Purchase',party:x.suppliers?.name||'Supplier',date:x.due_date||x.created_at,amount:due})
    }
    const summarize=rows=>{
      const out={'0–30':0,'31–60':0,'61–90':0,'90+':0}
      rows.forEach(x=>{out[ageBucket(x.date)]+=x.amount})
      return out
    }
    return {ar,ap,arBuckets:summarize(ar),apBuckets:summarize(ap)}
  },[sales,workOrders,projectInvoices,purchases])

  const journalTotals=journalForm.lines.reduce((a,line)=>({debit:a.debit+Number(line.debit||0),credit:a.credit+Number(line.credit||0)}),{debit:0,credit:0})
  const changeLine=(index,key,value)=>setJournalForm(f=>({...f,lines:f.lines.map((line,i)=>i===index?{...line,[key]:value}:line)}))

  const createAccount=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('create_accounting_account',{
      p_code:accountForm.code,p_name:accountForm.name,p_account_type:accountForm.account_type,p_subtype:accountForm.subtype||null,
      p_normal_balance:accountForm.normal_balance,p_cash_flow_category:accountForm.cash_flow_category
    })
    if(error)setMessage({type:'error',text:error.message})
    else{setAccountForm({code:'',name:'',account_type:'expense',subtype:'',normal_balance:'debit',cash_flow_category:'operating'});setMessage({type:'success',text:'Account created.'});await load()}
    setBusy(false)
  }

  const saveMapping=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('set_expense_account_mapping',{p_category:mappingForm.category,p_account_id:mappingForm.account_id})
    if(error)setMessage({type:'error',text:error.message})
    else{setMappingForm(f=>({...f,category:''}));setMessage({type:'success',text:'Expense category mapping saved.'});await load()}
    setBusy(false)
  }

  const postJournal=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    if(Math.abs(journalTotals.debit-journalTotals.credit)>0.009||journalTotals.debit<=0){
      setMessage({type:'error',text:'Journal debits and credits must be equal and greater than zero.'});setBusy(false);return
    }
    const lines=journalForm.lines.filter(x=>Number(x.debit||0)>0||Number(x.credit||0)>0).map(x=>({
      account_id:x.account_id,debit:Number(x.debit||0),credit:Number(x.credit||0),memo:x.memo||null
    }))
    const {error}=await supabase.rpc('post_manual_journal',{
      p_journal_date:journalForm.journal_date,p_description:journalForm.description,p_reference:journalForm.reference||null,
      p_lines:lines,p_cash_flow_category:journalForm.cash_flow_category,p_location_id:journalForm.location_id||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      const first=accounts.find(x=>x.allow_manual_entries)?.id||accounts[0]?.id||''
      setJournalForm(f=>({...f,description:'',reference:'',lines:[{account_id:first,debit:'',credit:'',memo:''},{account_id:first,debit:'',credit:'',memo:''}]}))
      setMessage({type:'success',text:'Balanced journal posted.'});await load()
    }
    setBusy(false)
  }

  const reverseJournal=async journal=>{
    const reason=window.prompt('Reason for reversing '+journal.journal_number+':','Correction')
    if(reason===null)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('reverse_accounting_journal',{p_journal_id:journal.id,p_reverse_date:today(),p_reason:reason})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Journal reversed with a balancing reversal entry.'});await load()}
    setBusy(false)
  }

  const createPeriod=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('create_accounting_period',{p_name:periodForm.name,p_start_date:periodForm.start_date,p_end_date:periodForm.end_date})
    if(error)setMessage({type:'error',text:error.message});else{setPeriodForm({name:'',start_date:yearStart(),end_date:today()});setMessage({type:'success',text:'Accounting period created.'});await load()}
    setBusy(false)
  }

  const changePeriod=async(period,action)=>{
    if(action==='close'&&!window.confirm('Close '+period.name+'? Transactions dated inside this period will be locked.'))return
    setBusy(true);setMessage(null)
    const fn=action==='close'?'close_accounting_period':'reopen_accounting_period'
    const {error}=await supabase.rpc(fn,{p_period_id:period.id})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:action==='close'?'Period closed.':'Period reopened.'});await load()}
    setBusy(false)
  }

  const saveTaxSettings=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('save_accounting_tax_settings',{
      p_tax_registered:taxForm.tax_registered,p_tax_number:taxForm.tax_number||null,p_filing_frequency:taxForm.tax_filing_frequency,
      p_fiscal_year_start_month:Number(taxForm.fiscal_year_start_month),p_accounting_basis:taxForm.accounting_basis
    })
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Accounting and tax settings saved.'});await load()}
    setBusy(false)
  }

  const saveTaxCode=async event=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('save_accounting_tax_code',{
      p_id:null,p_code:taxCodeForm.code,p_name:taxCodeForm.name,p_rate:Number(taxCodeForm.rate||0),p_scope:taxCodeForm.scope,p_active:true
    })
    if(error)setMessage({type:'error',text:error.message});else{setTaxCodeForm({code:'',name:'',rate:'',scope:'both'});setMessage({type:'success',text:'Tax code saved.'});await load()}
    setBusy(false)
  }

  if(loading)return <main className="page-wrap text-muted">Loading accounting...</main>

  const tabs=[
    ['overview','Overview'],['accounts','Chart of Accounts'],['journals','Journals'],['ledger','General Ledger'],
    ['trial','Trial Balance'],['statements','Statements'],['ageing','AR / AP Ageing'],['tax','Tax / VAT'],['periods','Periods']
  ]

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Advanced finance</p><h1 className="page-title">Accounting</h1><p className="page-subtitle">Double-entry journals, general ledger, trial balance, financial statements, ageing, tax controls and period close.</p></div>
      <Link href="/cashbook" className="btn-secondary rounded-xl px-4 py-2.5 text-sm font-black">Cash & Finance</Link>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 page-card p-4">
      <div className="flex flex-wrap items-end gap-3">
        <label><span className="mb-1 block text-xs font-bold text-muted">Statement from</span><input className="input-base" type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Statement to / as of</span><input className="input-base" type="date" value={endDate} onChange={e=>setEndDate(e.target.value)}/></label>
        <button type="button" className="btn-secondary rounded-xl px-3 py-2.5 text-xs font-black" onClick={()=>{setStartDate(yearStart());setEndDate(today())}}>This year</button>
      </div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      {tabs.map(([key,label])=><button key={key} onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
    </div>

    {tab==='overview'&&<section className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Assets · as of {endDate}</p><strong className="mt-2 block text-xl">{money(statements.assets,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Liabilities</p><strong className="mt-2 block text-xl">{money(statements.liabilities,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Net income · selected period</p><strong className={`mt-2 block text-xl ${statements.netIncome>=0?'text-emerald-600':'text-red-500'}`}>{money(statements.netIncome,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Tax / VAT position</p><strong className={`mt-2 block text-xl ${statements.netTax>0?'text-amber-600':'text-emerald-600'}`}>{money(statements.netTax,currency)}</strong><p className="mt-1 text-xs text-muted">{statements.netTax>0?'Net output tax payable':'Input tax exceeds output tax'}</p></div>
      </div>
      <div className="grid gap-5 xl:grid-cols-2">
        <div className="page-card p-5"><h2 className="font-black">Accounting engine</h2><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-4"><span className="text-muted">Chart accounts</span><strong>{accounts.length}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Journal entries</span><strong>{journals.length}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Ledger lines loaded</span><strong>{ledger.length}</strong></div><div className="flex justify-between gap-4"><span className="text-muted">Closed periods</span><strong>{periods.filter(x=>x.status==='closed').length}</strong></div></div></div>
        <div className="page-card p-5"><h2 className="font-black">Automatic posting coverage</h2><p className="mt-2 text-sm leading-6 text-muted">MGT automatically posts completed sales, returns, received purchases, customer and supplier payments, expenses, completed service jobs, project invoices, cash-to-bank movements and standalone bank adjustments into balanced journals.</p><p className="mt-3 text-xs text-muted">Manual journals are reserved for accountant adjustments, opening balances, depreciation, accruals and classifications that are not created by an operational module.</p></div>
      </div>
    </section>}

    {tab==='accounts'&&<section className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="space-y-5">
        {canManage&&<form onSubmit={createAccount} className="page-card p-5"><h2 className="font-black">Add account</h2><div className="mt-4 grid grid-cols-[100px_1fr] gap-2"><input required className="input-base" placeholder="Code" value={accountForm.code} onChange={e=>setAccountForm({...accountForm,code:e.target.value})}/><input required className="input-base" placeholder="Account name" value={accountForm.name} onChange={e=>setAccountForm({...accountForm,name:e.target.value})}/></div><select className="input-base mt-3" value={accountForm.account_type} onChange={e=>setAccountForm({...accountForm,account_type:e.target.value,normal_balance:['asset','expense'].includes(e.target.value)?'debit':'credit'})}><option value="asset">Asset</option><option value="liability">Liability</option><option value="equity">Equity</option><option value="income">Income</option><option value="expense">Expense</option></select><input className="input-base mt-3" placeholder="Subtype (optional)" value={accountForm.subtype} onChange={e=>setAccountForm({...accountForm,subtype:e.target.value})}/><select className="input-base mt-3" value={accountForm.normal_balance} onChange={e=>setAccountForm({...accountForm,normal_balance:e.target.value})}><option value="debit">Debit normal balance</option><option value="credit">Credit normal balance</option></select><select className="input-base mt-3" value={accountForm.cash_flow_category} onChange={e=>setAccountForm({...accountForm,cash_flow_category:e.target.value})}><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option><option value="noncash">Non-cash</option></select><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Create account</button></form>}
        {canManage&&<form onSubmit={saveMapping} className="page-card p-5"><h2 className="font-black">Expense category mapping</h2><p className="mt-1 text-xs text-muted">Map recurring expense categories to a specific expense account instead of the default Operating Expenses account.</p><input required className="input-base mt-4" placeholder="Category exactly as used in Finance" value={mappingForm.category} onChange={e=>setMappingForm({...mappingForm,category:e.target.value})}/><select required className="input-base mt-3" value={mappingForm.account_id} onChange={e=>setMappingForm({...mappingForm,account_id:e.target.value})}>{accounts.filter(a=>a.account_type==='expense').map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><button disabled={busy} className="btn-secondary mt-4 w-full rounded-xl px-4 py-3 font-black">Save mapping</button></form>}
      </div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Chart of Accounts</strong></div><div className="divide-y divide-[var(--line)]">{accounts.map(account=>{const b=accountBalances[account.id]||{debit:0,credit:0};return <div key={account.id} className="grid gap-3 p-4 sm:grid-cols-[90px_1fr_auto] sm:items-center"><strong>{account.code}</strong><div><strong>{account.name}</strong><p className="mt-1 text-xs capitalize text-muted">{account.account_type} · {account.subtype?.replaceAll('_',' ')||'general'} · {account.normal_balance} normal{account.system_code?' · system':''}</p></div><strong>{money(signedBalance(account,b.debit,b.credit),currency)}</strong></div>})}</div></div>
    </section>}

    {tab==='journals'&&<section className="grid gap-5 xl:grid-cols-[440px_1fr]">
      {canManage&&<form onSubmit={postJournal} className="page-card h-fit p-5"><h2 className="font-black">Post manual journal</h2><p className="mt-1 text-xs text-muted">Use for adjustments, opening balances, depreciation and accruals. Operational transactions post automatically.</p><div className="mt-4 grid grid-cols-2 gap-2"><input required className="input-base" type="date" value={journalForm.journal_date} onChange={e=>setJournalForm({...journalForm,journal_date:e.target.value})}/><select className="input-base" value={journalForm.location_id} onChange={e=>setJournalForm({...journalForm,location_id:e.target.value})}><option value="">Business-wide</option>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</select></div><input required className="input-base mt-3" placeholder="Description" value={journalForm.description} onChange={e=>setJournalForm({...journalForm,description:e.target.value})}/><input className="input-base mt-3" placeholder="Reference" value={journalForm.reference} onChange={e=>setJournalForm({...journalForm,reference:e.target.value})}/><select className="input-base mt-3" value={journalForm.cash_flow_category} onChange={e=>setJournalForm({...journalForm,cash_flow_category:e.target.value})}><option value="operating">Operating</option><option value="investing">Investing</option><option value="financing">Financing</option><option value="noncash">Non-cash</option></select><div className="mt-4 space-y-3">{journalForm.lines.map((line,index)=><div key={index} className="rounded-xl bg-[var(--panel-2)] p-3"><select required className="input-base" value={line.account_id} onChange={e=>changeLine(index,'account_id',e.target.value)}>{accounts.filter(a=>a.allow_manual_entries).map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><div className="mt-2 grid grid-cols-2 gap-2"><input className="input-base" type="number" min="0" step="0.01" placeholder="Debit" value={line.debit} onChange={e=>changeLine(index,'debit',e.target.value)}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Credit" value={line.credit} onChange={e=>changeLine(index,'credit',e.target.value)}/></div><input className="input-base mt-2" placeholder="Memo" value={line.memo} onChange={e=>changeLine(index,'memo',e.target.value)}/>{journalForm.lines.length>2&&<button type="button" onClick={()=>setJournalForm(f=>({...f,lines:f.lines.filter((_,i)=>i!==index)}))} className="mt-2 text-xs font-black text-red-500">Remove line</button>}</div>)}</div><button type="button" onClick={()=>setJournalForm(f=>({...f,lines:[...f.lines,{account_id:accounts.find(a=>a.allow_manual_entries)?.id||'',debit:'',credit:'',memo:''}]}))} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 text-xs font-black">Add journal line</button><div className="mt-3 flex justify-between rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span>Debit {money(journalTotals.debit,currency)}</span><span>Credit {money(journalTotals.credit,currency)}</span></div><button disabled={busy||Math.abs(journalTotals.debit-journalTotals.credit)>0.009||journalTotals.debit<=0} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black disabled:opacity-40">Post balanced journal</button></form>}
      <div className="space-y-3">{!journals.length&&<div className="page-card p-6 text-sm text-muted">No journals posted yet.</div>}{journals.map(j=><article key={j.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{j.journal_number}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase">{j.source_type.replaceAll('_',' ')}</span><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${j.status==='reversed'?'bg-red-500/10 text-red-500':'bg-emerald-500/10 text-emerald-600'}`}>{j.status}</span></div><p className="mt-1 text-sm">{j.description}</p><p className="mt-1 text-xs text-muted">{j.journal_date}{j.reference?' · '+j.reference:''}</p></div>{canManage&&j.status==='posted'&&j.source_type!=='period_close'&&<button disabled={busy} onClick={()=>reverseJournal(j)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Reverse</button>}</div></article>)}</div>
    </section>}

    {tab==='ledger'&&<section className="space-y-4"><select className="input-base max-w-md" value={accountFilter} onChange={e=>setAccountFilter(e.target.value)}><option value="">All accounts</option>{accounts.map(a=><option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select><div className="page-card overflow-hidden"><div className="max-h-[760px] divide-y divide-[var(--line)] overflow-y-auto">{!filteredLedger.length&&<p className="p-5 text-sm text-muted">No ledger activity in this period.</p>}{filteredLedger.map(row=><div key={row.line_id} className="grid gap-2 p-4 text-sm md:grid-cols-[110px_110px_1fr_130px_130px]"><span>{row.journal_date}</span><strong>{row.account_code}</strong><div><strong>{row.account_name}</strong><p className="text-xs text-muted">{row.description} · {row.source_type.replaceAll('_',' ')}</p></div><span className="text-right">{Number(row.debit)>0?money(row.debit,currency):'—'}</span><span className="text-right">{Number(row.credit)>0?money(row.credit,currency):'—'}</span></div>)}</div></div></section>}

    {tab==='trial'&&<section className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Trial Balance · as of {endDate}</strong></div><div className="divide-y divide-[var(--line)]">{trialBalance.map(row=><div key={row.account_id} className="grid grid-cols-[90px_1fr_130px_130px] gap-3 p-4 text-sm"><strong>{row.code}</strong><span>{row.name}</span><strong className="text-right">{row.balance_debit?money(row.balance_debit,currency):'—'}</strong><strong className="text-right">{row.balance_credit?money(row.balance_credit,currency):'—'}</strong></div>)}</div><div className="grid grid-cols-[1fr_130px_130px] gap-3 border-t-2 border-[var(--line)] p-4"><strong>Total</strong><strong className="text-right">{money(trialBalance.reduce((s,x)=>s+x.balance_debit,0),currency)}</strong><strong className="text-right">{money(trialBalance.reduce((s,x)=>s+x.balance_credit,0),currency)}</strong></div></section>}

    {tab==='statements'&&<section className="grid gap-5 xl:grid-cols-3">
      <div className="page-card p-5"><h2 className="font-black">Profit & Loss</h2><p className="mt-1 text-xs text-muted">{startDate} to {endDate}</p><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span>Income</span><strong>{money(statements.income,currency)}</strong></div><div className="flex justify-between"><span>Expenses</span><strong>{money(statements.expenses,currency)}</strong></div><div className="flex justify-between border-t border-[var(--line)] pt-3"><strong>Net profit / loss</strong><strong className={statements.netIncome>=0?'text-emerald-600':'text-red-500'}>{money(statements.netIncome,currency)}</strong></div></div></div>
      <div className="page-card p-5"><h2 className="font-black">Balance Sheet</h2><p className="mt-1 text-xs text-muted">As of {endDate}</p><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span>Assets</span><strong>{money(statements.assets,currency)}</strong></div><div className="flex justify-between"><span>Liabilities</span><strong>{money(statements.liabilities,currency)}</strong></div><div className="flex justify-between"><span>Posted equity</span><strong>{money(statements.equity,currency)}</strong></div><div className="flex justify-between"><span>Open-period earnings</span><strong>{money(statements.currentEarnings,currency)}</strong></div><div className="flex justify-between border-t border-[var(--line)] pt-3"><strong>Liabilities + equity + earnings</strong><strong>{money(statements.liabilities+statements.equity+statements.currentEarnings,currency)}</strong></div></div></div>
      <div className="page-card p-5"><h2 className="font-black">Cash Flow</h2><p className="mt-1 text-xs text-muted">Direct movement · selected period</p><div className="mt-5 space-y-3 text-sm"><div className="flex justify-between"><span>Operating</span><strong>{money(statements.cashFlow.operating,currency)}</strong></div><div className="flex justify-between"><span>Investing</span><strong>{money(statements.cashFlow.investing,currency)}</strong></div><div className="flex justify-between"><span>Financing</span><strong>{money(statements.cashFlow.financing,currency)}</strong></div><div className="flex justify-between border-t border-[var(--line)] pt-3"><strong>Net cash movement</strong><strong>{money(statements.cashFlow.operating+statements.cashFlow.investing+statements.cashFlow.financing,currency)}</strong></div></div></div>
    </section>}

    {tab==='ageing'&&<section className="space-y-5">
      <div className="grid gap-5 xl:grid-cols-2">{[['Accounts Receivable',ageing.arBuckets],['Accounts Payable',ageing.apBuckets]].map(([title,buckets])=><div key={title} className="page-card p-5"><h2 className="font-black">{title} ageing</h2><div className="mt-4 grid grid-cols-2 gap-3">{Object.entries(buckets).map(([bucket,value])=><div key={bucket} className="rounded-xl bg-[var(--panel-2)] p-4"><span className="text-xs text-muted">{bucket} days</span><strong className="mt-1 block">{money(value,currency)}</strong></div>)}</div></div>)}</div>
      <div className="grid gap-5 xl:grid-cols-2"><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Receivables detail</strong></div><div className="max-h-[520px] divide-y divide-[var(--line)] overflow-y-auto">{!ageing.ar.length&&<p className="p-5 text-sm text-muted">No current receivables.</p>}{ageing.ar.map(x=><div key={x.id} className="flex justify-between gap-4 p-4 text-sm"><div><strong>{x.party}</strong><p className="text-xs text-muted">{x.type} · {x.number} · {ageBucket(x.date)} days</p></div><strong>{money(x.amount,currency)}</strong></div>)}</div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Payables detail</strong></div><div className="max-h-[520px] divide-y divide-[var(--line)] overflow-y-auto">{!ageing.ap.length&&<p className="p-5 text-sm text-muted">No current supplier payables.</p>}{ageing.ap.map(x=><div key={x.id} className="flex justify-between gap-4 p-4 text-sm"><div><strong>{x.party}</strong><p className="text-xs text-muted">{x.number} · {ageBucket(x.date)} days</p></div><strong>{money(x.amount,currency)}</strong></div>)}</div></div></div>
    </section>}

    {tab==='tax'&&<section className="grid gap-5 xl:grid-cols-[400px_1fr]">
      <div className="space-y-5">{canTax&&<form onSubmit={saveTaxSettings} className="page-card p-5"><h2 className="font-black">Tax & accounting settings</h2><label className="mt-4 flex items-center gap-2 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><input type="checkbox" checked={taxForm.tax_registered} onChange={e=>setTaxForm({...taxForm,tax_registered:e.target.checked})}/> Tax / VAT registered</label><input className="input-base mt-3" placeholder="Tax registration number" value={taxForm.tax_number} onChange={e=>setTaxForm({...taxForm,tax_number:e.target.value})}/><select className="input-base mt-3" value={taxForm.tax_filing_frequency} onChange={e=>setTaxForm({...taxForm,tax_filing_frequency:e.target.value})}><option value="monthly">Monthly filing</option><option value="quarterly">Quarterly filing</option><option value="annual">Annual filing</option></select><select className="input-base mt-3" value={taxForm.accounting_basis} onChange={e=>setTaxForm({...taxForm,accounting_basis:e.target.value})}><option value="accrual">Accrual accounting</option><option value="cash">Cash accounting</option></select><input className="input-base mt-3" type="number" min="1" max="12" value={taxForm.fiscal_year_start_month} onChange={e=>setTaxForm({...taxForm,fiscal_year_start_month:e.target.value})}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Save settings</button></form>}
      {canTax&&<form onSubmit={saveTaxCode} className="page-card p-5"><h2 className="font-black">Add tax code</h2><div className="mt-4 grid grid-cols-2 gap-2"><input required className="input-base" placeholder="Code" value={taxCodeForm.code} onChange={e=>setTaxCodeForm({...taxCodeForm,code:e.target.value})}/><input required className="input-base" placeholder="Name" value={taxCodeForm.name} onChange={e=>setTaxCodeForm({...taxCodeForm,name:e.target.value})}/></div><div className="mt-3 grid grid-cols-2 gap-2"><input required className="input-base" type="number" min="0" step="0.01" placeholder="Rate %" value={taxCodeForm.rate} onChange={e=>setTaxCodeForm({...taxCodeForm,rate:e.target.value})}/><select className="input-base" value={taxCodeForm.scope} onChange={e=>setTaxCodeForm({...taxCodeForm,scope:e.target.value})}><option value="both">Sales & purchases</option><option value="sales">Sales only</option><option value="purchase">Purchases only</option></select></div><button disabled={busy} className="btn-secondary mt-4 w-full rounded-xl px-4 py-3 font-black">Save tax code</button></form>}</div>
      <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-3"><div className="page-card p-4"><p className="text-xs text-muted">Output tax</p><strong className="mt-2 block">{money(statements.outputTax,currency)}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Input tax recoverable</p><strong className="mt-2 block">{money(statements.inputTax,currency)}</strong></div><div className="page-card p-4"><p className="text-xs text-muted">Net tax position</p><strong className="mt-2 block">{money(statements.netTax,currency)}</strong></div></div><div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Configured tax codes</strong></div><div className="divide-y divide-[var(--line)]">{!taxCodes.length&&<p className="p-5 text-sm text-muted">No tax codes configured. Product tax rates continue to drive operational tax amounts until codes are configured.</p>}{taxCodes.map(code=><div key={code.id} className="flex justify-between gap-4 p-4"><div><strong>{code.code} · {code.name}</strong><p className="mt-1 text-xs capitalize text-muted">{code.scope} · {code.active?'active':'inactive'}</p></div><strong>{Number(code.rate).toLocaleString()}%</strong></div>)}</div></div></div>
    </section>}

    {tab==='periods'&&<section className="grid gap-5 xl:grid-cols-[360px_1fr]">{canClose&&<form onSubmit={createPeriod} className="page-card h-fit p-5"><h2 className="font-black">Create accounting period</h2><p className="mt-1 text-xs text-muted">Periods cannot overlap. Closing locks new accounting entries dated inside that period and transfers period earnings to retained earnings.</p><input required className="input-base mt-4" placeholder="Period name e.g. October 2026" value={periodForm.name} onChange={e=>setPeriodForm({...periodForm,name:e.target.value})}/><input required className="input-base mt-3" type="date" value={periodForm.start_date} onChange={e=>setPeriodForm({...periodForm,start_date:e.target.value})}/><input required className="input-base mt-3" type="date" value={periodForm.end_date} onChange={e=>setPeriodForm({...periodForm,end_date:e.target.value})}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Create period</button></form>}<div className="space-y-3">{!periods.length&&<div className="page-card p-6 text-sm text-muted">No accounting periods created yet.</div>}{periods.map(period=><article key={period.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2"><strong>{period.name}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${period.status==='closed'?'bg-red-500/10 text-red-500':'bg-emerald-500/10 text-emerald-600'}`}>{period.status}</span></div><p className="mt-1 text-xs text-muted">{period.start_date} → {period.end_date}{period.closed_at?' · closed '+new Date(period.closed_at).toLocaleString():''}</p></div>{canClose&&<button disabled={busy} onClick={()=>changePeriod(period,period.status==='closed'?'reopen':'close')} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{period.status==='closed'?'Reopen':'Close period'}</button>}</div></article>)}</div></section>}
  </main>
}
