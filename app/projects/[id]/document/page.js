'use client'

import { useEffect,useMemo,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,money,PartyBlock,shareDocument } from '../../../components/BusinessDocument'

export default function ProjectDocumentPage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [project,setProject]=useState(null)
  const [members,setMembers]=useState([])
  const [milestones,setMilestones]=useState([])
  const [tasks,setTasks]=useState([])
  const [invoices,setInvoices]=useState([])
  const [users,setUsers]=useState([])
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const pRes=await supabase.from('projects').select('*,customers(name,phone,email,address),locations(name,type)').eq('id',id).maybeSingle()
      if(pRes.error)throw pRes.error;if(!pRes.data)throw new Error('Project not found.')
      setProject(pRes.data)
      const [memberRes,milestoneRes,taskRes,invoiceRes,userRes]=await Promise.all([
        supabase.from('project_members').select('id,user_id,project_role').eq('project_id',id).eq('active',true).order('created_at'),
        supabase.from('project_milestones').select('*').eq('project_id',id).order('due_date'),
        supabase.from('project_tasks').select('id,title,status,priority,due_date,progress_percent,assigned_user_id').eq('project_id',id).order('due_date'),
        supabase.from('project_invoices').select('id,invoice_number,status,total_amount,amount_paid,issue_date,due_date').eq('project_id',id).order('issue_date'),
        supabase.from('users').select('id,full_name').eq('organization_id',pRes.data.organization_id).eq('active',true)
      ])
      for(const r of [memberRes,milestoneRes,taskRes,invoiceRes,userRes])if(r.error)throw r.error
      setMembers(memberRes.data||[]);setMilestones(milestoneRes.data||[]);setTasks(taskRes.data||[]);setInvoices(invoiceRes.data||[]);setUsers(userRes.data||[])
    }catch(error){setMessage(error.message||'Could not load project document.')}finally{setLoading(false)}
  })()},[id])

  const summary=useMemo(()=>({
    invoiced:invoices.filter(x=>x.status!=='void').reduce((s,x)=>s+Number(x.total_amount||0),0),
    paid:invoices.filter(x=>x.status!=='void').reduce((s,x)=>s+Number(x.amount_paid||0),0),
    completedTasks:tasks.filter(x=>x.status==='completed').length
  }),[invoices,tasks])

  if(loading)return <main className="page-wrap text-muted">Loading project summary...</main>
  if(!project)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const profile=businessDocumentProfile(context,business),currency=profile.currency
  const userName=userId=>users.find(x=>x.id===userId)?.full_name||'Unassigned'
  const share=async()=>{await shareDocument({title:'Project '+project.project_number,lines:[profile.tradingName,'Project Summary '+project.project_number,project.name,'Client: '+(project.customers?.name||'Client'),'Progress: '+Number(project.progress_percent||0).toLocaleString()+'%']});setMessage('Project summary details copied/shared.')}

  return <main className="page-wrap">
    <DocumentToolbar backHref="/projects" backLabel="Projects" onShare={share}/>
    {message&&<div className="mb-4 rounded-xl border border-[var(--line)] p-3 text-sm print:hidden">{message}</div>}
    <DocumentPaper>
      <DocumentHeader profile={profile} location={project.locations} title="Project Summary" number={project.project_number} status={project.status} meta={project.name}/>
      <section className="grid gap-5 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Client" name={project.customers?.name||'Client'} phone={project.customers?.phone} email={project.customers?.email} address={project.customers?.address}/>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Project management</span><strong className="mt-1 block">{userName(project.manager_user_id)}</strong><span className="mt-1 block text-xs text-slate-500">{dateText(project.start_date)} → {project.due_date?dateText(project.due_date):'No due date'}</span><span className="mt-0.5 block text-xs capitalize text-slate-500">Priority: {String(project.priority||'normal').replaceAll('_',' ')}</span></div>
      </section>
      {project.description&&<section className="border-b border-slate-200 py-5 text-sm"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Project scope</h2><p className="mt-2 whitespace-pre-wrap text-slate-700">{project.description}</p></section>}

      <section className="grid gap-3 border-b border-slate-200 py-5 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Progress</span><strong className="mt-1 block text-xl">{Number(project.progress_percent||0).toLocaleString()}%</strong></div>
        <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Contract value</span><strong className="mt-1 block text-xl">{money(project.contract_value,currency)}</strong></div>
        <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Budget / actual cost</span><strong className="mt-1 block">{money(project.budget_cost,currency)}</strong><span className="text-xs text-slate-500">{money(project.total_cost,currency)} actual</span></div>
        <div className="rounded-xl bg-slate-50 p-4"><span className="text-xs text-slate-500">Gross profit</span><strong className={'mt-1 block text-xl '+(Number(project.gross_profit||0)>=0?'text-emerald-700':'text-red-600')}>{money(project.gross_profit,currency)}</strong></div>
      </section>

      <section className="grid gap-5 border-b border-slate-200 py-5 md:grid-cols-2">
        <div><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Project team</h2><div className="mt-3 space-y-2">{!members.length&&<p className="text-sm text-slate-500">No project team members recorded.</p>}{members.map(x=><div key={x.id} className="flex justify-between gap-3 text-sm"><strong>{userName(x.user_id)}</strong><span className="capitalize text-slate-500">{String(x.project_role||'member').replaceAll('_',' ')}</span></div>)}</div></div>
        <div><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Cost breakdown</h2><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span>Materials</span><strong>{money(project.material_cost,currency)}</strong></div><div className="flex justify-between"><span>Labour</span><strong>{money(project.labour_cost,currency)}</strong></div><div className="flex justify-between"><span>Other expenses</span><strong>{money(project.expense_cost,currency)}</strong></div><div className="flex justify-between border-t border-slate-200 pt-2"><strong>Total cost</strong><strong>{money(project.total_cost,currency)}</strong></div></div></div>
      </section>

      <section className="border-b border-slate-200 py-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Milestones</h2><div className="mt-3 divide-y divide-slate-100">{!milestones.length&&<p className="text-sm text-slate-500">No milestones recorded.</p>}{milestones.map(x=><div key={x.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.name}</strong>{x.description&&<p className="mt-1 text-xs text-slate-500">{x.description}</p>}</div><span className="capitalize text-slate-500">{String(x.status).replaceAll('_',' ')}</span><span>{x.due_date?dateText(x.due_date):'No due date'}</span></div>)}</div></section>

      <section className="border-b border-slate-200 py-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Task status</h2><div className="mt-3 divide-y divide-slate-100">{!tasks.length&&<p className="text-sm text-slate-500">No project tasks recorded.</p>}{tasks.map(x=><div key={x.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.title}</strong><p className="mt-1 text-xs text-slate-500">{userName(x.assigned_user_id)}</p></div><span>{Number(x.progress_percent||0).toLocaleString()}%</span><span className="capitalize text-slate-500">{String(x.status).replaceAll('_',' ')}</span></div>)}</div><p className="mt-3 text-xs text-slate-500">{summary.completedTasks} of {tasks.length} task(s) completed.</p></section>

      <section className="py-5"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Client billing</h2><div className="mt-3 divide-y divide-slate-100">{!invoices.length&&<p className="text-sm text-slate-500">No project invoices yet.</p>}{invoices.map(x=><div key={x.id} className="grid gap-2 py-3 text-sm sm:grid-cols-[1fr_auto_auto]"><div><strong>{x.invoice_number}</strong><p className="text-xs text-slate-500">{dateText(x.issue_date)} · {x.status}</p></div><span>{money(x.total_amount,currency)}</span><strong>{money(x.amount_paid,currency)} paid</strong></div>)}</div><div className="mt-4 ml-auto max-w-sm border-t border-slate-200 pt-3 text-sm"><div className="flex justify-between"><span>Total invoiced</span><strong>{money(summary.invoiced,currency)}</strong></div><div className="mt-2 flex justify-between"><span>Total paid</span><strong>{money(summary.paid,currency)}</strong></div><div className="mt-2 flex justify-between"><span>Outstanding</span><strong>{money(Math.max(0,summary.invoiced-summary.paid),currency)}</strong></div></div></section>

      {project.notes&&<section className="rounded-xl bg-slate-50 p-4 text-sm"><strong>Project notes</strong><p className="mt-1 whitespace-pre-wrap text-slate-600">{project.notes}</p></section>}
      <DocumentFooter profile={{...profile,terms:''}} note="Project summary generated from the current MGT project record."/>
    </DocumentPaper>
  </main>
}
