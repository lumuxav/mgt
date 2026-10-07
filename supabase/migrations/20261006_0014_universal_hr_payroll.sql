-- MGT Business Suite — Universal HR & Payroll

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('hr.view','HR & Payroll','View HR records','View employee records, departments and HR summaries',100),
 ('hr.manage','HR & Payroll','Manage employees','Manage employee profiles, departments and compensation settings',101),
 ('attendance.use','HR & Payroll','Use attendance','Clock in/out and view own attendance',102),
 ('attendance.manage','HR & Payroll','Manage attendance','Correct and manage staff attendance records',103),
 ('leave.request','HR & Payroll','Request leave','Submit and view own leave requests',104),
 ('leave.manage','HR & Payroll','Manage leave','Approve, reject and manage employee leave',105),
 ('payroll.view','HR & Payroll','View payroll','View payroll periods and employee payroll records',106),
 ('payroll.manage','HR & Payroll','Manage payroll','Create, calculate and approve payroll periods',107),
 ('payroll.pay','HR & Payroll','Pay payroll','Record salary payments into the finance ledger',108),
 ('commissions.manage','HR & Payroll','Manage commissions','Create, approve and reject employee commissions',109)
on conflict(code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','hr.view'),('manager','hr.manage'),('manager','attendance.use'),('manager','attendance.manage'),
 ('manager','leave.request'),('manager','leave.manage'),('manager','payroll.view'),('manager','commissions.manage'),
 ('accountant','attendance.use'),('accountant','leave.request'),('accountant','payroll.view'),('accountant','payroll.manage'),('accountant','payroll.pay'),
 ('cashier','attendance.use'),('cashier','leave.request'),
 ('salesperson','attendance.use'),('salesperson','leave.request'),
 ('storekeeper','attendance.use'),('storekeeper','leave.request'),
 ('production_staff','attendance.use'),('production_staff','leave.request'),
 ('employee','attendance.use'),('employee','leave.request')
) as x(role,permission)
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.departments(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 code text,
 manager_user_id uuid references public.users(id) on delete set null,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists departments_org_name_idx on public.departments(organization_id,lower(name));
create index if not exists departments_manager_idx on public.departments(manager_user_id);

create table if not exists public.employee_profiles(
 user_id uuid primary key references public.users(id) on delete cascade,
 organization_id uuid not null references public.organizations(id) on delete cascade,
 employee_number text,
 department_id uuid references public.departments(id) on delete set null,
 job_title text,
 hire_date date,
 employment_type text not null default 'full_time' check(employment_type in ('full_time','part_time','contract','temporary','intern','casual')),
 pay_frequency text not null default 'monthly' check(pay_frequency in ('monthly','weekly','daily','hourly')),
 base_salary numeric(18,2) not null default 0 check(base_salary>=0),
 hourly_rate numeric(18,2) not null default 0 check(hourly_rate>=0),
 daily_rate numeric(18,2) not null default 0 check(daily_rate>=0),
 phone text,
 emergency_contact text,
 tax_number text,
 bank_name text,
 bank_account_name text,
 bank_account_number text,
 mobile_money_number text,
 notes text,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists employee_profiles_org_number_idx on public.employee_profiles(organization_id,employee_number) where employee_number is not null;
create index if not exists employee_profiles_department_idx on public.employee_profiles(department_id);

create table if not exists public.shifts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 start_time time not null,
 end_time time not null,
 break_minutes integer not null default 0 check(break_minutes>=0),
 days_of_week smallint[] not null default array[1,2,3,4,5]::smallint[],
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists shifts_org_name_idx on public.shifts(organization_id,lower(name));

create table if not exists public.employee_shift_assignments(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 shift_id uuid not null references public.shifts(id) on delete cascade,
 effective_from date not null default current_date,
 effective_to date,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 check(effective_to is null or effective_to>=effective_from)
);
create index if not exists employee_shift_assignments_user_idx on public.employee_shift_assignments(user_id,effective_from desc);
create index if not exists employee_shift_assignments_shift_idx on public.employee_shift_assignments(shift_id);

create table if not exists public.attendance(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 work_date date not null,
 status text not null default 'present' check(status in ('present','late','half_day','absent','leave','off')),
 check_in timestamptz,
 check_out timestamptz,
 break_minutes integer not null default 0 check(break_minutes>=0),
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,user_id,work_date),
 check(check_out is null or check_in is null or check_out>=check_in)
);
create index if not exists attendance_org_date_idx on public.attendance(organization_id,work_date desc);
create index if not exists attendance_user_date_idx on public.attendance(user_id,work_date desc);
create index if not exists attendance_location_idx on public.attendance(location_id,work_date desc);

create table if not exists public.leave_types(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 code text,
 paid boolean not null default true,
 annual_allowance numeric(8,2),
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create unique index if not exists leave_types_org_name_idx on public.leave_types(organization_id,lower(name));

create table if not exists public.leave_requests(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 leave_type_id uuid not null references public.leave_types(id) on delete restrict,
 start_date date not null,
 end_date date not null,
 total_days numeric(8,2) not null default 0,
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 reason text,
 review_notes text,
 reviewed_by uuid references public.users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 check(end_date>=start_date)
);
create index if not exists leave_requests_org_status_idx on public.leave_requests(organization_id,status,created_at desc);
create index if not exists leave_requests_user_idx on public.leave_requests(user_id,start_date desc);
create index if not exists leave_requests_reviewer_idx on public.leave_requests(reviewed_by);

create table if not exists public.employee_pay_components(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 component_type text not null check(component_type in ('allowance','deduction')),
 name text not null,
 calculation_type text not null default 'fixed' check(calculation_type in ('fixed','percentage_base')),
 value numeric(18,4) not null default 0 check(value>=0),
 active boolean not null default true,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists employee_pay_components_user_idx on public.employee_pay_components(user_id,active);

create table if not exists public.payroll_periods(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 start_date date not null,
 end_date date not null,
 status text not null default 'draft' check(status in ('draft','calculated','approved','paid','cancelled')),
 total_gross numeric(18,2) not null default 0,
 total_deductions numeric(18,2) not null default 0,
 total_net numeric(18,2) not null default 0,
 created_by uuid references public.users(id) on delete set null,
 approved_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 calculated_at timestamptz,
 approved_at timestamptz,
 paid_at timestamptz,
 check(end_date>=start_date),
 unique(organization_id,start_date,end_date)
);
create index if not exists payroll_periods_org_date_idx on public.payroll_periods(organization_id,start_date desc);

create table if not exists public.payroll_entries(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 payroll_period_id uuid not null references public.payroll_periods(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete restrict,
 location_id uuid references public.locations(id) on delete set null,
 base_pay numeric(18,2) not null default 0,
 allowances numeric(18,2) not null default 0,
 deductions numeric(18,2) not null default 0,
 commissions numeric(18,2) not null default 0,
 gross_pay numeric(18,2) not null default 0,
 net_pay numeric(18,2) not null default 0,
 attendance_days numeric(8,2) not null default 0,
 attendance_hours numeric(10,2) not null default 0,
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','paid')),
 paid_at timestamptz,
 payment_method text,
 payment_reference text,
 bank_account_id uuid references public.bank_accounts(id) on delete set null,
 expense_id uuid references public.expenses(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(payroll_period_id,user_id)
);
create index if not exists payroll_entries_user_idx on public.payroll_entries(user_id,payroll_period_id);
create index if not exists payroll_entries_bank_idx on public.payroll_entries(bank_account_id);
create index if not exists payroll_entries_expense_idx on public.payroll_entries(expense_id);

create table if not exists public.payroll_entry_components(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 payroll_entry_id uuid not null references public.payroll_entries(id) on delete cascade,
 component_type text not null check(component_type in ('base','allowance','deduction','commission')),
 name text not null,
 amount numeric(18,2) not null default 0,
 source_type text,
 source_id uuid,
 created_at timestamptz not null default now()
);
create index if not exists payroll_entry_components_entry_idx on public.payroll_entry_components(payroll_entry_id);

create table if not exists public.employee_commissions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 sale_id uuid references public.sales(id) on delete set null,
 work_order_id uuid references public.work_orders(id) on delete set null,
 amount numeric(18,2) not null check(amount>0),
 status text not null default 'pending' check(status in ('pending','approved','rejected','paid')),
 notes text,
 created_by uuid references public.users(id) on delete set null,
 approved_by uuid references public.users(id) on delete set null,
 approved_at timestamptz,
 payroll_entry_id uuid references public.payroll_entries(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists employee_commissions_user_idx on public.employee_commissions(user_id,status,created_at desc);
create index if not exists employee_commissions_payroll_idx on public.employee_commissions(payroll_entry_id);
create index if not exists employee_commissions_sale_idx on public.employee_commissions(sale_id);
create index if not exists employee_commissions_work_order_idx on public.employee_commissions(work_order_id);

alter table public.payments
 add column if not exists employee_user_id uuid references public.users(id) on delete set null;
create index if not exists payments_employee_user_id_idx on public.payments(employee_user_id);

-- RLS
alter table public.departments enable row level security;
alter table public.employee_profiles enable row level security;
alter table public.shifts enable row level security;
alter table public.employee_shift_assignments enable row level security;
alter table public.attendance enable row level security;
alter table public.leave_types enable row level security;
alter table public.leave_requests enable row level security;
alter table public.employee_pay_components enable row level security;
alter table public.payroll_periods enable row level security;
alter table public.payroll_entries enable row level security;
alter table public.payroll_entry_components enable row level security;
alter table public.employee_commissions enable row level security;

drop policy if exists departments_select on public.departments;
create policy departments_select on public.departments for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('hr.view') or public.has_permission('hr.manage') or public.has_permission('attendance.use'))
);
drop policy if exists departments_manage on public.departments;
create policy departments_manage on public.departments for all to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('hr.manage'))
with check(public.has_organization_access(organization_id) and public.has_permission('hr.manage'));

drop policy if exists employee_profiles_select on public.employee_profiles;
create policy employee_profiles_select on public.employee_profiles for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('hr.view') or public.has_permission('hr.manage') or public.has_permission('payroll.view'))
);

drop policy if exists shifts_select on public.shifts;
create policy shifts_select on public.shifts for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('attendance.use') or public.has_permission('attendance.manage') or public.has_permission('hr.view') or public.has_permission('hr.manage'))
);
drop policy if exists shifts_manage on public.shifts;
create policy shifts_manage on public.shifts for all to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('attendance.manage'))
with check(public.has_organization_access(organization_id) and public.has_permission('attendance.manage'));

