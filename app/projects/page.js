'use client'

import { useEffect,useMemo,useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()
const today=()=>new Date().toISOString().slice(0,10)

export default function ProjectsPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [projects,setProjects]=useState([])
  const [members,setMembers]=useState([])
  const [milestones,setMilestones]=useState([])
  const [tasks,setTasks]=useState([])
  const [timesheets,setTimesheets]=useState([])
  const [materials,setMaterials]=useState([])
  const [projectExpenses,setProjectExpenses]=useState([])
  const [invoices,setInvoices]=useState([])
  const [invoiceLines,setInvoiceLines]=useState([])
  const [events,setEvents]=useState([])
  const [users,setUsers]=useState([])
  const [customers,setCustomers]=useState([])
  const [locations,setLocations]=useState([])
  const [products,setProducts]=useState([])
  const [balances,setBalances]=useState([])
  const [bankAccounts,setBankAccounts]=useState([])
  const [tab,setTab]=useState('portfolio')
  const [detailTab,setDetailTab]=useState('overview')
  const [search,setSearch]=useState('')
  const [selected,setSelected]=useState(null)
  const [payInvoice,setPayInvoice]=useState(null)
  const [payExpense,setPayExpense]=useState(null)
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const [projectForm,setProjectForm]=useState({location_id:'',customer_id:'',name:'',description:'',start_date:'',due_date:'',priority:'normal',manager_user_id:'',contract_value:'',budget_cost:'',budget_hours:'',notes:''})
  const [memberForm,setMemberForm]=useState({user_id:'',project_role:'team_member',cost_rate:'',billing_rate:''})
  const [milestoneForm,setMilestoneForm]=useState({name:'',description:'',due_date:'',billing_amount:''})
  const [taskForm,setTaskForm]=useState({title:'',description:'',milestone_id:'',assigned_user_id:'',priority:'normal',start_date:'',due_date:'',estimated_hours:'',notes:''})
  const [timeForm,setTimeForm]=useState({task_id:'',work_date:today(),hours:'',description:'',billable:true,user_id:''})
  const [materialForm,setMaterialForm]=useState({product_id:'',quantity:'',notes:''})
  const [expenseForm,setExpenseForm]=useState({category:'Project',description:'',amount:'',payment_method:'',bank_account_id:'',reference:'',notes:''})
  const [invoiceForm,setInvoiceForm]=useState({due_date:'',tax_amount:'',notes:'',lines:[{description:'',quantity:'1',unit_price:'',milestone_id:''}]})
  const [paymentForm,setPaymentForm]=useState({amount:'',method:'cash',bank_account_id:'',reference:'',notes:''})
  const [expensePayForm,setExpensePayForm]=useState({method:'cash',bank_account_id:'',reference:''})
  const [statusForm,setStatusForm]=useState({status:'active',progress_percent:'',notes:''})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const userId=context?.user?.id
  const canManage=permissions.includes('projects.manage')
  const canTime=permissions.includes('projects.time')||canManage
  const canCosts=permissions.includes('projects.costs')||canManage
  const canBilling=permissions.includes('projects.billing')||canManage
  const canView=permissions.includes('projects.view')||canManage

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id
      const [
        permRes,projectRes,memberRes,milestoneRes,taskRes,timeRes,materialRes,expenseRes,
        invoiceRes,lineRes,eventRes,userRes,customerRes,locationRes,productRes,balanceRes,bankRes
      ]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('projects').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
        supabase.from('project_members').select('*').eq('organization_id',org).order('created_at'),
        supabase.from('project_milestones').select('*').eq('organization_id',org).order('due_date',{ascending:true,nullsFirst:false}),
        supabase.from('project_tasks').select('*').eq('organization_id',org).order('due_date',{ascending:true,nullsFirst:false}),
        supabase.from('project_timesheets').select('*').eq('organization_id',org).order('work_date',{ascending:false}).limit(4000),
        supabase.from('project_materials').select('*').eq('organization_id',org).order('issued_at',{ascending:false}).limit(3000),
        supabase.from('project_expenses').select('*').eq('organization_id',org).order('expense_date',{ascending:false}).limit(3000),
        supabase.from('project_invoices').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(2000),
        supabase.from('project_invoice_lines').select('*').eq('organization_id',org).order('created_at'),
        supabase.from('project_events').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(5000),
        supabase.from('users').select('id,full_name,email,role,default_location_id').eq('organization_id',org).eq('active',true).order('full_name'),
        supabase.from('customers').select('id,name,phone,email,address').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('products').select('id,name,sku,unit,track_inventory,cost_price,selling_price').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('stock_balances').select('product_id,location_id,quantity,reserved_quantity'),
        supabase.from('bank_accounts').select('id,name,provider,account_type').eq('organization_id',org).eq('active',true).order('name'),
      ])
      for(const r of [permRes,projectRes,memberRes,milestoneRes,taskRes,timeRes,materialRes,expenseRes,invoiceRes,lineRes,eventRes,userRes,customerRes,locationRes,productRes,balanceRes,bankRes])if(r.error)throw r.error

      setPermissions((permRes.data||[]).map((r)=>r.permission))
      setProjects(projectRes.data||[])
      setMembers(memberRes.data||[])
      setMilestones(milestoneRes.data||[])
      setTasks(taskRes.data||[])
      setTimesheets(timeRes.data||[])
      setMaterials(materialRes.data||[])
      setProjectExpenses(expenseRes.data||[])
      setInvoices(invoiceRes.data||[])
      setInvoiceLines(lineRes.data||[])
      setEvents(eventRes.data||[])
      setUsers(userRes.data||[])
      setCustomers(customerRes.data||[])
      setLocations(locationRes.data||[])
      setProducts(productRes.data||[])
      setBalances(balanceRes.data||[])
      setBankAccounts(bankRes.data||[])

      const defaultLocation=ctx.location?.id||locationRes.data?.[0]?.id||''
      const defaultManager=ctx.user?.id||userRes.data?.[0]?.id||''
      const firstUser=userRes.data?.[0]?.id||''
      setProjectForm((v)=>({...v,location_id:v.location_id||defaultLocation,manager_user_id:v.manager_user_id||defaultManager}))
      setMemberForm((v)=>({...v,user_id:v.user_id||firstUser}))
      setTimeForm((v)=>({...v,user_id:v.user_id||defaultManager}))
      setExpenseForm((v)=>({...v,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))
      setPaymentForm((v)=>({...v,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))
      setExpensePayForm((v)=>({...v,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))

      if(selected){
        const fresh=(projectRes.data||[]).find((p)=>p.id===selected.id)
        if(fresh)setSelected(fresh)
      }
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load projects.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  const userName=(id)=>users.find((u)=>u.id===id)?.full_name||'Unassigned'
  const customerName=(id)=>customers.find((c)=>c.id===id)?.name||'No client'
  const locationName=(id)=>locations.find((l)=>l.id===id)?.name||'Location'
  const projectName=(id)=>projects.find((p)=>p.id===id)?.name||'Project'

  const createProject=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=projectForm
    const {data,error}=await supabase.rpc('create_project',{
      p_location_id:f.location_id,p_customer_id:f.customer_id||null,p_name:f.name,p_description:f.description||null,
      p_start_date:f.start_date||null,p_due_date:f.due_date||null,p_priority:f.priority,p_manager_user_id:f.manager_user_id||null,
      p_contract_value:Number(f.contract_value||0),p_budget_cost:Number(f.budget_cost||0),p_budget_hours:Number(f.budget_hours||0),p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message})
    else{
      setProjectForm((v)=>({location_id:v.location_id,customer_id:'',name:'',description:'',start_date:'',due_date:'',priority:'normal',manager_user_id:v.manager_user_id,contract_value:'',budget_cost:'',budget_hours:'',notes:''}))
      setMessage({type:'success',text:`${data?.project_number||'Project'} created.`})
      setTab('portfolio');await load()
    }
    setBusy(false)
  }

  const openProject=(project)=>{
    setSelected(project);setDetailTab('overview')
    setStatusForm({status:project.status,progress_percent:String(project.progress_percent??0),notes:''})
    setMemberForm((v)=>({...v,user_id:v.user_id||users[0]?.id||''}))
    setMilestoneForm({name:'',description:'',due_date:'',billing_amount:''})
    setTaskForm({title:'',description:'',milestone_id:'',assigned_user_id:'',priority:'normal',start_date:'',due_date:'',estimated_hours:'',notes:''})
    setTimeForm((v)=>({...v,task_id:'',work_date:today(),hours:'',description:'',billable:true,user_id:userId||v.user_id}))
  }

  const assignMember=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('assign_project_member',{
      p_project_id:selected.id,p_user_id:memberForm.user_id,p_project_role:memberForm.project_role,
      p_cost_rate:memberForm.cost_rate===''?null:Number(memberForm.cost_rate),p_billing_rate:memberForm.billing_rate===''?null:Number(memberForm.billing_rate)
    })
    if(error)setMessage({type:'error',text:error.message});else{setMemberForm((v)=>({...v,cost_rate:'',billing_rate:'',project_role:'team_member'}));setMessage({type:'success',text:'Project member assigned.'});await load()}
    setBusy(false)
  }

  const addMilestone=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('add_project_milestone',{
      p_project_id:selected.id,p_name:milestoneForm.name,p_description:milestoneForm.description||null,
      p_due_date:milestoneForm.due_date||null,p_billing_amount:Number(milestoneForm.billing_amount||0)
    })
    if(error)setMessage({type:'error',text:error.message});else{setMilestoneForm({name:'',description:'',due_date:'',billing_amount:''});setMessage({type:'success',text:'Milestone added.'});await load()}
    setBusy(false)
  }

  const updateMilestone=async(id,status)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('update_project_milestone',{p_milestone_id:id,p_status:status})
    if(error)setMessage({type:'error',text:error.message});else await load()
    setBusy(false)
  }

  const addTask=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const f=taskForm
    const {error}=await supabase.rpc('add_project_task',{
      p_project_id:selected.id,p_title:f.title,p_description:f.description||null,p_milestone_id:f.milestone_id||null,
      p_assigned_user_id:f.assigned_user_id||null,p_priority:f.priority,p_start_date:f.start_date||null,p_due_date:f.due_date||null,
      p_estimated_hours:Number(f.estimated_hours||0),p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setTaskForm({title:'',description:'',milestone_id:'',assigned_user_id:'',priority:'normal',start_date:'',due_date:'',estimated_hours:'',notes:''});setMessage({type:'success',text:'Task added.'});await load()}
    setBusy(false)
  }

  const updateTask=async(task,status)=>{
    setBusy(true);setMessage(null)
    const progress=status==='completed'?100:status==='in_progress'?Math.max(1,Number(task.progress_percent||0)):Number(task.progress_percent||0)
    const {error}=await supabase.rpc('update_project_task',{p_task_id:task.id,p_status:status,p_progress_percent:progress,p_notes:null})
    if(error)setMessage({type:'error',text:error.message});else await load()
    setBusy(false)
  }

  const logTime=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const f=timeForm
    const {data,error}=await supabase.rpc('log_project_time',{
      p_project_id:selected.id,p_task_id:f.task_id||null,p_work_date:f.work_date,p_hours:Number(f.hours),
      p_description:f.description,p_billable:f.billable,p_user_id:canManage?(f.user_id||null):null
    })
    if(error)setMessage({type:'error',text:error.message});else{setTimeForm((v)=>({...v,task_id:'',hours:'',description:'',billable:true}));setMessage({type:'success',text:`Time logged · ${data?.status||'submitted'}.`});await load()}
    setBusy(false)
  }

  const reviewTimesheet=async(id,decision)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('review_project_timesheet',{p_timesheet_id:id,p_decision:decision})
    if(error)setMessage({type:'error',text:error.message});else await load()
    setBusy(false)
  }

  const issueMaterial=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('issue_project_material',{p_project_id:selected.id,p_product_id:materialForm.product_id,p_quantity:Number(materialForm.quantity),p_notes:materialForm.notes||null})
    if(error)setMessage({type:'error',text:error.message});else{setMaterialForm({product_id:'',quantity:'',notes:''});setMessage({type:'success',text:`Material issued · cost ${money(data?.cost_total,currency)}.`});await load()}
    setBusy(false)
  }

  const reverseMaterial=async(id)=>{
    if(!confirm('Reverse this material issue and return the quantity to stock?'))return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('reverse_project_material',{p_project_material_id:id,p_notes:'Reversed from project workspace'})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Material issue reversed and stock restored.'});await load()}
    setBusy(false)
  }

  const addExpense=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const f=expenseForm
    const {data,error}=await supabase.rpc('post_project_expense',{
      p_project_id:selected.id,p_category:f.category,p_description:f.description,p_amount:Number(f.amount),
      p_payment_method:f.payment_method||null,p_bank_account_id:f.payment_method&&f.payment_method!=='cash'?(f.bank_account_id||null):null,
      p_reference:f.reference||null,p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setExpenseForm((v)=>({...v,description:'',amount:'',payment_method:'',reference:'',notes:''}));setMessage({type:'success',text:`Project expense recorded · ${data?.status||'accrued'}.`});await load()}
    setBusy(false)
  }

  const payAccruedExpense=async(event)=>{
    event.preventDefault();if(!payExpense)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('pay_project_expense',{
      p_project_expense_id:payExpense.id,p_payment_method:expensePayForm.method,
      p_bank_account_id:expensePayForm.method==='cash'?null:(expensePayForm.bank_account_id||null),p_reference:expensePayForm.reference||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setPayExpense(null);setExpensePayForm((v)=>({...v,reference:''}));setMessage({type:'success',text:'Project expense paid and posted to Finance.'});await load()}
    setBusy(false)
  }

  const setInvoiceLine=(index,key,value)=>{
    setInvoiceForm((f)=>({...f,lines:f.lines.map((line,i)=>i===index?{...line,[key]:value}:line)}))
  }
  const addInvoiceLine=()=>setInvoiceForm((f)=>({...f,lines:[...f.lines,{description:'',quantity:'1',unit_price:'',milestone_id:''}]}))
  const removeInvoiceLine=(index)=>setInvoiceForm((f)=>({...f,lines:f.lines.filter((_,i)=>i!==index)}))

  const createInvoice=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const lines=invoiceForm.lines.filter((l)=>l.description.trim()).map((l)=>({description:l.description,quantity:Number(l.quantity||1),unit_price:Number(l.unit_price||0),milestone_id:l.milestone_id||null}))
    const {data,error}=await supabase.rpc('create_project_invoice',{
      p_project_id:selected.id,p_due_date:invoiceForm.due_date||null,p_lines:lines,p_tax_amount:Number(invoiceForm.tax_amount||0),p_notes:invoiceForm.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setInvoiceForm({due_date:'',tax_amount:'',notes:'',lines:[{description:'',quantity:'1',unit_price:'',milestone_id:''}]});setMessage({type:'success',text:`${data?.invoice_number||'Invoice'} created · ${money(data?.total_amount,currency)}.`});await load()}
    setBusy(false)
  }

  const recordPayment=async(event)=>{
    event.preventDefault();if(!payInvoice)return
    setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('record_project_invoice_payment',{
      p_invoice_id:payInvoice.id,p_amount:Number(paymentForm.amount),p_method:paymentForm.method,
      p_bank_account_id:paymentForm.method==='cash'?null:(paymentForm.bank_account_id||null),p_reference:paymentForm.reference||null,p_notes:paymentForm.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setPayInvoice(null);setPaymentForm((v)=>({...v,amount:'',reference:'',notes:''}));setMessage({type:'success',text:`Payment recorded · balance ${money(data?.balance,currency)}.`});await load()}
    setBusy(false)
  }

  const updateProjectStatus=async(event)=>{
    event.preventDefault();if(!selected)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('update_project_status',{
      p_project_id:selected.id,p_status:statusForm.status,p_progress_percent:statusForm.progress_percent===''?null:Number(statusForm.progress_percent),p_notes:statusForm.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Project status updated.'});await load()}
    setBusy(false)
  }

  const filtered=useMemo(()=>{
    const term=search.trim().toLowerCase()
    if(!term)return projects
    return projects.filter((p)=>[p.project_number,p.name,p.status,p.priority,customerName(p.customer_id),locationName(p.location_id)].filter(Boolean).some((v)=>String(v).toLowerCase().includes(term)))
  },[projects,search,customers,locations])

  const activeProjects=projects.filter((p)=>['planning','active','on_hold'].includes(p.status))
  const overdue=activeProjects.filter((p)=>p.due_date&&new Date(p.due_date+'T23:59:59')<new Date())
  const totalContract=activeProjects.reduce((s,p)=>s+Number(p.contract_value||0),0)
  const projectReceivables=invoices.filter((i)=>i.status!=='void').reduce((s,i)=>s+Math.max(0,Number(i.total_amount||0)-Number(i.amount_paid||0)),0)

  if(loading)return <main className="page-wrap text-muted">Loading projects...</main>

  const selectedMembers=selected?members.filter((m)=>m.project_id===selected.id&&m.active):[]
  const selectedMilestones=selected?milestones.filter((m)=>m.project_id===selected.id):[]
  const selectedTasks=selected?tasks.filter((t)=>t.project_id===selected.id):[]
  const selectedTimesheets=selected?timesheets.filter((t)=>t.project_id===selected.id):[]
  const selectedMaterials=selected?materials.filter((m)=>m.project_id===selected.id):[]
  const selectedExpenses=selected?projectExpenses.filter((e)=>e.project_id===selected.id):[]
  const selectedInvoices=selected?invoices.filter((i)=>i.project_id===selected.id):[]
  const selectedEvents=selected?events.filter((e)=>e.project_id===selected.id):[]
  const approvedHours=selectedTimesheets.filter((t)=>t.status==='approved').reduce((s,t)=>s+Number(t.hours||0),0)
  const billableTime=selectedTimesheets.filter((t)=>t.status==='approved').reduce((s,t)=>s+Number(t.billable_amount||0),0)
  const projectedMargin=selected?Number(selected.contract_value||0)-Number(selected.total_cost||0):0

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">Projects</p><h1 className="page-title">Projects & Costing</h1><p className="page-subtitle">Budgets, teams, milestones, tasks, time, materials, expenses, client billing and profitability.</p></div>
      <div className="flex flex-wrap gap-2"><Link href="/payments" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Payments</Link><Link href="/customers" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Clients</Link>{canManage&&<button type="button" onClick={()=>setTab('new')} className="btn-primary rounded-xl px-4 py-2 text-sm font-black">New project</button>}</div>
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active projects</p><strong className="mt-2 block text-2xl">{activeProjects.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Overdue projects</p><strong className="mt-2 block text-2xl text-red-500">{overdue.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Active contract value</p><strong className="mt-2 block text-xl">{money(totalContract,currency)}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Project receivables</p><strong className="mt-2 block text-xl text-amber-600">{canBilling||canView?money(projectReceivables,currency):'Restricted'}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      <button type="button" onClick={()=>setTab('portfolio')} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab==='portfolio'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>Portfolio</button>
      {canManage&&<button type="button" onClick={()=>setTab('new')} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab==='new'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>New project</button>}
      <button type="button" onClick={()=>setTab('mywork')} className={`rounded-xl px-4 py-2.5 text-sm font-black ${tab==='mywork'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>My work</button>
    </div>

    {tab==='portfolio'&&<section className="space-y-4">
      <input className="input-base max-w-xl" placeholder="Search project, client, location or status…" value={search} onChange={(e)=>setSearch(e.target.value)}/>
      {!filtered.length&&<div className="page-card p-7 text-center text-sm text-muted">No projects available.</div>}
      {filtered.map((p)=>{
        const margin=Number(p.contract_value||0)-Number(p.total_cost||0)
        const receivable=Math.max(0,Number(p.billed_amount||0)-Number(p.amount_paid||0))
        return <button key={p.id} type="button" onClick={()=>openProject(p)} className="page-card w-full p-4 text-left sm:p-5">
          <div className="grid gap-4 xl:grid-cols-[1fr_auto_auto_auto] xl:items-center">
            <div><div className="flex flex-wrap items-center gap-2"><strong>{p.project_number} · {p.name}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{p.status.replaceAll('_',' ')}</span>{p.priority==='urgent'&&<span className="rounded-full bg-red-500/10 px-2 py-1 text-[10px] font-black uppercase text-red-500">urgent</span>}</div><p className="mt-1 text-sm text-muted">{customerName(p.customer_id)} · {locationName(p.location_id)} · Manager {userName(p.manager_user_id)}</p><div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--panel-2)]"><div className="h-full bg-[var(--accent)]" style={{width:`${Math.min(100,Number(p.progress_percent||0))}%`}}/></div><p className="mt-1 text-[11px] text-muted">{Number(p.progress_percent||0).toLocaleString()}% complete{p.due_date?` · due ${new Date(p.due_date+'T00:00:00').toLocaleDateString()}`:''}</p></div>
            <div className="text-left xl:text-right"><span className="text-xs text-muted">Contract</span><strong className="block">{money(p.contract_value,currency)}</strong></div>
            <div className="text-left xl:text-right"><span className="text-xs text-muted">Current cost</span><strong className="block">{money(p.total_cost,currency)}</strong><small className={margin>=0?'text-emerald-600':'text-red-500'}>{money(margin,currency)} projected margin</small></div>
            <div className="text-left xl:text-right"><span className="text-xs text-muted">Receivable</span><strong className={receivable>0?'block text-amber-600':'block'}>{money(receivable,currency)}</strong></div>
          </div>
        </button>
      })}
    </section>}

    {tab==='new'&&canManage&&<form onSubmit={createProject} className="page-card mx-auto max-w-4xl p-5">
      <h2 className="font-black">Create project</h2><p className="mt-1 text-sm text-muted">Set the commercial target and initial schedule. Tasks, team, costs and invoices are added from the project workspace.</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <input required className="input-base sm:col-span-2" placeholder="Project name" value={projectForm.name} onChange={(e)=>setProjectForm({...projectForm,name:e.target.value})}/>
        <select className="input-base" value={projectForm.customer_id} onChange={(e)=>setProjectForm({...projectForm,customer_id:e.target.value})}><option value="">No client yet</option>{customers.map((c)=><option key={c.id} value={c.id}>{c.name}</option>)}</select>
        <select className="input-base" value={projectForm.location_id} onChange={(e)=>setProjectForm({...projectForm,location_id:e.target.value})}>{locations.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select>
        <select className="input-base" value={projectForm.manager_user_id} onChange={(e)=>setProjectForm({...projectForm,manager_user_id:e.target.value})}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select>
        <select className="input-base" value={projectForm.priority} onChange={(e)=>setProjectForm({...projectForm,priority:e.target.value})}><option value="low">Low priority</option><option value="normal">Normal priority</option><option value="high">High priority</option><option value="urgent">Urgent</option></select>
        <label><span className="mb-1 block text-xs font-bold text-muted">Start date</span><input className="input-base" type="date" value={projectForm.start_date} onChange={(e)=>setProjectForm({...projectForm,start_date:e.target.value})}/></label>
        <label><span className="mb-1 block text-xs font-bold text-muted">Due date</span><input className="input-base" type="date" value={projectForm.due_date} onChange={(e)=>setProjectForm({...projectForm,due_date:e.target.value})}/></label>
        <input className="input-base" type="number" min="0" step="0.01" placeholder="Contract / project value" value={projectForm.contract_value} onChange={(e)=>setProjectForm({...projectForm,contract_value:e.target.value})}/>
        <input className="input-base" type="number" min="0" step="0.01" placeholder="Cost budget" value={projectForm.budget_cost} onChange={(e)=>setProjectForm({...projectForm,budget_cost:e.target.value})}/>
        <input className="input-base sm:col-span-2" type="number" min="0" step="0.25" placeholder="Budget hours" value={projectForm.budget_hours} onChange={(e)=>setProjectForm({...projectForm,budget_hours:e.target.value})}/>
        <textarea className="input-base min-h-24 sm:col-span-2" placeholder="Scope / description" value={projectForm.description} onChange={(e)=>setProjectForm({...projectForm,description:e.target.value})}/>
        <textarea className="input-base min-h-20 sm:col-span-2" placeholder="Internal notes" value={projectForm.notes} onChange={(e)=>setProjectForm({...projectForm,notes:e.target.value})}/>
      </div><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Create project</button>
    </form>}

    {tab==='mywork'&&<section className="grid gap-5 xl:grid-cols-2">
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>My assigned tasks</strong></div><div className="divide-y divide-[var(--line)]">{tasks.filter((t)=>t.assigned_user_id===userId&&!['completed','cancelled'].includes(t.status)).map((t)=><div key={t.id} className="p-4"><div className="flex justify-between gap-3"><div><strong>{t.title}</strong><p className="mt-1 text-xs text-muted">{projectName(t.project_id)} · <span className="capitalize">{t.status.replaceAll('_',' ')}</span>{t.due_date?` · due ${new Date(t.due_date+'T00:00:00').toLocaleDateString()}`:''}</p></div><button type="button" onClick={()=>{const p=projects.find((x)=>x.id===t.project_id);if(p){openProject(p);setDetailTab('tasks')}}} className="text-xs font-black text-accent">Open</button></div></div>)}</div></div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>My recent time</strong></div><div className="divide-y divide-[var(--line)]">{timesheets.filter((t)=>t.user_id===userId).slice(0,20).map((t)=><div key={t.id} className="flex justify-between gap-4 p-4"><div><strong>{projectName(t.project_id)}</strong><p className="mt-1 text-xs text-muted">{t.work_date} · {t.description} · <span className="capitalize">{t.status}</span></p></div><strong>{Number(t.hours).toLocaleString()}h</strong></div>)}</div></div>
    </section>}

    {selected&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-3 sm:p-7">
      <div className="mx-auto max-w-7xl rounded-3xl bg-[var(--panel)] p-4 shadow-2xl sm:p-6">
        <div className="flex flex-col gap-4 border-b border-[var(--line)] pb-5 lg:flex-row lg:items-start lg:justify-between">
          <div><p className="page-eyebrow">{selected.project_number}</p><h2 className="text-2xl font-black">{selected.name}</h2><p className="mt-1 text-sm text-muted">{customerName(selected.customer_id)} · {locationName(selected.location_id)} · Manager {userName(selected.manager_user_id)}</p></div>
          <div className="flex flex-wrap gap-2"><Link href={`/projects/${selected.id}/document`} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Project summary</Link>{canBilling&&selectedInvoices.length>0&&<Link href={`/projects/invoices/${selectedInvoices[0].id}`} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Latest invoice</Link>}<button type="button" onClick={()=>setSelected(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div>
        </div>

        <section className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-6">
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Progress</span><strong className="block">{Number(selected.progress_percent||0).toLocaleString()}%</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Contract</span><strong className="block">{money(selected.contract_value,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Total cost</span><strong className="block">{money(selected.total_cost,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Billed</span><strong className="block">{money(selected.billed_amount,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Paid</span><strong className="block text-emerald-600">{money(selected.amount_paid,currency)}</strong></div>
          <div className="rounded-2xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Projected margin</span><strong className={projectedMargin>=0?'block text-emerald-600':'block text-red-500'}>{money(projectedMargin,currency)}</strong></div>
        </section>

        <div className="mt-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
          {['overview','tasks','time','costs','billing','history'].map((key)=><button key={key} type="button" onClick={()=>setDetailTab(key)} className={`whitespace-nowrap rounded-xl px-4 py-2 text-xs font-black capitalize ${detailTab===key?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>{key}</button>)}
        </div>

        {detailTab==='overview'&&<div className="mt-5 grid gap-5 xl:grid-cols-[1fr_400px]">
          <div className="space-y-5">
            <section className="page-card p-5"><h3 className="font-black">Project control</h3><p className="mt-2 text-sm text-muted">{selected.description||'No project description recorded.'}</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><div><span className="text-xs text-muted">Start</span><strong className="block">{selected.start_date||'—'}</strong></div><div><span className="text-xs text-muted">Due</span><strong className="block">{selected.due_date||'—'}</strong></div><div><span className="text-xs text-muted">Status</span><strong className="block capitalize">{selected.status.replaceAll('_',' ')}</strong></div></div>{canManage&&<form onSubmit={updateProjectStatus} className="mt-5 grid gap-3 sm:grid-cols-3"><select className="input-base" value={statusForm.status} onChange={(e)=>setStatusForm({...statusForm,status:e.target.value})}><option value="planning">Planning</option><option value="active">Active</option><option value="on_hold">On hold</option><option value="completed">Completed</option><option value="cancelled">Cancelled</option></select><input className="input-base" type="number" min="0" max="100" step="1" placeholder="Progress %" value={statusForm.progress_percent} onChange={(e)=>setStatusForm({...statusForm,progress_percent:e.target.value})}/><button disabled={busy} className="btn-primary rounded-xl px-3 py-2 font-black">Update project</button><textarea className="input-base min-h-16 sm:col-span-3" placeholder="Status note" value={statusForm.notes} onChange={(e)=>setStatusForm({...statusForm,notes:e.target.value})}/></form>}</section>
            <section className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Milestones</strong></div><div className="divide-y divide-[var(--line)]">{!selectedMilestones.length&&<p className="p-5 text-sm text-muted">No milestones yet.</p>}{selectedMilestones.map((m)=><div key={m.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><strong>{m.name}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{m.status.replaceAll('_',' ')}</span></div><p className="mt-1 text-xs text-muted">{m.due_date?`Due ${new Date(m.due_date+'T00:00:00').toLocaleDateString()}`:'No due date'} · billing target {money(m.billing_amount,currency)}</p></div>{canManage&&!['completed','cancelled'].includes(m.status)&&<div className="flex gap-2"><button disabled={busy} onClick={()=>updateMilestone(m.id,'in_progress')} className="btn-secondary rounded-lg px-2 py-1 text-xs font-bold">Start</button><button disabled={busy} onClick={()=>updateMilestone(m.id,'completed')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Complete</button></div>}</div>)}</div></section>
            {canManage&&<form onSubmit={addMilestone} className="page-card p-5"><h3 className="font-black">Add milestone</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><input required className="input-base" placeholder="Milestone name" value={milestoneForm.name} onChange={(e)=>setMilestoneForm({...milestoneForm,name:e.target.value})}/><input className="input-base" type="date" value={milestoneForm.due_date} onChange={(e)=>setMilestoneForm({...milestoneForm,due_date:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Billing target" value={milestoneForm.billing_amount} onChange={(e)=>setMilestoneForm({...milestoneForm,billing_amount:e.target.value})}/><textarea className="input-base" placeholder="Description" value={milestoneForm.description} onChange={(e)=>setMilestoneForm({...milestoneForm,description:e.target.value})}/></div><button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 font-black">Add milestone</button></form>}
          </div>
          <div className="space-y-5">
            <section className="page-card p-5"><h3 className="font-black">Budget vs actual</h3><div className="mt-4 space-y-3 text-sm"><div className="flex justify-between"><span className="text-muted">Cost budget</span><strong>{money(selected.budget_cost,currency)}</strong></div><div className="flex justify-between"><span className="text-muted">Actual materials</span><strong>{money(selected.material_cost,currency)}</strong></div><div className="flex justify-between"><span className="text-muted">Actual labour</span><strong>{money(selected.labour_cost,currency)}</strong></div><div className="flex justify-between"><span className="text-muted">Other project expenses</span><strong>{money(selected.expense_cost,currency)}</strong></div><div className="flex justify-between border-t border-[var(--line)] pt-3"><strong>Total actual cost</strong><strong>{money(selected.total_cost,currency)}</strong></div><div className="flex justify-between"><span className="text-muted">Budget remaining</span><strong className={Number(selected.budget_cost)-Number(selected.total_cost)>=0?'text-emerald-600':'text-red-500'}>{money(Number(selected.budget_cost)-Number(selected.total_cost),currency)}</strong></div></div></section>
            <section className="page-card p-5"><h3 className="font-black">Time</h3><div className="mt-3 grid grid-cols-2 gap-3"><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Approved hours</span><strong className="block">{approvedHours.toLocaleString()}h</strong></div><div className="rounded-xl bg-[var(--panel-2)] p-3"><span className="text-xs text-muted">Budget hours</span><strong className="block">{Number(selected.budget_hours||0).toLocaleString()}h</strong></div></div><p className="mt-3 text-xs text-muted">Potential time billing from approved time: {money(billableTime,currency)}</p></section>
            <section className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Project team</strong></div><div className="divide-y divide-[var(--line)]">{selectedMembers.map((m)=><div key={m.id} className="p-4"><strong>{userName(m.user_id)}</strong><p className="mt-1 text-xs text-muted">{m.project_role.replaceAll('_',' ')}{m.cost_rate!=null?` · cost ${money(m.cost_rate,currency)}/h`:''}{m.billing_rate!=null?` · bill ${money(m.billing_rate,currency)}/h`:''}</p></div>)}</div></section>
            {canManage&&<form onSubmit={assignMember} className="page-card p-5"><h3 className="font-black">Assign team member</h3><select className="input-base mt-3" value={memberForm.user_id} onChange={(e)=>setMemberForm({...memberForm,user_id:e.target.value})}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input className="input-base mt-3" placeholder="Project role" value={memberForm.project_role} onChange={(e)=>setMemberForm({...memberForm,project_role:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-3"><input className="input-base" type="number" min="0" step="0.01" placeholder="Cost / hour" value={memberForm.cost_rate} onChange={(e)=>setMemberForm({...memberForm,cost_rate:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Billing / hour" value={memberForm.billing_rate} onChange={(e)=>setMemberForm({...memberForm,billing_rate:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-2 font-black">Assign / update member</button></form>}
          </div>
        </div>}

        {detailTab==='tasks'&&<div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
          {canManage&&<form onSubmit={addTask} className="page-card h-fit p-5"><h3 className="font-black">Add task</h3><input required className="input-base mt-3" placeholder="Task title" value={taskForm.title} onChange={(e)=>setTaskForm({...taskForm,title:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Description" value={taskForm.description} onChange={(e)=>setTaskForm({...taskForm,description:e.target.value})}/><select className="input-base mt-3" value={taskForm.milestone_id} onChange={(e)=>setTaskForm({...taskForm,milestone_id:e.target.value})}><option value="">No milestone</option>{selectedMilestones.filter((m)=>m.status!=='cancelled').map((m)=><option key={m.id} value={m.id}>{m.name}</option>)}</select><select className="input-base mt-3" value={taskForm.assigned_user_id} onChange={(e)=>setTaskForm({...taskForm,assigned_user_id:e.target.value})}><option value="">Unassigned</option>{selectedMembers.map((m)=><option key={m.user_id} value={m.user_id}>{userName(m.user_id)}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-3"><select className="input-base" value={taskForm.priority} onChange={(e)=>setTaskForm({...taskForm,priority:e.target.value})}><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select><input className="input-base" type="number" min="0" step="0.25" placeholder="Est. hours" value={taskForm.estimated_hours} onChange={(e)=>setTaskForm({...taskForm,estimated_hours:e.target.value})}/><input className="input-base" type="date" value={taskForm.start_date} onChange={(e)=>setTaskForm({...taskForm,start_date:e.target.value})}/><input className="input-base" type="date" value={taskForm.due_date} onChange={(e)=>setTaskForm({...taskForm,due_date:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Add task</button></form>}
          <div className="space-y-3">{selectedTasks.map((t)=>{const own=t.assigned_user_id===userId;return <article key={t.id} className="page-card p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{t.title}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{t.status.replaceAll('_',' ')}</span>{t.priority==='urgent'&&<span className="text-xs font-black uppercase text-red-500">urgent</span>}</div><p className="mt-1 text-xs text-muted">{t.assigned_user_id?userName(t.assigned_user_id):'Unassigned'}{t.due_date?` · due ${new Date(t.due_date+'T00:00:00').toLocaleDateString()}`:''} · est. {Number(t.estimated_hours||0).toLocaleString()}h</p><div className="mt-2 h-1.5 w-52 max-w-full rounded-full bg-[var(--panel-2)]"><div className="h-full rounded-full bg-[var(--accent)]" style={{width:`${Number(t.progress_percent||0)}%`}}/></div></div>{(canManage||own)&&!['completed','cancelled'].includes(t.status)&&<div className="flex gap-2"><button disabled={busy} onClick={()=>updateTask(t,'in_progress')} className="btn-secondary rounded-lg px-2 py-1 text-xs font-bold">Start</button><button disabled={busy} onClick={()=>updateTask(t,'blocked')} className="btn-secondary rounded-lg px-2 py-1 text-xs font-bold">Block</button><button disabled={busy} onClick={()=>updateTask(t,'completed')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Complete</button></div>}</div></article>})}</div>
        </div>}

        {detailTab==='time'&&<div className="mt-5 grid gap-5 xl:grid-cols-[420px_1fr]">
          {canTime&&<form onSubmit={logTime} className="page-card h-fit p-5"><h3 className="font-black">Log project time</h3>{canManage&&<select className="input-base mt-3" value={timeForm.user_id} onChange={(e)=>setTimeForm({...timeForm,user_id:e.target.value})}>{selectedMembers.map((m)=><option key={m.user_id} value={m.user_id}>{userName(m.user_id)}</option>)}</select>}<select className="input-base mt-3" value={timeForm.task_id} onChange={(e)=>setTimeForm({...timeForm,task_id:e.target.value})}><option value="">General project time</option>{selectedTasks.filter((t)=>!['completed','cancelled'].includes(t.status)).map((t)=><option key={t.id} value={t.id}>{t.title}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-3"><input required className="input-base" type="date" value={timeForm.work_date} onChange={(e)=>setTimeForm({...timeForm,work_date:e.target.value})}/><input required className="input-base" type="number" min="0.25" max="24" step="0.25" placeholder="Hours" value={timeForm.hours} onChange={(e)=>setTimeForm({...timeForm,hours:e.target.value})}/></div><textarea required className="input-base mt-3 min-h-20" placeholder="What was done?" value={timeForm.description} onChange={(e)=>setTimeForm({...timeForm,description:e.target.value})}/><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={timeForm.billable} onChange={(e)=>setTimeForm({...timeForm,billable:e.target.checked})}/> Billable time</label><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Log time</button><p className="mt-2 text-xs text-muted">{canManage?'Manager-entered time is approved immediately.':'Your time is submitted for project-manager approval.'}</p></form>}
          <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Timesheets</strong></div><div className="max-h-[760px] divide-y divide-[var(--line)] overflow-y-auto">{selectedTimesheets.map((t)=><div key={t.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><strong>{userName(t.user_id)} · {Number(t.hours).toLocaleString()}h</strong><p className="mt-1 text-xs text-muted">{t.work_date} · {t.description} · <span className="capitalize">{t.status}</span>{t.billable?' · billable':''}</p></div><div className="text-left sm:text-right"><span className="text-xs text-muted">Cost</span><strong className="block">{money(t.cost_amount,currency)}</strong></div>{canManage&&t.status==='submitted'&&<div className="flex gap-2"><button disabled={busy} onClick={()=>reviewTimesheet(t.id,'rejected')} className="rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white">Reject</button><button disabled={busy} onClick={()=>reviewTimesheet(t.id,'approved')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Approve</button></div>}</div>)}</div></div>
        </div>}

        {detailTab==='costs'&&<div className="mt-5 grid gap-5 xl:grid-cols-2">
          <div className="space-y-5">
            {canCosts&&<form onSubmit={issueMaterial} className="page-card p-5"><h3 className="font-black">Issue material from stock</h3><select required className="input-base mt-3" value={materialForm.product_id} onChange={(e)=>setMaterialForm({...materialForm,product_id:e.target.value})}><option value="">Choose stock item</option>{products.filter((p)=>p.track_inventory).map((p)=>{const b=balances.find((x)=>x.product_id===p.id&&x.location_id===selected.location_id);const available=Number(b?.quantity||0)-Number(b?.reserved_quantity||0);return <option key={p.id} value={p.id}>{p.name}{p.sku?` · ${p.sku}`:''} · available {available.toLocaleString()}</option>})}</select><input required className="input-base mt-3" type="number" min="0.001" step="0.001" placeholder="Quantity" value={materialForm.quantity} onChange={(e)=>setMaterialForm({...materialForm,quantity:e.target.value})}/><input className="input-base mt-3" placeholder="Issue note" value={materialForm.notes} onChange={(e)=>setMaterialForm({...materialForm,notes:e.target.value})}/><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Issue material</button></form>}
            <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Project materials</strong></div><div className="divide-y divide-[var(--line)]">{selectedMaterials.map((m)=><div key={m.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><strong>{m.description}</strong><p className="mt-1 text-xs text-muted">{Number(m.quantity).toLocaleString()} × {money(m.unit_cost,currency)} · <span className="capitalize">{m.status}</span></p></div><strong>{money(m.cost_total,currency)}</strong>{canCosts&&m.status==='issued'&&<button disabled={busy} onClick={()=>reverseMaterial(m.id)} className="rounded-lg border border-red-500/30 px-2 py-1 text-xs font-bold text-red-500">Reverse</button>}</div>)}</div></div>
          </div>
          <div className="space-y-5">
            {canCosts&&<form onSubmit={addExpense} className="page-card p-5"><h3 className="font-black">Project expense</h3><div className="mt-3 grid gap-3 sm:grid-cols-2"><input className="input-base" placeholder="Category" value={expenseForm.category} onChange={(e)=>setExpenseForm({...expenseForm,category:e.target.value})}/><input required className="input-base" type="number" min="0.01" step="0.01" placeholder="Amount" value={expenseForm.amount} onChange={(e)=>setExpenseForm({...expenseForm,amount:e.target.value})}/><input required className="input-base sm:col-span-2" placeholder="Expense description" value={expenseForm.description} onChange={(e)=>setExpenseForm({...expenseForm,description:e.target.value})}/><select className="input-base" value={expenseForm.payment_method} onChange={(e)=>setExpenseForm({...expenseForm,payment_method:e.target.value})}><option value="">Accrued / pay later</option><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="cheque">Cheque</option></select>{expenseForm.payment_method&&expenseForm.payment_method!=='cash'&&<select className="input-base" value={expenseForm.bank_account_id} onChange={(e)=>setExpenseForm({...expenseForm,bank_account_id:e.target.value})}>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}<input className="input-base" placeholder="Reference" value={expenseForm.reference} onChange={(e)=>setExpenseForm({...expenseForm,reference:e.target.value})}/><textarea className="input-base sm:col-span-2" placeholder="Notes" value={expenseForm.notes} onChange={(e)=>setExpenseForm({...expenseForm,notes:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Record project expense</button></form>}
            <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Project expenses</strong></div><div className="divide-y divide-[var(--line)]">{selectedExpenses.map((e)=><div key={e.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><strong>{e.description}</strong><p className="mt-1 text-xs text-muted">{e.category} · {e.expense_date} · <span className="capitalize">{e.status}</span>{e.payment_method?` · ${e.payment_method.replaceAll('_',' ')}`:''}</p></div><strong>{money(e.amount,currency)}</strong>{canCosts&&e.status==='accrued'&&<button type="button" onClick={()=>setPayExpense(e)} className="btn-secondary rounded-lg px-2 py-1 text-xs font-black">Pay</button>}</div>)}</div></div>
          </div>
        </div>}

        {detailTab==='billing'&&<div className="mt-5 grid gap-5 xl:grid-cols-[460px_1fr]">
          {canBilling&&<form onSubmit={createInvoice} className="page-card h-fit p-5"><h3 className="font-black">Create client invoice</h3><p className="mt-1 text-xs text-muted">Invoices require a client on the project.</p><label className="mt-3 block"><span className="mb-1 block text-xs font-bold text-muted">Due date</span><input className="input-base" type="date" value={invoiceForm.due_date} onChange={(e)=>setInvoiceForm({...invoiceForm,due_date:e.target.value})}/></label><div className="mt-4 space-y-3">{invoiceForm.lines.map((line,index)=><div key={index} className="rounded-xl border border-[var(--line)] p-3"><input required className="input-base" placeholder="Line description" value={line.description} onChange={(e)=>setInvoiceLine(index,'description',e.target.value)}/><div className="mt-2 grid grid-cols-2 gap-2"><input required className="input-base" type="number" min="0.001" step="0.001" placeholder="Qty" value={line.quantity} onChange={(e)=>setInvoiceLine(index,'quantity',e.target.value)}/><input required className="input-base" type="number" min="0" step="0.01" placeholder="Unit price" value={line.unit_price} onChange={(e)=>setInvoiceLine(index,'unit_price',e.target.value)}/></div><select className="input-base mt-2" value={line.milestone_id} onChange={(e)=>setInvoiceLine(index,'milestone_id',e.target.value)}><option value="">No linked milestone</option>{selectedMilestones.map((m)=><option key={m.id} value={m.id}>{m.name}</option>)}</select>{invoiceForm.lines.length>1&&<button type="button" onClick={()=>removeInvoiceLine(index)} className="mt-2 text-xs font-bold text-red-500">Remove line</button>}</div>)}</div><button type="button" onClick={addInvoiceLine} className="btn-secondary mt-3 w-full rounded-xl px-3 py-2 text-sm font-bold">+ Add invoice line</button><input className="input-base mt-3" type="number" min="0" step="0.01" placeholder="Tax amount" value={invoiceForm.tax_amount} onChange={(e)=>setInvoiceForm({...invoiceForm,tax_amount:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Invoice notes" value={invoiceForm.notes} onChange={(e)=>setInvoiceForm({...invoiceForm,notes:e.target.value})}/><div className="mt-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span className="text-muted">Invoice total:</span> <strong>{money(invoiceForm.lines.reduce((s,l)=>s+Number(l.quantity||0)*Number(l.unit_price||0),0)+Number(invoiceForm.tax_amount||0),currency)}</strong></div><button disabled={busy||!selected.customer_id} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Issue invoice</button></form>}
          <div className="space-y-3">{!selectedInvoices.length&&<div className="page-card p-6 text-sm text-muted">No project invoices yet.</div>}{selectedInvoices.map((i)=>{const balance=Math.max(0,Number(i.total_amount)-Number(i.amount_paid));return <article key={i.id} className="page-card p-4"><div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><strong>{i.invoice_number}</strong><span className="rounded-full bg-[var(--panel-2)] px-2 py-1 text-[10px] font-black uppercase text-muted">{i.status}</span></div><p className="mt-1 text-xs text-muted">Issued {i.issue_date}{i.due_date?` · due ${i.due_date}`:''} · paid {money(i.amount_paid,currency)}</p></div><div className="text-left sm:text-right"><span className="text-xs text-muted">Total</span><strong className="block">{money(i.total_amount,currency)}</strong>{balance>0&&<small className="text-amber-600">Balance {money(balance,currency)}</small>}</div><div className="flex gap-2"><Link href={`/projects/invoices/${i.id}`} className="btn-secondary rounded-lg px-2 py-1 text-xs font-black">Invoice</Link>{canBilling&&['issued','partial'].includes(i.status)&&<button type="button" onClick={()=>{setPayInvoice(i);setPaymentForm((v)=>({...v,amount:String(balance)}))}} className="btn-primary rounded-lg px-2 py-1 text-xs font-black">Receive</button>}</div></div></article>})}</div>
        </div>}

        {detailTab==='history'&&<div className="mt-5 page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Project activity</strong></div><div className="max-h-[760px] divide-y divide-[var(--line)] overflow-y-auto">{selectedEvents.map((e)=><div key={e.id} className="p-4"><strong className="capitalize">{e.event_type.replaceAll('_',' ')}</strong><p className="mt-1 text-sm text-muted">{e.description}</p><p className="mt-1 text-xs text-muted">{userName(e.user_id)} · {new Date(e.created_at).toLocaleString()}</p></div>)}</div></div>}
      </div>
    </div>}

    {payInvoice&&<div className="fixed inset-0 z-[120] overflow-y-auto bg-black/60 p-4 sm:p-8"><form onSubmit={recordPayment} className="mx-auto max-w-lg rounded-3xl bg-[var(--panel)] p-5 shadow-2xl"><div className="flex justify-between gap-4"><div><p className="page-eyebrow">Receive project payment</p><h2 className="text-xl font-black">{payInvoice.invoice_number}</h2><p className="mt-1 text-sm text-muted">Balance {money(Number(payInvoice.total_amount)-Number(payInvoice.amount_paid),currency)}</p></div><button type="button" onClick={()=>setPayInvoice(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><input required className="input-base mt-4" type="number" min="0.01" max={Math.max(0,Number(payInvoice.total_amount)-Number(payInvoice.amount_paid))} step="0.01" value={paymentForm.amount} onChange={(e)=>setPaymentForm({...paymentForm,amount:e.target.value})}/><select className="input-base mt-3" value={paymentForm.method} onChange={(e)=>setPaymentForm({...paymentForm,method:e.target.value})}><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="cheque">Cheque</option></select>{paymentForm.method!=='cash'&&<select required className="input-base mt-3" value={paymentForm.bank_account_id} onChange={(e)=>setPaymentForm({...paymentForm,bank_account_id:e.target.value})}><option value="">Choose financial account</option>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}<input className="input-base mt-3" placeholder="Reference" value={paymentForm.reference} onChange={(e)=>setPaymentForm({...paymentForm,reference:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Payment note" value={paymentForm.notes} onChange={(e)=>setPaymentForm({...paymentForm,notes:e.target.value})}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Record payment</button></form></div>}

    {payExpense&&<div className="fixed inset-0 z-[120] overflow-y-auto bg-black/60 p-4 sm:p-8"><form onSubmit={payAccruedExpense} className="mx-auto max-w-lg rounded-3xl bg-[var(--panel)] p-5 shadow-2xl"><div className="flex justify-between gap-4"><div><p className="page-eyebrow">Pay project expense</p><h2 className="text-xl font-black">{payExpense.description}</h2><p className="mt-1 text-sm text-muted">{money(payExpense.amount,currency)}</p></div><button type="button" onClick={()=>setPayExpense(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><select className="input-base mt-4" value={expensePayForm.method} onChange={(e)=>setExpensePayForm({...expensePayForm,method:e.target.value})}><option value="cash">Cash</option><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="card">Card</option><option value="cheque">Cheque</option></select>{expensePayForm.method!=='cash'&&<select required className="input-base mt-3" value={expensePayForm.bank_account_id} onChange={(e)=>setExpensePayForm({...expensePayForm,bank_account_id:e.target.value})}>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}</option>)}</select>}<input className="input-base mt-3" placeholder="Payment reference" value={expensePayForm.reference} onChange={(e)=>setExpensePayForm({...expensePayForm,reference:e.target.value})}/><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Pay & post to Finance</button></form></div>}
  </main>
}
