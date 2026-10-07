-- MGT Business Suite — Durable built-in role permission templates

create table if not exists public.default_role_permission_templates(
 role text not null,
 permission text not null references public.permission_catalog(code) on delete cascade,
 primary key(role,permission)
);

alter table public.default_role_permission_templates enable row level security;

insert into public.default_role_permission_templates(role,permission) values
 ('accountant','approvals.view'),
 ('accountant','attendance.use'),
 ('accountant','customers.view'),
 ('accountant','dashboard.view'),
 ('accountant','finance.manage'),
 ('accountant','finance.view'),
 ('accountant','leave.request'),
 ('accountant','payroll.manage'),
 ('accountant','payroll.pay'),
 ('accountant','payroll.view'),
 ('accountant','projects.billing'),
 ('accountant','projects.costs'),
 ('accountant','projects.view'),
 ('accountant','purchasing.pay'),
 ('accountant','purchasing.view'),
 ('accountant','reports.view'),
 ('accountant','sales.view'),
 ('accountant','suppliers.view'),

 ('cashier','attendance.use'),
 ('cashier','catalog.view'),
 ('cashier','customers.manage'),
 ('cashier','customers.view'),
 ('cashier','dashboard.view'),
 ('cashier','inventory.view'),
 ('cashier','leave.request'),
 ('cashier','sales.create'),
 ('cashier','sales.view'),
 ('cashier','services.pay'),
 ('cashier','services.view'),

 ('employee','attendance.use'),
 ('employee','dashboard.view'),
 ('employee','leave.request'),
 ('employee','projects.time'),
 ('employee','services.view'),

 ('manager','approvals.view'),
 ('manager','assets.maintenance'),
 ('manager','assets.manage'),
 ('manager','assets.view'),
 ('manager','attendance.manage'),
 ('manager','attendance.use'),
 ('manager','catalog.manage'),
 ('manager','catalog.view'),
 ('manager','commissions.manage'),
 ('manager','customers.manage'),
 ('manager','customers.view'),
 ('manager','dashboard.view'),
 ('manager','finance.view'),
 ('manager','fleet.dispatch'),
 ('manager','fleet.manage'),
 ('manager','fleet.view'),
 ('manager','hr.manage'),
 ('manager','hr.view'),
 ('manager','inventory.adjust'),
 ('manager','inventory.stocktake'),
 ('manager','inventory.transfer'),
 ('manager','inventory.view'),
 ('manager','leave.manage'),
 ('manager','leave.request'),
 ('manager','manufacturing.bom'),
 ('manager','manufacturing.manage'),
 ('manager','manufacturing.production'),
 ('manager','manufacturing.view'),
 ('manager','payroll.view'),
 ('manager','projects.billing'),
 ('manager','projects.costs'),
 ('manager','projects.manage'),
 ('manager','projects.time'),
 ('manager','projects.view'),
 ('manager','purchasing.create'),
 ('manager','purchasing.receive'),
 ('manager','purchasing.view'),
 ('manager','reports.view'),
 ('manager','sales.create'),
 ('manager','sales.discount'),
 ('manager','sales.view'),
 ('manager','services.manage'),
 ('manager','services.pay'),
 ('manager','services.view'),
 ('manager','suppliers.manage'),
 ('manager','suppliers.view'),

 ('production_staff','assets.maintenance'),
 ('production_staff','assets.view'),
 ('production_staff','attendance.use'),
 ('production_staff','catalog.view'),
 ('production_staff','dashboard.view'),
 ('production_staff','inventory.view'),
 ('production_staff','leave.request'),
 ('production_staff','manufacturing.manage'),
 ('production_staff','manufacturing.production'),
 ('production_staff','manufacturing.view'),
 ('production_staff','projects.time'),

 ('salesperson','attendance.use'),
 ('salesperson','catalog.view'),
 ('salesperson','customers.manage'),
 ('salesperson','customers.view'),
 ('salesperson','dashboard.view'),
 ('salesperson','fleet.dispatch'),
 ('salesperson','fleet.view'),
 ('salesperson','leave.request'),
 ('salesperson','projects.time'),
 ('salesperson','projects.view'),
 ('salesperson','sales.create'),
 ('salesperson','sales.view'),

 ('storekeeper','assets.view'),
 ('storekeeper','attendance.use'),
 ('storekeeper','catalog.view'),
 ('storekeeper','dashboard.view'),
 ('storekeeper','fleet.view'),
 ('storekeeper','inventory.adjust'),
 ('storekeeper','inventory.stocktake'),
 ('storekeeper','inventory.transfer'),
 ('storekeeper','inventory.view'),
 ('storekeeper','leave.request'),
 ('storekeeper','manufacturing.view'),
 ('storekeeper','purchasing.create'),
 ('storekeeper','purchasing.receive'),
 ('storekeeper','purchasing.view'),
 ('storekeeper','suppliers.view')
on conflict(role,permission) do nothing;

create or replace function public.seed_default_roles(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.roles(organization_id,key,name,description,is_system)
  values
    (p_organization_id,'owner','Owner','Full business ownership and administrative control',true),
    (p_organization_id,'admin','Administrator','Full day-to-day business administration',true),
    (p_organization_id,'manager','Manager','Operational management without ownership controls',true),
    (p_organization_id,'cashier','Cashier','Point of sale and customer checkout access',true),
    (p_organization_id,'salesperson','Salesperson','Sales and customer relationship access',true),
    (p_organization_id,'storekeeper','Storekeeper','Inventory, receiving and stock-control access',true),
    (p_organization_id,'accountant','Accountant','Finance, payroll, billing and reporting access',true),
    (p_organization_id,'production_staff','Production Staff','Manufacturing, project time and asset visibility',true),
    (p_organization_id,'employee','Employee','Basic employee self-service and assigned work access',true)
  on conflict(organization_id,key) do update set
    name=excluded.name,
    description=excluded.description,
    is_system=true,
    active=true,
    updated_at=now();

  insert into public.role_permissions(organization_id,role,permission,allowed)
  select p_organization_id,role_key,pc.code,true
  from (values ('owner'),('admin')) as r(role_key)
  cross join public.permission_catalog pc
  on conflict(organization_id,role,permission) do update set allowed=true;

  insert into public.role_permissions(organization_id,role,permission,allowed)
  select p_organization_id,t.role,t.permission,true
  from public.default_role_permission_templates t
  on conflict(organization_id,role,permission) do update set allowed=true;
end;
$$;

revoke all on function public.seed_default_roles(uuid) from public;
revoke execute on function public.seed_default_roles(uuid) from anon;
revoke execute on function public.seed_default_roles(uuid) from authenticated;
