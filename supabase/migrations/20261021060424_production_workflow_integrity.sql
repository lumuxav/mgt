-- MGT production integrity: preserve existing grants, enforce transaction boundaries.
-- No customer records or role grants are rewritten by this migration.

create or replace function public.mgt_require_modules(p_modules text[])
returns void language plpgsql stable security invoker set search_path=public as $$
begin
 if public.current_organization_id() is null then raise exception 'Active organization required' using errcode='42501'; end if;
 if not exists(select 1 from unnest(p_modules) m where public.current_module_enabled(m)) then
  raise exception 'Required business module is disabled: %',array_to_string(p_modules,' or ') using errcode='42501';
 end if;
end; $$;
revoke all on function public.mgt_require_modules(text[]) from public,anon;
grant execute on function public.mgt_require_modules(text[]) to authenticated,service_role;

create or replace function public.mgt_record_scope_allows(
 p_org uuid,p_location uuid,p_owner uuid,p_secondary_assignment boolean default false
) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(p_org=public.current_organization_id(),false) and coalesce((
 select case s.scope
  when 'organization' then true
  when 'location' then coalesce(s.location_id=p_location,false)
  when 'assigned' then coalesce(p_owner=auth.uid(),false) or coalesce(p_secondary_assignment,false)
  else false end
 from public.user_work_scope s where s.organization_id=p_org and s.user_id=auth.uid()
 ),true)
$$;

create or replace function public.mgt_require_scope(p_location uuid,p_owner uuid default null,p_assigned boolean default false)
returns void language plpgsql stable security invoker set search_path=public as $$
begin
 if not public.mgt_record_scope_allows(public.current_organization_id(),p_location,p_owner,p_assigned) then
  raise exception 'This action is outside your assigned work scope' using errcode='42501';
 end if;
end; $$;
revoke all on function public.mgt_require_scope(uuid,uuid,boolean) from public,anon;
grant execute on function public.mgt_require_scope(uuid,uuid,boolean) to authenticated,service_role;

-- Legacy immediate receiving bypassed approvals, receiving grants and payment
-- controls. Every supported UI now uses create/approve/receive/payment RPCs.
revoke execute on function public.receive_purchase(uuid,uuid,jsonb,numeric,text,text) from public,anon,authenticated;

-- Reject non-finite numeric values on every existing numeric business column.
-- NOT VALID avoids blocking deployment on a historical table scan, while all
-- future inserts/updates are checked. Existing anomalies remain visible to audit.
do $$ declare r record; begin
 for r in
  select c.table_name,string_agg(format('%I::text not in (''NaN'',''Infinity'',''-Infinity'')',c.column_name),' and ' order by c.ordinal_position) as predicate
  from information_schema.columns c
  join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
  where c.table_schema='public' and c.data_type='numeric' group by c.table_name
 loop
  if not exists(select 1 from pg_constraint where conrelid=format('public.%I',r.table_name)::regclass and conname='mgt_finite_numbers') then
   execute format('alter table public.%I add constraint mgt_finite_numbers check (%s) not valid',r.table_name,r.predicate);
  end if;
 end loop;
end $$;


CREATE OR REPLACE FUNCTION public.get_customer_sales_balances()
 RETURNS TABLE(customer_id uuid, name text, phone text, credit_limit numeric, opening_due numeric, sales_due numeric, balance_due numeric, sale_count bigint, last_sale_at timestamp with time zone)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('sales.view') or public.has_permission('sales.create') or public.has_permission('finance.view') or public.has_permission('customers.view') or public.has_permission('payments.view') or public.has_permission('payments.request') or public.has_permission('reports.view')) then raise exception 'Permission denied'; end if;
 return query select c.id,c.name,c.phone,c.credit_limit,
 case when public.mgt_record_scope_allows(v_org,null,null) then greatest(c.opening_balance-c.opening_balance_paid,0) else 0 end,
 coalesce(sum(greatest(s.total_amount-s.refunded_amount-s.amount_paid,0)),0),
 case when public.mgt_record_scope_allows(v_org,null,null) then greatest(c.opening_balance-c.opening_balance_paid,0) else 0 end+coalesce(sum(greatest(s.total_amount-s.refunded_amount-s.amount_paid,0)),0),
 count(s.id) filter(where s.total_amount-s.refunded_amount-s.amount_paid>0.009),max(s.created_at)
 from public.customers c left join public.sales s on s.customer_id=c.id and s.organization_id=v_org and public.mgt_record_scope_allows(v_org,s.location_id,s.sold_by)
 where c.organization_id=v_org group by c.id;
end; $function$;


CREATE OR REPLACE FUNCTION public.create_quotation(p_location_id uuid, p_customer_id uuid, p_issue_date date, p_valid_until date, p_notes text, p_terms text, p_lines jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_id uuid;v_number text;v_line jsonb;
 v_subtotal numeric(18,2):=0;v_discount numeric(18,2):=0;v_tax numeric(18,2):=0;v_total numeric(18,2):=0;
 v_qty numeric(18,3);v_price numeric(18,2);v_disc numeric(18,2);v_line_tax numeric(18,2);v_line_total numeric(18,2);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('documents.manage') then raise exception 'Permission denied: documents.manage'; end if;
 if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org) then raise exception 'Location not found'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org) then raise exception 'Customer not found'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'Add at least one quotation line'; end if;
 if p_valid_until is not null and p_valid_until<coalesce(p_issue_date,current_date) then raise exception 'Valid-until date cannot be before issue date'; end if;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=coalesce(nullif(v_line->>'quantity','')::numeric,0);
  v_price:=coalesce(nullif(v_line->>'unit_price','')::numeric,0);
  v_disc:=coalesce(nullif(v_line->>'discount_amount','')::numeric,0);
  v_line_tax:=coalesce(nullif(v_line->>'tax_amount','')::numeric,0);
  if v_qty<=0 or v_price<0 or v_disc<0 or v_line_tax<0 or coalesce(trim(v_line->>'description'),'')='' then raise exception 'Invalid quotation line'; end if;
  if v_disc>round(v_qty*v_price,2) then raise exception 'Quotation discount cannot exceed line value'; end if;
  v_line_total:=round(v_qty*v_price-v_disc+v_line_tax,2);
  v_subtotal:=v_subtotal+round(v_qty*v_price,2);v_discount:=v_discount+v_disc;v_tax:=v_tax+v_line_tax;v_total:=v_total+v_line_total;
 end loop;

 v_number:='QTN-'||to_char(coalesce(p_issue_date,current_date),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 insert into public.quotations(organization_id,location_id,customer_id,quotation_number,status,issue_date,valid_until,subtotal,discount_amount,tax_amount,total_amount,notes,terms,created_by)
 values(v_org,p_location_id,p_customer_id,v_number,'draft',coalesce(p_issue_date,current_date),p_valid_until,round(v_subtotal,2),round(v_discount,2),round(v_tax,2),round(v_total,2),nullif(trim(p_notes),''),nullif(trim(p_terms),''),auth.uid())
 returning id into v_id;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=coalesce(nullif(v_line->>'quantity','')::numeric,0);
  v_price:=coalesce(nullif(v_line->>'unit_price','')::numeric,0);
  v_disc:=coalesce(nullif(v_line->>'discount_amount','')::numeric,0);
  v_line_tax:=coalesce(nullif(v_line->>'tax_amount','')::numeric,0);
  v_line_total:=round(greatest(v_qty*v_price-v_disc+v_line_tax,0),2);
  insert into public.quotation_items(quotation_id,product_id,description,quantity,unit_price,discount_amount,tax_amount,line_total)
  values(v_id,nullif(v_line->>'product_id','')::uuid,trim(v_line->>'description'),v_qty,v_price,v_disc,v_line_tax,v_line_total);
 end loop;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'quotation_created','quotation',v_id::text,'Quotation created: '||v_number,jsonb_build_object('total_amount',v_total,'customer_id',p_customer_id));
 return v_id;
end; $function$;


CREATE OR REPLACE FUNCTION public.set_work_order_status(p_work_order_id uuid, p_status text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.work_orders%rowtype;
 v_total numeric(18,2);
 v_cost numeric(18,2);
 v_paid numeric(18,2);
 v_payment_status text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage'; end if;
 if p_status not in ('open','scheduled','in_progress','on_hold','completed','cancelled') then raise exception 'Invalid job status'; end if;

 select * into v_order from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status='completed' and p_status<>'completed' then raise exception 'Completed jobs cannot be reopened automatically'; end if;
 if v_order.status='cancelled' then raise exception 'Cancelled jobs cannot be reopened automatically'; end if;
 if p_status='cancelled' and (
  exists(select 1 from public.payments where work_order_id=v_order.id)
  or exists(select 1 from public.work_order_lines where work_order_id=v_order.id and line_type='material')
 ) then raise exception 'Reverse job materials and reconcile payments before cancelling this job'; end if;
 if p_status=v_order.status then return jsonb_build_object('work_order_id',v_order.id,'status',v_order.status); end if;

 select coalesce(sum(line_total),0),coalesce(sum(cost_total),0)
 into v_total,v_cost from public.work_order_lines where work_order_id=v_order.id;

 if v_total<=0 then v_total:=coalesce(v_order.quoted_amount,0); end if;

 select coalesce(sum(case when direction='in' then amount else -amount end),0)
 into v_paid from public.payments where work_order_id=v_order.id;

 v_payment_status:=case
  when v_total>0 and v_paid>=v_total-0.009 then 'paid'
  when v_paid>0 then 'partial'
  else 'unpaid'
 end;

 update public.work_orders
 set status=p_status,
     started_at=case when p_status='in_progress' then coalesce(started_at,now()) else started_at end,
     completed_at=case when p_status='completed' then now() else completed_at end,
     final_amount=v_total,
     final_cost=v_cost,
     gross_profit=v_total-v_cost,
     amount_paid=v_paid,
     payment_status=v_payment_status,
     notes=coalesce(p_notes,notes),
     updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,v_order.id,'status_changed','Job status changed to '||p_status,jsonb_build_object('from_status',v_order.status,'to_status',p_status,'notes',p_notes),auth.uid());

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_order.location_id,auth.uid(),'work_order_status_changed','work_order',v_order.id::text,coalesce(v_order.job_number,v_order.title),
  jsonb_build_object('from_status',v_order.status,'to_status',p_status,'final_amount',v_total,'final_cost',v_cost,'payment_status',v_payment_status));

 return jsonb_build_object('work_order_id',v_order.id,'status',p_status,'final_amount',v_total,'final_cost',v_cost,'gross_profit',v_total-v_cost,'payment_status',v_payment_status);
