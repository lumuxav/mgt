-- Extend the existing work scopes to reports, HR and financial summaries.
-- Shared catalog/contact fields remain available under their existing permissions.
create or replace function public.mgt_staff_scope_allows(p_org uuid,p_user uuid)
returns boolean language sql stable security definer set search_path=public as $$
 select coalesce(p_org=public.current_organization_id(),false) and exists(
  select 1 from public.users u where u.id=p_user and u.organization_id=p_org
   and (u.id=auth.uid() or public.mgt_record_scope_allows(p_org,u.default_location_id,u.id))
 )
$$;
revoke all on function public.mgt_staff_scope_allows(uuid,uuid) from public,anon;
grant execute on function public.mgt_staff_scope_allows(uuid,uuid) to authenticated,service_role;

create or replace function public.mgt_require_staff_scope(p_user uuid)
returns void language plpgsql stable security definer set search_path=public as $$
begin
 if not public.mgt_staff_scope_allows(public.current_organization_id(),p_user) then
  raise exception 'Employee is outside your assigned work scope' using errcode='42501';
 end if;
end; $$;
revoke all on function public.mgt_require_staff_scope(uuid) from public,anon;
grant execute on function public.mgt_require_staff_scope(uuid) to authenticated,service_role;

-- RLS does not protect TRUNCATE or schema-level operations.
revoke truncate,references,trigger on all tables in schema public from anon,authenticated;


drop policy if exists mgt_report_scope on public.till_sessions;
create policy mgt_report_scope on public.till_sessions as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,user_id)) with check (public.mgt_record_scope_allows(organization_id,location_id,user_id));


drop policy if exists mgt_report_scope on public.sale_returns;
create policy mgt_report_scope on public.sale_returns as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,processed_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,processed_by));


drop policy if exists mgt_report_scope on public.banking_transactions;
create policy mgt_report_scope on public.banking_transactions as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,recorded_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,recorded_by));


drop policy if exists mgt_report_scope on public.accounting_journals;
create policy mgt_report_scope on public.accounting_journals as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,created_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,created_by));


drop policy if exists mgt_report_scope on public.fuel_logs;
create policy mgt_report_scope on public.fuel_logs as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,driver_user_id)) with check (public.mgt_record_scope_allows(organization_id,location_id,driver_user_id));


drop policy if exists mgt_report_scope on public.approval_requests;
create policy mgt_report_scope on public.approval_requests as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,requested_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,requested_by));


drop policy if exists mgt_report_scope on public.audit_log;
create policy mgt_report_scope on public.audit_log as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,user_id)) with check (public.mgt_record_scope_allows(organization_id,location_id,user_id));


drop policy if exists mgt_report_scope on public.storefronts;
create policy mgt_report_scope on public.storefronts as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,created_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,created_by));


drop policy if exists mgt_report_scope on public.online_orders;
create policy mgt_report_scope on public.online_orders as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,confirmed_by)) with check (public.mgt_record_scope_allows(organization_id,location_id,confirmed_by));


drop policy if exists mgt_report_scope on public.stock_transfers;
create policy mgt_report_scope on public.stock_transfers as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,from_location_id,created_by) or public.mgt_record_scope_allows(organization_id,to_location_id,created_by)) with check (public.mgt_record_scope_allows(organization_id,from_location_id,created_by) or public.mgt_record_scope_allows(organization_id,to_location_id,created_by));


drop policy if exists mgt_report_scope on public.accounting_journal_lines;
create policy mgt_report_scope on public.accounting_journal_lines as restrictive for all to authenticated using (exists(select 1 from public.accounting_journals parent where parent.id=accounting_journal_lines.journal_id)) with check (exists(select 1 from public.accounting_journals parent where parent.id=accounting_journal_lines.journal_id));


drop policy if exists mgt_report_scope on public.stock_transfer_items;
create policy mgt_report_scope on public.stock_transfer_items as restrictive for all to authenticated using (exists(select 1 from public.stock_transfers parent where parent.id=stock_transfer_items.transfer_id)) with check (exists(select 1 from public.stock_transfers parent where parent.id=stock_transfer_items.transfer_id));


drop policy if exists mgt_report_scope on public.production_consumption;
create policy mgt_report_scope on public.production_consumption as restrictive for all to authenticated using (exists(select 1 from public.production_orders parent where parent.id=production_consumption.production_order_id)) with check (exists(select 1 from public.production_orders parent where parent.id=production_consumption.production_order_id));


drop policy if exists mgt_report_scope on public.production_outputs;
create policy mgt_report_scope on public.production_outputs as restrictive for all to authenticated using (exists(select 1 from public.production_orders parent where parent.id=production_outputs.production_order_id)) with check (exists(select 1 from public.production_orders parent where parent.id=production_outputs.production_order_id));


drop policy if exists mgt_report_scope on public.project_timesheets;
create policy mgt_report_scope on public.project_timesheets as restrictive for all to authenticated using (exists(select 1 from public.projects parent where parent.id=project_timesheets.project_id)) with check (exists(select 1 from public.projects parent where parent.id=project_timesheets.project_id));


drop policy if exists mgt_report_scope on public.project_members;
create policy mgt_report_scope on public.project_members as restrictive for all to authenticated using (exists(select 1 from public.projects parent where parent.id=project_members.project_id)) with check (exists(select 1 from public.projects parent where parent.id=project_members.project_id));


