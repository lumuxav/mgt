-- MGT Business Suite — Universal Projects & Project Costing

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('projects.view','Projects','View projects','View project portfolio, tasks, milestones and project summaries',130),
 ('projects.manage','Projects','Manage projects','Create projects, teams, milestones and tasks',131),
 ('projects.time','Projects','Use project timesheets','View assigned projects and log project time',132),
 ('projects.costs','Projects','Manage project costs','Issue materials and record project expenses',133),
 ('projects.billing','Projects','Manage project billing','Create project invoices and record client payments',134)
on conflict(code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','projects.view'),('manager','projects.manage'),('manager','projects.time'),('manager','projects.costs'),('manager','projects.billing'),
 ('accountant','projects.view'),('accountant','projects.costs'),('accountant','projects.billing'),
 ('employee','projects.time'),
 ('salesperson','projects.view'),('salesperson','projects.time'),
 ('production_staff','projects.time')
) as x(role,permission)
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.projects(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 customer_id uuid references public.customers(id) on delete set null,
 project_number text not null,
 name text not null,
 description text,
 status text not null default 'planning' check(status in ('planning','active','on_hold','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 start_date date,
 due_date date,
 completed_at timestamptz,
 manager_user_id uuid references public.users(id) on delete set null,
 contract_value numeric(18,2) not null default 0 check(contract_value>=0),
 budget_cost numeric(18,2) not null default 0 check(budget_cost>=0),
 budget_hours numeric(12,2) not null default 0 check(budget_hours>=0),
 progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),
 material_cost numeric(18,2) not null default 0,
 labour_cost numeric(18,2) not null default 0,
 expense_cost numeric(18,2) not null default 0,
 total_cost numeric(18,2) not null default 0,
 billed_amount numeric(18,2) not null default 0,
 amount_paid numeric(18,2) not null default 0,
 gross_profit numeric(18,2) not null default 0,
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,project_number),
 check(due_date is null or start_date is null or due_date>=start_date)
);
create index if not exists projects_org_status_idx on public.projects(organization_id,status,created_at desc);
create index if not exists projects_customer_idx on public.projects(customer_id,created_at desc);
create index if not exists projects_manager_idx on public.projects(manager_user_id,created_at desc);
create index if not exists projects_due_idx on public.projects(organization_id,due_date) where status in ('planning','active','on_hold');

create table if not exists public.project_members(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 project_role text not null default 'team_member',
 cost_rate numeric(18,2),
 billing_rate numeric(18,2),
 active boolean not null default true,
 added_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(project_id,user_id),
 check(cost_rate is null or cost_rate>=0),
 check(billing_rate is null or billing_rate>=0)
);
create index if not exists project_members_user_idx on public.project_members(user_id,active);
create index if not exists project_members_org_idx on public.project_members(organization_id,project_id);