end; $function$;


CREATE OR REPLACE FUNCTION public.log_project_time(p_project_id uuid, p_task_id uuid, p_work_date date, p_hours numeric, p_description text, p_billable boolean DEFAULT true, p_user_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_user uuid:=coalesce(p_user_id,auth.uid());
 v_member public.project_members%rowtype;
 v_profile public.employee_profiles%rowtype;
 v_cost_rate numeric(18,2):=0;
 v_billing_rate numeric(18,2):=0;
 v_status text:='submitted';
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.time') and not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.time'; end if;
 if p_hours::text in ('NaN','Infinity','-Infinity') or coalesce(p_hours,0)<=0 or p_hours>24 then raise exception 'Hours must be between 0 and 24'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Time description is required'; end if;
 if p_user_id is not null and p_user_id<>auth.uid() and not public.has_permission('projects.manage') then raise exception 'Only project managers can log time for another employee'; end if;

 perform pg_advisory_xact_lock(hashtextextended('mgt-time:'||v_user::text||':'||coalesce(p_work_date,current_date)::text,0));
 if not exists(select 1 from public.users where id=v_user and organization_id=v_org and active and archived_at is null) then raise exception 'Active employee required'; end if;
 -- Totals are updated later in this transaction. Take the update lock now,
 -- avoiding two workers deadlocking while upgrading shared project locks.
 perform 1 from public.projects where id=p_project_id and organization_id=v_org and status not in ('completed','cancelled') for update;
 if not found then raise exception 'Project is closed or unavailable for new time entries'; end if;
 if coalesce((select sum(hours) from public.project_timesheets where organization_id=v_org and user_id=v_user and work_date=coalesce(p_work_date,current_date) and status<>'rejected'),0)+p_hours>24 then
  raise exception 'Daily time entries cannot exceed 24 hours across projects';
 end if;
 select * into v_member from public.project_members
 where project_id=p_project_id and user_id=v_user and organization_id=v_org and active=true;
 if not found then raise exception 'Employee is not an active member of this project'; end if;

 if p_task_id is not null and not exists(
  select 1 from public.project_tasks
  where id=p_task_id and project_id=p_project_id and organization_id=v_org and status<>'cancelled'
 ) then raise exception 'Task not found in this project'; end if;

 v_cost_rate:=coalesce(v_member.cost_rate,0);
 v_billing_rate:=coalesce(v_member.billing_rate,0);

 if v_cost_rate=0 then
  select * into v_profile from public.employee_profiles where user_id=v_user and organization_id=v_org;
  if found then
   if v_profile.hourly_rate>0 then v_cost_rate:=v_profile.hourly_rate;
   elsif v_profile.daily_rate>0 then v_cost_rate:=round(v_profile.daily_rate/8.0,2);
   elsif v_profile.pay_frequency='monthly' and v_profile.base_salary>0 then v_cost_rate:=round(v_profile.base_salary/173.33,2);
   elsif v_profile.pay_frequency='weekly' and v_profile.base_salary>0 then v_cost_rate:=round(v_profile.base_salary/40.0,2);
   elsif v_profile.pay_frequency='daily' and v_profile.base_salary>0 then v_cost_rate:=round(v_profile.base_salary/8.0,2);
   elsif v_profile.pay_frequency='hourly' then v_cost_rate:=v_profile.base_salary;
   end if;
  end if;
 end if;

 if public.has_permission('projects.manage') then v_status:='approved'; end if;

 insert into public.project_timesheets(
  organization_id,project_id,task_id,user_id,work_date,hours,description,billable,cost_rate,billing_rate,
  cost_amount,billable_amount,status
 ) values(
  v_org,p_project_id,p_task_id,v_user,coalesce(p_work_date,current_date),p_hours,trim(p_description),coalesce(p_billable,true),
  v_cost_rate,v_billing_rate,round(p_hours*v_cost_rate,2),
  case when coalesce(p_billable,true) then round(p_hours*v_billing_rate,2) else 0 end,v_status
 ) returning id into v_id;

 if v_status='approved' then perform public.recalculate_project_totals(p_project_id); end if;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,p_project_id,'time_logged',trim(p_description),
  jsonb_build_object('timesheet_id',v_id,'employee_user_id',v_user,'hours',p_hours,'status',v_status),auth.uid());

 return jsonb_build_object('timesheet_id',v_id,'status',v_status,'cost_rate',v_cost_rate,'billing_rate',v_billing_rate);
end; $function$;