drop policy if exists mgt_report_scope on public.online_order_items;
create policy mgt_report_scope on public.online_order_items as restrictive for all to authenticated using (exists(select 1 from public.online_orders parent where parent.id=online_order_items.order_id)) with check (exists(select 1 from public.online_orders parent where parent.id=online_order_items.order_id));


drop policy if exists mgt_report_scope on public.storefront_products;
create policy mgt_report_scope on public.storefront_products as restrictive for all to authenticated using (exists(select 1 from public.storefronts parent where parent.id=storefront_products.storefront_id)) with check (exists(select 1 from public.storefronts parent where parent.id=storefront_products.storefront_id));


drop policy if exists mgt_report_scope on public.users;
create policy mgt_report_scope on public.users as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,id)) with check (public.mgt_staff_scope_allows(organization_id,id));


drop policy if exists mgt_report_scope on public.employee_profiles;
create policy mgt_report_scope on public.employee_profiles as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,user_id)) with check (public.mgt_staff_scope_allows(organization_id,user_id));


drop policy if exists mgt_report_scope on public.employee_shift_assignments;
create policy mgt_report_scope on public.employee_shift_assignments as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,user_id)) with check (public.mgt_staff_scope_allows(organization_id,user_id));


drop policy if exists mgt_report_scope on public.employee_pay_components;
create policy mgt_report_scope on public.employee_pay_components as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,user_id)) with check (public.mgt_staff_scope_allows(organization_id,user_id));


drop policy if exists mgt_report_scope on public.leave_requests;
create policy mgt_report_scope on public.leave_requests as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,user_id)) with check (public.mgt_staff_scope_allows(organization_id,user_id));


drop policy if exists mgt_report_scope on public.employee_commissions;
create policy mgt_report_scope on public.employee_commissions as restrictive for all to authenticated using (public.mgt_staff_scope_allows(organization_id,user_id)) with check (public.mgt_staff_scope_allows(organization_id,user_id));


drop policy if exists mgt_report_scope on public.attendance;
create policy mgt_report_scope on public.attendance as restrictive for all to authenticated using (public.has_organization_access(organization_id) and (user_id=auth.uid() or public.mgt_record_scope_allows(organization_id,location_id,user_id))) with check (public.has_organization_access(organization_id) and (user_id=auth.uid() or public.mgt_record_scope_allows(organization_id,location_id,user_id)));


drop policy if exists mgt_report_scope on public.payroll_entries;
create policy mgt_report_scope on public.payroll_entries as restrictive for all to authenticated using (public.has_organization_access(organization_id) and (user_id=auth.uid() or public.mgt_record_scope_allows(organization_id,location_id,user_id))) with check (public.has_organization_access(organization_id) and (user_id=auth.uid() or public.mgt_record_scope_allows(organization_id,location_id,user_id)));


drop policy if exists mgt_report_scope on public.payroll_periods;
create policy mgt_report_scope on public.payroll_periods as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,null,null)) with check (public.mgt_record_scope_allows(organization_id,null,null));


drop policy if exists mgt_report_scope on public.locations;
create policy mgt_report_scope on public.locations as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,id,auth.uid())) with check (public.mgt_record_scope_allows(organization_id,id,auth.uid()));


drop policy if exists mgt_report_scope on public.payments;
create policy mgt_report_scope on public.payments as restrictive for all to authenticated using (public.mgt_record_scope_allows(organization_id,location_id,coalesce(employee_user_id,received_by)) and (
 (employee_user_id is not null and (employee_user_id=auth.uid() or public.has_permission('payroll.view') or public.has_permission('payroll.pay') or public.has_permission('payroll.manage')))
 or (employee_user_id is null and (
  public.has_permission('finance.view')
  or (sale_id is not null and public.has_permission('sales.view'))
  or (purchase_id is not null and public.has_permission('purchasing.view'))
  or (work_order_id is not null and (public.has_permission('services.view') or public.has_permission('services.manage')))
  or (project_id is not null and (public.has_permission('projects.view') or public.has_permission('projects.billing') or public.has_permission('projects.manage')))
  or (payment_type='customer_payment' and public.has_permission('sales.view'))
  or (payment_type='supplier_payment' and public.has_permission('purchasing.view'))
 )))) with check (public.mgt_record_scope_allows(organization_id,location_id,coalesce(employee_user_id,received_by)) and (
 (employee_user_id is not null and (employee_user_id=auth.uid() or public.has_permission('payroll.view') or public.has_permission('payroll.pay') or public.has_permission('payroll.manage')))
 or (employee_user_id is null and (
  public.has_permission('finance.view')
  or (sale_id is not null and public.has_permission('sales.view'))
  or (purchase_id is not null and public.has_permission('purchasing.view'))
  or (work_order_id is not null and (public.has_permission('services.view') or public.has_permission('services.manage')))
  or (project_id is not null and (public.has_permission('projects.view') or public.has_permission('projects.billing') or public.has_permission('projects.manage')))
  or (payment_type='customer_payment' and public.has_permission('sales.view'))
  or (payment_type='supplier_payment' and public.has_permission('purchasing.view'))
 ))));