create table if not exists public.project_milestones(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 name text not null,
 description text,
 status text not null default 'pending' check(status in ('pending','in_progress','completed','blocked','cancelled')),
 due_date date,
 completed_at timestamptz,
 billing_amount numeric(18,2) not null default 0 check(billing_amount>=0),
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists project_milestones_project_idx on public.project_milestones(project_id,due_date);
create index if not exists project_milestones_org_status_idx on public.project_milestones(organization_id,status,due_date);

create table if not exists public.project_tasks(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 milestone_id uuid references public.project_milestones(id) on delete set null,
 title text not null,
 description text,
 assigned_user_id uuid references public.users(id) on delete set null,
 status text not null default 'todo' check(status in ('todo','in_progress','blocked','completed','cancelled')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 start_date date,
 due_date date,
 estimated_hours numeric(12,2) not null default 0 check(estimated_hours>=0),
 progress_percent numeric(5,2) not null default 0 check(progress_percent between 0 and 100),
 completed_at timestamptz,
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(due_date is null or start_date is null or due_date>=start_date)
);
create index if not exists project_tasks_project_idx on public.project_tasks(project_id,status,due_date);
create index if not exists project_tasks_assigned_idx on public.project_tasks(assigned_user_id,status,due_date);
create index if not exists project_tasks_milestone_idx on public.project_tasks(milestone_id);

create table if not exists public.project_timesheets(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 task_id uuid references public.project_tasks(id) on delete set null,
 user_id uuid not null references public.users(id) on delete restrict,
 work_date date not null default current_date,
 hours numeric(10,2) not null check(hours>0 and hours<=24),
 description text not null,
 billable boolean not null default true,
 cost_rate numeric(18,2) not null default 0,
 billing_rate numeric(18,2) not null default 0,
 cost_amount numeric(18,2) not null default 0,
 billable_amount numeric(18,2) not null default 0,
 status text not null default 'submitted' check(status in ('submitted','approved','rejected')),
 reviewed_by uuid references public.users(id) on delete set null,
 reviewed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create index if not exists project_timesheets_project_idx on public.project_timesheets(project_id,work_date desc);
create index if not exists project_timesheets_user_idx on public.project_timesheets(user_id,work_date desc);
create index if not exists project_timesheets_status_idx on public.project_timesheets(organization_id,status,created_at desc);
create index if not exists project_timesheets_task_idx on public.project_timesheets(task_id);

create table if not exists public.project_materials(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 description text not null,
 quantity numeric(18,3) not null check(quantity>0),
 unit_cost numeric(18,2) not null default 0,
 cost_total numeric(18,2) not null default 0,
 status text not null default 'issued' check(status in ('issued','reversed')),
 issued_by uuid references public.users(id) on delete set null,
 issued_at timestamptz not null default now(),
 reversed_by uuid references public.users(id) on delete set null,
 reversed_at timestamptz,
 notes text
);
create index if not exists project_materials_project_idx on public.project_materials(project_id,issued_at desc);
create index if not exists project_materials_product_idx on public.project_materials(product_id);
create index if not exists project_materials_location_idx on public.project_materials(location_id);

create table if not exists public.project_expenses(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 expense_date date not null default current_date,
 category text not null default 'Project',
 description text not null,
 amount numeric(18,2) not null check(amount>0),
 status text not null default 'accrued' check(status in ('accrued','paid','cancelled')),
 payment_method text,
 reference text,
 bank_account_id uuid references public.bank_accounts(id) on delete set null,
 finance_expense_id uuid references public.expenses(id) on delete set null,
 notes text,
 recorded_by uuid references public.users(id) on delete set null,
 paid_at timestamptz,
 created_at timestamptz not null default now()
);
create index if not exists project_expenses_project_idx on public.project_expenses(project_id,expense_date desc);
create index if not exists project_expenses_bank_idx on public.project_expenses(bank_account_id);
create index if not exists project_expenses_finance_idx on public.project_expenses(finance_expense_id);

create table if not exists public.project_invoices(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 customer_id uuid not null references public.customers(id) on delete restrict,
 invoice_number text not null,
 issue_date date not null default current_date,
 due_date date,
 status text not null default 'issued' check(status in ('issued','partial','paid','void')),
 subtotal numeric(18,2) not null default 0,
 tax_amount numeric(18,2) not null default 0,
 total_amount numeric(18,2) not null default 0,
 amount_paid numeric(18,2) not null default 0,
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,invoice_number)
);
create index if not exists project_invoices_project_idx on public.project_invoices(project_id,created_at desc);
create index if not exists project_invoices_customer_idx on public.project_invoices(customer_id,status,due_date);
create index if not exists project_invoices_org_status_idx on public.project_invoices(organization_id,status,due_date);

create table if not exists public.project_invoice_lines(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 invoice_id uuid not null references public.project_invoices(id) on delete cascade,
 milestone_id uuid references public.project_milestones(id) on delete set null,
 description text not null,
 quantity numeric(18,3) not null default 1 check(quantity>0),
 unit_price numeric(18,2) not null default 0 check(unit_price>=0),
 line_total numeric(18,2) not null default 0,
 created_at timestamptz not null default now()
);
create index if not exists project_invoice_lines_invoice_idx on public.project_invoice_lines(invoice_id);
create index if not exists project_invoice_lines_milestone_idx on public.project_invoice_lines(milestone_id);

create table if not exists public.project_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 project_id uuid not null references public.projects(id) on delete cascade,
 event_type text not null,
 description text,
 metadata jsonb not null default '{}'::jsonb,
 user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists project_events_project_idx on public.project_events(project_id,created_at desc);
create index if not exists project_events_user_idx on public.project_events(user_id);

alter table public.expenses add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.payments add column if not exists project_id uuid references public.projects(id) on delete set null;
alter table public.payments add column if not exists project_invoice_id uuid references public.project_invoices(id) on delete set null;
create index if not exists expenses_project_id_idx on public.expenses(project_id);
create index if not exists payments_project_id_idx on public.payments(project_id);
create index if not exists payments_project_invoice_id_idx on public.payments(project_invoice_id);

alter table public.projects enable row level security;
alter table public.project_members enable row level security;
alter table public.project_milestones enable row level security;
alter table public.project_tasks enable row level security;
alter table public.project_timesheets enable row level security;
alter table public.project_materials enable row level security;
alter table public.project_expenses enable row level security;
alter table public.project_invoices enable row level security;
alter table public.project_invoice_lines enable row level security;
alter table public.project_events enable row level security;

create policy project_members_select on public.project_members for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   user_id=auth.uid()
   or public.has_permission('projects.view')
   or public.has_permission('projects.manage')
   or public.has_permission('projects.costs')
   or public.has_permission('projects.billing')
 )
);

create policy projects_select on public.projects for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('projects.view')
   or public.has_permission('projects.manage')
   or public.has_permission('projects.costs')
   or public.has_permission('projects.billing')
   or exists(
     select 1 from public.project_members pm
     where pm.project_id=projects.id and pm.user_id=auth.uid() and pm.active=true
   )
 )
);

