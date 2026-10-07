-- MGT Business Suite — Universal staff, roles, permissions and invitations
-- Apply only to the Universal Mgt Supabase project.

alter table public.users
  add column if not exists email text,
  add column if not exists archived_at timestamptz;

create index if not exists users_org_role_idx on public.users(organization_id, role);
create index if not exists users_org_email_idx on public.users(organization_id, lower(email));

create table if not exists public.permission_catalog (
  code text primary key,
  section text not null,
  label text not null,
  description text,
  sort_order integer not null default 0
);

insert into public.permission_catalog(code, section, label, description, sort_order) values
  ('dashboard.view','Workspace','View dashboard','View the business dashboard and summary metrics',10),
  ('catalog.view','Catalog','View catalog','View products and services',20),
  ('catalog.manage','Catalog','Manage catalog','Create and edit products, services and pricing',21),
  ('inventory.view','Inventory','View inventory','View stock balances and movements',30),
  ('inventory.adjust','Inventory','Adjust inventory','Post stock corrections, opening stock and losses',31),
  ('sales.view','Sales','View sales','View sales and invoice history',40),
  ('sales.create','Sales','Create sales','Create sales, invoices and customer charges',41),
  ('sales.discount','Sales','Apply discounts','Apply discretionary sale discounts',42),
  ('sales.refund','Sales','Refund sales','Process returns and refunds',43),
  ('customers.view','CRM','View customers','View customer records and balances',50),
  ('customers.manage','CRM','Manage customers','Create and edit customer records',51),
  ('suppliers.view','Purchasing','View suppliers','View suppliers and supplier balances',60),
  ('suppliers.manage','Purchasing','Manage suppliers','Create and edit supplier records',61),
  ('purchasing.view','Purchasing','View purchases','View purchase and receiving history',62),
  ('purchasing.create','Purchasing','Create purchases','Create purchase orders and receive stock',63),
  ('purchasing.approve','Purchasing','Approve purchases','Approve controlled purchase activity',64),
  ('finance.view','Finance','View finance','View cash, banking, expenses and balances',70),
  ('finance.manage','Finance','Manage finance','Post expenses, banking and finance entries',71),
  ('reports.view','Reporting','View reports','View business reports and analytics',80),
  ('services.manage','Operations','Manage service jobs','Create and manage service work orders',90),
  ('manufacturing.manage','Operations','Manage manufacturing','Manage BOMs and production orders',91),
  ('locations.manage','Administration','Manage locations','Create and manage branches, stores and warehouses',100),
  ('users.manage','Administration','Manage staff','Invite, disable and manage staff accounts',101),
  ('roles.manage','Administration','Manage roles','Create roles and change permission sets',102),
  ('settings.manage','Administration','Manage settings','Change organization and application settings',103),
  ('audit.view','Administration','View audit history','View security and business audit events',104)
on conflict (code) do update set
  section = excluded.section,
  label = excluded.label,
  description = excluded.description,
  sort_order = excluded.sort_order;

create table if not exists public.roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, key)
);

create index if not exists roles_org_active_idx on public.roles(organization_id, active);

create table if not exists public.staff_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  full_name text not null,
  role text not null,
  default_location_id uuid references public.locations(id) on delete set null,
  auth_user_id uuid references auth.users(id) on delete set null,
  invited_by uuid references public.users(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','accepted','revoked','expired')),
  invited_at timestamptz not null default now(),
  accepted_at timestamptz,
  revoked_at timestamptz
);

create index if not exists staff_invitations_org_status_idx on public.staff_invitations(organization_id, status, invited_at desc);
create index if not exists staff_invitations_email_idx on public.staff_invitations(organization_id, lower(email));
create index if not exists staff_invitations_auth_user_idx on public.staff_invitations(auth_user_id);

alter table public.permission_catalog enable row level security;
alter table public.roles enable row level security;
alter table public.staff_invitations enable row level security;

drop policy if exists permission_catalog_authenticated_select on public.permission_catalog;
create policy permission_catalog_authenticated_select on public.permission_catalog
for select to authenticated using (true);

drop policy if exists roles_org_select on public.roles;
create policy roles_org_select on public.roles
for select to authenticated using (public.has_organization_access(organization_id));

drop policy if exists roles_org_insert on public.roles;
create policy roles_org_insert on public.roles
for insert to authenticated with check (
  public.has_organization_access(organization_id)
  and public.has_permission('roles.manage')
);