CREATE OR REPLACE FUNCTION public.get_business_insights()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY INVOKER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid := public.current_organization_id();
 v_tz text; v_currency text; v_today date; v_since timestamptz; v_end timestamptz;
 v_modules text[]; v_sales boolean; v_finance boolean; v_inventory boolean;
 v_services boolean; v_projects boolean;
 v_daily jsonb; v_stock jsonb := null; v_first date; v_receivables numeric := null;
 v_jobs bigint := null; v_overruns bigint := null;
begin
 if v_org is null or not public.has_permission('insights.view') then
  raise exception 'You do not have access to MGT Intelligence' using errcode='42501';
 end if;
 select coalesce(array_agg(module_key),array[]::text[]) into v_modules
 from public.organization_modules where organization_id=v_org and enabled;
 if not ('insights'=any(v_modules)) then
  raise exception 'MGT Intelligence is disabled for this business' using errcode='42501';
 end if;
 select o.currency,case when exists(select 1 from pg_timezone_names z where z.name=o.timezone) then o.timezone else 'UTC' end
 into v_currency,v_tz from public.organizations o where o.id=v_org;
 v_today := (now() at time zone v_tz)::date;
 v_since := (v_today-90)::timestamp at time zone v_tz;
 v_end := v_today::timestamp at time zone v_tz;
 v_sales := public.has_permission('sales.view') and ('sales'=any(v_modules) or 'pos'=any(v_modules));
 v_finance := public.has_permission('finance.view') and 'finance'=any(v_modules);
 v_inventory := public.has_permission('inventory.view') and 'inventory'=any(v_modules);
 v_services := (public.has_permission('services.view') or public.has_permission('services.manage')) and 'services'=any(v_modules);
 v_projects := (public.has_permission('projects.view') or public.has_permission('projects.manage') or public.has_permission('projects.costs') or public.has_permission('projects.billing')) and 'projects'=any(v_modules);
 with days as (select v_today-n as day from generate_series(1,90) n),
 daily_sales as (
  select (s.created_at at time zone v_tz)::date as day,
   sum(greatest(s.total_amount-s.refunded_amount,0)) as sales,count(*) as sale_count
  from public.sales s
  where v_sales and s.organization_id=v_org and s.created_at>=v_since and s.created_at<v_end
   and s.status not in ('cancelled','void','draft')
  group by 1
 ),daily_expenses as (
  select (e.created_at at time zone v_tz)::date as day,sum(e.amount) as expenses
  from public.expenses e where v_finance and e.organization_id=v_org and e.created_at>=v_since and e.created_at<v_end
  group by 1
 )
 select jsonb_agg(jsonb_build_object('date',d.day,
  'sales',case when v_sales then coalesce(s.sales,0) else null end,
  'sale_count',case when v_sales then coalesce(s.sale_count,0) else null end,
  'expenses',case when v_finance then coalesce(e.expenses,0) else null end) order by d.day)
 into v_daily from days d left join daily_sales s using(day) left join daily_expenses e using(day);
 if v_sales then
  select (min(created_at) at time zone v_tz)::date,
   coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0)
  into v_first,v_receivables from public.sales
  where organization_id=v_org and created_at<=now() and status not in ('cancelled','void','draft');
 end if;
 if v_inventory then
  with stock as (
   select p.id,p.name,p.reorder_level,coalesce(sum(greatest(b.quantity-b.reserved_quantity,0)),0) as available
   from public.products p left join public.stock_balances b on b.product_id=p.id
   where p.organization_id=v_org and p.active and p.track_inventory
   group by p.id,p.name,p.reorder_level
  ), low as (select * from stock where available<=reorder_level)
  select jsonb_build_object('tracked_count',(select count(*) from stock),'low_count',(select count(*) from low),
   'low_items',coalesce((select jsonb_agg(to_jsonb(x) order by x.available,x.name,x.id) from
    (select * from low order by available,name,id limit 12) x),'[]'::jsonb)) into v_stock;
 end if;
 if v_services then
  select count(*) into v_jobs from public.work_orders where organization_id=v_org
   and status not in ('completed','cancelled') and due_at<now();
 end if;
 if v_projects then
  select count(*) into v_overruns from public.projects where organization_id=v_org
   and status not in ('completed','cancelled') and budget_cost>0 and total_cost>budget_cost;
 end if;
 return jsonb_build_object('generated_at',now(),'currency',v_currency,'timezone',v_tz,
  'period_start',v_today-30,'period_end',v_today-1,'first_sale_date',v_first,
  'access',jsonb_build_object('sales',v_sales,'finance',v_finance,'inventory',v_inventory,'services',v_services,'projects',v_projects),
  'daily',v_daily,'sales_receivables',v_receivables,'inventory',v_stock,
  'operations',jsonb_build_object('overdue_jobs',v_jobs,'over_budget_projects',v_overruns));
end;
$function$
;