create policy project_milestones_select on public.project_milestones for select to authenticated using(
 public.has_organization_access(organization_id)
 and exists(select 1 from public.projects p where p.id=project_milestones.project_id)
);

create policy project_tasks_select on public.project_tasks for select to authenticated using(
 public.has_organization_access(organization_id)
 and exists(select 1 from public.projects p where p.id=project_tasks.project_id)
);

create policy project_timesheets_select on public.project_timesheets for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   user_id=auth.uid()
   or public.has_permission('projects.view')
   or public.has_permission('projects.manage')
 )
);

create policy project_materials_select on public.project_materials for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('projects.costs')
   or public.has_permission('projects.manage')
   or public.has_permission('projects.view')
 )
);

create policy project_expenses_select on public.project_expenses for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('projects.costs')
   or public.has_permission('projects.manage')
   or public.has_permission('projects.view')
 )
);

create policy project_invoices_select on public.project_invoices for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('projects.billing')
   or public.has_permission('projects.manage')
   or public.has_permission('projects.view')
 )
);

create policy project_invoice_lines_select on public.project_invoice_lines for select to authenticated using(
 public.has_organization_access(organization_id)
 and exists(select 1 from public.project_invoices i where i.id=project_invoice_lines.invoice_id)
);

create policy project_events_select on public.project_events for select to authenticated using(
 public.has_organization_access(organization_id)
 and exists(select 1 from public.projects p where p.id=project_events.project_id)
);

drop policy if exists products_org_select on public.products;
create policy products_org_select on public.products for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('catalog.view')
   or public.has_permission('services.view')
   or public.has_permission('services.manage')
   or public.has_permission('manufacturing.view')
   or public.has_permission('manufacturing.manage')
   or public.has_permission('projects.costs')
   or public.has_permission('projects.manage')
 )
);

drop policy if exists stock_balances_permission_select on public.stock_balances;
create policy stock_balances_permission_select on public.stock_balances for select to authenticated using(
 (
   public.has_permission('inventory.view')
   or public.has_permission('projects.costs')
   or public.has_permission('projects.manage')
 )
 and exists(
   select 1 from public.products p
   where p.id=stock_balances.product_id and public.has_organization_access(p.organization_id)
 )
);

drop policy if exists payments_org_select on public.payments;
create policy payments_org_select on public.payments for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('finance.view')
   or public.has_permission('sales.view')
   or public.has_permission('purchasing.view')
   or public.has_permission('services.view')
   or public.has_permission('services.manage')
   or public.has_permission('projects.view')
   or public.has_permission('projects.billing')
   or public.has_permission('projects.manage')
 )
);

drop policy if exists customers_org_select on public.customers;
create policy customers_org_select on public.customers for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('customers.view')
   or exists(
     select 1
     from public.projects p
     join public.project_members pm on pm.project_id=p.id and pm.active=true
     where p.customer_id=customers.id and pm.user_id=auth.uid()
   )
 )
);

