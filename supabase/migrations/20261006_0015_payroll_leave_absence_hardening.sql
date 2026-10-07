-- MGT Business Suite — Payroll leave and absence hardening

alter table public.attendance
 add column if not exists leave_request_id uuid references public.leave_requests(id) on delete set null,
 add column if not exists paid_leave boolean not null default false;

create index if not exists attendance_leave_request_idx on public.attendance(leave_request_id);

create or replace function public.review_leave_request(
 p_leave_request_id uuid,p_decision text,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_req public.leave_requests%rowtype;
 v_shift_days smallint[];
 v_day date;
 v_location uuid;
 v_paid boolean:=false;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('leave.manage') then raise exception 'Permission denied: leave.manage'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 select * into v_req from public.leave_requests
 where id=p_leave_request_id and organization_id=v_org and status='pending' for update;
 if not found then raise exception 'Pending leave request not found'; end if;

 select paid into v_paid from public.leave_types
 where id=v_req.leave_type_id and organization_id=v_org;

 update public.leave_requests set status=p_decision,review_notes=p_notes,reviewed_by=auth.uid(),reviewed_at=now()
 where id=v_req.id;

 if p_decision='approved' then
  select default_location_id into v_location from public.users where id=v_req.user_id;

  select s.days_of_week into v_shift_days
  from public.employee_shift_assignments a join public.shifts s on s.id=a.shift_id
  where a.organization_id=v_org and a.user_id=v_req.user_id and s.active=true
    and a.effective_from<=v_req.start_date and (a.effective_to is null or a.effective_to>=v_req.start_date)
  order by a.effective_from desc limit 1;
  if v_shift_days is null then v_shift_days:=array[1,2,3,4,5]::smallint[]; end if;

  for v_day in select d::date from generate_series(v_req.start_date,v_req.end_date,interval '1 day') d
   where extract(isodow from d)::smallint=any(v_shift_days)
  loop
   insert into public.attendance(
    organization_id,user_id,location_id,work_date,status,notes,created_by,leave_request_id,paid_leave
   )
   values(v_org,v_req.user_id,v_location,v_day,'leave','Approved leave',auth.uid(),v_req.id,coalesce(v_paid,false))
   on conflict(organization_id,user_id,work_date) do nothing;
  end loop;
 end if;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'leave_'||p_decision,'leave_request',v_req.id::text,'Leave request '||p_decision,
  jsonb_build_object('employee_user_id',v_req.user_id,'start_date',v_req.start_date,'end_date',v_req.end_date,'paid',v_paid));

 return jsonb_build_object('leave_request_id',v_req.id,'status',p_decision,'paid',v_paid);
end; $$;