drop policy if exists employee_shift_assignments_select on public.employee_shift_assignments;
create policy employee_shift_assignments_select on public.employee_shift_assignments for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('attendance.manage') or public.has_permission('hr.view') or public.has_permission('hr.manage'))
);
drop policy if exists employee_shift_assignments_manage on public.employee_shift_assignments;
create policy employee_shift_assignments_manage on public.employee_shift_assignments for all to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('attendance.manage'))
with check(public.has_organization_access(organization_id) and public.has_permission('attendance.manage'));

drop policy if exists attendance_select on public.attendance;
create policy attendance_select on public.attendance for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('attendance.manage') or public.has_permission('hr.view') or public.has_permission('hr.manage'))
);

drop policy if exists leave_types_select on public.leave_types;
create policy leave_types_select on public.leave_types for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('leave.request') or public.has_permission('leave.manage') or public.has_permission('hr.view') or public.has_permission('hr.manage'))
);
drop policy if exists leave_types_manage on public.leave_types;
create policy leave_types_manage on public.leave_types for all to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('leave.manage'))
with check(public.has_organization_access(organization_id) and public.has_permission('leave.manage'));

drop policy if exists leave_requests_select on public.leave_requests;
create policy leave_requests_select on public.leave_requests for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('leave.manage') or public.has_permission('hr.view') or public.has_permission('hr.manage'))
);