create or replace function public.recalculate_project_totals(p_project_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 v_material numeric(18,2);
 v_labour numeric(18,2);
 v_expense numeric(18,2);
 v_billed numeric(18,2);
 v_paid numeric(18,2);
begin
 select coalesce(sum(cost_total),0) into v_material
 from public.project_materials where project_id=p_project_id and status='issued';

 select coalesce(sum(cost_amount),0) into v_labour
 from public.project_timesheets where project_id=p_project_id and status='approved';

 select coalesce(sum(amount),0) into v_expense
 from public.project_expenses where project_id=p_project_id and status in ('accrued','paid');

 select coalesce(sum(total_amount),0),coalesce(sum(amount_paid),0)
 into v_billed,v_paid
 from public.project_invoices where project_id=p_project_id and status<>'void';

 update public.projects
 set material_cost=v_material,
     labour_cost=v_labour,
     expense_cost=v_expense,
     total_cost=v_material+v_labour+v_expense,
     billed_amount=v_billed,
     amount_paid=v_paid,
     gross_profit=v_billed-(v_material+v_labour+v_expense),
     updated_at=now()
 where id=p_project_id;
end; $$;
revoke all on function public.recalculate_project_totals(uuid) from public;
revoke execute on function public.recalculate_project_totals(uuid) from anon;
revoke execute on function public.recalculate_project_totals(uuid) from authenticated;

create or replace function public.create_project(
 p_location_id uuid,p_customer_id uuid,p_name text,p_description text default null,
 p_start_date date default null,p_due_date date default null,p_priority text default 'normal',
 p_manager_user_id uuid default null,p_contract_value numeric default 0,p_budget_cost numeric default 0,
 p_budget_hours numeric default 0,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
 v_number text;
 v_manager uuid:=coalesce(p_manager_user_id,auth.uid());
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if coalesce(trim(p_name),'')='' then raise exception 'Project name is required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
 if p_due_date is not null and p_start_date is not null and p_due_date<p_start_date then raise exception 'Due date cannot be before start date'; end if;
 if coalesce(p_contract_value,0)<0 or coalesce(p_budget_cost,0)<0 or coalesce(p_budget_hours,0)<0 then raise exception 'Project values cannot be negative'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org and active=true) then raise exception 'Customer not found'; end if;
 if not exists(select 1 from public.users where id=v_manager and organization_id=v_org and active=true) then raise exception 'Project manager not found'; end if;

 v_number:='PRJ-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.projects(
  organization_id,location_id,customer_id,project_number,name,description,status,priority,start_date,due_date,
  manager_user_id,contract_value,budget_cost,budget_hours,notes,created_by
 ) values(
  v_org,p_location_id,p_customer_id,v_number,trim(p_name),p_description,
  case when p_start_date is not null and p_start_date<=current_date then 'active' else 'planning' end,
  p_priority,p_start_date,p_due_date,v_manager,coalesce(p_contract_value,0),coalesce(p_budget_cost,0),
  coalesce(p_budget_hours,0),p_notes,auth.uid()
 ) returning id into v_id;

 insert into public.project_members(organization_id,project_id,user_id,project_role,active,added_by)
 values(v_org,v_id,v_manager,'project_manager',true,auth.uid())
 on conflict(project_id,user_id) do update set project_role='project_manager',active=true,updated_at=now();

 if auth.uid()<>v_manager then
  insert into public.project_members(organization_id,project_id,user_id,project_role,active,added_by)
  values(v_org,v_id,auth.uid(),'creator',true,auth.uid())
  on conflict(project_id,user_id) do nothing;
 end if;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_id,'created','Project created',jsonb_build_object('project_number',v_number,'contract_value',p_contract_value,'budget_cost',p_budget_cost),auth.uid());

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'project_created','project',v_id::text,v_number||' · '||trim(p_name),
  jsonb_build_object('customer_id',p_customer_id,'manager_user_id',v_manager));

 return jsonb_build_object('project_id',v_id,'project_number',v_number);
end; $$;
revoke all on function public.create_project(uuid,uuid,text,text,date,date,text,uuid,numeric,numeric,numeric,text) from public;
revoke execute on function public.create_project(uuid,uuid,text,text,date,date,text,uuid,numeric,numeric,numeric,text) from anon;
grant execute on function public.create_project(uuid,uuid,text,text,date,date,text,uuid,numeric,numeric,numeric,text) to authenticated;

create or replace function public.assign_project_member(
 p_project_id uuid,p_user_id uuid,p_project_role text default 'team_member',
 p_cost_rate numeric default null,p_billing_rate numeric default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and organization_id=v_org and status<>'cancelled') then raise exception 'Project not found'; end if;
 if not exists(select 1 from public.users where id=p_user_id and organization_id=v_org and active=true) then raise exception 'Employee not found'; end if;
 if p_cost_rate is not null and p_cost_rate<0 then raise exception 'Cost rate cannot be negative'; end if;
 if p_billing_rate is not null and p_billing_rate<0 then raise exception 'Billing rate cannot be negative'; end if;

 insert into public.project_members(organization_id,project_id,user_id,project_role,cost_rate,billing_rate,active,added_by)
 values(v_org,p_project_id,p_user_id,coalesce(nullif(trim(p_project_role),''),'team_member'),p_cost_rate,p_billing_rate,true,auth.uid())
 on conflict(project_id,user_id) do update set
  project_role=excluded.project_role,cost_rate=excluded.cost_rate,billing_rate=excluded.billing_rate,
  active=true,updated_at=now();

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,p_project_id,'member_assigned','Project team updated',
  jsonb_build_object('member_user_id',p_user_id,'project_role',p_project_role,'cost_rate',p_cost_rate,'billing_rate',p_billing_rate),auth.uid());

 return jsonb_build_object('project_id',p_project_id,'user_id',p_user_id,'active',true);
end; $$;
revoke all on function public.assign_project_member(uuid,uuid,text,numeric,numeric) from public;
revoke execute on function public.assign_project_member(uuid,uuid,text,numeric,numeric) from anon;
grant execute on function public.assign_project_member(uuid,uuid,text,numeric,numeric) to authenticated;

create or replace function public.add_project_milestone(
 p_project_id uuid,p_name text,p_description text default null,p_due_date date default null,p_billing_amount numeric default 0
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if coalesce(trim(p_name),'')='' then raise exception 'Milestone name is required'; end if;
 if coalesce(p_billing_amount,0)<0 then raise exception 'Billing amount cannot be negative'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and organization_id=v_org and status not in ('completed','cancelled')) then raise exception 'Open project not found'; end if;

 insert into public.project_milestones(organization_id,project_id,name,description,due_date,billing_amount,created_by)
 values(v_org,p_project_id,trim(p_name),p_description,p_due_date,coalesce(p_billing_amount,0),auth.uid())
 returning id into v_id;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,p_project_id,'milestone_added',trim(p_name),jsonb_build_object('milestone_id',v_id,'due_date',p_due_date,'billing_amount',p_billing_amount),auth.uid());
 return v_id;
