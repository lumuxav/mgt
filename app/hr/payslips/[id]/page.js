'use client'

import { useEffect,useState } from 'react'
import { useParams } from 'next/navigation'
import { supabase } from '../../../../lib/supabase'
import { getPlatformContext } from '../../../../lib/platformDb'
import { getBusinessConfig } from '../../../../lib/platformConfig'
import { businessDocumentProfile,dateText,DocumentFooter,DocumentHeader,DocumentPaper,DocumentToolbar,money,PartyBlock } from '../../../components/BusinessDocument'

export default function PayslipPage(){
  const {id}=useParams()
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [entry,setEntry]=useState(null)
  const [period,setPeriod]=useState(null)
  const [employee,setEmployee]=useState(null)
  const [profileData,setProfileData]=useState(null)
  const [components,setComponents]=useState([])
  const [department,setDepartment]=useState(null)
  const [message,setMessage]=useState('')
  const [loading,setLoading]=useState(true)

  useEffect(()=>{;(async()=>{
    try{
      const ctx=await getPlatformContext();setContext(ctx)
      const eRes=await supabase.from('payroll_entries').select('*').eq('id',id).maybeSingle()
      if(eRes.error)throw eRes.error;if(!eRes.data)throw new Error('Payslip not found or you do not have access.')
      setEntry(eRes.data)
      const [pRes,uRes,epRes,cRes]=await Promise.all([
        supabase.from('payroll_periods').select('*').eq('id',eRes.data.payroll_period_id).maybeSingle(),
        supabase.from('users').select('id,full_name,email,role,default_location_id').eq('id',eRes.data.user_id).maybeSingle(),
        supabase.from('employee_profiles').select('*').eq('user_id',eRes.data.user_id).maybeSingle(),
        supabase.from('payroll_entry_components').select('*').eq('payroll_entry_id',eRes.data.id).order('created_at')
      ])
      for(const r of [pRes,uRes,epRes,cRes])if(r.error)throw r.error
      setPeriod(pRes.data);setEmployee(uRes.data);setProfileData(epRes.data);setComponents(cRes.data||[])
      if(epRes.data?.department_id){const dRes=await supabase.from('departments').select('id,name,code').eq('id',epRes.data.department_id).maybeSingle();if(!dRes.error)setDepartment(dRes.data)}
    }catch(error){setMessage(error.message||'Could not load payslip.')}finally{setLoading(false)}
  })()},[id])

  if(loading)return <main className="page-wrap text-muted">Loading payslip...</main>
  if(!entry)return <main className="page-wrap"><div className="page-card p-6 text-red-500">{message}</div></main>
  const doc=businessDocumentProfile(context,business),currency=doc.currency
  const allowances=components.filter(x=>x.component_type==='allowance'||x.component_type==='commission')
  const deductions=components.filter(x=>x.component_type==='deduction')

  return <main className="page-wrap">
    <DocumentToolbar backHref="/hr" backLabel="HR & Payroll"/>
    <DocumentPaper size="narrow">
      <DocumentHeader profile={doc} title="Employee Payslip" number={period?.name||'Payroll period'} status={entry.payment_status} meta={(period?.start_date||'')+' → '+(period?.end_date||'')}/>
      <section className="grid gap-4 border-b border-slate-200 py-5 text-sm sm:grid-cols-2">
        <PartyBlock label="Employee" name={employee?.full_name||'Employee'} email={employee?.email} extra={(profileData?.employee_number||'No employee number')+(profileData?.job_title?' · '+profileData.job_title:'')}/>
        <div><span className="block text-xs font-black uppercase tracking-[0.12em] text-slate-400">Employment</span><strong className="mt-1 block">{department?.name||'Department not assigned'}</strong><span className="text-xs capitalize text-slate-500">{String(profileData?.employment_type||'').replaceAll('_',' ')} · {String(profileData?.pay_frequency||'').replaceAll('_',' ')}</span><span className="mt-1 block text-xs text-slate-500">{Number(entry.attendance_days||0).toLocaleString()} attendance day(s) · {Number(entry.attendance_hours||0).toLocaleString()} hrs</span></div>
      </section>
      <section className="grid gap-6 py-5 md:grid-cols-2">
        <div><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Earnings</h2><div className="mt-3 space-y-2 text-sm"><div className="flex justify-between"><span>Base pay</span><strong>{money(entry.base_pay,currency)}</strong></div>{allowances.map(x=><div key={x.id} className="flex justify-between"><span>{x.name}</span><strong>{money(x.amount,currency)}</strong></div>)}<div className="flex justify-between border-t border-slate-200 pt-3"><strong>Gross pay</strong><strong>{money(entry.gross_pay,currency)}</strong></div></div></div>
        <div><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Deductions</h2><div className="mt-3 space-y-2 text-sm">{!deductions.length&&<p className="text-slate-500">No deductions.</p>}{deductions.map(x=><div key={x.id} className="flex justify-between"><span>{x.name}</span><strong>- {money(x.amount,currency)}</strong></div>)}<div className="flex justify-between border-t border-slate-200 pt-3"><strong>Total deductions</strong><strong>{money(entry.deductions,currency)}</strong></div></div></div>
      </section>
      <section className="rounded-2xl bg-slate-50 p-5"><div className="flex items-end justify-between gap-4"><div><span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Net pay</span><p className="mt-1 text-xs text-slate-500">{entry.payment_status==='paid'&&entry.paid_at?'Paid '+dateText(entry.paid_at,true):'Awaiting payment'}{entry.payment_method?' · '+String(entry.payment_method).replaceAll('_',' '):''}{entry.payment_reference?' · Ref '+entry.payment_reference:''}</p></div><strong className="text-2xl">{money(entry.net_pay,currency)}</strong></div></section>
      {profileData?.bank_name&&<section className="mt-5 border-t border-slate-200 pt-5 text-sm"><h2 className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Payment details on file</h2><p className="mt-2 text-slate-600">{[profileData.bank_name,profileData.bank_account_name,profileData.bank_account_number].filter(Boolean).join(' · ')}</p></section>}
      <DocumentFooter profile={{...doc,terms:''}} note="This payslip reflects the approved payroll record for the stated period."/>
    </DocumentPaper>
  </main>
}