drop policy if exists roles_org_update on public.roles;
create policy roles_org_update on public.roles
for update to authenticated using (
  public.has_organization_access(organization_id)
  and public.has_permission('roles.manage')
)
with check (
  public.has_organization_access(organization_id)
  and public.has_permission('roles.manage')
);

drop policy if exists roles_org_delete on public.roles;
create policy roles_org_delete on public.roles
for delete to authenticated using (
  public.has_organization_access(organization_id)
  and public.has_permission('roles.manage')
);

drop policy if exists staff_invitations_org_select on public.staff_invitations;
create policy staff_invitations_org_select on public.staff_invitations
for select to authenticated using (
  public.has_organization_access(organization_id)
  and public.has_permission('users.manage')
);

drop policy if exists staff_invitations_org_insert on public.staff_invitations;
create policy staff_invitations_org_insert on public.staff_invitations
for insert to authenticated with check (
  public.has_organization_access(organization_id)
  and public.has_permission('users.manage')
);

drop policy if exists staff_invitations_org_update on public.staff_invitations;
create policy staff_invitations_org_update on public.staff_invitations
for update to authenticated using (
  public.has_organization_access(organization_id)
  and public.has_permission('users.manage')
)
with check (
  public.has_organization_access(organization_id)
  and public.has_permission('users.manage')
);