end; $$;
revoke all on function public.add_project_milestone(uuid,text,text,date,numeric) from public;
revoke execute on function public.add_project_milestone(uuid,text,text,date,numeric) from anon;
grant execute on function public.add_project_milestone(uuid,text,text,date,numeric) to authenticated;

create or replace function public.update_project_milestone(
 p_milestone_id uuid,p_status text
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_m public.project_milestones%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if p_status not in ('pending','in_progress','completed','blocked','cancelled') then raise exception 'Invalid milestone status'; end if;
 select * into v_m from public.project_milestones where id=p_milestone_id and organization_id=v_org for update;
 if not found then raise exception 'Milestone not found'; end if;

 update public.project_milestones set
  status=p_status,
  completed_at=case when p_status='completed' then coalesce(completed_at,now()) else null end,
  updated_at=now()
 where id=v_m.id;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_m.project_id,'milestone_status','Milestone status changed',
  jsonb_build_object('milestone_id',v_m.id,'name',v_m.name,'from_status',v_m.status,'to_status',p_status),auth.uid());

 return jsonb_build_object('milestone_id',v_m.id,'status',p_status);
end; $$;
revoke all on function public.update_project_milestone(uuid,text) from public;
revoke execute on function public.update_project_milestone(uuid,text) from anon;
grant execute on function public.update_project_milestone(uuid,text) to authenticated;

create or replace function public.add_project_task(
 p_project_id uuid,p_title text,p_description text default null,p_milestone_id uuid default null,
 p_assigned_user_id uuid default null,p_priority text default 'normal',p_start_date date default null,
 p_due_date date default null,p_estimated_hours numeric default 0,p_notes text default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if coalesce(trim(p_title),'')='' then raise exception 'Task title is required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
 if p_due_date is not null and p_start_date is not null and p_due_date<p_start_date then raise exception 'Task due date cannot be before start date'; end if;
 if coalesce(p_estimated_hours,0)<0 then raise exception 'Estimated hours cannot be negative'; end if;
 if not exists(select 1 from public.projects where id=p_project_id and organization_id=v_org and status not in ('completed','cancelled')) then raise exception 'Open project not found'; end if;
 if p_milestone_id is not null and not exists(select 1 from public.project_milestones where id=p_milestone_id and project_id=p_project_id and organization_id=v_org) then raise exception 'Milestone not found'; end if;
 if p_assigned_user_id is not null and not exists(select 1 from public.project_members where project_id=p_project_id and user_id=p_assigned_user_id and organization_id=v_org and active=true) then raise exception 'Assigned employee must be an active project member'; end if;

 insert into public.project_tasks(
  organization_id,project_id,milestone_id,title,description,assigned_user_id,priority,start_date,due_date,
  estimated_hours,notes,created_by
 ) values(
  v_org,p_project_id,p_milestone_id,trim(p_title),p_description,p_assigned_user_id,p_priority,p_start_date,p_due_date,
  coalesce(p_estimated_hours,0),p_notes,auth.uid()
 ) returning id into v_id;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,p_project_id,'task_added',trim(p_title),jsonb_build_object('task_id',v_id,'assigned_user_id',p_assigned_user_id,'due_date',p_due_date),auth.uid());
 return v_id;
end; $$;
revoke all on function public.add_project_task(uuid,text,text,uuid,uuid,text,date,date,numeric,text) from public;
revoke execute on function public.add_project_task(uuid,text,text,uuid,uuid,text,date,date,numeric,text) from anon;
grant execute on function public.add_project_task(uuid,text,text,uuid,uuid,text,date,date,numeric,text) to authenticated;

create or replace function public.update_project_task(
 p_task_id uuid,p_status text,p_progress_percent numeric default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_task public.project_tasks%rowtype;
 v_progress numeric(5,2);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if p_status not in ('todo','in_progress','blocked','completed','cancelled') then raise exception 'Invalid task status'; end if;

 select * into v_task from public.project_tasks where id=p_task_id and organization_id=v_org for update;
 if not found then raise exception 'Task not found'; end if;

 if not (
  public.has_permission('projects.manage')
  or v_task.assigned_user_id=auth.uid()
 ) then raise exception 'You can only update tasks assigned to you'; end if;

 v_progress:=coalesce(p_progress_percent,v_task.progress_percent);
 if v_progress<0 or v_progress>100 then raise exception 'Progress must be between 0 and 100'; end if;
 if p_status='completed' then v_progress:=100; end if;

 update public.project_tasks set
  status=p_status,progress_percent=v_progress,notes=coalesce(p_notes,notes),
  completed_at=case when p_status='completed' then coalesce(completed_at,now()) else null end,
  updated_at=now()
 where id=v_task.id;

 update public.projects p set
  progress_percent=coalesce((
    select round(avg(t.progress_percent),2)
    from public.project_tasks t
    where t.project_id=p.id and t.status<>'cancelled'
  ),p.progress_percent),
  updated_at=now()
 where p.id=v_task.project_id;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_task.project_id,'task_status',v_task.title,
  jsonb_build_object('task_id',v_task.id,'from_status',v_task.status,'to_status',p_status,'progress_percent',v_progress),auth.uid());

 return jsonb_build_object('task_id',v_task.id,'status',p_status,'progress_percent',v_progress);
