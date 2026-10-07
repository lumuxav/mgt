'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money = (value, currency) => `${Number(value || 0).toLocaleString()} ${currency || ''}`.trim()
const sameDay = (value, date = new Date()) => new Date(value).toDateString() === date.toDateString()

export default function FinancePage() {
  const business = getBusinessConfig()
  const [context,setContext] = useState(null)
  const [permissions,setPermissions] = useState([])
  const [locations,setLocations] = useState([])
  const [expenses,setExpenses] = useState([])
  const [bankAccounts,setBankAccounts] = useState([])
  const [bankTx,setBankTx] = useState([])
  const [payments,setPayments] = useState([])
  const [tills,setTills] = useState([])
  const [tab,setTab] = useState('overview')
  const [message,setMessage] = useState(null)
  const [loading,setLoading] = useState(true)
  const [busy,setBusy] = useState(false)

  const [expense,setExpense] = useState({ location_id:'', category:'Other', description:'', amount:'', payment_method:'cash', bank_account_id:'', reference:'', notes:'' })
  const [accountForm,setAccountForm] = useState({ name:'', account_type:'bank', provider:'', account_reference:'', opening_balance:'' })
  const [bankForm,setBankForm] = useState({ bank_account_id:'', location_id:'', transaction_type:'deposit', amount:'', reference:'', notes:'' })
  const [bankTill,setBankTill] = useState({ till_session_id:'', bank_account_id:'', amount:'', reference:'', notes:'' })

  const currency = context?.organization?.currency || business.currency || 'UGX'
  const canManage = permissions.includes('finance.manage')

  const load = async () => {
    setLoading(true)
    try {
      const ctx = await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id) throw new Error('Complete business setup first.')
      const org = ctx.organization.id

      const [permRes,locationRes,expenseRes,accountRes,bankRes,paymentRes,tillRes] = await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('expenses').select('id,location_id,category,description,amount,payment_method,reference,notes,recorded_by,created_at,locations(name),users!expenses_recorded_by_fkey(full_name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(500),
        supabase.from('bank_accounts').select('id,name,account_type,provider,account_reference,opening_balance,active,created_at').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('banking_transactions').select('id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by,created_at,bank_accounts(name),locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(800),
        supabase.from('payments').select('id,location_id,customer_id,supplier_id,sale_id,purchase_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id,created_at,locations(name)').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
        supabase.from('till_sessions').select('id,location_id,user_id,status,opening_cash,expected_cash,counted_cash,variance,opened_at,closed_at,locations(name),users(full_name)').eq('organization_id',org).order('opened_at',{ascending:false}).limit(300),
      ])

      for(const result of [permRes,locationRes,expenseRes,accountRes,bankRes,paymentRes,tillRes]) if(result.error) throw result.error

      setPermissions((permRes.data || []).map((row)=>row.permission))
      setLocations(locationRes.data || [])
      setExpenses(expenseRes.data || [])
      setBankAccounts(accountRes.data || [])
      setBankTx(bankRes.data || [])
      setPayments(paymentRes.data || [])
      setTills(tillRes.data || [])

      const defaultLocation = ctx.location?.id || locationRes.data?.[0]?.id || ''
      const defaultAccount = accountRes.data?.[0]?.id || ''
      setExpense((value)=>({...value,location_id:value.location_id || defaultLocation,bank_account_id:value.bank_account_id || defaultAccount}))
      setBankForm((value)=>({...value,location_id:value.location_id || defaultLocation,bank_account_id:value.bank_account_id || defaultAccount}))
      setBankTill((value)=>({...value,bank_account_id:value.bank_account_id || defaultAccount}))
    } catch(error) {
      setMessage({type:'error',text:error.message || 'Could not load finance.'})
    } finally {
      setLoading(false)
    }
  }

  useEffect(()=>{load()},[])

  const bankBalances = useMemo(()=>{
    const map={}
    for(const account of bankAccounts){
      const movement = bankTx.filter((tx)=>tx.bank_account_id===account.id).reduce((sum,tx)=>sum + (tx.transaction_type==='withdrawal' ? -Number(tx.amount||0) : Number(tx.amount||0)),0)
      map[account.id]=Number(account.opening_balance||0)+movement
    }
    return map
  },[bankAccounts,bankTx])

  const openTills = tills.filter((till)=>till.status==='open')
  const todayIn = payments.filter((payment)=>payment.direction==='in' && sameDay(payment.created_at)).reduce((sum,payment)=>sum+Number(payment.amount||0),0)
  const todayOut = payments.filter((payment)=>payment.direction==='out' && sameDay(payment.created_at)).reduce((sum,payment)=>sum+Number(payment.amount||0),0)
  const todayExpenses = expenses.filter((item)=>sameDay(item.created_at)).reduce((sum,item)=>sum+Number(item.amount||0),0)
  const bankTotal = Object.values(bankBalances).reduce((sum,value)=>sum+Number(value||0),0)

  const tillCash = (till) => {
    const related = payments.filter((payment)=>payment.till_session_id===till.id && payment.method==='cash')
    return Number(till.opening_cash||0)+related.reduce((sum,payment)=>sum+(payment.direction==='out'?-Number(payment.amount||0):Number(payment.amount||0)),0)
  }

  const submitExpense = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { data,error } = await supabase.rpc('post_expense',{
      p_location_id:expense.location_id,
      p_category:expense.category,
      p_description:expense.description,
      p_amount:Number(expense.amount),
      p_payment_method:expense.payment_method,
      p_bank_account_id:expense.payment_method==='cash' ? null : (expense.bank_account_id || null),
      p_reference:expense.reference || null,
      p_notes:expense.notes || null,
    })
    if(error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:`Expense posted. Reference ${data}.`})
      setExpense((value)=>({...value,description:'',amount:'',reference:'',notes:''}))
      await load()
    }
    setBusy(false)
  }

  const addBankAccount = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { error } = await supabase.from('bank_accounts').insert({
      organization_id:context.organization.id,
      name:accountForm.name.trim(),
      account_type:accountForm.account_type,
      provider:accountForm.provider.trim() || null,
      account_reference:accountForm.account_reference.trim() || null,
      opening_balance:Number(accountForm.opening_balance || 0),
    })
    if(error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:'Financial account added.'})
      setAccountForm({name:'',account_type:'bank',provider:'',account_reference:'',opening_balance:''})
      await load()
    }
    setBusy(false)
  }

  const postBankTransaction = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { data,error } = await supabase.rpc('record_bank_transaction',{
      p_bank_account_id:bankForm.bank_account_id,
      p_location_id:bankForm.location_id || null,
      p_transaction_type:bankForm.transaction_type,
      p_amount:Number(bankForm.amount),
      p_reference:bankForm.reference || null,
      p_notes:bankForm.notes || null,
    })
    if(error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:`Bank transaction recorded. Reference ${data}.`})
      setBankForm((value)=>({...value,amount:'',reference:'',notes:''}))
      await load()
    }
    setBusy(false)
  }

  const bankCash = async (event) => {
    event.preventDefault()
    setBusy(true)
    setMessage(null)
    const { data,error } = await supabase.rpc('bank_cash_from_till',{
      p_till_session_id:bankTill.till_session_id,
      p_bank_account_id:bankTill.bank_account_id,
      p_amount:Number(bankTill.amount),
      p_reference:bankTill.reference || null,
      p_notes:bankTill.notes || null,
    })
    if(error) setMessage({type:'error',text:error.message})
    else {
      setMessage({type:'success',text:`Cash banked. Remaining till cash: ${money(data?.cash_remaining,currency)}.`})
      setBankTill((value)=>({...value,amount:'',reference:'',notes:''}))
      await load()
    }
    setBusy(false)
  }

  const ledger = useMemo(()=>{
    const rows=[]
    for(const payment of payments) rows.push({
      id:`p-${payment.id}`,
      date:payment.created_at,
      kind:String(payment.payment_type || 'payment').replaceAll('_',' '),
      location:payment.locations?.name || '',
      method:payment.method,
      amount:payment.direction==='out' ? -Number(payment.amount||0) : Number(payment.amount||0),
      reference:payment.reference,
    })
    for(const tx of bankTx) rows.push({
      id:`b-${tx.id}`,
      date:tx.created_at,
      kind:`bank ${tx.transaction_type}`,
      location:tx.bank_accounts?.name || tx.locations?.name || '',
      method:'bank',
      amount:tx.transaction_type==='withdrawal' ? -Number(tx.amount||0) : Number(tx.amount||0),
      reference:tx.reference,
    })
    return rows.sort((a,b)=>new Date(b.date)-new Date(a.date)).slice(0,800)
  },[payments,bankTx])

  if(loading) return <main className="page-wrap text-muted">Loading finance...</main>

  return (
    <main className="page-wrap">
      <div className="page-header-row">
        <div>
          <p className="page-eyebrow">Finance</p>
          <h1 className="page-title">Cash, Banking & Expenses</h1>
          <p className="page-subtitle">Universal cash movement, till control, expenses, banking and account balances.</p>
        </div>
        <div className="flex flex-wrap gap-2"><Link href="/payments" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">External Payments</Link><Link href="/accounting" className="btn-secondary rounded-xl px-4 py-2 text-sm font-black">Accounting</Link><Link href="/sales-report" className="btn-primary rounded-xl px-4 py-2 text-sm font-black">Reports</Link></div>
      </div>

      {message && <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="page-card p-4"><p className="text-xs text-muted">Money received today</p><strong className="mt-2 block text-2xl text-emerald-600">{money(todayIn,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Money paid out today</p><strong className="mt-2 block text-2xl text-red-500">{money(todayOut,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Expenses today</p><strong className="mt-2 block text-2xl text-amber-600">{money(todayExpenses,currency)}</strong></div>
        <div className="page-card p-4"><p className="text-xs text-muted">Bank / financial accounts</p><strong className="mt-2 block text-2xl">{money(bankTotal,currency)}</strong></div>
      </section>

      <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
        {[
          ['overview','Overview'],
          ['expenses','Expenses'],
          ['banking','Banking'],
          ['tills','Tills'],
          ['ledger','Ledger'],
        ].map(([key,label])=><button key={key} type="button" onClick={()=>setTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{label}</button>)}
      </div>

      {tab==='overview' && (
        <section className="grid gap-5 lg:grid-cols-2">
          <div className="page-card p-5">
            <h2 className="font-black">Financial accounts</h2>
            <div className="mt-4 space-y-3">
              {!bankAccounts.length && <p className="text-sm text-muted">No bank or mobile-money accounts configured.</p>}
              {bankAccounts.map((account)=><div key={account.id} className="rounded-2xl bg-[var(--panel-2)] p-4"><div className="flex items-start justify-between gap-3"><div><strong>{account.name}</strong><p className="mt-1 text-xs text-muted">{account.provider || account.account_type}{account.account_reference ? ` · ${account.account_reference}` : ''}</p></div><strong>{money(bankBalances[account.id],currency)}</strong></div></div>)}
            </div>
          </div>

          <div className="page-card p-5">
            <h2 className="font-black">Open tills</h2>
            <div className="mt-4 space-y-3">
              {!openTills.length && <p className="text-sm text-muted">No tills are open right now.</p>}
              {openTills.map((till)=><div key={till.id} className="rounded-2xl bg-[var(--panel-2)] p-4"><div className="flex justify-between gap-3"><div><strong>{till.users?.full_name || 'Cashier'}</strong><p className="mt-1 text-xs text-muted">{till.locations?.name || 'Location'} · opened {new Date(till.opened_at).toLocaleString()}</p></div><div className="text-right"><span className="text-xs text-muted">Cash expected</span><strong className="block">{money(tillCash(till),currency)}</strong></div></div></div>)}
            </div>
          </div>
        </section>
      )}

      {tab==='expenses' && (
        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          {canManage && (
            <form onSubmit={submitExpense} className="page-card h-fit p-5">
              <h2 className="font-black">Record expense</h2>
              <select className="input-base mt-4" value={expense.location_id} onChange={(event)=>setExpense({...expense,location_id:event.target.value})}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select>
              <input required className="input-base mt-3" placeholder="Category e.g. Fuel, Rent, Utilities" value={expense.category} onChange={(event)=>setExpense({...expense,category:event.target.value})}/>
              <input required className="input-base mt-3" placeholder="What was paid for?" value={expense.description} onChange={(event)=>setExpense({...expense,description:event.target.value})}/>
              <input required className="input-base mt-3" type="number" min="0.01" step="0.01" placeholder="Amount" value={expense.amount} onChange={(event)=>setExpense({...expense,amount:event.target.value})}/>
              <select className="input-base mt-3" value={expense.payment_method} onChange={(event)=>setExpense({...expense,payment_method:event.target.value})}>
                <option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option>
              </select>
              {expense.payment_method!=='cash' && <select className="input-base mt-3" value={expense.bank_account_id} onChange={(event)=>setExpense({...expense,bank_account_id:event.target.value})}><option value="">No linked account</option>{bankAccounts.map((account)=><option key={account.id} value={account.id}>{account.name}</option>)}</select>}
              <input className="input-base mt-3" placeholder="Reference (optional)" value={expense.reference} onChange={(event)=>setExpense({...expense,reference:event.target.value})}/>
              <textarea className="input-base mt-3 min-h-20" placeholder="Notes" value={expense.notes} onChange={(event)=>setExpense({...expense,notes:event.target.value})}/>
              <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Posting...':'Post expense'}</button>
              <p className="mt-3 text-xs text-muted">Cash expenses require your till to be open and reduce its expected closing cash automatically.</p>
            </form>
          )}

          <div className="page-card overflow-hidden">
            <div className="border-b border-[var(--line)] p-4"><strong>Expense history</strong></div>
            <div className="divide-y divide-[var(--line)]">
              {!expenses.length && <p className="p-5 text-sm text-muted">No expenses recorded.</p>}
              {expenses.map((item)=><div key={item.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><strong>{item.description}</strong><p className="mt-1 text-xs text-muted">{item.category} · {item.payment_method?.replaceAll('_',' ')} · {item.locations?.name || 'Location'} · {new Date(item.created_at).toLocaleString()}</p>{item.reference&&<p className="mt-1 text-xs text-muted">Ref: {item.reference}</p>}</div><strong className="text-red-500">- {money(item.amount,currency)}</strong></div>)}
            </div>
          </div>
        </section>
      )}

      {tab==='banking' && (
        <section className="grid gap-5 xl:grid-cols-[360px_1fr]">
          <div className="space-y-5">
            {canManage && (
              <form onSubmit={addBankAccount} className="page-card p-5">
                <h2 className="font-black">Add financial account</h2>
                <input required className="input-base mt-4" placeholder="Account name e.g. Stanbic Main" value={accountForm.name} onChange={(event)=>setAccountForm({...accountForm,name:event.target.value})}/>
                <select className="input-base mt-3" value={accountForm.account_type} onChange={(event)=>setAccountForm({...accountForm,account_type:event.target.value})}><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="cashbox">Cash box</option><option value="other">Other</option></select>
                <input className="input-base mt-3" placeholder="Provider e.g. MTN, Stanbic" value={accountForm.provider} onChange={(event)=>setAccountForm({...accountForm,provider:event.target.value})}/>
                <input className="input-base mt-3" placeholder="Account / wallet reference" value={accountForm.account_reference} onChange={(event)=>setAccountForm({...accountForm,account_reference:event.target.value})}/>
                <input className="input-base mt-3" type="number" min="0" step="0.01" placeholder="Opening balance" value={accountForm.opening_balance} onChange={(event)=>setAccountForm({...accountForm,opening_balance:event.target.value})}/>
                <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Saving...':'Add account'}</button>
              </form>
            )}

            {canManage && bankAccounts.length>0 && (
              <form onSubmit={postBankTransaction} className="page-card p-5">
                <h2 className="font-black">Bank transaction</h2>
                <select className="input-base mt-4" value={bankForm.bank_account_id} onChange={(event)=>setBankForm({...bankForm,bank_account_id:event.target.value})}>{bankAccounts.map((account)=><option key={account.id} value={account.id}>{account.name}</option>)}</select>
                <select className="input-base mt-3" value={bankForm.location_id} onChange={(event)=>setBankForm({...bankForm,location_id:event.target.value})}>{locations.map((location)=><option key={location.id} value={location.id}>{location.name}</option>)}</select>
                <select className="input-base mt-3" value={bankForm.transaction_type} onChange={(event)=>setBankForm({...bankForm,transaction_type:event.target.value})}><option value="deposit">Deposit / money in</option><option value="withdrawal">Withdrawal / money out</option></select>
                <input required className="input-base mt-3" type="number" min="0.01" step="0.01" placeholder="Amount" value={bankForm.amount} onChange={(event)=>setBankForm({...bankForm,amount:event.target.value})}/>
                <input className="input-base mt-3" placeholder="Reference" value={bankForm.reference} onChange={(event)=>setBankForm({...bankForm,reference:event.target.value})}/>
                <textarea className="input-base mt-3 min-h-20" placeholder="Notes" value={bankForm.notes} onChange={(event)=>setBankForm({...bankForm,notes:event.target.value})}/>
                <button disabled={busy} className="btn-secondary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Posting...':'Record transaction'}</button>
              </form>
            )}

            {canManage && openTills.length>0 && bankAccounts.length>0 && (
              <form onSubmit={bankCash} className="page-card p-5">
                <h2 className="font-black">Bank cash from till</h2>
                <p className="mt-1 text-xs text-muted">Moves physical cash out of an open till and records the matching bank deposit.</p>
                <select required className="input-base mt-4" value={bankTill.till_session_id} onChange={(event)=>setBankTill({...bankTill,till_session_id:event.target.value})}><option value="">Choose open till</option>{openTills.map((till)=><option key={till.id} value={till.id}>{till.users?.full_name || 'Cashier'} · {till.locations?.name} · {money(tillCash(till),currency)}</option>)}</select>
                <select className="input-base mt-3" value={bankTill.bank_account_id} onChange={(event)=>setBankTill({...bankTill,bank_account_id:event.target.value})}>{bankAccounts.map((account)=><option key={account.id} value={account.id}>{account.name}</option>)}</select>
                <input required className="input-base mt-3" type="number" min="0.01" step="0.01" placeholder="Amount to bank" value={bankTill.amount} onChange={(event)=>setBankTill({...bankTill,amount:event.target.value})}/>
                <input className="input-base mt-3" placeholder="Banking reference" value={bankTill.reference} onChange={(event)=>setBankTill({...bankTill,reference:event.target.value})}/>
                <textarea className="input-base mt-3 min-h-20" placeholder="Notes" value={bankTill.notes} onChange={(event)=>setBankTill({...bankTill,notes:event.target.value})}/>
                <button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Banking...':'Bank till cash'}</button>
              </form>
            )}
          </div>

          <div className="space-y-5">
            <div className="page-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Account balances</strong></div>
              <div className="divide-y divide-[var(--line)]">{bankAccounts.map((account)=><div key={account.id} className="flex justify-between gap-4 p-4"><div><strong>{account.name}</strong><p className="mt-1 text-xs text-muted">{account.provider || account.account_type}{account.account_reference? ` · ${account.account_reference}`:''}</p></div><strong>{money(bankBalances[account.id],currency)}</strong></div>)}</div>
            </div>
            <div className="page-card overflow-hidden">
              <div className="border-b border-[var(--line)] p-4"><strong>Banking history</strong></div>
              <div className="max-h-[620px] divide-y divide-[var(--line)] overflow-y-auto">
                {!bankTx.length && <p className="p-5 text-sm text-muted">No banking transactions yet.</p>}
                {bankTx.map((tx)=><div key={tx.id} className="flex justify-between gap-4 p-4"><div><strong className="capitalize">{tx.transaction_type}</strong><p className="mt-1 text-xs text-muted">{tx.bank_accounts?.name || 'Account'} · {tx.locations?.name || 'Business'} · {new Date(tx.created_at).toLocaleString()}</p>{tx.reference&&<p className="mt-1 text-xs text-muted">Ref: {tx.reference}</p>}</div><strong className={tx.transaction_type==='withdrawal'?'text-red-500':'text-emerald-600'}>{tx.transaction_type==='withdrawal'?'-':'+'}{money(tx.amount,currency)}</strong></div>)}
              </div>
            </div>
          </div>
        </section>
      )}

      {tab==='tills' && (
        <section className="page-card overflow-hidden">
          <div className="border-b border-[var(--line)] p-4"><strong>Till sessions</strong><p className="mt-1 text-xs text-muted">Opening cash, expected cash, counted cash and closing variance.</p></div>
          <div className="divide-y divide-[var(--line)]">
            {!tills.length && <p className="p-5 text-sm text-muted">No till sessions yet.</p>}
            {tills.map((till)=><div key={till.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><div className="flex items-center gap-2"><strong>{till.users?.full_name || 'Cashier'}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${till.status==='open'?'bg-emerald-500/10 text-emerald-600':'bg-[var(--panel-2)] text-muted'}`}>{till.status}</span></div><p className="mt-1 text-xs text-muted">{till.locations?.name || 'Location'} · opened {new Date(till.opened_at).toLocaleString()}{till.closed_at ? ` · closed ${new Date(till.closed_at).toLocaleString()}`:''}</p></div><div className="text-left sm:text-right"><span className="text-xs text-muted">Opening</span><strong className="block">{money(till.opening_cash,currency)}</strong></div><div className="text-left sm:text-right"><span className="text-xs text-muted">{till.status==='open'?'Expected now':'Variance'}</span><strong className={Number(till.variance||0)!==0?'text-amber-600':''}>{till.status==='open'?money(tillCash(till),currency):money(till.variance,currency)}</strong></div></div>)}
          </div>
        </section>
      )}

      {tab==='ledger' && (
        <section className="page-card overflow-hidden">
          <div className="border-b border-[var(--line)] p-4"><strong>Financial movement ledger</strong><p className="mt-1 text-xs text-muted">Customer receipts, supplier payments, refunds, expenses, till banking and bank transactions.</p></div>
          <div className="max-h-[720px] divide-y divide-[var(--line)] overflow-y-auto">
            {!ledger.length && <p className="p-5 text-sm text-muted">No financial movements yet.</p>}
            {ledger.map((row)=><div key={row.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><strong className="capitalize">{row.kind}</strong><p className="mt-1 text-xs text-muted">{row.location || 'Business'} · {row.method?.replaceAll('_',' ')} · {new Date(row.date).toLocaleString()}</p>{row.reference&&<p className="mt-1 text-xs text-muted">Ref: {row.reference}</p>}</div><strong className={row.amount<0?'text-red-500':'text-emerald-600'}>{row.amount<0?'-':'+'}{money(Math.abs(row.amount),currency)}</strong></div>)}
          </div>
        </section>
      )}
    </main>
  )
}