CREATE OR REPLACE FUNCTION public.submit_leave_request(p_leave_type_id uuid, p_start_date date, p_end_date date, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
 v_days numeric(8,2);
 v_shift_days smallint[];
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('leave.request') then raise exception 'Permission denied: leave.request'; end if;
 perform pg_advisory_xact_lock(hashtextextended('mgt-leave:'||auth.uid()::text,0));
 if p_start_date is null or p_end_date is null then raise exception 'Leave dates are required'; end if;
 if p_end_date<p_start_date then raise exception 'Leave end date cannot be before start date'; end if;
 if not exists(select 1 from public.leave_types where id=p_leave_type_id and organization_id=v_org and active=true) then raise exception 'Leave type not found'; end if;

 select s.days_of_week into v_shift_days
 from public.employee_shift_assignments a join public.shifts s on s.id=a.shift_id
 where a.organization_id=v_org and a.user_id=auth.uid() and s.active=true
   and a.effective_from<=p_start_date and (a.effective_to is null or a.effective_to>=p_start_date)
 order by a.effective_from desc limit 1;

 if v_shift_days is null then v_shift_days:=array[1,2,3,4,5]::smallint[]; end if;

 select count(*)::numeric into v_days
 from generate_series(p_start_date,p_end_date,interval '1 day') d
 where extract(isodow from d)::smallint=any(v_shift_days);

 if v_days<=0 then raise exception 'Selected dates contain no scheduled work days'; end if;

 if exists(
  select 1 from public.leave_requests
  where organization_id=v_org and user_id=auth.uid() and status in ('pending','approved')
   and daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')
 ) then raise exception 'This leave overlaps an existing leave request'; end if;

 insert into public.leave_requests(organization_id,user_id,leave_type_id,start_date,end_date,total_days,status,reason)
 values(v_org,auth.uid(),p_leave_type_id,p_start_date,p_end_date,v_days,'pending',p_reason)
 returning id into v_id;

 return jsonb_build_object('leave_request_id',v_id,'total_days',v_days,'status','pending');
end; $function$;


CREATE OR REPLACE FUNCTION public.create_payroll_period(p_name text, p_start_date date, p_end_date date)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.manage') then raise exception 'Permission denied: payroll.manage'; end if;
 perform pg_advisory_xact_lock(hashtextextended('mgt-payroll:'||v_org::text,0));
 if p_start_date is null or p_end_date is null then raise exception 'Payroll dates are required'; end if;
 if p_end_date<p_start_date then raise exception 'Payroll end date cannot be before start date'; end if;
 if coalesce(trim(p_name),'')='' then raise exception 'Payroll period name is required'; end if;
 if exists(
  select 1 from public.payroll_periods
  where organization_id=v_org and status<>'cancelled'
   and daterange(start_date,end_date,'[]') && daterange(p_start_date,p_end_date,'[]')
 ) then raise exception 'Payroll period overlaps an existing active period'; end if;

 insert into public.payroll_periods(organization_id,name,start_date,end_date,status,created_by)
 values(v_org,trim(p_name),p_start_date,p_end_date,'draft',auth.uid())
 returning id into v_id;
 return jsonb_build_object('payroll_period_id',v_id,'status','draft');
end; $function$;


CREATE OR REPLACE FUNCTION public.calculate_payroll_period(p_payroll_period_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
    select round(sum(v_emp.base_salary/extract(day from (date_trunc('month',d)+interval '1 month - 1 day'))),2)
    into v_base from generate_series(v_period.start_date,v_period.end_date,interval '1 day') d;
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
end; $function$;


CREATE OR REPLACE FUNCTION public.update_delivery_status(p_delivery_id uuid, p_status text, p_recipient_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_d public.deliveries%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.dispatch') then raise exception 'Permission denied: fleet.dispatch'; end if;
 if p_status is null or p_status not in ('pending','scheduled','dispatched','in_transit','delivered','failed','cancelled') then raise exception 'Invalid delivery status'; end if;

 select * into v_d from public.deliveries where id=p_delivery_id and organization_id=v_org for update;
 if not found then raise exception 'Delivery not found'; end if;
 if v_d.status in ('delivered','cancelled') and p_status<>v_d.status then raise exception 'Completed/cancelled delivery cannot be reopened automatically'; end if;

 if p_status=v_d.status then return jsonb_build_object('delivery_id',v_d.id,'delivery_number',v_d.delivery_number,'status',v_d.status); end if;
 if not (
  (v_d.status in ('pending','scheduled') and p_status in ('scheduled','dispatched','cancelled')) or
  (v_d.status='dispatched' and p_status in ('in_transit','delivered','failed','cancelled')) or
  (v_d.status='in_transit' and p_status in ('delivered','failed')) or
  (v_d.status='failed' and p_status in ('scheduled','dispatched','cancelled'))
 ) then raise exception 'Invalid delivery status transition'; end if;
 if p_status='delivered' and nullif(trim(p_recipient_name),'') is null then raise exception 'Recipient name is required as proof of delivery'; end if;
 if p_status='failed' and nullif(trim(p_failure_reason),'') is null then raise exception 'Reason for unsuccessful delivery is required'; end if;
 if v_d.vehicle_id is not null then perform 1 from public.vehicles where id=v_d.vehicle_id and organization_id=v_org for update; end if;
 if p_status='dispatched' then
  if not exists(select 1 from public.users u where u.id=v_d.driver_user_id and u.organization_id=v_org and u.active and u.archived_at is null) then raise exception 'Assign an active driver before dispatch'; end if;
  if exists(select 1 from public.user_work_scope s where s.user_id=v_d.driver_user_id and s.organization_id=v_org and s.scope='location' and s.location_id is distinct from v_d.source_location_id) then raise exception 'Delivery is outside the assigned driver location'; end if;
  if v_d.vehicle_id is not null and not exists(select 1 from public.vehicles where id=v_d.vehicle_id and organization_id=v_org and active and status not in ('maintenance','out_of_service','retired')) then raise exception 'Vehicle is unavailable for dispatch'; end if;
 end if;
 update public.deliveries set
  status=p_status,
  dispatched_at=case when p_status in ('dispatched','in_transit','delivered') then coalesce(dispatched_at,now()) else dispatched_at end,
  delivered_at=case when p_status='delivered' then now() else delivered_at end,
  recipient_name=case when p_status='delivered' then coalesce(nullif(trim(p_recipient_name),''),recipient_name) else recipient_name end,
  delivery_notes=coalesce(p_notes,delivery_notes),
  failure_reason=case when p_status='failed' then p_failure_reason else failure_reason end,
  updated_at=now()
 where id=v_d.id;

 if v_d.vehicle_id is not null then
  update public.vehicles set status=case when vehicles.status in ('maintenance','out_of_service','retired') then vehicles.status when exists(select 1 from public.deliveries d where d.vehicle_id=v_d.vehicle_id and d.organization_id=v_org and d.status in ('dispatched','in_transit')) then 'in_transit' else 'available' end,updated_at=now()
  where id=v_d.vehicle_id and organization_id=v_org and status<>'maintenance';
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_d.source_location_id,auth.uid(),'delivery_status_changed','delivery',v_d.id::text,v_d.delivery_number,
  jsonb_build_object('from_status',v_d.status,'to_status',p_status,'recipient_name',p_recipient_name));

 return jsonb_build_object('delivery_id',v_d.id,'delivery_number',v_d.delivery_number,'status',p_status);
end; $function$;


CREATE OR REPLACE FUNCTION public.mgt_update_assigned_delivery(p_delivery_id uuid, p_status text, p_recipient_name text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_failure_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid:=public.current_organization_id();v_me uuid:=auth.uid();v_d public.deliveries%rowtype;
begin
 if v_org is null or not public.has_permission('fleet.assigned')
 then raise exception 'Permission denied: assigned delivery'; end if;
 if not exists(select 1 from public.organization_modules where organization_id=v_org and module_key='fleet' and enabled)
 then raise exception 'Fleet module is not enabled'; end if;
 if p_status not in ('in_transit','delivered','failed') then raise exception 'Invalid driver delivery status'; end if;
 select * into v_d from public.deliveries d
 where d.id=p_delivery_id and d.organization_id=v_org and d.driver_user_id=v_me
 and public.mgt_record_scope_allows(v_org,d.source_location_id,d.driver_user_id,true)
 for update;
 if not found then raise exception 'This delivery is not assigned to you'; end if;
 if v_d.status not in ('dispatched','in_transit') then
   raise exception 'Only dispatched, open deliveries can be updated by a driver'; end if;
 if p_status='delivered' and nullif(trim(coalesce(p_recipient_name,'')),'') is null
 then raise exception 'Recipient name is required as proof of delivery'; end if;
 if p_status='failed' and nullif(trim(coalesce(p_failure_reason,'')),'') is null
 then raise exception 'Reason for unsuccessful delivery is required'; end if;
 if v_d.vehicle_id is not null then perform 1 from public.vehicles where id=v_d.vehicle_id and organization_id=v_org for update; end if;
 update public.deliveries set status=p_status,
    dispatched_at=coalesce(dispatched_at,now()),
    delivered_at=case when p_status='delivered' then now() else delivered_at end,
    recipient_name=case when p_status='delivered' then trim(p_recipient_name) else recipient_name end,
    failure_reason=case when p_status='failed' then trim(p_failure_reason) else failure_reason end,
    delivery_notes=case when nullif(trim(coalesce(p_notes,'')),'') is null then delivery_notes else trim(p_notes) end,
    updated_at=now()
 where id=v_d.id and organization_id=v_org;
 if v_d.vehicle_id is not null then
   update public.vehicles set status=case when vehicles.status in ('maintenance','out_of_service','retired') then vehicles.status when exists(select 1 from public.deliveries d where d.vehicle_id=v_d.vehicle_id and d.organization_id=v_org and d.status in ('dispatched','in_transit')) then 'in_transit' else 'available' end,
     updated_at=now() where id=v_d.vehicle_id and organization_id=v_org and status<>'maintenance';
 end if;
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_d.source_location_id,v_me,'assigned_delivery_updated','delivery',v_d.id::text,
 v_d.delivery_number,jsonb_build_object('from_status',v_d.status,'to_status',p_status));
 return jsonb_build_object('delivery_id',v_d.id,'status',p_status);
end; $function$;


CREATE OR REPLACE FUNCTION public.review_approval_request(p_request_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_req public.approval_requests%rowtype;
 v_product public.products%rowtype;
 v_product_id uuid;
 v_delta numeric(18,3);
 v_reason text;
 v_current numeric(18,3);
 v_new numeric(18,3);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('approvals.manage') then raise exception 'Permission denied: approvals.manage'; end if;
 if p_decision is null or p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 select * into v_req from public.approval_requests
 where id=p_request_id and organization_id=v_org and status='pending' for update;
 if not found then raise exception 'Pending approval request not found'; end if;
 perform public.mgt_require_modules(array[case v_req.request_type when 'purchase_order' then 'purchasing' when 'production_order' then 'manufacturing' when 'stock_adjustment' then 'inventory' else 'alerts' end]);
 if (select coalesce(require_separate_approvers,false) from public.organizations where id=v_org)
    and v_req.requested_by=auth.uid() then
   raise exception 'A different authorized staff member must approve this request';
 end if;

 if v_req.request_type='purchase_order' then
  update public.purchases
   set approval_status=case when p_decision='approved' then 'approved' else 'rejected' end,
       status=case when p_decision='approved' then 'ordered' else 'rejected' end,
       updated_at=now()
   where id=v_req.entity_id::uuid and organization_id=v_org;

 elsif v_req.request_type='production_order' then
  update public.production_orders
   set approval_status=case when p_decision='approved' then 'approved' else 'rejected' end,
       status=case when p_decision='approved' then 'planned' else 'rejected' end
   where id=v_req.entity_id::uuid and organization_id=v_org;

 elsif v_req.request_type='stock_adjustment' and p_decision='approved' then
  v_product_id:=(v_req.metadata->>'product_id')::uuid;
  v_delta:=(v_req.metadata->>'quantity_delta')::numeric;
  v_reason:=coalesce(v_req.metadata->>'reason','adjustment');

  select * into v_product from public.products
   where id=v_product_id and organization_id=v_org and active=true and track_inventory=true;
  if not found then raise exception 'Adjustment product no longer available'; end if;

  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product_id,v_req.location_id,0,0) on conflict(product_id,location_id) do nothing;

  select quantity into v_current from public.stock_balances
   where product_id=v_product_id and location_id=v_req.location_id for update;

  v_new:=coalesce(v_current,0)+v_delta;
  if v_new<0 then raise exception 'Approved adjustment would create negative stock'; end if;
  if v_new<(select reserved_quantity from public.stock_balances where product_id=v_product_id and location_id=v_req.location_id) then
   raise exception 'Approved adjustment would consume reserved stock';
  end if;

  update public.stock_balances set quantity=v_new,updated_at=now()
   where product_id=v_product_id and location_id=v_req.location_id;

  insert into public.stock_movements(
   organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
  )
  values(
   v_org,v_req.location_id,v_product_id,v_reason,v_delta,v_product.cost_price,
   'approved_adjustment',v_req.id,coalesce(v_req.metadata->>'notes',p_notes),auth.uid()
  );
 end if;

 update public.approval_requests
 set status=p_decision,reviewed_by=auth.uid(),review_notes=p_notes,reviewed_at=now()
 where id=v_req.id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  v_org,v_req.location_id,auth.uid(),'approval_'||p_decision,'approval_request',v_req.id::text,v_req.title,
  jsonb_build_object('request_type',v_req.request_type,'entity_id',v_req.entity_id,'review_notes',p_notes)
 );

 return jsonb_build_object('approval_request_id',v_req.id,'status',p_decision,'request_type',v_req.request_type);
end; $function$;


CREATE OR REPLACE FUNCTION public.mgt_my_work()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid:=public.current_organization_id(); v_me uuid:=auth.uid();
 v_tasks jsonb:='[]'::jsonb; v_jobs jsonb:='[]'::jsonb; v_deliveries jsonb:='[]'::jsonb;
 v_attendance jsonb:='{}'::jsonb; v_tz text;
begin
 if v_org is null or v_me is null then raise exception 'Active staff account required'; end if;
 if exists(select 1 from public.organization_modules where organization_id=v_org and module_key='projects' and enabled)
    and (public.has_permission('projects.time') or public.has_permission('projects.view')) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'project_id',t.project_id,'title',t.title,'status',t.status,
      'priority',t.priority,'due_date',t.due_date,'progress',t.progress_percent
    ) order by t.due_date nulls last),'[]'::jsonb) into v_tasks
    from public.project_tasks t where t.organization_id=v_org and t.assigned_user_id=v_me
    and t.status not in ('cancelled','completed')
    and exists(select 1 from public.projects p where p.id=t.project_id and p.organization_id=v_org
      and public.mgt_record_scope_allows(v_org,p.location_id,t.assigned_user_id,true));
 end if;
 if exists(select 1 from public.organization_modules where organization_id=v_org and module_key='services' and enabled)
    and (public.has_permission('services.assigned') or public.has_permission('services.view') or public.has_permission('services.manage')) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'number',w.job_number,'title',w.title,'status',w.status,'priority',w.priority,'due_at',w.due_at
    ) order by w.due_at nulls last),'[]'::jsonb) into v_jobs
    from public.work_orders w where w.organization_id=v_org
    and (w.assigned_to=v_me or exists(select 1 from public.work_order_assignments wa where wa.work_order_id=w.id and wa.user_id=v_me))
    and public.mgt_record_scope_allows(v_org,w.location_id,w.assigned_to,true)
    and w.status not in ('cancelled','completed');
 end if;
 if exists(select 1 from public.organization_modules where organization_id=v_org and module_key='fleet' and enabled)
    and (public.has_permission('fleet.assigned') or public.has_permission('fleet.dispatch')) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',d.id,'number',d.delivery_number,'destination',d.destination,'status',d.status,
      'scheduled_at',d.scheduled_at,'contact_name',d.contact_name,'contact_phone',d.contact_phone
    ) order by d.scheduled_at nulls last),'[]'::jsonb) into v_deliveries
    from public.deliveries d where d.organization_id=v_org and d.driver_user_id=v_me
    and d.status not in ('delivered','failed','cancelled')
    and public.mgt_record_scope_allows(v_org,d.source_location_id,d.driver_user_id,true);
 end if;
 if public.has_permission('attendance.use') then
    select timezone into v_tz from public.organizations where id=v_org;
    select coalesce(jsonb_build_object('check_in',a.check_in,'check_out',a.check_out,'date',a.work_date),'{}'::jsonb)
    into v_attendance from public.attendance a where a.organization_id=v_org and a.user_id=v_me
      and a.work_date=(now() at time zone coalesce(v_tz,'UTC'))::date limit 1;
 end if;
 return jsonb_build_object('tasks',v_tasks,'jobs',v_jobs,'deliveries',v_deliveries,'attendance',coalesce(v_attendance,'{}'::jsonb));