create or replace function public.calculate_payroll_period(p_payroll_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_period public.payroll_periods%rowtype;
 v_emp record;
 v_entry_id uuid;
 v_days_in_period numeric;
 v_days_in_month numeric;
 v_att_days numeric;
 v_att_hours numeric;
 v_unpaid_days numeric;
 v_scheduled_days numeric;
 v_shift_days smallint[];
 v_base numeric(18,2);
 v_allow numeric(18,2);
 v_deduct numeric(18,2);
 v_comm numeric(18,2);
 v_gross numeric(18,2);
 v_net numeric(18,2);
 v_comp record;
 v_amount numeric(18,2);
 v_comm_row record;
 v_total_gross numeric(18,2):=0;
 v_total_deductions numeric(18,2):=0;
 v_total_net numeric(18,2):=0;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.manage') then raise exception 'Permission denied: payroll.manage'; end if;

 select * into v_period from public.payroll_periods
 where id=p_payroll_period_id and organization_id=v_org for update;
 if not found then raise exception 'Payroll period not found'; end if;
 if v_period.status not in ('draft','calculated') then raise exception 'Only draft/calculated payroll can be recalculated'; end if;

 update public.employee_commissions set payroll_entry_id=null
 where organization_id=v_org and payroll_entry_id in(
  select id from public.payroll_entries where payroll_period_id=v_period.id
 );
 delete from public.payroll_entries where payroll_period_id=v_period.id;

 v_days_in_period:=(v_period.end_date-v_period.start_date)+1;
 v_days_in_month:=extract(day from (date_trunc('month',v_period.start_date)+interval '1 month - 1 day'));

 for v_emp in
  select u.id as user_id,u.default_location_id,u.full_name,
         ep.pay_frequency,ep.base_salary,ep.daily_rate,ep.hourly_rate
  from public.users u
  join public.employee_profiles ep on ep.user_id=u.id and ep.organization_id=v_org
  where u.organization_id=v_org and u.active=true and u.archived_at is null
 loop
  select s.days_of_week into v_shift_days
  from public.employee_shift_assignments a join public.shifts s on s.id=a.shift_id
  where a.organization_id=v_org and a.user_id=v_emp.user_id and s.active=true
    and a.effective_from<=v_period.end_date and (a.effective_to is null or a.effective_to>=v_period.start_date)
  order by a.effective_from desc limit 1;
  if v_shift_days is null then v_shift_days:=array[1,2,3,4,5]::smallint[]; end if;

  select count(*)::numeric into v_scheduled_days
  from generate_series(v_period.start_date,v_period.end_date,interval '1 day') d
  where extract(isodow from d)::smallint=any(v_shift_days);

  select
   coalesce(sum(case when a.status in ('present','late') then 1
                     when a.status='leave' and a.paid_leave then 1
                     when a.status='half_day' then 0.5 else 0 end),0),
   coalesce(sum(case when a.check_in is not null and a.check_out is not null
     then greatest(extract(epoch from (a.check_out-a.check_in))/3600.0-(a.break_minutes/60.0),0) else 0 end),0),
   coalesce(sum(case when a.status='absent' then 1
                     when a.status='leave' and not a.paid_leave then 1
                     else 0 end),0)
  into v_att_days,v_att_hours,v_unpaid_days
  from public.attendance a
  where a.organization_id=v_org and a.user_id=v_emp.user_id
    and a.work_date between v_period.start_date and v_period.end_date;

  if v_emp.pay_frequency='monthly' then
   if date_trunc('month',v_period.start_date)=date_trunc('month',v_period.end_date)
      and extract(day from v_period.start_date)=1
      and v_period.end_date=(date_trunc('month',v_period.start_date)+interval '1 month - 1 day')::date then
    v_base:=v_emp.base_salary;
   else
    v_base:=round(v_emp.base_salary*(v_days_in_period/v_days_in_month),2);
   end if;
   if v_scheduled_days>0 and v_unpaid_days>0 then
    v_base:=greatest(round(v_base-(v_base/v_scheduled_days)*v_unpaid_days,2),0);
   end if;
  elsif v_emp.pay_frequency='weekly' then
   v_base:=round(v_emp.base_salary*(v_days_in_period/7.0),2);
   if v_scheduled_days>0 and v_unpaid_days>0 then
    v_base:=greatest(round(v_base-(v_base/v_scheduled_days)*v_unpaid_days,2),0);
   end if;
  elsif v_emp.pay_frequency='daily' then
   v_base:=round(coalesce(nullif(v_emp.daily_rate,0),v_emp.base_salary)*v_att_days,2);
  else
   v_base:=round(coalesce(nullif(v_emp.hourly_rate,0),v_emp.base_salary)*v_att_hours,2);
  end if;

  v_allow:=0; v_deduct:=0;
  insert into public.payroll_entries(
   organization_id,payroll_period_id,user_id,location_id,base_pay,attendance_days,attendance_hours
  )
  values(v_org,v_period.id,v_emp.user_id,v_emp.default_location_id,v_base,v_att_days,round(v_att_hours,2))
  returning id into v_entry_id;

  insert into public.payroll_entry_components(organization_id,payroll_entry_id,component_type,name,amount,source_type)
  values(v_org,v_entry_id,'base','Base pay',v_base,'employee_profile');

  for v_comp in
   select * from public.employee_pay_components
   where organization_id=v_org and user_id=v_emp.user_id and active=true
  loop
   v_amount:=case when v_comp.calculation_type='percentage_base'
     then round(v_base*(v_comp.value/100.0),2) else round(v_comp.value,2) end;
   if v_comp.component_type='allowance' then v_allow:=v_allow+v_amount; else v_deduct:=v_deduct+v_amount; end if;
   insert into public.payroll_entry_components(organization_id,payroll_entry_id,component_type,name,amount,source_type,source_id)
   values(v_org,v_entry_id,v_comp.component_type,v_comp.name,v_amount,'pay_component',v_comp.id);
  end loop;

  v_comm:=0;
  for v_comm_row in
   select * from public.employee_commissions
   where organization_id=v_org and user_id=v_emp.user_id and status='approved'
     and payroll_entry_id is null
     and coalesce(approved_at,created_at)::date between v_period.start_date and v_period.end_date
  loop
   v_comm:=v_comm+v_comm_row.amount;
   update public.employee_commissions set payroll_entry_id=v_entry_id where id=v_comm_row.id;
   insert into public.payroll_entry_components(organization_id,payroll_entry_id,component_type,name,amount,source_type,source_id)
   values(v_org,v_entry_id,'commission','Commission',v_comm_row.amount,'commission',v_comm_row.id);
  end loop;

  v_gross:=v_base+v_allow+v_comm;
  v_net:=greatest(v_gross-v_deduct,0);

  update public.payroll_entries set
   allowances=v_allow,deductions=v_deduct,commissions=v_comm,gross_pay=v_gross,net_pay=v_net
  where id=v_entry_id;

  v_total_gross:=v_total_gross+v_gross;
  v_total_deductions:=v_total_deductions+v_deduct;
  v_total_net:=v_total_net+v_net;
 end loop;

 update public.payroll_periods
 set status='calculated',total_gross=v_total_gross,total_deductions=v_total_deductions,total_net=v_total_net,calculated_at=now()
 where id=v_period.id;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'payroll_calculated','payroll_period',v_period.id::text,v_period.name,
  jsonb_build_object('gross',v_total_gross,'deductions',v_total_deductions,'net',v_total_net));

 return jsonb_build_object('payroll_period_id',v_period.id,'status','calculated','total_gross',v_total_gross,'total_deductions',v_total_deductions,'total_net',v_total_net);
end; $$;