create or replace function public.seed_default_roles(p_organization_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.roles(organization_id, key, name, description, is_system)
  values
    (p_organization_id,'owner','Owner','Full business ownership and administrative control',true),
    (p_organization_id,'admin','Administrator','Full day-to-day business administration',true),
    (p_organization_id,'manager','Manager','Operational management without ownership controls',true),
    (p_organization_id,'cashier','Cashier','Point of sale and customer checkout access',true),
    (p_organization_id,'salesperson','Salesperson','Sales and customer relationship access',true),
    (p_organization_id,'storekeeper','Storekeeper','Inventory and receiving access',true),
    (p_organization_id,'accountant','Accountant','Finance and reporting access',true),
    (p_organization_id,'production_staff','Production Staff','Manufacturing and stock visibility',true),
    (p_organization_id,'employee','Employee','Basic dashboard access',true)
  on conflict (organization_id, key) do update set
    name = excluded.name,
    description = excluded.description,
    is_system = true,
    active = true,
    updated_at = now();

  -- Owner and admin are also treated as privileged by has_permission(), but we
  -- populate explicit rows so the UI can show their complete permission set.
  insert into public.role_permissions(organization_id, role, permission, allowed)
  select p_organization_id, role_key, pc.code, true
  from (values ('owner'),('admin')) as r(role_key)
  cross join public.permission_catalog pc
  on conflict (organization_id, role, permission) do update set allowed = true;

  insert into public.role_permissions(organization_id, role, permission, allowed) values
    (p_organization_id,'manager','dashboard.view',true),
    (p_organization_id,'manager','catalog.view',true),
    (p_organization_id,'manager','catalog.manage',true),
    (p_organization_id,'manager','inventory.view',true),
    (p_organization_id,'manager','inventory.adjust',true),
    (p_organization_id,'manager','sales.view',true),
    (p_organization_id,'manager','sales.create',true),
    (p_organization_id,'manager','sales.discount',true),
    (p_organization_id,'manager','customers.view',true),
    (p_organization_id,'manager','customers.manage',true),
    (p_organization_id,'manager','suppliers.view',true),
    (p_organization_id,'manager','suppliers.manage',true),
    (p_organization_id,'manager','purchasing.view',true),
    (p_organization_id,'manager','purchasing.create',true),
    (p_organization_id,'manager','finance.view',true),
    (p_organization_id,'manager','reports.view',true),
    (p_organization_id,'manager','services.manage',true),
    (p_organization_id,'manager','manufacturing.manage',true),
    (p_organization_id,'cashier','dashboard.view',true),
    (p_organization_id,'cashier','catalog.view',true),
    (p_organization_id,'cashier','inventory.view',true),
    (p_organization_id,'cashier','sales.view',true),
    (p_organization_id,'cashier','sales.create',true),
    (p_organization_id,'cashier','customers.view',true),
    (p_organization_id,'cashier','customers.manage',true),
    (p_organization_id,'salesperson','dashboard.view',true),
    (p_organization_id,'salesperson','catalog.view',true),
    (p_organization_id,'salesperson','sales.view',true),
    (p_organization_id,'salesperson','sales.create',true),
    (p_organization_id,'salesperson','customers.view',true),
    (p_organization_id,'salesperson','customers.manage',true),
    (p_organization_id,'storekeeper','dashboard.view',true),
    (p_organization_id,'storekeeper','catalog.view',true),
    (p_organization_id,'storekeeper','inventory.view',true),
    (p_organization_id,'storekeeper','inventory.adjust',true),
    (p_organization_id,'storekeeper','suppliers.view',true),
    (p_organization_id,'storekeeper','purchasing.view',true),
    (p_organization_id,'storekeeper','purchasing.create',true),
    (p_organization_id,'accountant','dashboard.view',true),
    (p_organization_id,'accountant','sales.view',true),
    (p_organization_id,'accountant','customers.view',true),
    (p_organization_id,'accountant','suppliers.view',true),
    (p_organization_id,'accountant','purchasing.view',true),
    (p_organization_id,'accountant','finance.view',true),
    (p_organization_id,'accountant','finance.manage',true),
    (p_organization_id,'accountant','reports.view',true),
    (p_organization_id,'production_staff','dashboard.view',true),
    (p_organization_id,'production_staff','catalog.view',true),
    (p_organization_id,'production_staff','inventory.view',true),
    (p_organization_id,'production_staff','manufacturing.manage',true),
    (p_organization_id,'employee','dashboard.view',true)
  on conflict (organization_id, role, permission) do update set allowed = excluded.allowed;
end;
$$;

revoke all on function public.seed_default_roles(uuid) from public;
revoke execute on function public.seed_default_roles(uuid) from anon;
revoke execute on function public.seed_default_roles(uuid) from authenticated;

-- Seed roles for organizations already created before this migration.
do $$
declare
  org record;
begin
  for org in select id from public.organizations loop
    perform public.seed_default_roles(org.id);
  end loop;
end;
$$;

create or replace function public.bootstrap_organization(
  business_name text,
  business_type text default 'hybrid',
  currency_code text default 'UGX',
  country_name text default 'Uganda',
  timezone_name text default 'Africa/Kampala',
  short_code text default null,
  location_name text default 'Main Location',
  location_type text default 'branch'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  actor uuid := auth.uid();
  org_id uuid;
  loc_id uuid;
  actor_name text;
  actor_email text;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into org_id from public.users where id = actor limit 1;
  if org_id is not null then
    perform public.seed_default_roles(org_id);
    update public.users u
      set email = coalesce(u.email, au.email), updated_at = now()
      from auth.users au
      where u.id = actor and au.id = actor;
    return org_id;
  end if;

  select
    coalesce(raw_user_meta_data->>'full_name', email, 'Owner'),
    email
  into actor_name, actor_email
  from auth.users
  where id = actor;

  insert into public.organizations(name, short_name, business_type, currency, country, timezone)
  values (
    coalesce(nullif(trim(business_name), ''), 'My Business'),
    nullif(trim(short_code), ''),
    coalesce(nullif(trim(business_type), ''), 'hybrid'),
    coalesce(nullif(trim(currency_code), ''), 'UGX'),
    coalesce(nullif(trim(country_name), ''), 'Uganda'),
    coalesce(nullif(trim(timezone_name), ''), 'Africa/Kampala')
  )
  returning id into org_id;

  insert into public.locations(organization_id, name, type)
  values (
    org_id,
    coalesce(nullif(trim(location_name), ''), 'Main Location'),
    coalesce(nullif(trim(location_type), ''), 'branch')
  )
  returning id into loc_id;

  insert into public.users(id, organization_id, default_location_id, full_name, email, role, active)
  values (actor, org_id, loc_id, actor_name, actor_email, 'owner', true)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        default_location_id = excluded.default_location_id,
        full_name = excluded.full_name,
        email = excluded.email,
        role = 'owner',
        active = true,
        archived_at = null,
        updated_at = now();

  perform public.seed_default_roles(org_id);

  return org_id;
end;
$$;

revoke all on function public.bootstrap_organization(text,text,text,text,text,text,text,text) from public;
grant execute on function public.bootstrap_organization(text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.accept_my_staff_invitation()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.staff_invitations
  set status = 'accepted',
      accepted_at = coalesce(accepted_at, now())
  where auth_user_id = auth.uid()
    and status = 'pending';
end;
$$;

revoke all on function public.accept_my_staff_invitation() from public;
revoke execute on function public.accept_my_staff_invitation() from anon;
grant execute on function public.accept_my_staff_invitation() to authenticated;