end; $function$;


CREATE OR REPLACE FUNCTION public.record_customer_payment(p_customer_id uuid, p_location_id uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid:=public.current_organization_id();
  v_customer public.customers%rowtype;
  v_sale public.sales%rowtype;
  v_remaining numeric(18,2):=coalesce(p_amount,0);
  v_opening_due numeric(18,2):=0;
  v_opening_apply numeric(18,2):=0;
  v_sales_due numeric(18,2):=0;
  v_total_debt numeric(18,2):=0;
  v_apply numeric(18,2);
  v_outstanding numeric(18,2);
  v_new_paid numeric(18,2);
  v_till_id uuid;
  v_location_id uuid:=p_location_id;
  v_method text:=coalesce(nullif(trim(p_method),''),'cash');
  v_allocations jsonb:='[]'::jsonb;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not (public.has_permission('sales.create') or public.has_permission('finance.manage')) then
    raise exception 'Permission denied';
  end if;
  if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id and organization_id=v_org and active=true
  for update;
  if not found then raise exception 'Customer not found'; end if;

  if v_location_id is null then
    select default_location_id into v_location_id
    from public.users
    where id=auth.uid() and organization_id=v_org and active=true and archived_at is null;
  end if;

  if v_location_id is null then
    select id into v_location_id
    from public.locations
    where organization_id=v_org and active=true
    order by created_at asc
    limit 1 for update;
  end if;

  if v_location_id is null or not exists(
    select 1 from public.locations
    where id=v_location_id and organization_id=v_org and active=true
  ) then raise exception 'Active business location not found'; end if;

  perform public.mgt_require_scope(v_location_id,auth.uid());
  v_opening_due:=greatest(coalesce(v_customer.opening_balance,0)-coalesce(v_customer.opening_balance_paid,0),0);

  select coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0)
  into v_sales_due
  from public.sales
  where organization_id=v_org and customer_id=p_customer_id
    and public.mgt_record_scope_allows(v_org,location_id,sold_by);

  if not public.mgt_record_scope_allows(v_org,null,null) then v_opening_due:=0; end if;
  v_total_debt:=v_opening_due+v_sales_due;

  if v_remaining>v_total_debt+0.009 then
    raise exception 'Payment exceeds customer outstanding balance';
  end if;

  if v_method='cash' then
    select id into v_till_id
    from public.till_sessions
    where organization_id=v_org
      and location_id=v_location_id
      and user_id=auth.uid()
      and status='open'
    order by opened_at desc
    limit 1 for update;

    if v_till_id is null then raise exception 'Open a till before accepting cash'; end if;
  end if;

  if v_opening_due>0 and v_remaining>0 then
    v_opening_apply:=least(v_remaining,v_opening_due);

    update public.customers
    set opening_balance_paid=opening_balance_paid+v_opening_apply,updated_at=now()
    where id=p_customer_id;

    insert into public.payments(
      organization_id,location_id,customer_id,direction,payment_type,method,amount,
      reference,notes,received_by,till_session_id
    )
    values(
      v_org,v_location_id,p_customer_id,'in','debt_payment',v_method,v_opening_apply,
      nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
    );

    v_allocations:=v_allocations||jsonb_build_array(
      jsonb_build_object('type','opening_balance','amount',v_opening_apply)
    );
    v_remaining:=v_remaining-v_opening_apply;
  end if;

  for v_sale in
    select *
    from public.sales
    where organization_id=v_org
      and customer_id=p_customer_id
      and public.mgt_record_scope_allows(v_org,location_id,sold_by)
      and greatest(total_amount-refunded_amount-amount_paid,0)>0.009
    order by created_at asc
    for update
  loop
    exit when v_remaining<=0.009;

    v_outstanding:=greatest(v_sale.total_amount-v_sale.refunded_amount-v_sale.amount_paid,0);
    v_apply:=least(v_remaining,v_outstanding);
    v_new_paid:=v_sale.amount_paid+v_apply;

    update public.sales
    set amount_paid=v_new_paid,
        payment_status=case
          when greatest(total_amount-refunded_amount-v_new_paid,0)<=0.009 then 'paid'
          else 'partial'
        end,
        updated_at=now()
    where id=v_sale.id;

    insert into public.payments(
      organization_id,location_id,customer_id,sale_id,direction,
      payment_type,method,amount,reference,notes,received_by,till_session_id
    )
    values(
      v_org,v_location_id,p_customer_id,v_sale.id,'in',
      'debt_payment',v_method,v_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
    );

    v_allocations:=v_allocations||jsonb_build_array(
      jsonb_build_object('type','sale','sale_id',v_sale.id,'sale_number',v_sale.sale_number,'amount',v_apply)
    );
    v_remaining:=v_remaining-v_apply;
  end loop;

  insert into public.audit_log(
    organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    v_org,v_location_id,auth.uid(),'customer_payment_received','customer',p_customer_id::text,
    'Customer debt payment received',
    jsonb_build_object('amount',p_amount,'method',v_method,'allocations',v_allocations)
  );

  return jsonb_build_object(
    'amount_received',p_amount,
    'remaining_balance',greatest(v_total_debt-p_amount,0),
    'allocations',v_allocations
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.record_supplier_payment(p_supplier_id uuid, p_location_id uuid, p_amount numeric, p_method text DEFAULT 'bank'::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_supplier public.suppliers%rowtype;
 v_purchase public.purchases%rowtype;
 v_remaining numeric(18,2):=coalesce(p_amount,0);
 v_opening_due numeric(18,2);
 v_opening_apply numeric(18,2);
 v_purchase_due numeric(18,2);
 v_apply numeric(18,2);
 v_new_paid numeric(18,2);
 v_total_due numeric(18,2);
 v_allocations jsonb:='[]'::jsonb;
 v_method text:=coalesce(nullif(trim(p_method),''),'bank');
 v_till_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('purchasing.pay') or public.has_permission('finance.manage')) then raise exception 'Permission denied'; end if;
 if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_supplier from public.suppliers
  where id=p_supplier_id and organization_id=v_org and active=true for update;
 if not found then raise exception 'Supplier not found'; end if;

 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then
  raise exception 'Location not found';
 end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=p_location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1 for update;
  if v_till_id is null then raise exception 'Open your till before recording a cash supplier payment'; end if;
 end if;

 v_opening_due:=case when public.mgt_record_scope_allows(v_org,null,null) then greatest(v_supplier.opening_balance-v_supplier.opening_balance_paid,0) else 0 end;
 select v_opening_due+coalesce(sum(greatest(total_amount-amount_paid,0)),0)
 into v_total_due from public.purchases where organization_id=v_org and supplier_id=p_supplier_id and public.mgt_record_scope_allows(v_org,location_id,created_by) and approval_status in ('not_required','approved') and status not in ('draft','pending_approval','rejected','cancelled');

 if v_remaining>v_total_due+0.009 then raise exception 'Payment exceeds supplier outstanding balance'; end if;

 if v_opening_due>0 and v_remaining>0 then
  v_opening_apply:=least(v_remaining,v_opening_due);
  update public.suppliers set opening_balance_paid=opening_balance_paid+v_opening_apply,updated_at=now() where id=p_supplier_id;

  insert into public.payments(
   organization_id,location_id,supplier_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,p_location_id,p_supplier_id,'out','supplier_payment',v_method,
   v_opening_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
  );

  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','opening_balance','amount',v_opening_apply));
  v_remaining:=v_remaining-v_opening_apply;
 end if;

 for v_purchase in
  select * from public.purchases
  where organization_id=v_org and supplier_id=p_supplier_id and public.mgt_record_scope_allows(v_org,location_id,created_by) and approval_status in ('not_required','approved') and status not in ('draft','pending_approval','rejected','cancelled') and greatest(total_amount-amount_paid,0)>0.009
  order by created_at asc for update
 loop
  exit when v_remaining<=0.009;

  v_purchase_due:=greatest(v_purchase.total_amount-v_purchase.amount_paid,0);
  v_apply:=least(v_remaining,v_purchase_due);
  v_new_paid:=v_purchase.amount_paid+v_apply;

  update public.purchases set
   amount_paid=v_new_paid,
   payment_status=case when total_amount<=v_new_paid+0.009 then 'paid' else 'partial' end,
   updated_at=now()
  where id=v_purchase.id;

  insert into public.payments(
   organization_id,location_id,supplier_id,purchase_id,direction,payment_type,method,
   amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,p_location_id,p_supplier_id,v_purchase.id,'out','supplier_payment',v_method,
   v_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
  );

  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object(
   'type','purchase','purchase_id',v_purchase.id,'purchase_number',v_purchase.purchase_number,'amount',v_apply
  ));
  v_remaining:=v_remaining-v_apply;
 end loop;

 insert into public.audit_log(
  organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
 )
 values(
  v_org,p_location_id,auth.uid(),'supplier_payment_recorded','supplier',p_supplier_id::text,'Supplier payment',
  jsonb_build_object('amount',p_amount,'method',v_method,'allocations',v_allocations,'till_session_id',v_till_id)
 );

 return jsonb_build_object(
  'amount_paid',p_amount,
  'remaining_balance',greatest(v_total_due-p_amount,0),
  'allocations',v_allocations
 );
end; $function$;


