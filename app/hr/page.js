'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { supabase } from '../../lib/supabase'
import { getPlatformContext } from '../../lib/platformDb'
import { getBusinessConfig } from '../../lib/platformConfig'

const money=(value,currency)=>`${Number(value||0).toLocaleString()} ${currency||''}`.trim()
const today=()=>new Date().toISOString().slice(0,10)

export default function HRPage(){
  const business=getBusinessConfig()
  const [context,setContext]=useState(null)
  const [permissions,setPermissions]=useState([])
  const [users,setUsers]=useState([])
  const [locations,setLocations]=useState([])
  const [departments,setDepartments]=useState([])
  const [profiles,setProfiles]=useState([])
  const [shifts,setShifts]=useState([])
  const [shiftAssignments,setShiftAssignments]=useState([])
  const [attendance,setAttendance]=useState([])
  const [leaveTypes,setLeaveTypes]=useState([])
  const [leaveRequests,setLeaveRequests]=useState([])
  const [payComponents,setPayComponents]=useState([])
  const [periods,setPeriods]=useState([])
  const [entries,setEntries]=useState([])
  const [commissions,setCommissions]=useState([])
  const [bankAccounts,setBankAccounts]=useState([])
  const [sales,setSales]=useState([])
  const [jobs,setJobs]=useState([])
  const [tab,setTab]=useState('myhr')
  const [message,setMessage]=useState(null)
  const [loading,setLoading]=useState(true)
  const [busy,setBusy]=useState(false)

  const [profileUser,setProfileUser]=useState('')
  const [profileForm,setProfileForm]=useState({employee_number:'',department_id:'',job_title:'',hire_date:'',employment_type:'full_time',pay_frequency:'monthly',base_salary:'',daily_rate:'',hourly_rate:'',phone:'',emergency_contact:'',tax_number:'',bank_name:'',bank_account_name:'',bank_account_number:'',mobile_money_number:'',notes:''})
  const [departmentForm,setDepartmentForm]=useState({name:'',code:'',manager_user_id:''})
  const [shiftForm,setShiftForm]=useState({name:'',start_time:'08:00',end_time:'17:00',break_minutes:'60',days_of_week:[1,2,3,4,5]})
  const [shiftEmployee,setShiftEmployee]=useState('')
  const [shiftId,setShiftId]=useState('')
  const [attendanceForm,setAttendanceForm]=useState({user_id:'',work_date:today(),location_id:'',status:'present',check_in:'',check_out:'',break_minutes:'0',notes:''})
  const [leaveForm,setLeaveForm]=useState({leave_type_id:'',start_date:'',end_date:'',reason:''})
  const [leaveTypeForm,setLeaveTypeForm]=useState({name:'',code:'',paid:true,annual_allowance:''})
  const [componentForm,setComponentForm]=useState({user_id:'',component_type:'allowance',name:'',calculation_type:'fixed',value:''})
  const [periodForm,setPeriodForm]=useState({name:'',start_date:'',end_date:''})
  const [commissionForm,setCommissionForm]=useState({user_id:'',amount:'',sale_id:'',work_order_id:'',notes:''})
  const [payTarget,setPayTarget]=useState(null)
  const [payForm,setPayForm]=useState({method:'bank',bank_account_id:'',reference:''})

  const currency=context?.organization?.currency||business.currency||'UGX'
  const userId=context?.user?.id
  const canHrView=permissions.includes('hr.view')||permissions.includes('hr.manage')
  const canHrManage=permissions.includes('hr.manage')
  const canAttendanceManage=permissions.includes('attendance.manage')
  const canLeaveManage=permissions.includes('leave.manage')
  const canPayrollView=permissions.includes('payroll.view')||permissions.includes('payroll.manage')||permissions.includes('payroll.pay')
  const canPayrollManage=permissions.includes('payroll.manage')
  const canPayrollPay=permissions.includes('payroll.pay')
  const canCommission=permissions.includes('commissions.manage')

  const load=async()=>{
    setLoading(true)
    try{
      const ctx=await getPlatformContext()
      setContext(ctx)
      if(!ctx.organization?.id)throw new Error('Complete business setup first.')
      const org=ctx.organization.id

      const [permRes,userRes,locRes,deptRes,profileRes,shiftRes,assignRes,attRes,leaveTypeRes,leaveRes,compRes,periodRes,entryRes,commissionRes,bankRes,saleRes,jobRes]=await Promise.all([
        supabase.rpc('current_permissions'),
        supabase.from('users').select('id,full_name,email,role,default_location_id,active').eq('organization_id',org).eq('active',true).order('full_name'),
        supabase.from('locations').select('id,name,type').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('departments').select('id,name,code,manager_user_id,active').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('employee_profiles').select('*').eq('organization_id',org),
        supabase.from('shifts').select('*').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('employee_shift_assignments').select('*').eq('organization_id',org).order('effective_from',{ascending:false}),
        supabase.from('attendance').select('*').eq('organization_id',org).order('work_date',{ascending:false}).limit(3000),
        supabase.from('leave_types').select('*').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('leave_requests').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(1000),
        supabase.from('employee_pay_components').select('*').eq('organization_id',org).order('created_at',{ascending:false}),
        supabase.rpc('get_scoped_payroll_periods').select('*').eq('organization_id',org).order('start_date',{ascending:false}).limit(200),
        supabase.from('payroll_entries').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(3000),
        supabase.from('employee_commissions').select('*').eq('organization_id',org).order('created_at',{ascending:false}).limit(2000),
        supabase.from('bank_accounts').select('id,name,account_type,provider').eq('organization_id',org).eq('active',true).order('name'),
        supabase.from('sales').select('id,sale_number,total_amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(150),
        supabase.from('work_orders').select('id,job_number,title,final_amount,created_at').eq('organization_id',org).order('created_at',{ascending:false}).limit(150),
      ])

      for(const result of [permRes,userRes,locRes,deptRes,profileRes,shiftRes,assignRes,attRes,leaveTypeRes,leaveRes,compRes,periodRes,entryRes,commissionRes,bankRes,saleRes,jobRes])if(result.error)throw result.error

      setPermissions((permRes.data||[]).map((row)=>row.permission))
      setUsers(userRes.data||[])
      setLocations(locRes.data||[])
      setDepartments(deptRes.data||[])
      setProfiles(profileRes.data||[])
      setShifts(shiftRes.data||[])
      setShiftAssignments(assignRes.data||[])
      setAttendance(attRes.data||[])
      setLeaveTypes(leaveTypeRes.data||[])
      setLeaveRequests(leaveRes.data||[])
      setPayComponents(compRes.data||[])
      setPeriods(periodRes.data||[])
      setEntries(entryRes.data||[])
      setCommissions(commissionRes.data||[])
      setBankAccounts(bankRes.data||[])
      setSales(saleRes.data||[])
      setJobs(jobRes.data||[])

      const defaultLocation=ctx.location?.id||locRes.data?.[0]?.id||''
      const firstUser=userRes.data?.[0]?.id||''
      setProfileUser((v)=>v||firstUser)
      setShiftEmployee((v)=>v||firstUser)
      setShiftId((v)=>v||shiftRes.data?.[0]?.id||'')
      setAttendanceForm((v)=>({...v,user_id:v.user_id||firstUser,location_id:v.location_id||defaultLocation}))
      setLeaveForm((v)=>({...v,leave_type_id:v.leave_type_id||leaveTypeRes.data?.[0]?.id||''}))
      setComponentForm((v)=>({...v,user_id:v.user_id||firstUser}))
      setCommissionForm((v)=>({...v,user_id:v.user_id||firstUser}))
      setPayForm((v)=>({...v,bank_account_id:v.bank_account_id||bankRes.data?.[0]?.id||''}))
    }catch(error){
      setMessage({type:'error',text:error.message||'Could not load HR & payroll.'})
    }finally{setLoading(false)}
  }

  useEffect(()=>{load()},[])

  useEffect(()=>{
    if(!profileUser)return
    const p=profiles.find((row)=>row.user_id===profileUser)
    setProfileForm({
      employee_number:p?.employee_number||'',department_id:p?.department_id||'',job_title:p?.job_title||'',
      hire_date:p?.hire_date||'',employment_type:p?.employment_type||'full_time',pay_frequency:p?.pay_frequency||'monthly',
      base_salary:p?.base_salary??'',daily_rate:p?.daily_rate??'',hourly_rate:p?.hourly_rate??'',phone:p?.phone||'',
      emergency_contact:p?.emergency_contact||'',tax_number:p?.tax_number||'',bank_name:p?.bank_name||'',
      bank_account_name:p?.bank_account_name||'',bank_account_number:p?.bank_account_number||'',
      mobile_money_number:p?.mobile_money_number||'',notes:p?.notes||''
    })
  },[profileUser,profiles])

  const userName=(id)=>users.find((u)=>u.id===id)?.full_name||'Employee'
  const locationName=(id)=>locations.find((l)=>l.id===id)?.name||'Location'
  const departmentName=(id)=>departments.find((d)=>d.id===id)?.name||'No department'
  const shiftName=(id)=>shifts.find((s)=>s.id===id)?.name||'No shift'

  const ownAttendance=attendance.filter((row)=>row.user_id===userId)
  const ownToday=ownAttendance.find((row)=>row.work_date===today())
  const ownLeaves=leaveRequests.filter((row)=>row.user_id===userId)
  const ownEntries=entries.filter((row)=>row.user_id===userId)
  const ownProfile=profiles.find((row)=>row.user_id===userId)
  const ownShift=shiftAssignments.find((row)=>row.user_id===userId&&(!row.effective_to||row.effective_to>=today()))

  const clockIn=async()=>{
    setBusy(true);setMessage(null)
    const location=context?.location?.id||users.find((u)=>u.id===userId)?.default_location_id||locations[0]?.id
    const {error}=await supabase.rpc('clock_in',{p_location_id:location})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Clock-in recorded.'});await load()}
    setBusy(false)
  }
  const clockOut=async()=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('clock_out')
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Clock-out recorded.'});await load()}
    setBusy(false)
  }

  const saveProfile=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=profileForm
    const {error}=await supabase.rpc('upsert_employee_hr_profile',{
      p_user_id:profileUser,p_employee_number:f.employee_number||null,p_department_id:f.department_id||null,
      p_job_title:f.job_title||null,p_hire_date:f.hire_date||null,p_employment_type:f.employment_type,
      p_pay_frequency:f.pay_frequency,p_base_salary:Number(f.base_salary||0),p_daily_rate:Number(f.daily_rate||0),
      p_hourly_rate:Number(f.hourly_rate||0),p_phone:f.phone||null,p_emergency_contact:f.emergency_contact||null,
      p_tax_number:f.tax_number||null,p_bank_name:f.bank_name||null,p_bank_account_name:f.bank_account_name||null,
      p_bank_account_number:f.bank_account_number||null,p_mobile_money_number:f.mobile_money_number||null,p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Employee HR profile saved.'});await load()}
    setBusy(false)
  }

  const addDepartment=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.from('departments').insert({organization_id:context.organization.id,name:departmentForm.name.trim(),code:departmentForm.code.trim()||null,manager_user_id:departmentForm.manager_user_id||null})
    if(error)setMessage({type:'error',text:error.message});else{setDepartmentForm({name:'',code:'',manager_user_id:''});setMessage({type:'success',text:'Department added.'});await load()}
    setBusy(false)
  }

  const addShift=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.from('shifts').insert({organization_id:context.organization.id,name:shiftForm.name.trim(),start_time:shiftForm.start_time,end_time:shiftForm.end_time,break_minutes:Number(shiftForm.break_minutes||0),days_of_week:shiftForm.days_of_week})
    if(error)setMessage({type:'error',text:error.message});else{setShiftForm({name:'',start_time:'08:00',end_time:'17:00',break_minutes:'60',days_of_week:[1,2,3,4,5]});setMessage({type:'success',text:'Shift added.'});await load()}
    setBusy(false)
  }

  const assignShift=async()=>{
    if(!shiftEmployee||!shiftId)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.from('employee_shift_assignments').insert({organization_id:context.organization.id,user_id:shiftEmployee,shift_id:shiftId,effective_from:today(),created_by:userId})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Shift assignment added.'});await load()}
    setBusy(false)
  }

  const recordAttendance=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const f=attendanceForm
    const {error}=await supabase.rpc('record_attendance',{
      p_user_id:f.user_id,p_work_date:f.work_date,p_location_id:f.location_id||null,p_status:f.status,
      p_check_in:f.check_in?new Date(f.check_in).toISOString():null,p_check_out:f.check_out?new Date(f.check_out).toISOString():null,
      p_break_minutes:Number(f.break_minutes||0),p_notes:f.notes||null
    })
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Attendance record saved.'});await load()}
    setBusy(false)
  }

  const submitLeave=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {data,error}=await supabase.rpc('submit_leave_request',{p_leave_type_id:leaveForm.leave_type_id,p_start_date:leaveForm.start_date,p_end_date:leaveForm.end_date,p_reason:leaveForm.reason||null})
    if(error)setMessage({type:'error',text:error.message});else{setLeaveForm((v)=>({...v,start_date:'',end_date:'',reason:''}));setMessage({type:'success',text:`Leave request submitted for ${Number(data?.total_days||0).toLocaleString()} work day(s).`});await load()}
    setBusy(false)
  }

  const reviewLeave=async(id,decision)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('review_leave_request',{p_leave_request_id:id,p_decision:decision,p_notes:null})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:`Leave ${decision}.`});await load()}
    setBusy(false)
  }

  const addLeaveType=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.from('leave_types').insert({organization_id:context.organization.id,name:leaveTypeForm.name.trim(),code:leaveTypeForm.code.trim()||null,paid:leaveTypeForm.paid,annual_allowance:leaveTypeForm.annual_allowance===''?null:Number(leaveTypeForm.annual_allowance)})
    if(error)setMessage({type:'error',text:error.message});else{setLeaveTypeForm({name:'',code:'',paid:true,annual_allowance:''});setMessage({type:'success',text:'Leave type added.'});await load()}
    setBusy(false)
  }

  const addComponent=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.from('employee_pay_components').insert({organization_id:context.organization.id,user_id:componentForm.user_id,component_type:componentForm.component_type,name:componentForm.name.trim(),calculation_type:componentForm.calculation_type,value:Number(componentForm.value||0),created_by:userId})
    if(error)setMessage({type:'error',text:error.message});else{setComponentForm((v)=>({...v,name:'',value:''}));setMessage({type:'success',text:'Pay component added.'});await load()}
    setBusy(false)
  }

  const deleteComponent=async(id)=>{
    setBusy(true);const {error}=await supabase.from('employee_pay_components').delete().eq('id',id)
    if(error)setMessage({type:'error',text:error.message});else await load()
    setBusy(false)
  }

  const createPeriod=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('create_payroll_period',{p_name:periodForm.name,p_start_date:periodForm.start_date,p_end_date:periodForm.end_date})
    if(error)setMessage({type:'error',text:error.message});else{setPeriodForm({name:'',start_date:'',end_date:''});setMessage({type:'success',text:'Payroll period created.'});await load()}
    setBusy(false)
  }

  const calculatePeriod=async(id)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('calculate_payroll_period',{p_payroll_period_id:id})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Payroll calculated.'});await load()}
    setBusy(false)
  }
  const approvePeriod=async(id)=>{
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('approve_payroll_period',{p_payroll_period_id:id})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:'Payroll approved and ready for payment.'});await load()}
    setBusy(false)
  }

  const payEntry=async(event)=>{
    event.preventDefault();if(!payTarget)return
    setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('record_payroll_payment',{p_payroll_entry_id:payTarget.id,p_method:payForm.method,p_bank_account_id:payForm.method==='cash'?null:(payForm.bank_account_id||null),p_reference:payForm.reference||null})
    if(error)setMessage({type:'error',text:error.message});else{setPayTarget(null);setPayForm((v)=>({...v,reference:''}));setMessage({type:'success',text:'Payroll payment recorded in Finance.'});await load()}
    setBusy(false)
  }

  const addCommission=async(event)=>{
    event.preventDefault();setBusy(true);setMessage(null)
    const {error}=await supabase.rpc('create_employee_commission',{p_user_id:commissionForm.user_id,p_amount:Number(commissionForm.amount),p_sale_id:commissionForm.sale_id||null,p_work_order_id:commissionForm.work_order_id||null,p_notes:commissionForm.notes||null})
    if(error)setMessage({type:'error',text:error.message});else{setCommissionForm((v)=>({...v,amount:'',sale_id:'',work_order_id:'',notes:''}));setMessage({type:'success',text:'Commission created for review.'});await load()}
    setBusy(false)
  }
  const reviewCommission=async(id,decision)=>{
    setBusy(true);const {error}=await supabase.rpc('review_employee_commission',{p_commission_id:id,p_decision:decision})
    if(error)setMessage({type:'error',text:error.message});else{setMessage({type:'success',text:`Commission ${decision}.`});await load()}
    setBusy(false)
  }

  const days=['Mon','Tue','Wed','Thu','Fri','Sat','Sun']
  const pendingLeaves=leaveRequests.filter((r)=>r.status==='pending')
  const pendingCommissions=commissions.filter((c)=>c.status==='pending')
  const currentPeriod=periods[0]
  const activeStaff=users.length
  const todayPresent=attendance.filter((a)=>a.work_date===today()&&['present','late','half_day'].includes(a.status)).length

  if(loading)return <main className="page-wrap text-muted">Loading HR & payroll...</main>

  return <main className="page-wrap">
    <div className="page-header-row">
      <div><p className="page-eyebrow">People</p><h1 className="page-title">HR & Payroll</h1><p className="page-subtitle">Employee records, attendance, shifts, leave, compensation, commissions, payroll and payslips.</p></div>
      {canHrView&&<Link href="/users" className="btn-secondary rounded-xl px-4 py-2 text-sm font-bold">Staff & Access</Link>}
    </div>

    {message&&<div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.type==='error'?'border-red-500/30 bg-red-500/10 text-red-500':'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'}`}>{message.text}</div>}

    <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="page-card p-4"><p className="text-xs text-muted">Active staff</p><strong className="mt-2 block text-2xl">{activeStaff}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Clocked / marked today</p><strong className="mt-2 block text-2xl">{todayPresent}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Pending leave</p><strong className="mt-2 block text-2xl text-amber-600">{pendingLeaves.length}</strong></div>
      <div className="page-card p-4"><p className="text-xs text-muted">Latest payroll</p><strong className="mt-2 block text-lg">{currentPeriod?money(currentPeriod.total_net,currency):'Not created'}</strong></div>
    </section>

    <div className="mb-5 flex gap-2 overflow-x-auto rounded-2xl bg-[var(--panel-2)] p-1">
      <button type="button" onClick={()=>setTab('myhr')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='myhr'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>My HR</button>
      {canHrView&&<button type="button" onClick={()=>setTab('people')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='people'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>People</button>}
      {(canHrView||canAttendanceManage)&&<button type="button" onClick={()=>setTab('attendance')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='attendance'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>Attendance & Shifts</button>}
      {(permissions.includes('leave.request')||canLeaveManage)&&<button type="button" onClick={()=>setTab('leave')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='leave'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>Leave</button>}
      {canPayrollView&&<button type="button" onClick={()=>setTab('payroll')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='payroll'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>Payroll</button>}
      {canCommission&&<button type="button" onClick={()=>setTab('commissions')} className={`whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-black ${tab==='commissions'?'bg-[var(--panel)] text-accent shadow-sm':'text-muted'}`}>Commissions</button>}
    </div>

    {tab==='myhr'&&<section className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <div className="space-y-5">
        <div className="page-card p-5"><h2 className="font-black">Today</h2><p className="mt-1 text-sm text-muted">{ownToday?ownToday.status.replaceAll('_',' '):'No attendance recorded yet'}</p><div className="mt-4 grid grid-cols-2 gap-2"><button disabled={busy||!!ownToday?.check_in} type="button" onClick={clockIn} className="btn-primary rounded-xl px-3 py-3 font-black disabled:opacity-40">Clock in</button><button disabled={busy||!ownToday?.check_in||!!ownToday?.check_out} type="button" onClick={clockOut} className="btn-secondary rounded-xl px-3 py-3 font-black disabled:opacity-40">Clock out</button></div>{ownToday?.check_in&&<p className="mt-3 text-xs text-muted">In: {new Date(ownToday.check_in).toLocaleTimeString()}{ownToday.check_out?` · Out: ${new Date(ownToday.check_out).toLocaleTimeString()}`:''}</p>}<p className="mt-2 text-xs text-muted">Shift: {ownShift?shiftName(ownShift.shift_id):'No shift assigned'}</p></div>
        <div className="page-card p-5"><h2 className="font-black">My employment</h2><div className="mt-3 space-y-2 text-sm"><p><span className="text-muted">Job title:</span> <strong>{ownProfile?.job_title||'Not set'}</strong></p><p><span className="text-muted">Department:</span> <strong>{departmentName(ownProfile?.department_id)}</strong></p><p><span className="text-muted">Employee #:</span> <strong>{ownProfile?.employee_number||'Not set'}</strong></p><p><span className="text-muted">Pay cycle:</span> <strong className="capitalize">{ownProfile?.pay_frequency||'Not configured'}</strong></p></div></div>
      </div>
      <div className="space-y-5">
        <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Recent attendance</strong></div><div className="divide-y divide-[var(--line)]">{ownAttendance.slice(0,14).map((a)=><div key={a.id} className="flex justify-between gap-4 p-4"><div><strong>{new Date(a.work_date+'T00:00:00').toLocaleDateString()}</strong><p className="mt-1 text-xs text-muted capitalize">{a.status.replaceAll('_',' ')} · {locationName(a.location_id)}</p></div><span className="text-xs text-muted">{a.check_in?new Date(a.check_in).toLocaleTimeString():''}{a.check_out?` – ${new Date(a.check_out).toLocaleTimeString()}`:''}</span></div>)}</div></div>
        <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>My payslips</strong></div><div className="divide-y divide-[var(--line)]">{!ownEntries.length&&<p className="p-5 text-sm text-muted">No payroll entries yet.</p>}{ownEntries.slice(0,12).map((e)=>{const p=periods.find((x)=>x.id===e.payroll_period_id);return <Link key={e.id} href={`/hr/payslips/${e.id}`} className="flex justify-between gap-4 p-4"><div><strong>{p?.name||'Payroll period'}</strong><p className="mt-1 text-xs text-muted capitalize">{e.payment_status} · {Number(e.attendance_days||0).toLocaleString()} payable day(s)</p></div><strong>{money(e.net_pay,currency)}</strong></Link>})}</div></div>
      </div>
    </section>}

    {tab==='people'&&canHrView&&<section className="grid gap-5 xl:grid-cols-[420px_1fr]">
      <div className="space-y-5">
        {canHrManage&&<form onSubmit={addDepartment} className="page-card p-5"><h2 className="font-black">Departments</h2><input required className="input-base mt-3" placeholder="Department name" value={departmentForm.name} onChange={(e)=>setDepartmentForm({...departmentForm,name:e.target.value})}/><input className="input-base mt-3" placeholder="Code" value={departmentForm.code} onChange={(e)=>setDepartmentForm({...departmentForm,code:e.target.value})}/><select className="input-base mt-3" value={departmentForm.manager_user_id} onChange={(e)=>setDepartmentForm({...departmentForm,manager_user_id:e.target.value})}><option value="">No department manager</option>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-3 py-3 font-black">Add department</button><div className="mt-4 space-y-2">{departments.map((d)=><div key={d.id} className="rounded-xl bg-[var(--panel-2)] p-3 text-sm"><strong>{d.name}</strong><p className="mt-1 text-xs text-muted">{d.code||'No code'}{d.manager_user_id?` · ${userName(d.manager_user_id)}`:''}</p></div>)}</div></form>}
        <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Employees</strong></div><div className="max-h-[500px] divide-y divide-[var(--line)] overflow-y-auto">{users.map((u)=>{const p=profiles.find((x)=>x.user_id===u.id);return <button key={u.id} type="button" onClick={()=>setProfileUser(u.id)} className={`w-full p-4 text-left ${profileUser===u.id?'bg-[var(--accent-2)]':''}`}><strong>{u.full_name}</strong><p className="mt-1 text-xs text-muted">{p?.job_title||u.role.replaceAll('_',' ')} · {departmentName(p?.department_id)}</p></button>})}</div></div>
      </div>
      <div className="space-y-5">
        {canHrManage&&<form onSubmit={saveProfile} className="page-card p-5"><h2 className="font-black">Employee HR profile · {userName(profileUser)}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2"><input className="input-base" placeholder="Employee number" value={profileForm.employee_number} onChange={(e)=>setProfileForm({...profileForm,employee_number:e.target.value})}/><input className="input-base" placeholder="Job title" value={profileForm.job_title} onChange={(e)=>setProfileForm({...profileForm,job_title:e.target.value})}/><select className="input-base" value={profileForm.department_id} onChange={(e)=>setProfileForm({...profileForm,department_id:e.target.value})}><option value="">No department</option>{departments.map((d)=><option key={d.id} value={d.id}>{d.name}</option>)}</select><input className="input-base" type="date" value={profileForm.hire_date} onChange={(e)=>setProfileForm({...profileForm,hire_date:e.target.value})}/><select className="input-base" value={profileForm.employment_type} onChange={(e)=>setProfileForm({...profileForm,employment_type:e.target.value})}><option value="full_time">Full time</option><option value="part_time">Part time</option><option value="contract">Contract</option><option value="temporary">Temporary</option><option value="intern">Intern</option><option value="casual">Casual</option></select><select className="input-base" value={profileForm.pay_frequency} onChange={(e)=>setProfileForm({...profileForm,pay_frequency:e.target.value})}><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="daily">Daily</option><option value="hourly">Hourly</option></select><input className="input-base" type="number" min="0" step="0.01" placeholder="Base salary / cycle" value={profileForm.base_salary} onChange={(e)=>setProfileForm({...profileForm,base_salary:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Daily rate" value={profileForm.daily_rate} onChange={(e)=>setProfileForm({...profileForm,daily_rate:e.target.value})}/><input className="input-base" type="number" min="0" step="0.01" placeholder="Hourly rate" value={profileForm.hourly_rate} onChange={(e)=>setProfileForm({...profileForm,hourly_rate:e.target.value})}/><input className="input-base" placeholder="Phone" value={profileForm.phone} onChange={(e)=>setProfileForm({...profileForm,phone:e.target.value})}/><input className="input-base" placeholder="Emergency contact" value={profileForm.emergency_contact} onChange={(e)=>setProfileForm({...profileForm,emergency_contact:e.target.value})}/><input className="input-base" placeholder="Tax / employee tax number" value={profileForm.tax_number} onChange={(e)=>setProfileForm({...profileForm,tax_number:e.target.value})}/><input className="input-base" placeholder="Bank / provider" value={profileForm.bank_name} onChange={(e)=>setProfileForm({...profileForm,bank_name:e.target.value})}/><input className="input-base" placeholder="Account name" value={profileForm.bank_account_name} onChange={(e)=>setProfileForm({...profileForm,bank_account_name:e.target.value})}/><input className="input-base" placeholder="Account number" value={profileForm.bank_account_number} onChange={(e)=>setProfileForm({...profileForm,bank_account_number:e.target.value})}/><input className="input-base" placeholder="Mobile money number" value={profileForm.mobile_money_number} onChange={(e)=>setProfileForm({...profileForm,mobile_money_number:e.target.value})}/><textarea className="input-base min-h-20 sm:col-span-2" placeholder="HR notes" value={profileForm.notes} onChange={(e)=>setProfileForm({...profileForm,notes:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black">Save employee profile</button></form>}
        {(canPayrollManage||canHrManage)&&<form onSubmit={addComponent} className="page-card p-5"><h2 className="font-black">Recurring allowance / deduction</h2><div className="mt-3 grid gap-3 sm:grid-cols-2"><select className="input-base" value={componentForm.user_id} onChange={(e)=>setComponentForm({...componentForm,user_id:e.target.value})}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><select className="input-base" value={componentForm.component_type} onChange={(e)=>setComponentForm({...componentForm,component_type:e.target.value})}><option value="allowance">Allowance</option><option value="deduction">Deduction</option></select><input required className="input-base" placeholder="Name e.g. Housing / Loan" value={componentForm.name} onChange={(e)=>setComponentForm({...componentForm,name:e.target.value})}/><select className="input-base" value={componentForm.calculation_type} onChange={(e)=>setComponentForm({...componentForm,calculation_type:e.target.value})}><option value="fixed">Fixed amount</option><option value="percentage_base">% of base pay</option></select><input required className="input-base sm:col-span-2" type="number" min="0" step="0.01" placeholder={componentForm.calculation_type==='fixed'?'Amount':'Percentage'} value={componentForm.value} onChange={(e)=>setComponentForm({...componentForm,value:e.target.value})}/></div><button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-4 py-3 font-black">Add pay component</button><div className="mt-4 space-y-2">{payComponents.filter((x)=>x.user_id===componentForm.user_id&&x.active).map((x)=><div key={x.id} className="flex items-center justify-between gap-3 rounded-xl bg-[var(--panel-2)] p-3 text-sm"><span><strong>{x.name}</strong><small className="ml-2 text-muted capitalize">{x.component_type} · {x.calculation_type==='fixed'?money(x.value,currency):`${Number(x.value)}%`}</small></span><button type="button" onClick={()=>deleteComponent(x.id)} className="text-red-500">×</button></div>)}</div></form>}
      </div>
    </section>}

    {tab==='attendance'&&(canHrView||canAttendanceManage)&&<section className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="space-y-5">
        {canAttendanceManage&&<form onSubmit={addShift} className="page-card p-5"><h2 className="font-black">Create shift</h2><input required className="input-base mt-3" placeholder="Shift name" value={shiftForm.name} onChange={(e)=>setShiftForm({...shiftForm,name:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-3"><input className="input-base" type="time" value={shiftForm.start_time} onChange={(e)=>setShiftForm({...shiftForm,start_time:e.target.value})}/><input className="input-base" type="time" value={shiftForm.end_time} onChange={(e)=>setShiftForm({...shiftForm,end_time:e.target.value})}/></div><input className="input-base mt-3" type="number" min="0" placeholder="Break minutes" value={shiftForm.break_minutes} onChange={(e)=>setShiftForm({...shiftForm,break_minutes:e.target.value})}/><div className="mt-3 flex flex-wrap gap-2">{days.map((d,i)=>{const n=i+1;const on=shiftForm.days_of_week.includes(n);return <button type="button" key={d} onClick={()=>setShiftForm({...shiftForm,days_of_week:on?shiftForm.days_of_week.filter((x)=>x!==n):[...shiftForm.days_of_week,n].sort()})} className={`rounded-lg px-2 py-1 text-xs font-bold ${on?'bg-[var(--accent)] text-white':'bg-[var(--panel-2)] text-muted'}`}>{d}</button>})}</div><button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-3 py-3 font-black">Save shift</button></form>}
        {canAttendanceManage&&<div className="page-card p-5"><h2 className="font-black">Assign shift</h2><select className="input-base mt-3" value={shiftEmployee} onChange={(e)=>setShiftEmployee(e.target.value)}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><select className="input-base mt-3" value={shiftId} onChange={(e)=>setShiftId(e.target.value)}>{shifts.map((s)=><option key={s.id} value={s.id}>{s.name}</option>)}</select><button disabled={busy||!shiftId} type="button" onClick={assignShift} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Assign from today</button></div>}
        {canAttendanceManage&&<form onSubmit={recordAttendance} className="page-card p-5"><h2 className="font-black">Record / correct attendance</h2><select className="input-base mt-3" value={attendanceForm.user_id} onChange={(e)=>setAttendanceForm({...attendanceForm,user_id:e.target.value})}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input className="input-base mt-3" type="date" value={attendanceForm.work_date} onChange={(e)=>setAttendanceForm({...attendanceForm,work_date:e.target.value})}/><select className="input-base mt-3" value={attendanceForm.location_id} onChange={(e)=>setAttendanceForm({...attendanceForm,location_id:e.target.value})}>{locations.map((l)=><option key={l.id} value={l.id}>{l.name}</option>)}</select><select className="input-base mt-3" value={attendanceForm.status} onChange={(e)=>setAttendanceForm({...attendanceForm,status:e.target.value})}><option value="present">Present</option><option value="late">Late</option><option value="half_day">Half day</option><option value="absent">Absent</option><option value="off">Off</option></select><div className="mt-3 grid grid-cols-2 gap-3"><input className="input-base" type="datetime-local" value={attendanceForm.check_in} onChange={(e)=>setAttendanceForm({...attendanceForm,check_in:e.target.value})}/><input className="input-base" type="datetime-local" value={attendanceForm.check_out} onChange={(e)=>setAttendanceForm({...attendanceForm,check_out:e.target.value})}/></div><input className="input-base mt-3" type="number" min="0" placeholder="Break minutes" value={attendanceForm.break_minutes} onChange={(e)=>setAttendanceForm({...attendanceForm,break_minutes:e.target.value})}/><textarea className="input-base mt-3 min-h-16" placeholder="Notes" value={attendanceForm.notes} onChange={(e)=>setAttendanceForm({...attendanceForm,notes:e.target.value})}/><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-3 py-3 font-black">Save attendance</button></form>}
      </div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Attendance history</strong></div><div className="max-h-[850px] divide-y divide-[var(--line)] overflow-y-auto">{attendance.slice(0,500).map((a)=><div key={a.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><strong>{userName(a.user_id)}</strong><p className="mt-1 text-xs text-muted">{new Date(a.work_date+'T00:00:00').toLocaleDateString()} · {locationName(a.location_id)} · <span className="capitalize">{a.status.replaceAll('_',' ')}</span>{a.paid_leave?' · paid leave':''}</p></div><span className="text-xs text-muted">{a.check_in?new Date(a.check_in).toLocaleTimeString():'—'}{a.check_out?` – ${new Date(a.check_out).toLocaleTimeString()}`:''}</span></div>)}</div></div>
    </section>}

    {tab==='leave'&&<section className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="space-y-5">
        {permissions.includes('leave.request')&&<form onSubmit={submitLeave} className="page-card p-5"><h2 className="font-black">Request leave</h2><select className="input-base mt-3" value={leaveForm.leave_type_id} onChange={(e)=>setLeaveForm({...leaveForm,leave_type_id:e.target.value})}>{leaveTypes.map((t)=><option key={t.id} value={t.id}>{t.name}{t.paid?' · paid':' · unpaid'}</option>)}</select><div className="mt-3 grid grid-cols-2 gap-3"><input required className="input-base" type="date" value={leaveForm.start_date} onChange={(e)=>setLeaveForm({...leaveForm,start_date:e.target.value})}/><input required className="input-base" type="date" value={leaveForm.end_date} onChange={(e)=>setLeaveForm({...leaveForm,end_date:e.target.value})}/></div><textarea className="input-base mt-3 min-h-20" placeholder="Reason" value={leaveForm.reason} onChange={(e)=>setLeaveForm({...leaveForm,reason:e.target.value})}/><button disabled={busy||!leaveForm.leave_type_id} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black">Submit request</button></form>}
        {canLeaveManage&&<form onSubmit={addLeaveType} className="page-card p-5"><h2 className="font-black">Leave types</h2><input required className="input-base mt-3" placeholder="Type name e.g. Annual Leave" value={leaveTypeForm.name} onChange={(e)=>setLeaveTypeForm({...leaveTypeForm,name:e.target.value})}/><input className="input-base mt-3" placeholder="Code" value={leaveTypeForm.code} onChange={(e)=>setLeaveTypeForm({...leaveTypeForm,code:e.target.value})}/><input className="input-base mt-3" type="number" min="0" step="0.5" placeholder="Annual allowance days" value={leaveTypeForm.annual_allowance} onChange={(e)=>setLeaveTypeForm({...leaveTypeForm,annual_allowance:e.target.value})}/><label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" checked={leaveTypeForm.paid} onChange={(e)=>setLeaveTypeForm({...leaveTypeForm,paid:e.target.checked})}/> Paid leave</label><button disabled={busy} className="btn-secondary mt-3 w-full rounded-xl px-4 py-3 font-black">Add leave type</button></form>}
      </div>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>{canLeaveManage?'Leave requests':'My leave requests'}</strong></div><div className="divide-y divide-[var(--line)]">{(canLeaveManage?leaveRequests:ownLeaves).map((r)=>{const t=leaveTypes.find((x)=>x.id===r.leave_type_id);return <div key={r.id} className="p-4"><div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between"><div><div className="flex flex-wrap items-center gap-2"><strong>{canLeaveManage?userName(r.user_id):t?.name||'Leave'}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${r.status==='approved'?'bg-emerald-500/10 text-emerald-600':r.status==='rejected'?'bg-red-500/10 text-red-500':'bg-amber-500/10 text-amber-600'}`}>{r.status}</span></div><p className="mt-1 text-xs text-muted">{t?.name||'Leave'} · {new Date(r.start_date+'T00:00:00').toLocaleDateString()} – {new Date(r.end_date+'T00:00:00').toLocaleDateString()} · {Number(r.total_days).toLocaleString()} work day(s)</p>{r.reason&&<p className="mt-2 text-sm text-muted">{r.reason}</p>}</div>{canLeaveManage&&r.status==='pending'&&<div className="flex gap-2"><button disabled={busy} type="button" onClick={()=>reviewLeave(r.id,'rejected')} className="rounded-xl bg-red-500 px-3 py-2 text-xs font-black text-white">Reject</button><button disabled={busy} type="button" onClick={()=>reviewLeave(r.id,'approved')} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white">Approve</button></div>}</div></div>})}</div></div>
    </section>}

    {tab==='payroll'&&canPayrollView&&<section className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <div className="space-y-5">
        {canPayrollManage&&<form onSubmit={createPeriod} className="page-card p-5"><h2 className="font-black">New payroll period</h2><input required className="input-base mt-3" placeholder="e.g. October 2026 Payroll" value={periodForm.name} onChange={(e)=>setPeriodForm({...periodForm,name:e.target.value})}/><div className="mt-3 grid grid-cols-2 gap-3"><input required className="input-base" type="date" value={periodForm.start_date} onChange={(e)=>setPeriodForm({...periodForm,start_date:e.target.value})}/><input required className="input-base" type="date" value={periodForm.end_date} onChange={(e)=>setPeriodForm({...periodForm,end_date:e.target.value})}/></div><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black">Create payroll period</button></form>}
        <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Payroll periods</strong></div><div className="divide-y divide-[var(--line)]">{periods.map((p)=><div key={p.id} className="p-4"><div className="flex justify-between gap-3"><div><strong>{p.name}</strong><p className="mt-1 text-xs text-muted">{p.start_date} → {p.end_date} · <span className="capitalize">{p.status}</span></p></div><strong>{money(p.total_net,currency)}</strong></div>{canPayrollManage&&<div className="mt-3 flex gap-2">{['draft','calculated'].includes(p.status)&&<button disabled={busy} type="button" onClick={()=>calculatePeriod(p.id)} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">{p.status==='draft'?'Calculate':'Recalculate'}</button>}{p.status==='calculated'&&<button disabled={busy} type="button" onClick={()=>approvePeriod(p.id)} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Approve payroll</button>}</div>}</div>)}</div></div>
      </div>
      <div className="space-y-4">
        {periods.map((p)=>{const rows=entries.filter((e)=>e.payroll_period_id===p.id);if(!rows.length)return null;return <div key={p.id} className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><div className="flex justify-between gap-4"><div><strong>{p.name}</strong><p className="mt-1 text-xs text-muted capitalize">{p.status} · gross {money(p.total_gross,currency)} · deductions {money(p.total_deductions,currency)}</p></div><strong>{money(p.total_net,currency)}</strong></div></div><div className="divide-y divide-[var(--line)]">{rows.map((e)=><div key={e.id} className="grid gap-3 p-4 lg:grid-cols-[1fr_auto_auto] lg:items-center"><div><strong>{userName(e.user_id)}</strong><p className="mt-1 text-xs text-muted">Base {money(e.base_pay,currency)} · allowances {money(e.allowances,currency)} · commissions {money(e.commissions,currency)} · deductions {money(e.deductions,currency)}</p><p className="mt-1 text-xs text-muted">{Number(e.attendance_days||0).toLocaleString()} payable day(s) · {Number(e.attendance_hours||0).toLocaleString()} hours</p></div><div className="text-left lg:text-right"><span className="text-xs text-muted">Net pay</span><strong className="block">{money(e.net_pay,currency)}</strong><span className={`text-[10px] font-black uppercase ${e.payment_status==='paid'?'text-emerald-600':'text-amber-600'}`}>{e.payment_status}</span></div><div className="flex gap-2"><Link href={`/hr/payslips/${e.id}`} className="btn-secondary rounded-xl px-3 py-2 text-xs font-black">Payslip</Link>{canPayrollPay&&p.status==='approved'&&e.payment_status==='unpaid'&&<button type="button" onClick={()=>setPayTarget(e)} className="btn-primary rounded-xl px-3 py-2 text-xs font-black">Pay</button>}</div></div>)}</div></div>})}
      </div>
    </section>}

    {tab==='commissions'&&canCommission&&<section className="grid gap-5 xl:grid-cols-[390px_1fr]">
      <form onSubmit={addCommission} className="page-card h-fit p-5"><h2 className="font-black">Create commission</h2><select className="input-base mt-3" value={commissionForm.user_id} onChange={(e)=>setCommissionForm({...commissionForm,user_id:e.target.value})}>{users.map((u)=><option key={u.id} value={u.id}>{u.full_name}</option>)}</select><input required className="input-base mt-3" type="number" min="0.01" step="0.01" placeholder="Commission amount" value={commissionForm.amount} onChange={(e)=>setCommissionForm({...commissionForm,amount:e.target.value})}/><select className="input-base mt-3" value={commissionForm.sale_id} onChange={(e)=>setCommissionForm({...commissionForm,sale_id:e.target.value,work_order_id:''})}><option value="">No linked sale</option>{sales.map((s)=><option key={s.id} value={s.id}>{s.sale_number||s.id.slice(0,8)} · {money(s.total_amount,currency)}</option>)}</select><select className="input-base mt-3" value={commissionForm.work_order_id} onChange={(e)=>setCommissionForm({...commissionForm,work_order_id:e.target.value,sale_id:''})}><option value="">No linked service job</option>{jobs.map((j)=><option key={j.id} value={j.id}>{j.job_number||'Job'} · {j.title}</option>)}</select><textarea className="input-base mt-3 min-h-20" placeholder="Commission note / reason" value={commissionForm.notes} onChange={(e)=>setCommissionForm({...commissionForm,notes:e.target.value})}/><button disabled={busy} className="btn-primary mt-3 w-full rounded-xl px-4 py-3 font-black">Create commission</button></form>
      <div className="page-card overflow-hidden"><div className="border-b border-[var(--line)] p-4"><strong>Commission history</strong><p className="mt-1 text-xs text-muted">{pendingCommissions.length} pending review</p></div><div className="divide-y divide-[var(--line)]">{commissions.map((c)=><div key={c.id} className="grid gap-3 p-4 sm:grid-cols-[1fr_auto]"><div><div className="flex flex-wrap items-center gap-2"><strong>{userName(c.user_id)}</strong><span className={`rounded-full px-2 py-1 text-[10px] font-black uppercase ${c.status==='approved'?'bg-emerald-500/10 text-emerald-600':c.status==='rejected'?'bg-red-500/10 text-red-500':c.status==='paid'?'bg-blue-500/10 text-blue-600':'bg-amber-500/10 text-amber-600'}`}>{c.status}</span></div><p className="mt-1 text-xs text-muted">{c.sale_id?'Linked sale':c.work_order_id?'Linked service job':'Manual commission'} · {new Date(c.created_at).toLocaleString()}</p>{c.notes&&<p className="mt-1 text-sm text-muted">{c.notes}</p>}</div><div className="text-left sm:text-right"><strong>{money(c.amount,currency)}</strong>{c.status==='pending'&&<div className="mt-2 flex gap-2"><button disabled={busy} type="button" onClick={()=>reviewCommission(c.id,'rejected')} className="rounded-lg bg-red-500 px-2 py-1 text-xs font-bold text-white">Reject</button><button disabled={busy} type="button" onClick={()=>reviewCommission(c.id,'approved')} className="rounded-lg bg-emerald-600 px-2 py-1 text-xs font-bold text-white">Approve</button></div>}</div></div>)}</div></div>
    </section>}

    {payTarget&&<div className="fixed inset-0 z-[100] overflow-y-auto bg-black/60 p-4 sm:p-8"><form onSubmit={payEntry} className="mx-auto max-w-lg rounded-3xl bg-[var(--panel)] p-5 shadow-2xl sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="page-eyebrow">Payroll payment</p><h2 className="text-xl font-black">{userName(payTarget.user_id)}</h2><p className="mt-1 text-sm text-muted">Net pay {money(payTarget.net_pay,currency)}</p></div><button type="button" onClick={()=>setPayTarget(null)} className="rounded-xl border border-[var(--line)] px-3 py-2 font-black">×</button></div><select className="input-base mt-5" value={payForm.method} onChange={(e)=>setPayForm({...payForm,method:e.target.value})}><option value="bank">Bank</option><option value="mobile_money">Mobile Money</option><option value="cash">Cash</option><option value="cheque">Cheque</option></select>{payForm.method!=='cash'&&<select required className="input-base mt-3" value={payForm.bank_account_id} onChange={(e)=>setPayForm({...payForm,bank_account_id:e.target.value})}><option value="">Select financial account</option>{bankAccounts.map((a)=><option key={a.id} value={a.id}>{a.name}{a.provider?` · ${a.provider}`:''}</option>)}</select>}<input className="input-base mt-3" placeholder="Payment reference" value={payForm.reference} onChange={(e)=>setPayForm({...payForm,reference:e.target.value})}/><p className="mt-3 text-xs text-muted">{payForm.method==='cash'?'Cash payroll requires your till to be open at the employee payment location.':'This payment will create a payroll expense and a matching financial-account withdrawal.'}</p><button disabled={busy} className="btn-primary mt-4 w-full rounded-xl px-4 py-3 font-black disabled:opacity-50">{busy?'Recording...':'Record payroll payment'}</button></form></div>}
  </main>
}