CREATE OR REPLACE FUNCTION public.upsert_employee_hr_profile(p_user_id uuid, p_employee_number text DEFAULT NULL::text, p_department_id uuid DEFAULT NULL::uuid, p_job_title text DEFAULT NULL::text, p_hire_date date DEFAULT NULL::date, p_employment_type text DEFAULT 'full_time'::text, p_pay_frequency text DEFAULT 'monthly'::text, p_base_salary numeric DEFAULT 0, p_daily_rate numeric DEFAULT 0, p_hourly_rate numeric DEFAULT 0, p_phone text DEFAULT NULL::text, p_emergency_contact text DEFAULT NULL::text, p_tax_number text DEFAULT NULL::text, p_bank_name text DEFAULT NULL::text, p_bank_account_name text DEFAULT NULL::text, p_bank_account_number text DEFAULT NULL::text, p_mobile_money_number text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
begin
 perform public.mgt_require_modules(array['hr']); perform public.mgt_require_staff_scope(p_user_id);
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('hr.manage') then raise exception 'Permission denied: hr.manage'; end if;
 if not exists(select 1 from public.users where id=p_user_id and organization_id=v_org) then raise exception 'Employee user not found'; end if;
 if p_department_id is not null and not exists(select 1 from public.departments where id=p_department_id and organization_id=v_org and active=true) then raise exception 'Department not found'; end if;
 if p_employment_type not in ('full_time','part_time','contract','temporary','intern','casual') then raise exception 'Invalid employment type'; end if;
 if p_pay_frequency not in ('monthly','weekly','daily','hourly') then raise exception 'Invalid pay frequency'; end if;
 if coalesce(p_base_salary,0)<0 or coalesce(p_daily_rate,0)<0 or coalesce(p_hourly_rate,0)<0 then raise exception 'Pay rates cannot be negative'; end if;

 insert into public.employee_profiles(
  user_id,organization_id,employee_number,department_id,job_title,hire_date,employment_type,pay_frequency,
  base_salary,daily_rate,hourly_rate,phone,emergency_contact,tax_number,bank_name,bank_account_name,
  bank_account_number,mobile_money_number,notes
 )
 values(
  p_user_id,v_org,nullif(trim(p_employee_number),''),p_department_id,nullif(trim(p_job_title),''),
  p_hire_date,p_employment_type,p_pay_frequency,coalesce(p_base_salary,0),coalesce(p_daily_rate,0),
  coalesce(p_hourly_rate,0),nullif(trim(p_phone),''),nullif(trim(p_emergency_contact),''),
  nullif(trim(p_tax_number),''),nullif(trim(p_bank_name),''),nullif(trim(p_bank_account_name),''),
  nullif(trim(p_bank_account_number),''),nullif(trim(p_mobile_money_number),''),p_notes
 )
 on conflict(user_id) do update set
  employee_number=excluded.employee_number,department_id=excluded.department_id,job_title=excluded.job_title,
  hire_date=excluded.hire_date,employment_type=excluded.employment_type,pay_frequency=excluded.pay_frequency,
  base_salary=excluded.base_salary,daily_rate=excluded.daily_rate,hourly_rate=excluded.hourly_rate,
  phone=excluded.phone,emergency_contact=excluded.emergency_contact,tax_number=excluded.tax_number,
  bank_name=excluded.bank_name,bank_account_name=excluded.bank_account_name,bank_account_number=excluded.bank_account_number,
  mobile_money_number=excluded.mobile_money_number,notes=excluded.notes,updated_at=now();

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,auth.uid(),'employee_profile_updated','employee',p_user_id::text,'HR profile updated');

 return p_user_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_attendance(p_user_id uuid, p_work_date date, p_location_id uuid, p_status text, p_check_in timestamp with time zone DEFAULT NULL::timestamp with time zone, p_check_out timestamp with time zone DEFAULT NULL::timestamp with time zone, p_break_minutes integer DEFAULT 0, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_staff_scope(p_user_id);
 perform public.mgt_require_scope(p_location_id,auth.uid());
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('attendance.manage') then raise exception 'Permission denied: attendance.manage'; end if;
 if p_status not in ('present','late','half_day','absent','leave','off') then raise exception 'Invalid attendance status'; end if;
 if not exists(select 1 from public.users where id=p_user_id and organization_id=v_org and active=true) then raise exception 'Employee not found'; end if;
 if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_check_out is not null and p_check_in is not null and p_check_out<p_check_in then raise exception 'Clock-out cannot be before clock-in'; end if;

 insert into public.attendance(organization_id,user_id,location_id,work_date,status,check_in,check_out,break_minutes,notes,created_by)
 values(v_org,p_user_id,p_location_id,p_work_date,p_status,p_check_in,p_check_out,greatest(coalesce(p_break_minutes,0),0),p_notes,auth.uid())
 on conflict(organization_id,user_id,work_date) do update set
  location_id=excluded.location_id,status=excluded.status,check_in=excluded.check_in,check_out=excluded.check_out,
  break_minutes=excluded.break_minutes,notes=excluded.notes,updated_at=now()
 returning id into v_id;

 return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.review_leave_request(p_leave_request_id uuid, p_decision text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_req public.leave_requests%rowtype;
 v_shift_days smallint[];
 v_day date;
 v_location uuid;
 v_paid boolean:=false;
begin
 perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_staff_scope((select user_id from public.leave_requests where id=p_leave_request_id and organization_id=public.current_organization_id()));
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.create_employee_commission(p_user_id uuid, p_amount numeric, p_sale_id uuid DEFAULT NULL::uuid, p_work_order_id uuid DEFAULT NULL::uuid, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_staff_scope(p_user_id);
 if p_sale_id is not null then perform public.mgt_require_scope((select location_id from public.sales where id=p_sale_id and organization_id=public.current_organization_id()),(select sold_by from public.sales where id=p_sale_id and organization_id=public.current_organization_id())); end if;
 if p_work_order_id is not null then perform public.mgt_require_scope((select location_id from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),(select assigned_to from public.work_orders where id=p_work_order_id and organization_id=public.current_organization_id()),public.mgt_is_work_order_assignee(p_work_order_id)); end if;
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('commissions.manage') then raise exception 'Permission denied: commissions.manage'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Commission amount must be greater than zero'; end if;
 if not exists(select 1 from public.users where id=p_user_id and organization_id=v_org and active=true) then raise exception 'Employee not found'; end if;
 if p_sale_id is not null and not exists(select 1 from public.sales where id=p_sale_id and organization_id=v_org) then raise exception 'Sale not found'; end if;
 if p_work_order_id is not null and not exists(select 1 from public.work_orders where id=p_work_order_id and organization_id=v_org) then raise exception 'Work order not found'; end if;

 insert into public.employee_commissions(organization_id,user_id,sale_id,work_order_id,amount,status,notes,created_by)
 values(v_org,p_user_id,p_sale_id,p_work_order_id,p_amount,'pending',p_notes,auth.uid())
 returning id into v_id;
 return v_id;
end; $function$
;

CREATE OR REPLACE FUNCTION public.review_employee_commission(p_commission_id uuid, p_decision text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
begin
 perform public.mgt_require_modules(array['hr' ]);
 perform public.mgt_require_staff_scope((select user_id from public.employee_commissions where id=p_commission_id and organization_id=public.current_organization_id()));
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('commissions.manage') then raise exception 'Permission denied: commissions.manage'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 update public.employee_commissions
 set status=p_decision,approved_by=auth.uid(),approved_at=now()
 where id=p_commission_id and organization_id=v_org and status='pending';
 if not found then raise exception 'Pending commission not found'; end if;
 return jsonb_build_object('commission_id',p_commission_id,'status',p_decision);
end; $function$
;

revoke select on public.customers from anon,authenticated;
revoke select (opening_balance,opening_balance_paid) on public.customers from anon,authenticated;
grant select (id,organization_id,name,phone,email,address,customer_group,credit_limit,active,notes,created_at,updated_at) on public.customers to authenticated;

create or replace function public.get_scoped_customers()
returns setof public.customers language sql stable security definer set search_path=public as $$
 select t.id,t.organization_id,t.name,t.phone,t.email,t.address,t.customer_group,t.credit_limit,case when public.mgt_record_scope_allows(t.organization_id,null,null) then t.opening_balance else 0 end,t.active,t.notes,t.created_at,t.updated_at,case when public.mgt_record_scope_allows(t.organization_id,null,null) then t.opening_balance_paid else 0 end from public.customers t where t.organization_id=public.current_organization_id() and public.has_permission('customers.view')
$$;
revoke all on function public.get_scoped_customers() from public,anon;
grant execute on function public.get_scoped_customers() to authenticated,service_role;


revoke select on public.suppliers from anon,authenticated;
revoke select (opening_balance,opening_balance_paid) on public.suppliers from anon,authenticated;
grant select (id,organization_id,name,phone,email,address,active,notes,created_at,updated_at) on public.suppliers to authenticated;

create or replace function public.get_scoped_suppliers()
returns setof public.suppliers language sql stable security definer set search_path=public as $$
 select t.id,t.organization_id,t.name,t.phone,t.email,t.address,case when public.mgt_record_scope_allows(t.organization_id,null,null) then t.opening_balance else 0 end,t.active,t.notes,t.created_at,t.updated_at,case when public.mgt_record_scope_allows(t.organization_id,null,null) then t.opening_balance_paid else 0 end from public.suppliers t where t.organization_id=public.current_organization_id() and public.has_permission('suppliers.view')
$$;
revoke all on function public.get_scoped_suppliers() from public,anon;
grant execute on function public.get_scoped_suppliers() to authenticated,service_role;


revoke select on public.bank_accounts from anon,authenticated;
revoke select (opening_balance) on public.bank_accounts from anon,authenticated;
grant select (id,organization_id,name,account_type,provider,account_reference,active,created_at) on public.bank_accounts to authenticated;

drop policy if exists mgt_bank_insert_scope on public.bank_accounts;
create policy mgt_bank_insert_scope on public.bank_accounts as restrictive for insert to authenticated  with check (public.mgt_record_scope_allows(organization_id,null,null));


drop policy if exists mgt_bank_update_scope on public.bank_accounts;
create policy mgt_bank_update_scope on public.bank_accounts as restrictive for update to authenticated using (public.mgt_record_scope_allows(organization_id,null,null)) with check (public.mgt_record_scope_allows(organization_id,null,null));


drop policy if exists mgt_bank_delete_scope on public.bank_accounts;
create policy mgt_bank_delete_scope on public.bank_accounts as restrictive for delete to authenticated using (public.mgt_record_scope_allows(organization_id,null,null));


create or replace function public.get_bank_account_summaries()
returns table(id uuid,name text,account_type text,provider text,account_reference text,opening_balance numeric,active boolean,created_at timestamptz,balance numeric,balance_visible boolean)
language sql stable security definer set search_path=public as $$
 select a.id,a.name,a.account_type,a.provider,a.account_reference,
  case when public.mgt_record_scope_allows(a.organization_id,null,null) then a.opening_balance end,
  a.active,a.created_at,
  case when public.mgt_record_scope_allows(a.organization_id,null,null) then a.opening_balance+coalesce((
   select sum(case when b.transaction_type='withdrawal' then -b.amount else b.amount end)
   from public.banking_transactions b where b.bank_account_id=a.id and b.organization_id=a.organization_id and b.status='confirmed'
  ),0) end,public.mgt_record_scope_allows(a.organization_id,null,null)
 from public.bank_accounts a where a.organization_id=public.current_organization_id() and public.has_permission('finance.view') and a.active
 order by a.name
$$;
revoke all on function public.get_bank_account_summaries() from public,anon;
grant execute on function public.get_bank_account_summaries() to authenticated,service_role;

create or replace function public.get_scoped_payroll_periods()
returns setof public.payroll_periods language sql stable security definer set search_path=public as $$
 select p.id,p.organization_id,p.name,p.start_date,p.end_date,p.status,
  coalesce(e.gross,0),coalesce(e.deductions,0),coalesce(e.net,0),p.created_by,p.approved_by,p.created_at,p.calculated_at,p.approved_at,p.paid_at
 from public.payroll_periods p left join lateral(
  select sum(gross_pay) gross,sum(deductions) deductions,sum(net_pay) net,count(*) n
  from public.payroll_entries where payroll_period_id=p.id and organization_id=p.organization_id
   and public.mgt_record_scope_allows(organization_id,location_id,user_id)
 ) e on true
 where p.organization_id=public.current_organization_id()
  and (public.has_permission('payroll.view') or public.has_permission('payroll.manage') or public.has_permission('payroll.pay'))
  and (public.mgt_record_scope_allows(p.organization_id,null,null) or e.n>0)
 order by p.start_date desc
$$;
revoke all on function public.get_scoped_payroll_periods() from public,anon;
grant execute on function public.get_scoped_payroll_periods() to authenticated,service_role;


-- A cancellation is a recorded, completed refund; this RPC does not transfer funds at a provider.
create table public.service_cancellation_requests(
 organization_id uuid not null references public.organizations(id),
 user_id uuid not null references public.users(id),
 request_id uuid not null,
 work_order_id uuid not null references public.work_orders(id),
 request_payload jsonb not null,
 result jsonb not null,
 created_at timestamptz not null default now(),
 primary key(organization_id,user_id,request_id)
);
alter table public.service_cancellation_requests enable row level security;
revoke all on public.service_cancellation_requests from public,anon,authenticated;
grant all on public.service_cancellation_requests to service_role;

create or replace function public.cancel_service_work_order(
 p_request_id uuid,p_work_order_id uuid,p_reason text,p_expected_refund_amount numeric,
 p_refund_method text default 'cash',p_bank_account_id uuid default null,
 p_reference text default null,p_restore_materials boolean default false
) returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); w public.work_orders%rowtype; l record;
 v_payload jsonb; v_existing public.service_cancellation_requests%rowtype; v_result jsonb;
 v_paid numeric(18,2); v_available numeric(18,2); v_till public.till_sessions%rowtype;
 v_account public.bank_accounts%rowtype; v_payment uuid; v_cost numeric(18,2):=0;
begin
 if v_org is null or auth.uid() is null then raise exception 'Active organization required' using errcode='42501'; end if;
 perform public.mgt_require_modules(array['services']);
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage' using errcode='42501'; end if;
 if p_request_id is null then raise exception 'Cancellation request ID is required'; end if;
 if nullif(btrim(p_reason),'') is null then raise exception 'A cancellation reason is required'; end if;
 if p_restore_materials is null then raise exception 'Choose how to handle job materials'; end if;
 if p_refund_method is null or p_refund_method not in ('cash','bank','mobile_money','card','cheque') then raise exception 'Invalid refund method'; end if;
 v_payload:=jsonb_build_object('job',p_work_order_id,'reason',btrim(p_reason),'expected_refund',p_expected_refund_amount,'method',p_refund_method,'bank',p_bank_account_id,'reference',nullif(btrim(p_reference),''),'restore',p_restore_materials);
 perform pg_advisory_xact_lock(hashtextextended(v_org::text||':'||auth.uid()::text||':service-cancel:'||p_request_id::text,0));
 select * into w from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 perform public.mgt_require_scope(w.location_id,w.assigned_to,public.mgt_is_work_order_assignee(w.id));
 select * into v_existing from public.service_cancellation_requests where organization_id=v_org and user_id=auth.uid() and request_id=p_request_id;
 if found then
  if v_existing.request_payload is distinct from v_payload then raise exception 'Request ID was already used with different cancellation details'; end if;
  return v_existing.result;
 end if;
 if w.status='completed' then raise exception 'Completed jobs require a credit note; they cannot be cancelled'; end if;
 if w.status='cancelled' then raise exception 'This job is already cancelled'; end if;
 if exists(select 1 from public.external_payment_transactions t where t.organization_id=v_org and t.target_type='work_order' and t.target_id=w.id and (t.status in ('created','pending') or (t.status='succeeded' and t.settlement_status<>'settled'))) then
  raise exception 'Resolve pending provider payments before cancelling this job';
 end if;
 select coalesce(sum(case when direction='in' then amount else -amount end),0) into v_paid from public.payments where organization_id=v_org and work_order_id=w.id;
 if v_paid<0 then raise exception 'Job payment ledger requires reconciliation'; end if;
 if v_paid is distinct from p_expected_refund_amount then raise exception 'Payment total changed; reload the job before cancelling'; end if;
 if v_paid>0 then
  if p_refund_method='cash' then
   select * into v_till from public.till_sessions where organization_id=v_org and location_id=w.location_id and user_id=auth.uid() and status='open' order by opened_at desc limit 1 for update;
   if not found then raise exception 'Open your till before recording a cash refund'; end if;
   select v_till.opening_cash+coalesce(sum(case when direction='in' then amount else -amount end),0) into v_available from public.payments where till_session_id=v_till.id and method='cash';
   if v_available<v_paid then raise exception 'Refund exceeds cash available in your till'; end if;
  else
   if nullif(btrim(p_reference),'') is null then raise exception 'Enter the completed refund transaction reference'; end if;
   select * into v_account from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active for update;
   if not found then raise exception 'Select the financial account used for the refund'; end if;
   if (p_refund_method='mobile_money' and v_account.account_type<>'mobile_money') or (p_refund_method in ('bank','card','cheque') and v_account.account_type<>'bank') then raise exception 'Refund method does not match the financial account'; end if;
   select v_account.opening_balance+coalesce(sum(case when transaction_type='withdrawal' then -amount else amount end),0) into v_available from public.banking_transactions where bank_account_id=v_account.id and organization_id=v_org and status='confirmed';
   if v_available<v_paid then raise exception 'Refund exceeds the recorded financial account balance'; end if;
  end if;
  insert into public.payments(organization_id,location_id,customer_id,work_order_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
  values(v_org,w.location_id,w.customer_id,w.id,'out','job_refund',p_refund_method,v_paid,nullif(btrim(p_reference),''),btrim(p_reason),auth.uid(),v_till.id) returning id into v_payment;
  if p_refund_method<>'cash' then
   insert into public.banking_transactions(organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by,source_payment_id)
   values(v_org,w.location_id,v_account.id,'withdrawal',v_paid,'confirmed',nullif(btrim(p_reference),''),btrim(p_reason),auth.uid(),v_payment);
  end if;
 end if;
 -- The job lock serializes line edits, payments and cancellations. Sort stock locks consistently.
 for l in select * from public.work_order_lines where organization_id=v_org and work_order_id=w.id and line_type='material' order by product_id,id for update loop
  if p_restore_materials then
   insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity) values(l.product_id,w.location_id,l.quantity,0)
    on conflict(product_id,location_id) do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();
   insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
   values(v_org,w.location_id,l.product_id,'work_order_material_reversal',l.quantity,l.unit_cost,'work_order',w.id,'Returned materials on cancellation: '||btrim(p_reason),auth.uid());
  else v_cost:=v_cost+l.cost_total;
  end if;
 end loop;
 update public.work_orders set status='cancelled',final_amount=0,amount_paid=0,payment_status='unpaid',final_cost=v_cost,gross_profit=-v_cost,updated_at=now() where id=w.id;
 v_result:=jsonb_build_object('work_order_id',w.id,'status','cancelled','refunded_amount',v_paid,'payment_id',v_payment,'materials_returned',p_restore_materials,'retained_material_cost',v_cost);
 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,w.id,'cancelled_with_reconciliation',btrim(p_reason),v_result||jsonb_build_object('original_total',w.final_amount,'original_status',w.status),auth.uid());
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,w.location_id,auth.uid(),'service_job_cancelled','work_order',w.id::text,btrim(p_reason),v_result);
 insert into public.service_cancellation_requests(organization_id,user_id,request_id,work_order_id,request_payload,result) values(v_org,auth.uid(),p_request_id,w.id,v_payload,v_result);
 return v_result;
end; $$;
revoke all on function public.cancel_service_work_order(uuid,uuid,text,numeric,text,uuid,text,boolean) from public,anon;
grant execute on function public.cancel_service_work_order(uuid,uuid,text,numeric,text,uuid,text,boolean) to authenticated,service_role;

create or replace function public.mgt_work_order_provider_guard()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_status text;
begin
 if new.target_type='work_order' then
  select status into v_status from public.work_orders where id=new.target_id and organization_id=new.organization_id for update;
  if not found or v_status='cancelled' then raise exception 'Cannot request payment for a missing or cancelled service job'; end if;
 end if;
 return new;
end; $$;
revoke all on function public.mgt_work_order_provider_guard() from public,anon,authenticated;
create trigger mgt_work_order_provider_guard before insert on public.external_payment_transactions for each row execute function public.mgt_work_order_provider_guard();

-- Service managers can choose refund accounts, but cannot read private opening amounts.
create policy mgt_service_refund_accounts on public.bank_accounts for select to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('services.manage'));