CREATE OR REPLACE FUNCTION public.record_work_order_payment(p_work_order_id uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.work_orders%rowtype;
 v_total numeric(18,2);
 v_existing numeric(18,2);
 v_new_paid numeric(18,2);
 v_till_id uuid;
 v_method text:=coalesce(nullif(trim(p_method),''),'cash');
 v_status text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('services.pay') or public.has_permission('services.manage') or public.has_permission('finance.manage')) then
  raise exception 'Permission denied: services.pay';
 end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_order from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status='cancelled' then raise exception 'Cannot receive payment on a cancelled job'; end if;

 select coalesce(sum(line_total),0) into v_total from public.work_order_lines where work_order_id=v_order.id;
 if v_total<=0 then v_total:=coalesce(nullif(v_order.final_amount,0),v_order.quoted_amount,0); end if;
 if v_total<=0 then raise exception 'Add job charges or a quoted amount before receiving payment'; end if;

 select coalesce(sum(case when direction='in' then amount else -amount end),0)
 into v_existing from public.payments where work_order_id=v_order.id;

 if v_existing+p_amount>v_total+0.009 then raise exception 'Payment exceeds job balance'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_order.location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1 for update;
  if v_till_id is null then raise exception 'Open your till before accepting a cash job payment'; end if;
 end if;

 insert into public.payments(
  organization_id,location_id,customer_id,work_order_id,direction,payment_type,method,amount,
  reference,notes,received_by,till_session_id
 )
 values(
  v_org,v_order.location_id,v_order.customer_id,v_order.id,'in',
  case when v_existing<=0 then 'job_deposit' else 'job_payment' end,
  v_method,p_amount,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
 );

 v_new_paid:=v_existing+p_amount;
 v_status:=case when v_new_paid>=v_total-0.009 then 'paid' else 'partial' end;

 update public.work_orders
 set amount_paid=v_new_paid,payment_status=v_status,final_amount=v_total,updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,v_order.id,'payment_received','Job payment received',
  jsonb_build_object('amount',p_amount,'method',v_method,'reference',p_reference,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0)),auth.uid());

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_order.location_id,auth.uid(),'work_order_payment_received','work_order',v_order.id::text,coalesce(v_order.job_number,v_order.title),
  jsonb_build_object('amount',p_amount,'method',v_method,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0)));

 return jsonb_build_object('work_order_id',v_order.id,'amount_paid',p_amount,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0),'payment_status',v_status);
end; $function$;