drop policy if exists employee_pay_components_select on public.employee_pay_components;
create policy employee_pay_components_select on public.employee_pay_components for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('payroll.view') or public.has_permission('payroll.manage') or public.has_permission('hr.manage'))
);
drop policy if exists employee_pay_components_manage on public.employee_pay_components;
create policy employee_pay_components_manage on public.employee_pay_components for all to authenticated
using(public.has_organization_access(organization_id) and (public.has_permission('payroll.manage') or public.has_permission('hr.manage')))
with check(public.has_organization_access(organization_id) and (public.has_permission('payroll.manage') or public.has_permission('hr.manage')));

drop policy if exists payroll_periods_select on public.payroll_periods;
create policy payroll_periods_select on public.payroll_periods for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('payroll.view') or public.has_permission('payroll.manage') or public.has_permission('payroll.pay'))
);

drop policy if exists payroll_entries_select on public.payroll_entries;
create policy payroll_entries_select on public.payroll_entries for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('payroll.view') or public.has_permission('payroll.manage') or public.has_permission('payroll.pay'))
);

drop policy if exists payroll_entry_components_select on public.payroll_entry_components;
create policy payroll_entry_components_select on public.payroll_entry_components for select to authenticated using(
 public.has_organization_access(organization_id)
 and exists(
  select 1 from public.payroll_entries e
  where e.id=payroll_entry_components.payroll_entry_id
   and (e.user_id=auth.uid() or public.has_permission('payroll.view') or public.has_permission('payroll.manage') or public.has_permission('payroll.pay'))
 )
);