end; $$;
revoke all on function public.update_project_task(uuid,text,numeric,text) from public;
revoke execute on function public.update_project_task(uuid,text,numeric,text) from anon;
grant execute on function public.update_project_task(uuid,text,numeric,text) to authenticated;

create or replace function public.log_project_time(
 p_project_id uuid,p_task_id uuid,p_work_date date,p_hours numeric,p_description text,
 p_billable boolean default true,p_user_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
 if coalesce(p_hours,0)<=0 or p_hours>24 then raise exception 'Hours must be between 0 and 24'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Time description is required'; end if;
 if p_user_id is not null and p_user_id<>auth.uid() and not public.has_permission('projects.manage') then raise exception 'Only project managers can log time for another employee'; end if;

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
end; $$;
revoke all on function public.log_project_time(uuid,uuid,date,numeric,text,boolean,uuid) from public;
revoke execute on function public.log_project_time(uuid,uuid,date,numeric,text,boolean,uuid) from anon;
grant execute on function public.log_project_time(uuid,uuid,date,numeric,text,boolean,uuid) to authenticated;

create or replace function public.review_project_timesheet(p_timesheet_id uuid,p_decision text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_ts public.project_timesheets%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 select * into v_ts from public.project_timesheets
 where id=p_timesheet_id and organization_id=v_org and status='submitted' for update;
 if not found then raise exception 'Submitted timesheet not found'; end if;

 update public.project_timesheets
 set status=p_decision,reviewed_by=auth.uid(),reviewed_at=now(),updated_at=now()
 where id=v_ts.id;

 perform public.recalculate_project_totals(v_ts.project_id);
 return jsonb_build_object('timesheet_id',v_ts.id,'status',p_decision);
end; $$;
revoke all on function public.review_project_timesheet(uuid,text) from public;
revoke execute on function public.review_project_timesheet(uuid,text) from anon;
grant execute on function public.review_project_timesheet(uuid,text) to authenticated;

create or replace function public.issue_project_material(
 p_project_id uuid,p_product_id uuid,p_quantity numeric,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_project public.projects%rowtype;
 v_product public.products%rowtype;
 v_available numeric(18,3);
 v_cost numeric(18,2);
 v_total numeric(18,2);
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;

 select * into v_project from public.projects where id=p_project_id and organization_id=v_org and status in ('planning','active','on_hold') for update;
 if not found then raise exception 'Open project not found'; end if;
 select * into v_product from public.products where id=p_product_id and organization_id=v_org and active=true;
 if not found then raise exception 'Product not found'; end if;
 if not v_product.track_inventory then raise exception 'Selected item does not track inventory'; end if;

 insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
 values(v_product.id,v_project.location_id,0,0)
 on conflict(product_id,location_id) do nothing;

 select quantity-reserved_quantity into v_available
 from public.stock_balances where product_id=v_product.id and location_id=v_project.location_id for update;

 if coalesce(v_available,0)<p_quantity then raise exception 'Insufficient stock for %',v_product.name; end if;

 v_cost:=coalesce(v_product.cost_price,0);
 v_total:=round(p_quantity*v_cost,2);

 update public.stock_balances set quantity=quantity-p_quantity,updated_at=now()
 where product_id=v_product.id and location_id=v_project.location_id;

 insert into public.project_materials(
  organization_id,project_id,location_id,product_id,description,quantity,unit_cost,cost_total,status,issued_by,notes
 ) values(
  v_org,v_project.id,v_project.location_id,v_product.id,v_product.name,p_quantity,v_cost,v_total,'issued',auth.uid(),p_notes
 ) returning id into v_id;

 insert into public.stock_movements(
  organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
 ) values(
  v_org,v_project.location_id,v_product.id,'project_material',-p_quantity,v_cost,'project',v_project.id,
  coalesce(p_notes,v_project.project_number||' · '||v_project.name),auth.uid()
 );

 perform public.recalculate_project_totals(v_project.id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_project.id,'material_issued',v_product.name,
  jsonb_build_object('project_material_id',v_id,'product_id',v_product.id,'quantity',p_quantity,'unit_cost',v_cost,'cost_total',v_total),auth.uid());

 return jsonb_build_object('project_material_id',v_id,'cost_total',v_total);
end; $$;
revoke all on function public.issue_project_material(uuid,uuid,numeric,text) from public;
revoke execute on function public.issue_project_material(uuid,uuid,numeric,text) from anon;
grant execute on function public.issue_project_material(uuid,uuid,numeric,text) to authenticated;

create or replace function public.reverse_project_material(p_project_material_id uuid,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_row public.project_materials%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;

 select * into v_row from public.project_materials
 where id=p_project_material_id and organization_id=v_org and status='issued' for update;
 if not found then raise exception 'Issued project material not found'; end if;

 insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
 values(v_row.product_id,v_row.location_id,v_row.quantity,0)
 on conflict(product_id,location_id)
 do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();

 insert into public.stock_movements(
  organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
 ) values(
  v_org,v_row.location_id,v_row.product_id,'project_material_reversal',v_row.quantity,v_row.unit_cost,'project',v_row.project_id,
  coalesce(p_notes,'Project material reversal'),auth.uid()
 );

 update public.project_materials
 set status='reversed',reversed_by=auth.uid(),reversed_at=now(),notes=coalesce(p_notes,notes)
 where id=v_row.id;

 perform public.recalculate_project_totals(v_row.project_id);
 return jsonb_build_object('project_material_id',v_row.id,'status','reversed');
end; $$;
revoke all on function public.reverse_project_material(uuid,text) from public;
revoke execute on function public.reverse_project_material(uuid,text) from anon;
grant execute on function public.reverse_project_material(uuid,text) to authenticated;

create or replace function public.post_project_expense(
 p_project_id uuid,p_category text,p_description text,p_amount numeric,
 p_payment_method text default null,p_bank_account_id uuid default null,
 p_reference text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
   order by opened_at desc limit 1;
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
    organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
   ) values(
    v_org,v_project.location_id,p_bank_account_id,'withdrawal',p_amount,'confirmed',
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
end; $$;
revoke all on function public.post_project_expense(uuid,text,text,numeric,text,uuid,text,text) from public;
revoke execute on function public.post_project_expense(uuid,text,text,numeric,text,uuid,text,text) from anon;
grant execute on function public.post_project_expense(uuid,text,text,numeric,text,uuid,text,text) to authenticated;

create or replace function public.pay_project_expense(
 p_project_expense_id uuid,p_payment_method text,p_bank_account_id uuid default null,p_reference text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
  order by opened_at desc limit 1;
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
   organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_org,v_row.location_id,p_bank_account_id,'withdrawal',v_row.amount,'confirmed',
   nullif(trim(p_reference),''),'Project expense - '||v_project.project_number||' - '||v_row.description,auth.uid()
  );
 end if;

 update public.project_expenses
 set status='paid',payment_method=v_method,reference=nullif(trim(p_reference),''),
     bank_account_id=p_bank_account_id,finance_expense_id=v_finance_expense_id,paid_at=now()
 where id=v_row.id;

 return jsonb_build_object('project_expense_id',v_row.id,'status','paid','finance_expense_id',v_finance_expense_id);
end; $$;
revoke all on function public.pay_project_expense(uuid,text,uuid,text) from public;
revoke execute on function public.pay_project_expense(uuid,text,uuid,text) from anon;
grant execute on function public.pay_project_expense(uuid,text,uuid,text) to authenticated;

create or replace function public.create_project_invoice(
 p_project_id uuid,p_due_date date,p_lines jsonb,p_tax_amount numeric default 0,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_project public.projects%rowtype;
 v_invoice_id uuid;
 v_number text;
 v_item jsonb;
 v_description text;
 v_quantity numeric(18,3);
 v_unit_price numeric(18,2);
 v_line_total numeric(18,2);
 v_subtotal numeric(18,2):=0;
 v_tax numeric(18,2):=coalesce(p_tax_amount,0);
 v_milestone_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.billing') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.billing'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'Invoice must contain at least one line'; end if;
 if v_tax<0 then raise exception 'Tax amount cannot be negative'; end if;

 select * into v_project from public.projects where id=p_project_id and organization_id=v_org and status<>'cancelled' for update;
 if not found then raise exception 'Project not found'; end if;
 if v_project.customer_id is null then raise exception 'Assign a customer to the project before creating an invoice'; end if;

 v_number:='PINV-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.project_invoices(
  organization_id,project_id,location_id,customer_id,invoice_number,issue_date,due_date,status,tax_amount,notes,created_by
 ) values(
  v_org,v_project.id,v_project.location_id,v_project.customer_id,v_number,current_date,p_due_date,'issued',v_tax,p_notes,auth.uid()
 ) returning id into v_invoice_id;

 for v_item in select value from jsonb_array_elements(p_lines) loop
  v_description:=trim(coalesce(v_item->>'description',''));
  v_quantity:=coalesce((v_item->>'quantity')::numeric,1);
  v_unit_price:=coalesce((v_item->>'unit_price')::numeric,0);
  v_milestone_id:=nullif(v_item->>'milestone_id','')::uuid;
  if v_description='' then raise exception 'Invoice line description is required'; end if;
  if v_quantity<=0 or v_unit_price<0 then raise exception 'Invalid invoice line quantity or price'; end if;
  if v_milestone_id is not null and not exists(select 1 from public.project_milestones where id=v_milestone_id and project_id=v_project.id and organization_id=v_org) then raise exception 'Invoice milestone not found'; end if;

  v_line_total:=round(v_quantity*v_unit_price,2);
  v_subtotal:=v_subtotal+v_line_total;
  insert into public.project_invoice_lines(organization_id,invoice_id,milestone_id,description,quantity,unit_price,line_total)
  values(v_org,v_invoice_id,v_milestone_id,v_description,v_quantity,v_unit_price,v_line_total);
 end loop;

 update public.project_invoices set subtotal=v_subtotal,total_amount=v_subtotal+v_tax where id=v_invoice_id;
 perform public.recalculate_project_totals(v_project.id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_project.id,'invoice_created',v_number,
  jsonb_build_object('invoice_id',v_invoice_id,'subtotal',v_subtotal,'tax_amount',v_tax,'total_amount',v_subtotal+v_tax),auth.uid());

 return jsonb_build_object('invoice_id',v_invoice_id,'invoice_number',v_number,'total_amount',v_subtotal+v_tax);
end; $$;
revoke all on function public.create_project_invoice(uuid,date,jsonb,numeric,text) from public;
revoke execute on function public.create_project_invoice(uuid,date,jsonb,numeric,text) from anon;
grant execute on function public.create_project_invoice(uuid,date,jsonb,numeric,text) to authenticated;

create or replace function public.record_project_invoice_payment(
 p_invoice_id uuid,p_amount numeric,p_method text default 'cash',p_bank_account_id uuid default null,
 p_reference text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
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
  order by opened_at desc limit 1;
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
 );

 if v_method<>'cash' then
  insert into public.banking_transactions(
   organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_org,v_invoice.location_id,p_bank_account_id,'deposit',p_amount,'confirmed',
   nullif(trim(p_reference),''),'Project invoice '||v_invoice.invoice_number||' - '||v_project.project_number,auth.uid()
  );
 end if;

 update public.project_invoices set amount_paid=v_new_paid,status=v_status,updated_at=now() where id=v_invoice.id;
 perform public.recalculate_project_totals(v_invoice.project_id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_invoice.project_id,'payment_received','Project invoice payment received',
  jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'amount',p_amount,'method',v_method,'status',v_status),auth.uid());

 return jsonb_build_object('invoice_id',v_invoice.id,'payment_status',v_status,'total_paid',v_new_paid,'balance',greatest(v_invoice.total_amount-v_new_paid,0));
end; $$;
revoke all on function public.record_project_invoice_payment(uuid,numeric,text,uuid,text,text) from public;
revoke execute on function public.record_project_invoice_payment(uuid,numeric,text,uuid,text,text) from anon;
grant execute on function public.record_project_invoice_payment(uuid,numeric,text,uuid,text,text) to authenticated;

create or replace function public.update_project_status(
 p_project_id uuid,p_status text,p_progress_percent numeric default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_project public.projects%rowtype;
 v_progress numeric(5,2);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('projects.manage') then raise exception 'Permission denied: projects.manage'; end if;
 if p_status not in ('planning','active','on_hold','completed','cancelled') then raise exception 'Invalid project status'; end if;

 select * into v_project from public.projects where id=p_project_id and organization_id=v_org for update;
 if not found then raise exception 'Project not found'; end if;
 if v_project.status='cancelled' and p_status<>'cancelled' then raise exception 'Cancelled project cannot be reopened automatically'; end if;

 v_progress:=coalesce(p_progress_percent,v_project.progress_percent);
 if p_status='completed' then v_progress:=100; end if;
 if v_progress<0 or v_progress>100 then raise exception 'Progress must be between 0 and 100'; end if;

 update public.projects set
  status=p_status,progress_percent=v_progress,notes=coalesce(p_notes,notes),
  completed_at=case when p_status='completed' then coalesce(completed_at,now()) else completed_at end,
  updated_at=now()
 where id=v_project.id;

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_project.id,'status_changed','Project status changed',
  jsonb_build_object('from_status',v_project.status,'to_status',p_status,'progress_percent',v_progress,'notes',p_notes),auth.uid());

 return jsonb_build_object('project_id',v_project.id,'status',p_status,'progress_percent',v_progress);
end; $$;
revoke all on function public.update_project_status(uuid,text,numeric,text) from public;
revoke execute on function public.update_project_status(uuid,text,numeric,text) from anon;
grant execute on function public.update_project_status(uuid,text,numeric,text) to authenticated;