CREATE OR REPLACE FUNCTION public.process_sale_return(p_sale_id uuid, p_items jsonb, p_refund_method text DEFAULT 'cash'::text, p_reference text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_organization_id();
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_return_id uuid;
  v_return_number text;
  v_qty numeric(18,3);
  v_previously_returned numeric(18,3);
  v_available numeric(18,3);
  v_sale_items_total numeric(18,2);
  v_sale_factor numeric(18,8);
  v_unit_refund numeric(18,2);
  v_line_refund numeric(18,2);
  v_total_return numeric(18,2) := 0;
  v_outstanding_before numeric(18,2);
  v_credit_reduction numeric(18,2);
  v_cash_refund numeric(18,2);
  v_till_id uuid;
  v_new_refunded numeric(18,2); v_previous_value numeric(18,2); v_item_value numeric(18,2);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.refund') then raise exception 'Permission denied: sales.refund'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one return item is required';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id and organization_id = v_org
  for update;

  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'refunded' then raise exception 'Sale is already fully refunded'; end if;

  select coalesce(sum(line_total),0)
  into v_sale_items_total
  from public.sale_items
  where sale_id = v_sale.id;

  if v_sale_items_total <= 0 then raise exception 'Sale has no refundable value'; end if;
  v_sale_factor := v_sale.total_amount / v_sale_items_total;

  v_return_number := 'RET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

  insert into public.sale_returns(
    organization_id, location_id, sale_id, customer_id, return_number,
    total_amount, credit_reduction, cash_refund_amount,
    refund_method, refund_reference, reason, processed_by
  )
  values (
    v_org, v_sale.location_id, v_sale.id, v_sale.customer_id, v_return_number,
    0, 0, 0, nullif(trim(p_refund_method),''), nullif(trim(p_reference),''),
    p_reason, auth.uid()
  )
  returning id into v_return_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_sale_item
    from public.sale_items
    where id = (v_item->>'sale_item_id')::uuid
      and sale_id = v_sale.id;

    if not found then raise exception 'Return item does not belong to this sale'; end if;

    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_qty <= 0 then raise exception 'Return quantity must be greater than zero'; end if;

    select coalesce(sum(sri.quantity),0)
    into v_previously_returned
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id = sri.return_id
    where sr.sale_id = v_sale.id
      and sri.sale_item_id = v_sale_item.id;

    v_available := v_sale_item.quantity - v_previously_returned;
    if v_qty > v_available + 0.0009 then
      raise exception 'Return quantity exceeds quantity available for %', v_sale_item.description;
    end if;

    select coalesce(sum(sri.line_total),0) into v_previous_value
    from public.sale_return_items sri join public.sale_returns sr on sr.id=sri.return_id
    where sr.sale_id=v_sale.id and sri.sale_item_id=v_sale_item.id;
    select round(coalesce(sum(line_total),0)*v_sale_factor,2)
      -round(coalesce(sum(line_total) filter(where id<v_sale_item.id),0)*v_sale_factor,2)
    into v_item_value from public.sale_items where sale_id=v_sale.id and id<=v_sale_item.id;
    v_unit_refund := round(v_item_value/v_sale_item.quantity,2);
    v_line_refund := round(v_item_value*(v_previously_returned+v_qty)/v_sale_item.quantity,2)-v_previous_value;
    v_total_return := v_total_return + v_line_refund;

    insert into public.sale_return_items(
      return_id, sale_item_id, product_id, quantity, unit_refund, line_total
    )
    values (
      v_return_id, v_sale_item.id, v_sale_item.product_id, v_qty, v_unit_refund, v_line_refund
    );

    if v_sale_item.product_id is not null
       and exists (select 1 from public.products where id=v_sale_item.product_id and track_inventory=true) then
      insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
      values (v_sale_item.product_id, v_sale.location_id, v_qty, 0)
      on conflict (product_id, location_id)
      do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();

      insert into public.stock_movements(
        organization_id, location_id, product_id, movement_type, quantity,
        unit_cost, reference_type, reference_id, notes, recorded_by
      )
      values (
        v_org, v_sale.location_id, v_sale_item.product_id, 'sale_return', v_qty,
        v_sale_item.unit_cost, 'sale_return', v_return_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  if v_total_return < 0 then raise exception 'Return value cannot be negative'; end if;

  if v_sale.refunded_amount + v_total_return > v_sale.total_amount + 0.01 then
    raise exception 'Return value exceeds remaining refundable sale value';
  end if;

  v_outstanding_before := greatest(v_sale.total_amount - v_sale.refunded_amount - v_sale.amount_paid,0);
  v_credit_reduction := least(v_total_return, v_outstanding_before);
  v_cash_refund := greatest(v_total_return - v_credit_reduction,0);

  if v_cash_refund > 0 and coalesce(nullif(trim(p_refund_method),''),'cash') = 'cash' then
    select id into v_till_id
    from public.till_sessions
    where organization_id = v_org
      and location_id = v_sale.location_id
      and user_id = auth.uid()
      and status = 'open'
    order by opened_at desc
    limit 1 for update;

    if v_till_id is null then raise exception 'Open a till before issuing a cash refund'; end if;
  else
    select id into v_till_id
    from public.till_sessions
    where organization_id = v_org
      and location_id = v_sale.location_id
      and user_id = auth.uid()
      and status = 'open'
    order by opened_at desc
    limit 1 for update;
  end if;

  update public.sale_returns
  set total_amount = v_total_return,
      credit_reduction = v_credit_reduction,
      cash_refund_amount = v_cash_refund
  where id = v_return_id;

  if v_cash_refund > 0 then
    insert into public.payments(
      organization_id, location_id, customer_id, sale_id, direction,
      payment_type, method, amount, reference, notes, received_by, till_session_id
    )
    values (
      v_org, v_sale.location_id, v_sale.customer_id, v_sale.id, 'out',
      'refund', coalesce(nullif(trim(p_refund_method),''),'cash'),
      v_cash_refund, nullif(trim(p_reference),''), p_reason, auth.uid(), v_till_id
    );
  end if;

  v_new_refunded := v_sale.refunded_amount + v_total_return;

  update public.sales
  set refunded_amount = v_new_refunded,
      status = case
        when not exists (select 1 from public.sale_items si where si.sale_id=v_sale.id and si.quantity>(select coalesce(sum(ri.quantity),0) from public.sale_return_items ri join public.sale_returns sr on sr.id=ri.return_id where sr.sale_id=v_sale.id and ri.sale_item_id=si.id)+0.0009) then 'refunded'
        else 'partially_refunded'
      end,
      payment_status = case
        when greatest(total_amount - v_new_refunded - amount_paid,0) <= 0.009 then 'paid'
        when amount_paid > 0 then 'partial'
        else 'credit'
      end,
      updated_at = now()
  where id = v_sale.id;

  insert into public.audit_log(
    organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata
  )
  values (
    v_org, v_sale.location_id, auth.uid(), 'sale_return_processed', 'sale_return', v_return_id::text,
    v_return_number,
    jsonb_build_object(
      'sale_id',v_sale.id,
      'sale_number',v_sale.sale_number,
      'total_return',v_total_return,
      'credit_reduction',v_credit_reduction,
      'cash_refund',v_cash_refund,
      'refund_method',p_refund_method
    )
  );

  return jsonb_build_object(
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total_return', v_total_return,
    'credit_reduction', v_credit_reduction,
    'cash_refund_amount', v_cash_refund
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.complete_asset_maintenance(p_maintenance_id uuid, p_cost numeric DEFAULT 0, p_downtime_hours numeric DEFAULT 0, p_meter_reading numeric DEFAULT NULL::numeric, p_next_service_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_m public.asset_maintenance%rowtype;v_asset public.assets%rowtype;
 v_method text:=nullif(trim(p_payment_method),'');v_till_id uuid;v_expense_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.maintenance') then raise exception 'Permission denied: assets.maintenance'; end if;
 select * into v_m from public.asset_maintenance where id=p_maintenance_id and organization_id=v_org and status<>'completed' for update;
 if not found then raise exception 'Open maintenance record not found'; end if;
 select * into v_asset from public.assets where id=v_m.asset_id and organization_id=v_org for update;
 if not found then raise exception 'Asset not found'; end if;
 if coalesce(p_cost,0)<0 or coalesce(p_downtime_hours,0)<0 then raise exception 'Cost and downtime cannot be negative'; end if;

 if coalesce(p_cost,0)>0 and v_method is not null then
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
    where organization_id=v_org and location_id=v_m.location_id and user_id=auth.uid() and status='open'
    order by opened_at desc limit 1 for update;
   if v_till_id is null then raise exception 'Open your till before paying maintenance in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for maintenance payment'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_m.location_id,'Maintenance','Maintenance - '||v_asset.name||' - '||v_m.maintenance_number,
   p_cost,v_method,nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_expense_id;

  if v_method='cash' then
   insert into public.payments(organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
   values(v_org,v_m.location_id,'out','asset_maintenance','cash',p_cost,nullif(trim(p_reference),''),v_asset.name,auth.uid(),v_till_id);
  else
   insert into public.banking_transactions(source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_expense_id,v_org,v_m.location_id,p_bank_account_id,'withdrawal',p_cost,'confirmed',nullif(trim(p_reference),''),'Maintenance - '||v_asset.name,auth.uid());
  end if;
 end if;

 update public.asset_maintenance set
  status='completed',started_at=coalesce(started_at,now()),completed_at=now(),cost=coalesce(p_cost,0),
  downtime_hours=coalesce(p_downtime_hours,0),meter_reading=p_meter_reading,next_service_date=p_next_service_date,
  expense_id=v_expense_id,notes=coalesce(p_notes,notes),updated_at=now()
 where id=v_m.id;

 update public.assets set status='active',next_service_date=coalesce(p_next_service_date,next_service_date),updated_at=now() where id=v_asset.id;
 update public.vehicles set status='available',updated_at=now()
 where asset_id=v_asset.id and organization_id=v_org and active=true;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_m.location_id,auth.uid(),'maintenance_completed','asset_maintenance',v_m.id::text,v_m.maintenance_number,
  jsonb_build_object('asset_id',v_asset.id,'cost',p_cost,'downtime_hours',p_downtime_hours));

 return jsonb_build_object('maintenance_id',v_m.id,'status','completed','expense_id',v_expense_id);
end; $function$;


CREATE OR REPLACE FUNCTION public.record_fuel_log(p_vehicle_id uuid, p_odometer numeric, p_quantity numeric, p_unit_cost numeric, p_supplier text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();v_vehicle public.vehicles%rowtype;v_total numeric(18,2);
 v_method text:=nullif(trim(p_payment_method),'');v_till_id uuid;v_expense_id uuid;v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.manage') then raise exception 'Permission denied: fleet.manage'; end if;
 select * into v_vehicle from public.vehicles where id=p_vehicle_id and organization_id=v_org and active=true for update;
 if not found then raise exception 'Vehicle not found'; end if;
 if p_odometer<v_vehicle.odometer then raise exception 'Odometer cannot go backwards'; end if;
 if coalesce(p_quantity,0)<=0 or coalesce(p_unit_cost,0)<0 then raise exception 'Invalid fuel quantity or cost'; end if;
 v_total:=round(p_quantity*p_unit_cost,2);

 if v_total>0 and v_method is not null then
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
    where organization_id=v_org and location_id=v_vehicle.location_id and user_id=auth.uid() and status='open'
    order by opened_at desc limit 1 for update;
   if v_till_id is null then raise exception 'Open your till before paying for fuel in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for fuel'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_vehicle.location_id,'Fuel','Fuel - '||v_vehicle.registration_number,v_total,v_method,
   nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_expense_id;

  if v_method='cash' then
   insert into public.payments(organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
   values(v_org,v_vehicle.location_id,'out','fuel','cash',v_total,nullif(trim(p_reference),''),v_vehicle.registration_number,auth.uid(),v_till_id);
  else
   insert into public.banking_transactions(source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_expense_id,v_org,v_vehicle.location_id,p_bank_account_id,'withdrawal',v_total,'confirmed',nullif(trim(p_reference),''),'Fuel - '||v_vehicle.registration_number,auth.uid());
  end if;
 end if;

 insert into public.fuel_logs(
  organization_id,vehicle_id,location_id,driver_user_id,log_date,odometer,quantity,unit_cost,total_cost,
  supplier,reference,expense_id,notes,recorded_by
 ) values(
  v_org,v_vehicle.id,v_vehicle.location_id,v_vehicle.assigned_driver_id,current_date,p_odometer,p_quantity,p_unit_cost,v_total,
  nullif(trim(p_supplier),''),nullif(trim(p_reference),''),v_expense_id,p_notes,auth.uid()
 ) returning id into v_id;

 update public.vehicles set odometer=p_odometer,updated_at=now() where id=v_vehicle.id;
 return jsonb_build_object('fuel_log_id',v_id,'total_cost',v_total,'expense_id',v_expense_id);
end; $function$;


CREATE OR REPLACE FUNCTION public.record_project_invoice_payment(p_invoice_id uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_payment_id uuid;
 v_org uuid:=public.current_organization_id();
 v_invoice public.project_invoices%rowtype;
 v_project public.projects%rowtype;
 v_method text:=coalesce(nullif(trim(p_method),''),'cash');
 v_till_id uuid;
 v_new_paid numeric(18,2);
 v_status text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (
  public.has_permission('projects.billing')
  or public.has_permission('projects.manage')
  or public.has_permission('finance.manage')
 ) then raise exception 'Permission denied: projects.billing'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_invoice from public.project_invoices
 where id=p_invoice_id and organization_id=v_org and status in ('issued','partial') for update;
 if not found then raise exception 'Open project invoice not found'; end if;
 select * into v_project from public.projects where id=v_invoice.project_id and organization_id=v_org;
 if not found then raise exception 'Project not found'; end if;
 if v_invoice.amount_paid+p_amount>v_invoice.total_amount+0.009 then raise exception 'Payment exceeds invoice balance'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
  where organization_id=v_org and location_id=v_invoice.location_id and user_id=auth.uid() and status='open'
  order by opened_at desc limit 1 for update;
  if v_till_id is null then raise exception 'Open your till before accepting a cash project payment'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account receiving this payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 v_new_paid:=v_invoice.amount_paid+p_amount;
 v_status:=case when v_new_paid>=v_invoice.total_amount-0.009 then 'paid' else 'partial' end;

 insert into public.payments(
  organization_id,location_id,customer_id,project_id,project_invoice_id,direction,payment_type,method,
  amount,reference,notes,received_by,till_session_id
 ) values(
  v_org,v_invoice.location_id,v_invoice.customer_id,v_invoice.project_id,v_invoice.id,'in','project_invoice',
  v_method,p_amount,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
 ) returning id into v_payment_id;

 if v_method<>'cash' then
  insert into public.banking_transactions(
   source_payment_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_payment_id,v_org,v_invoice.location_id,p_bank_account_id,'deposit',p_amount,'confirmed',
   nullif(trim(p_reference),''),'Project invoice '||v_invoice.invoice_number||' - '||v_project.project_number,auth.uid()
  );
 end if;

 update public.project_invoices set amount_paid=v_new_paid,status=v_status,updated_at=now() where id=v_invoice.id;
 perform public.recalculate_project_totals(v_invoice.project_id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_invoice.project_id,'payment_received','Project invoice payment received',
  jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'amount',p_amount,'method',v_method,'status',v_status),auth.uid());

 return jsonb_build_object('invoice_id',v_invoice.id,'payment_status',v_status,'total_paid',v_new_paid,'balance',greatest(v_invoice.total_amount-v_new_paid,0));
end; $function$;


CREATE OR REPLACE FUNCTION public.pay_project_expense(p_project_expense_id uuid, p_payment_method text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_row public.project_expenses%rowtype;
 v_project public.projects%rowtype;
 v_method text:=coalesce(nullif(trim(p_payment_method),''),'cash');
 v_till_id uuid;
 v_finance_expense_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;

 select * into v_row from public.project_expenses
 where id=p_project_expense_id and organization_id=v_org and status='accrued' for update;
 if not found then raise exception 'Accrued project expense not found'; end if;
 select * into v_project from public.projects where id=v_row.project_id and organization_id=v_org;
 if not found then raise exception 'Project not found'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
  where organization_id=v_org and location_id=v_row.location_id and user_id=auth.uid() and status='open'
  order by opened_at desc limit 1 for update;
  if v_till_id is null then raise exception 'Open your till before paying this expense in cash'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account used for this payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 insert into public.expenses(
  organization_id,location_id,project_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
 ) values(
  v_org,v_row.location_id,v_row.project_id,v_row.category,v_row.description,v_row.amount,v_method,
  nullif(trim(p_reference),''),auth.uid(),v_row.notes,v_till_id,p_bank_account_id
 ) returning id into v_finance_expense_id;

 if v_method='cash' then
  insert into public.payments(
   organization_id,location_id,project_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  ) values(
   v_org,v_row.location_id,v_row.project_id,'out','project_expense','cash',v_row.amount,
   nullif(trim(p_reference),''),v_row.description,auth.uid(),v_till_id
  );
 else
  insert into public.banking_transactions(
   source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_finance_expense_id,v_org,v_row.location_id,p_bank_account_id,'withdrawal',v_row.amount,'confirmed',
   nullif(trim(p_reference),''),'Project expense - '||v_project.project_number||' - '||v_row.description,auth.uid()
  );
 end if;

 update public.project_expenses
 set status='paid',payment_method=v_method,reference=nullif(trim(p_reference),''),
     bank_account_id=p_bank_account_id,finance_expense_id=v_finance_expense_id,paid_at=now()
 where id=v_row.id;

 return jsonb_build_object('project_expense_id',v_row.id,'status','paid','finance_expense_id',v_finance_expense_id);
end; $function$;


CREATE OR REPLACE FUNCTION public.post_project_expense(p_project_id uuid, p_category text, p_description text, p_amount numeric, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_project public.projects%rowtype;
 v_method text:=nullif(trim(p_payment_method),'');
 v_till_id uuid;
 v_finance_expense_id uuid;
 v_project_expense_id uuid;
 v_status text:='accrued';
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Expense amount must be greater than zero'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Expense description is required'; end if;

 select * into v_project from public.projects where id=p_project_id and organization_id=v_org and status<>'cancelled';
 if not found then raise exception 'Project not found'; end if;

 if v_method is not null then
  v_status:='paid';
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_project.location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1 for update;
   if v_till_id is null then raise exception 'Open your till before paying a project expense in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for this project expense'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,project_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_project.location_id,v_project.id,coalesce(nullif(trim(p_category),''),'Project'),trim(p_description),
   p_amount,v_method,nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_finance_expense_id;

  if v_method='cash' then
   insert into public.payments(
    organization_id,location_id,project_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
   ) values(
    v_org,v_project.location_id,v_project.id,'out','project_expense','cash',p_amount,
    nullif(trim(p_reference),''),coalesce(p_notes,p_description),auth.uid(),v_till_id
   );
  else
   insert into public.banking_transactions(
    source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
   ) values(
    v_finance_expense_id,v_org,v_project.location_id,p_bank_account_id,'withdrawal',p_amount,'confirmed',
    nullif(trim(p_reference),''),'Project expense - '||v_project.project_number||' - '||trim(p_description),auth.uid()
   );
  end if;
 end if;

 insert into public.project_expenses(
  organization_id,project_id,location_id,category,description,amount,status,payment_method,reference,
  bank_account_id,finance_expense_id,notes,recorded_by,paid_at
 ) values(
  v_org,v_project.id,v_project.location_id,coalesce(nullif(trim(p_category),''),'Project'),trim(p_description),
  p_amount,v_status,v_method,nullif(trim(p_reference),''),p_bank_account_id,v_finance_expense_id,p_notes,auth.uid(),
  case when v_status='paid' then now() else null end
 ) returning id into v_project_expense_id;

 perform public.recalculate_project_totals(v_project.id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_project.id,'expense_recorded',trim(p_description),
  jsonb_build_object('project_expense_id',v_project_expense_id,'amount',p_amount,'status',v_status,'payment_method',v_method),auth.uid());

 return jsonb_build_object('project_expense_id',v_project_expense_id,'status',v_status,'finance_expense_id',v_finance_expense_id);
end; $function$;



-- Fail migration if any named endpoint is missing or its body format changes.
do $migration$ declare r record; f record; d text; patched text; begin
 for r in select * from (values
('post_pos_sale',$gate$perform public.mgt_require_modules(array['pos','sales' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('open_till',$gate$perform public.mgt_require_modules(array['pos','sales' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('close_till',$gate$perform public.mgt_require_modules(array['pos','sales' ]);
 perform public.mgt_require_scope((select location_id from public.till_sessions where id=p_session_id and organization_id=public.current_organization_id()),(select user_id from public.till_sessions where id=p_session_id and organization_id=public.current_organization_id()),false);$gate$),
('process_sale_return',$gate$perform public.mgt_require_modules(array['pos','sales' ]);
 perform public.mgt_require_scope((select location_id from public.sales where id=p_sale_id and organization_id=public.current_organization_id()),(select sold_by from public.sales where id=p_sale_id and organization_id=public.current_organization_id()),false);$gate$),
('record_customer_payment',$gate$perform public.mgt_require_modules(array['sales','pos','finance' ]);$gate$),
('submit_stock_adjustment',$gate$perform public.mgt_require_modules(array['inventory' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('transfer_stock',$gate$perform public.mgt_require_modules(array['inventory' ]);
 perform public.mgt_require_scope(p_from_location_id,null);$gate$),
('post_stocktake',$gate$perform public.mgt_require_modules(array['inventory' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('create_purchase_order',$gate$perform public.mgt_require_modules(array['purchasing' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('receive_purchase_order',$gate$perform public.mgt_require_modules(array['purchasing' ]);
 perform public.mgt_require_scope((select location_id from public.purchases where id=p_purchase_id and organization_id=public.current_organization_id()),(select created_by from public.purchases where id=p_purchase_id and organization_id=public.current_organization_id()),false);$gate$),
('record_supplier_payment',$gate$perform public.mgt_require_modules(array['purchasing','finance' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('create_service_work_order',$gate$perform public.mgt_require_modules(array['services' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('assign_work_order_staff',$gate$perform public.mgt_require_modules(array['services' ]);
 perform public.mgt_require_scope((select location_id from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),(select assigned_to from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee(p_work_order_id));$gate$),
('add_work_order_line',$gate$perform public.mgt_require_modules(array['services' ]);
 perform public.mgt_require_scope((select location_id from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),(select assigned_to from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee(p_work_order_id));$gate$),
('remove_work_order_line',$gate$perform public.mgt_require_modules(array['services' ]);
 perform public.mgt_require_scope((select w.location_id from public.work_orders w join public.work_order_lines l on l.work_order_id=w.id where l.id=p_line_id and w.organization_id=public.current_organization_id()),(select w.assigned_to from public.work_orders w join public.work_order_lines l on l.work_order_id=w.id where l.id=p_line_id and w.organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee((select work_order_id from public.work_order_lines where id=p_line_id and organization_id=public.current_organization_id())));$gate$),
('set_work_order_status',$gate$perform public.mgt_require_modules(array['services' ]);
 perform public.mgt_require_scope((select location_id from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),(select assigned_to from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee(p_work_order_id));$gate$),
('record_work_order_payment',$gate$perform public.mgt_require_modules(array['services','finance' ]);
 perform public.mgt_require_scope((select location_id from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),(select assigned_to from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee(p_work_order_id));$gate$),
('create_bom',$gate$perform public.mgt_require_modules(array['manufacturing' ]);$gate$),
('create_production_order',$gate$perform public.mgt_require_modules(array['manufacturing' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('complete_production_order',$gate$perform public.mgt_require_modules(array['manufacturing' ]);
 perform public.mgt_require_scope((select location_id from public.production_orders where id=p_production_order_id and organization_id=public.current_organization_id()),(select created_by from public.production_orders where id=p_production_order_id and organization_id=public.current_organization_id()),false);$gate$),
('post_expense',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('record_bank_transaction',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('bank_cash_from_till',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope((select location_id from public.till_sessions where id=p_till_session_id and organization_id=public.current_organization_id()),(select user_id from public.till_sessions where id=p_till_session_id and organization_id=public.current_organization_id()),false);$gate$),
('post_manual_journal',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('create_accounting_account',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('create_accounting_period',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('close_accounting_period',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('reopen_accounting_period',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('reverse_accounting_journal',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope((select location_id from public.accounting_journals where id=p_journal_id and organization_id=public.current_organization_id()),(select created_by from public.accounting_journals where id=p_journal_id and organization_id=public.current_organization_id()),false);$gate$),
('save_accounting_tax_code',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('save_accounting_tax_settings',$gate$perform public.mgt_require_modules(array['finance' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('clock_in',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('clock_out',$gate$perform public.mgt_require_modules(array['hr' ]);$gate$),
('record_attendance',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('submit_leave_request',$gate$perform public.mgt_require_modules(array['hr' ]);$gate$),
('review_leave_request',$gate$perform public.mgt_require_modules(array['hr' ]);$gate$),
('create_employee_commission',$gate$perform public.mgt_require_modules(array['hr' ]);$gate$),
('review_employee_commission',$gate$perform public.mgt_require_modules(array['hr' ]);$gate$),
('create_payroll_period',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('calculate_payroll_period',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('approve_payroll_period',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope(null,null);$gate$),
('record_payroll_payment',$gate$perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_scope((select location_id from public.payroll_entries where id=p_payroll_entry_id and organization_id=public.current_organization_id()),(select user_id from public.payroll_entries where id=p_payroll_entry_id and organization_id=public.current_organization_id()),false);$gate$),
('create_project',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('assign_project_member',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('add_project_milestone',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('add_project_task',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('update_project_status',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('update_project_milestone',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select p.location_id from public.projects p join public.project_milestones c on c.project_id=p.id where c.id=p_milestone_id and p.organization_id=public.current_organization_id()),(select p.manager_user_id from public.projects p join public.project_milestones c on c.project_id=p.id where c.id=p_milestone_id and p.organization_id=public.current_organization_id()),exists(select 1 from public.project_members m join public.project_milestones c on c.project_id=m.project_id where c.id=p_milestone_id and m.organization_id=public.current_organization_id() and m.user_id=auth.uid() and m.active));$gate$),
('update_project_task',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select p.location_id from public.projects p join public.project_tasks t on t.project_id=p.id where t.id=p_task_id and p.organization_id=public.current_organization_id()),(select assigned_user_id from public.project_tasks where id=p_task_id and organization_id=public.current_organization_id()));$gate$),
('log_project_time',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('review_project_timesheet',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select p.location_id from public.projects p join public.project_timesheets c on c.project_id=p.id where c.id=p_timesheet_id and p.organization_id=public.current_organization_id()),(select p.manager_user_id from public.projects p join public.project_timesheets c on c.project_id=p.id where c.id=p_timesheet_id and p.organization_id=public.current_organization_id()),exists(select 1 from public.project_members m join public.project_timesheets c on c.project_id=m.project_id where c.id=p_timesheet_id and m.organization_id=public.current_organization_id() and m.user_id=auth.uid() and m.active));$gate$),
('issue_project_material',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('reverse_project_material',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select p.location_id from public.projects p join public.project_materials c on c.project_id=p.id where c.id=p_project_material_id and p.organization_id=public.current_organization_id()),(select p.manager_user_id from public.projects p join public.project_materials c on c.project_id=p.id where c.id=p_project_material_id and p.organization_id=public.current_organization_id()),exists(select 1 from public.project_members m join public.project_materials c on c.project_id=m.project_id where c.id=p_project_material_id and m.organization_id=public.current_organization_id() and m.user_id=auth.uid() and m.active));$gate$),
('post_project_expense',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('pay_project_expense',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select p.location_id from public.projects p join public.project_expenses c on c.project_id=p.id where c.id=p_project_expense_id and p.organization_id=public.current_organization_id()),(select p.manager_user_id from public.projects p join public.project_expenses c on c.project_id=p.id where c.id=p_project_expense_id and p.organization_id=public.current_organization_id()),exists(select 1 from public.project_members m join public.project_expenses c on c.project_id=m.project_id where c.id=p_project_expense_id and m.organization_id=public.current_organization_id() and m.user_id=auth.uid() and m.active));$gate$),
('create_project_invoice',$gate$perform public.mgt_require_modules(array['projects' ]);
 perform public.mgt_require_scope((select location_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),(select manager_user_id from public.projects where id=p_project_id and organization_id=public.current_organization_id()),exists(select 1 from public.project_members where project_id=p_project_id and organization_id=public.current_organization_id() and user_id=auth.uid() and active));$gate$),
('record_project_invoice_payment',$gate$perform public.mgt_require_modules(array['projects','finance' ]);
 perform public.mgt_require_scope((select location_id from public.project_invoices where id=p_invoice_id and organization_id=public.current_organization_id()),(select created_by from public.project_invoices where id=p_invoice_id and organization_id=public.current_organization_id()),false);$gate$),
('create_vehicle',$gate$perform public.mgt_require_modules(array['fleet' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('create_delivery',$gate$perform public.mgt_require_modules(array['fleet' ]);
 perform public.mgt_require_scope(p_source_location_id,null);$gate$),
('update_delivery_status',$gate$perform public.mgt_require_modules(array['fleet' ]);
 perform public.mgt_require_scope((select source_location_id from public.deliveries where id=p_delivery_id and organization_id=public.current_organization_id()),(select driver_user_id from public.deliveries where id=p_delivery_id and organization_id=public.current_organization_id()),false);$gate$),
('record_fuel_log',$gate$perform public.mgt_require_modules(array['fleet' ]);
 perform public.mgt_require_scope((select location_id from public.vehicles where id=p_vehicle_id and organization_id=public.current_organization_id()),(select assigned_driver_id from public.vehicles where id=p_vehicle_id and organization_id=public.current_organization_id()),false);$gate$),
('create_asset',$gate$perform public.mgt_require_modules(array['assets' ]);
 perform public.mgt_require_scope(p_location_id,null);$gate$),
('schedule_asset_maintenance',$gate$perform public.mgt_require_modules(array['assets' ]);
 perform public.mgt_require_scope((select location_id from public.assets where id=p_asset_id and organization_id=public.current_organization_id()),(select assigned_user_id from public.assets where id=p_asset_id and organization_id=public.current_organization_id()),false);$gate$),
('complete_asset_maintenance',$gate$perform public.mgt_require_modules(array['assets' ]);
 perform public.mgt_require_scope((select location_id from public.asset_maintenance where id=p_maintenance_id and organization_id=public.current_organization_id()),(select assigned_user_id from public.asset_maintenance where id=p_maintenance_id and organization_id=public.current_organization_id()),false);$gate$),
('create_quotation',$gate$perform public.mgt_require_modules(array['documents' ]);
 perform public.mgt_require_scope(p_location_id,auth.uid());$gate$),
('update_quotation_status',$gate$perform public.mgt_require_modules(array['documents' ]);
 perform public.mgt_require_scope((select location_id from public.quotations where id=p_quotation_id and organization_id=public.current_organization_id()),(select created_by from public.quotations where id=p_quotation_id and organization_id=public.current_organization_id()),false);$gate$),
('review_approval_request',$gate$perform public.mgt_require_modules(array['alerts','purchasing','manufacturing','inventory' ]);
 perform public.mgt_require_scope((select location_id from public.approval_requests where id=p_request_id and organization_id=public.current_organization_id()),(select requested_by from public.approval_requests where id=p_request_id and organization_id=public.current_organization_id()),false);$gate$),
('transition_online_order',$gate$perform public.mgt_require_modules(array['ecommerce' ]);
 perform public.mgt_require_scope((select location_id from public.online_orders where id=p_order_id and organization_id=public.current_organization_id()),(select confirmed_by from public.online_orders where id=p_order_id and organization_id=public.current_organization_id()),false);$gate$),
('record_online_order_payment',$gate$perform public.mgt_require_modules(array['ecommerce' ]);
 perform public.mgt_require_scope((select location_id from public.online_orders where id=p_order_id and organization_id=public.current_organization_id()),(select confirmed_by from public.online_orders where id=p_order_id and organization_id=public.current_organization_id()),false);$gate$)
 ) as gates(name,guard) loop
  select p.oid into f from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=r.name;
  if not found then raise exception 'Missing required workflow: %',r.name; end if;
  d:=pg_get_functiondef(f.oid);
  patched:=regexp_replace(d,E'(\n[Bb][Ee][Gg][Ii][Nn][ \t]*\n)',$prefix$\1 $prefix$||r.guard||E'\n');
  if patched=d then raise exception 'Cannot install workflow guard: %',r.name; end if;
  execute patched;
 end loop;
end $migration$;


-- Database idempotency for checkout: the same request cannot consume stock or
-- accept a payment twice, including simultaneous requests and a lost response.
create table public.sale_checkout_requests (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 request_id uuid not null,
 payload jsonb not null,
 result jsonb,
 created_at timestamptz not null default now(),
 primary key(organization_id,user_id,request_id)
);
alter table public.sale_checkout_requests enable row level security;
revoke all on public.sale_checkout_requests from public,anon,authenticated;
grant all on public.sale_checkout_requests to service_role;

create or replace function public.post_pos_sale_once(
 p_request_id uuid,p_location_id uuid,p_customer_id uuid,p_items jsonb,
 p_payments jsonb default '[]'::jsonb,p_discount_amount numeric default 0,
 p_channel text default 'pos',p_pricing_mode text default 'retail',p_notes text default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id(); v_payload jsonb; v_saved public.sale_checkout_requests%rowtype; v_result jsonb;
begin
 perform public.mgt_require_modules(array['pos','sales']);
 if not public.has_permission('sales.create') then raise exception 'Permission denied: sales.create' using errcode='42501'; end if;
 perform public.mgt_require_scope(p_location_id,auth.uid());
 if p_request_id is null then raise exception 'Checkout request ID is required'; end if;
 v_payload:=jsonb_build_object('location',p_location_id,'customer',p_customer_id,'items',p_items,'payments',p_payments,'discount',p_discount_amount,'channel',p_channel,'pricing',p_pricing_mode,'notes',p_notes);
 insert into public.sale_checkout_requests(organization_id,user_id,request_id,payload)
 values(v_org,auth.uid(),p_request_id,v_payload) on conflict do nothing;
 select * into v_saved from public.sale_checkout_requests where organization_id=v_org and user_id=auth.uid() and request_id=p_request_id for update;
 if v_saved.payload is distinct from v_payload then raise exception 'Checkout request was already used for different sale details'; end if;
 if v_saved.result is not null then return v_saved.result; end if;
 v_result:=public.post_pos_sale(p_location_id,p_customer_id,p_items,p_payments,p_discount_amount,p_channel,p_pricing_mode,p_notes);
 update public.sale_checkout_requests set result=v_result where organization_id=v_org and user_id=auth.uid() and request_id=p_request_id;
 return v_result;
end; $$;
revoke all on function public.post_pos_sale_once(uuid,uuid,uuid,jsonb,jsonb,numeric,text,text,text) from public,anon;
grant execute on function public.post_pos_sale_once(uuid,uuid,uuid,jsonb,jsonb,numeric,text,text,text) to authenticated;

-- An extra restrictive policy intersects existing permission policies. It never
-- grants visibility merely because a row belongs to the same branch.
do $$ declare r record; begin
 for r in select * from (values
 ('purchases','location_id','created_by'),('stock_movements','location_id','recorded_by'),
 ('stocktakes','location_id','created_by'),('till_sessions','location_id','user_id'),
 ('expenses','location_id','recorded_by'),('deliveries','source_location_id','driver_user_id'),
 ('vehicles','location_id','assigned_driver_id'),('assets','location_id','assigned_user_id'),
 ('asset_maintenance','location_id','assigned_user_id'),('production_orders','location_id','created_by'),
 ('quotations','location_id','created_by'),('external_payment_transactions','location_id','initiated_by')
 ) as targets(tab,loc,owner) loop
  execute format('create policy mgt_work_scope on public.%I as restrictive for select to authenticated using(public.mgt_record_scope_allows(organization_id,%I,%I))',r.tab,r.loc,r.owner);
 end loop;
end $$;

create policy mgt_stock_location_scope on public.stock_balances as restrictive for select to authenticated
using(public.mgt_record_scope_allows(public.current_organization_id(),location_id,auth.uid()));

-- Service-backed payment requests must check scope before invoking provider APIs.
-- This helper returns no business details and is also used by the server via the
-- caller's own JWT; a service key is never substituted for caller authorization.
create or replace function public.mgt_payment_target_access(p_type text,p_id uuid)
returns boolean language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id(); v_location uuid; v_owner uuid; v_assigned boolean:=false;
begin
 if v_org is null or not(public.has_permission('payments.request') or public.has_permission('payments.view') or public.has_permission('payments.manage')) then return false; end if;
 if not public.current_module_enabled('payments') then return false; end if;
 case p_type
 when 'sale' then
  select location_id,sold_by into v_location,v_owner from public.sales where id=p_id and organization_id=v_org;
 when 'work_order' then
  select location_id,assigned_to into v_location,v_owner from public.work_orders where id=p_id and organization_id=v_org;
  v_assigned:=public.mgt_is_work_order_assignee(p_id);
 when 'project_invoice' then
  select location_id,created_by into v_location,v_owner from public.project_invoices where id=p_id and organization_id=v_org;
 when 'online_order' then
  select location_id,confirmed_by into v_location,v_owner from public.online_orders where id=p_id and organization_id=v_org;
 when 'customer_debt' then
  return public.mgt_record_scope_allows(v_org,null,null) and exists(select 1 from public.customers where id=p_id and organization_id=v_org);
 when 'unallocated' then return public.mgt_record_scope_allows(v_org,null,null);
 else return false;
 end case;
 if not found then return false; end if;
 return public.mgt_record_scope_allows(v_org,v_location,v_owner,v_assigned);
end; $$;
revoke all on function public.mgt_payment_target_access(text,uuid) from public,anon;
grant execute on function public.mgt_payment_target_access(text,uuid) to authenticated;

-- Supplier totals cover the full ledger, rather than a capped screen history.
create or replace function public.get_supplier_payables()
returns table(supplier_id uuid,balance_due numeric) language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();
begin
 perform public.mgt_require_modules(array['suppliers','purchasing','finance']);
 if not (public.has_permission('suppliers.view') or public.has_permission('purchasing.view') or public.has_permission('finance.view')) then
  raise exception 'Permission denied: supplier balances' using errcode='42501';
 end if;
 return query select s.id,
  case when public.mgt_record_scope_allows(v_org,null,null) then greatest(s.opening_balance-s.opening_balance_paid,0) else 0 end
  +coalesce(sum(greatest(p.total_amount-p.amount_paid,0)),0)
 from public.suppliers s left join public.purchases p on p.supplier_id=s.id and p.organization_id=v_org
  and public.mgt_record_scope_allows(v_org,p.location_id,p.created_by)
  and p.approval_status in ('not_required','approved') and p.status not in ('draft','pending_approval','rejected','cancelled')
 where s.organization_id=v_org and s.active group by s.id;
end; $$;
revoke all on function public.get_supplier_payables() from public,anon;
grant execute on function public.get_supplier_payables() to authenticated;

notify pgrst,'reload schema';