-- All callers must take the job lock before taking a line lock (same order as cancellation).
do $patch$ declare d text; begin
 select pg_get_functiondef('public.remove_work_order_line(uuid)'::regprocedure) into d;
 d:=replace(d,'select * into v_line from public.work_order_lines where id=p_line_id and organization_id=v_org for update;',
  'select * into v_line from public.work_order_lines where id=p_line_id and organization_id=v_org;');
 d:=replace(d,'if v_order.status in (''completed'',''cancelled'') then',
  'select * into v_line from public.work_order_lines where id=p_line_id and organization_id=v_org for update; if not found then raise exception ''Job line not found''; end if; if v_order.status in (''completed'',''cancelled'') then');
 execute d;
end; $patch$;

notify pgrst,'reload schema';


-- One complete, scoped ledger snapshot. JSON avoids the REST row cap truncating totals.
create or replace function public.get_party_statement(p_party_type text,p_party_id uuid,p_start_date date,p_end_date date)
returns jsonb language plpgsql stable security invoker set search_path=public as $$
declare v_party jsonb; v_base numeric; v_tz text; v_result jsonb;
begin
 if p_start_date is null or p_end_date is null or p_start_date>p_end_date then raise exception 'Choose a valid statement period'; end if;
 if not public.has_permission('documents.view') then raise exception 'Permission denied: documents.view' using errcode='42501'; end if;
 select case when exists(select 1 from pg_timezone_names z where z.name=o.timezone) then o.timezone else 'UTC' end into v_tz
 from public.organizations o where o.id=public.current_organization_id();
 if v_tz is null then raise exception 'Active organization required'; end if;
 if p_party_type='customer' then
  select to_jsonb(c),c.opening_balance into v_party,v_base from public.get_scoped_customers() c where c.id=p_party_id;
 elsif p_party_type='supplier' then
  select to_jsonb(s),s.opening_balance into v_party,v_base from public.get_scoped_suppliers() s where s.id=p_party_id;
 else raise exception 'Invalid statement party type'; end if;
 if v_party is null then raise exception 'Account not found or not accessible' using errcode='42501'; end if;
 with transactions as (
  select 'sale-'||id::text id,(created_at at time zone v_tz)::date day,created_at at_time,'Sales invoice'::text type,sale_number reference,total_amount debit,0::numeric credit
  from public.sales where p_party_type='customer' and customer_id=p_party_id and status not in ('cancelled','void','draft')
  union all
  select 'return-'||id::text,(created_at at time zone v_tz)::date,created_at,'Sales return / credit',return_number,0,total_amount
  from public.sale_returns where p_party_type='customer' and customer_id=p_party_id
  union all
  select 'job-'||id::text,(coalesce(completed_at,created_at) at time zone v_tz)::date,coalesce(completed_at,created_at),'Completed service job',coalesce(job_number,title),coalesce(final_amount,0),0
  from public.work_orders where p_party_type='customer' and customer_id=p_party_id and status='completed'
  union all
  select 'project-'||id::text,issue_date,issue_date::timestamp at time zone v_tz,'Project invoice',invoice_number,total_amount,0
  from public.project_invoices where p_party_type='customer' and customer_id=p_party_id and status not in ('draft','void','cancelled')
  union all
  select 'purchase-'||id::text,(created_at at time zone v_tz)::date,created_at,'Purchase / supplier invoice',purchase_number,total_amount,0
  from public.purchases where p_party_type='supplier' and supplier_id=p_party_id and status not in ('draft','pending_approval','rejected','cancelled') and approval_status in ('not_required','approved')
  union all
  select 'payment-'||id::text,(created_at at time zone v_tz)::date,created_at,
   case when p_party_type='customer' then case when direction='out' then 'Refund paid' else 'Payment received' end else case when direction='out' then 'Payment to supplier' else 'Supplier refund' end end,
   coalesce(reference,replace(method,'_',' ')),
   case when (p_party_type='customer' and direction='out') or (p_party_type='supplier' and direction='in') then amount else 0 end,
   case when (p_party_type='customer' and direction='in') or (p_party_type='supplier' and direction='out') then amount else 0 end
  from public.payments where (p_party_type='customer' and customer_id=p_party_id) or (p_party_type='supplier' and supplier_id=p_party_id)
 ), opening as (
  select coalesce(v_base,0)+coalesce(sum(debit-credit),0) amount from transactions where day<p_start_date
 ), period_rows as (
  select t.id,t.day date,t.type,t.reference,t.debit,t.credit,
   (select amount from opening)+sum(t.debit-t.credit) over(order by t.day,t.at_time,t.id rows between unbounded preceding and current row) balance,
   t.at_time
  from transactions t where day between p_start_date and p_end_date
 )
 select jsonb_build_object('party',v_party-'opening_balance'-'opening_balance_paid','opening',(select amount from opening),
  'rows',coalesce((select jsonb_agg(to_jsonb(r)-'at_time' order by r.date,r.at_time,r.id) from period_rows r),'[]'::jsonb),
  'debits',coalesce(sum(debit),0),'credits',coalesce(sum(credit),0),
  'closing',(select amount from opening)+coalesce(sum(debit-credit),0),
  'scope',case when public.mgt_record_scope_allows(public.current_organization_id(),null,null) then 'organization' else 'assigned work scope' end,
  'timezone',v_tz)
 into v_result from period_rows;
 return v_result;
end; $$;
revoke all on function public.get_party_statement(text,uuid,date,date) from public,anon;
grant execute on function public.get_party_statement(text,uuid,date,date) to authenticated,service_role;