drop policy if exists employee_commissions_select on public.employee_commissions;
create policy employee_commissions_select on public.employee_commissions for select to authenticated using(
 public.has_organization_access(organization_id)
 and (user_id=auth.uid() or public.has_permission('commissions.manage') or public.has_permission('payroll.view') or public.has_permission('payroll.manage'))
);

-- Employee profile
create or replace function public.upsert_employee_hr_profile(
 p_user_id uuid,
 p_employee_number text default null,
 p_department_id uuid default null,
 p_job_title text default null,
 p_hire_date date default null,
 p_employment_type text default 'full_time',
 p_pay_frequency text default 'monthly',
 p_base_salary numeric default 0,
 p_daily_rate numeric default 0,
 p_hourly_rate numeric default 0,
 p_phone text default null,
 p_emergency_contact text default null,
 p_tax_number text default null,
 p_bank_name text default null,
 p_bank_account_name text default null,
 p_bank_account_number text default null,
 p_mobile_money_number text default null,
 p_notes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
begin
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
end; $$;
revoke all on function public.upsert_employee_hr_profile(uuid,text,uuid,text,date,text,text,numeric,numeric,numeric,text,text,text,text,text,text,text,text) from public;
revoke execute on function public.upsert_employee_hr_profile(uuid,text,uuid,text,date,text,text,numeric,numeric,numeric,text,text,text,text,text,text,text,text) from anon;
grant execute on function public.upsert_employee_hr_profile(uuid,text,uuid,text,date,text,text,numeric,numeric,numeric,text,text,text,text,text,text,text,text) to authenticated;

-- Attendance clock
create or replace function public.clock_in(p_location_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_tz text;
 v_date date;
 v_id uuid;
 v_now timestamptz:=now();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('attendance.use') then raise exception 'Permission denied: attendance.use'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 select timezone into v_tz from public.organizations where id=v_org;
 v_date:=(v_now at time zone coalesce(v_tz,'UTC'))::date;

 insert into public.attendance(organization_id,user_id,location_id,work_date,status,check_in,created_by)
 values(v_org,auth.uid(),p_location_id,v_date,'present',v_now,auth.uid())
 on conflict(organization_id,user_id,work_date) do update
 set check_in=coalesce(public.attendance.check_in,excluded.check_in),
     location_id=coalesce(public.attendance.location_id,excluded.location_id),
     status=case when public.attendance.status in ('absent','off') then 'present' else public.attendance.status end,
     updated_at=now()
 returning id into v_id;

 return jsonb_build_object('attendance_id',v_id,'work_date',v_date,'check_in',v_now);
end; $$;
revoke all on function public.clock_in(uuid) from public;
revoke execute on function public.clock_in(uuid) from anon;
grant execute on function public.clock_in(uuid) to authenticated;

create or replace function public.clock_out()
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_tz text;
 v_date date;
 v_row public.attendance%rowtype;
 v_now timestamptz:=now();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('attendance.use') then raise exception 'Permission denied: attendance.use'; end if;
 select timezone into v_tz from public.organizations where id=v_org;
 v_date:=(v_now at time zone coalesce(v_tz,'UTC'))::date;

 select * into v_row from public.attendance
 where organization_id=v_org and user_id=auth.uid() and work_date=v_date
 for update;
 if not found or v_row.check_in is null then raise exception 'Clock in first'; end if;
 if v_row.check_out is not null then raise exception 'You already clocked out today'; end if;

 update public.attendance set check_out=v_now,updated_at=now() where id=v_row.id;
 return jsonb_build_object('attendance_id',v_row.id,'work_date',v_date,'check_out',v_now);
end; $$;
revoke all on function public.clock_out() from public;
revoke execute on function public.clock_out() from anon;
grant execute on function public.clock_out() to authenticated;

create or replace function public.record_attendance(
 p_user_id uuid,p_work_date date,p_location_id uuid,p_status text,
 p_check_in timestamptz default null,p_check_out timestamptz default null,
 p_break_minutes integer default 0,p_notes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
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
end; $$;
revoke all on function public.record_attendance(uuid,date,uuid,text,timestamptz,timestamptz,integer,text) from public;
revoke execute on function public.record_attendance(uuid,date,uuid,text,timestamptz,timestamptz,integer,text) from anon;
grant execute on function public.record_attendance(uuid,date,uuid,text,timestamptz,timestamptz,integer,text) to authenticated;

-- Leave
create or replace function public.submit_leave_request(
 p_leave_type_id uuid,p_start_date date,p_end_date date,p_reason text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
 v_days numeric(8,2);
 v_shift_days smallint[];
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('leave.request') then raise exception 'Permission denied: leave.request'; end if;
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
end; $$;
revoke all on function public.submit_leave_request(uuid,date,date,text) from public;
revoke execute on function public.submit_leave_request(uuid,date,date,text) from anon;
grant execute on function public.submit_leave_request(uuid,date,date,text) to authenticated;

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
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('leave.manage') then raise exception 'Permission denied: leave.manage'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 select * into v_req from public.leave_requests
 where id=p_leave_request_id and organization_id=v_org and status='pending' for update;
 if not found then raise exception 'Pending leave request not found'; end if;

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
   insert into public.attendance(organization_id,user_id,location_id,work_date,status,notes,created_by)
   values(v_org,v_req.user_id,v_location,v_day,'leave','Approved leave',auth.uid())
   on conflict(organization_id,user_id,work_date) do nothing;
  end loop;
 end if;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'leave_'||p_decision,'leave_request',v_req.id::text,'Leave request '||p_decision,
  jsonb_build_object('employee_user_id',v_req.user_id,'start_date',v_req.start_date,'end_date',v_req.end_date));

 return jsonb_build_object('leave_request_id',v_req.id,'status',p_decision);
end; $$;
revoke all on function public.review_leave_request(uuid,text,text) from public;
revoke execute on function public.review_leave_request(uuid,text,text) from anon;
grant execute on function public.review_leave_request(uuid,text,text) to authenticated;

-- Commissions
create or replace function public.create_employee_commission(
 p_user_id uuid,p_amount numeric,p_sale_id uuid default null,p_work_order_id uuid default null,p_notes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
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
end; $$;
revoke all on function public.create_employee_commission(uuid,numeric,uuid,uuid,text) from public;
revoke execute on function public.create_employee_commission(uuid,numeric,uuid,uuid,text) from anon;
grant execute on function public.create_employee_commission(uuid,numeric,uuid,uuid,text) to authenticated;

create or replace function public.review_employee_commission(p_commission_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('commissions.manage') then raise exception 'Permission denied: commissions.manage'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 update public.employee_commissions
 set status=p_decision,approved_by=auth.uid(),approved_at=now()
 where id=p_commission_id and organization_id=v_org and status='pending';
 if not found then raise exception 'Pending commission not found'; end if;
 return jsonb_build_object('commission_id',p_commission_id,'status',p_decision);
end; $$;
revoke all on function public.review_employee_commission(uuid,text) from public;
revoke execute on function public.review_employee_commission(uuid,text) from anon;
grant execute on function public.review_employee_commission(uuid,text) to authenticated;

-- Payroll periods
create or replace function public.create_payroll_period(
 p_name text,p_start_date date,p_end_date date
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.manage') then raise exception 'Permission denied: payroll.manage'; end if;
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
end; $$;
revoke all on function public.create_payroll_period(text,date,date) from public;
revoke execute on function public.create_payroll_period(text,date,date) from anon;
grant execute on function public.create_payroll_period(text,date,date) to authenticated;

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
  select
   coalesce(sum(case when a.status in ('present','late','leave') then 1 when a.status='half_day' then 0.5 else 0 end),0),
   coalesce(sum(case when a.check_in is not null and a.check_out is not null
     then greatest(extract(epoch from (a.check_out-a.check_in))/3600.0-(a.break_minutes/60.0),0) else 0 end),0)
  into v_att_days,v_att_hours
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
  elsif v_emp.pay_frequency='weekly' then
   v_base:=round(v_emp.base_salary*(v_days_in_period/7.0),2);
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
revoke all on function public.calculate_payroll_period(uuid) from public;
revoke execute on function public.calculate_payroll_period(uuid) from anon;
grant execute on function public.calculate_payroll_period(uuid) to authenticated;

create or replace function public.approve_payroll_period(p_payroll_period_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_period public.payroll_periods%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.manage') then raise exception 'Permission denied: payroll.manage'; end if;

 select * into v_period from public.payroll_periods
 where id=p_payroll_period_id and organization_id=v_org and status='calculated' for update;
 if not found then raise exception 'Calculated payroll period not found'; end if;

 update public.payroll_periods set status='approved',approved_by=auth.uid(),approved_at=now() where id=v_period.id;
 return jsonb_build_object('payroll_period_id',v_period.id,'status','approved');
end; $$;
revoke all on function public.approve_payroll_period(uuid) from public;
revoke execute on function public.approve_payroll_period(uuid) from anon;
grant execute on function public.approve_payroll_period(uuid) to authenticated;

create or replace function public.record_payroll_payment(
 p_payroll_entry_id uuid,p_method text,p_bank_account_id uuid default null,p_reference text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_entry public.payroll_entries%rowtype;
 v_period public.payroll_periods%rowtype;
 v_user public.users%rowtype;
 v_location uuid;
 v_till_id uuid;
 v_expense_id uuid;
 v_method text:=coalesce(nullif(trim(p_method),''),'bank');
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.pay') then raise exception 'Permission denied: payroll.pay'; end if;

 select * into v_entry from public.payroll_entries
 where id=p_payroll_entry_id and organization_id=v_org and payment_status='unpaid' for update;
 if not found then raise exception 'Unpaid payroll entry not found'; end if;
 select * into v_period from public.payroll_periods where id=v_entry.payroll_period_id and organization_id=v_org for update;
 if not found or v_period.status not in ('approved','paid') then raise exception 'Payroll period must be approved before payment'; end if;
 select * into v_user from public.users where id=v_entry.user_id and organization_id=v_org;
 if not found then raise exception 'Employee not found'; end if;

 v_location:=coalesce(v_entry.location_id,v_user.default_location_id,(select id from public.locations where organization_id=v_org and active=true order by created_at limit 1));
 if v_location is null then raise exception 'No business location available for payroll payment'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_location and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before paying payroll in cash'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account used for this payroll payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 insert into public.expenses(
  organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
 )
 values(
  v_org,v_location,'Payroll','Payroll - '||v_user.full_name||' - '||v_period.name,
  v_entry.net_pay,v_method,nullif(trim(p_reference),''),auth.uid(),
  'Payroll entry '||v_entry.id::text,v_till_id,p_bank_account_id
 ) returning id into v_expense_id;

 if v_method='cash' then
  insert into public.payments(
   organization_id,location_id,employee_user_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,v_location,v_entry.user_id,'out','payroll','cash',v_entry.net_pay,
   nullif(trim(p_reference),''),'Payroll - '||v_period.name,auth.uid(),v_till_id
  );
 else
  insert into public.banking_transactions(
   organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  )
  values(
   v_org,v_location,p_bank_account_id,'withdrawal',v_entry.net_pay,'confirmed',
   nullif(trim(p_reference),''),'Payroll - '||v_user.full_name||' - '||v_period.name,auth.uid()
  );
 end if;

 update public.payroll_entries set
  payment_status='paid',paid_at=now(),payment_method=v_method,payment_reference=nullif(trim(p_reference),''),
  bank_account_id=p_bank_account_id,expense_id=v_expense_id
 where id=v_entry.id;

 update public.employee_commissions set status='paid'
 where organization_id=v_org and payroll_entry_id=v_entry.id and status='approved';

 if not exists(select 1 from public.payroll_entries where payroll_period_id=v_period.id and payment_status='unpaid') then
  update public.payroll_periods set status='paid',paid_at=now() where id=v_period.id;
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  v_org,v_location,auth.uid(),'payroll_paid','payroll_entry',v_entry.id::text,v_user.full_name,
  jsonb_build_object('amount',v_entry.net_pay,'method',v_method,'period',v_period.name)
 );

 return jsonb_build_object('payroll_entry_id',v_entry.id,'status','paid','amount',v_entry.net_pay,'expense_id',v_expense_id);
end; $$;
revoke all on function public.record_payroll_payment(uuid,text,uuid,text) from public;
revoke execute on function public.record_payroll_payment(uuid,text,uuid,text) from anon;
grant execute on function public.record_payroll_payment(uuid,text,uuid,text) to authenticated;
