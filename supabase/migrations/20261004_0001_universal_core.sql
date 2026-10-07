-- MGT Business Suite — Universal Core Schema
-- This migration initializes the dedicated Universal MGT Supabase project.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  short_name text,
  legal_name text,
  business_type text not null default 'hybrid',
  country text not null default 'Uganda',
  currency text not null default 'UGX',
  timezone text not null default 'Africa/Kampala',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text,
  type text not null default 'branch',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  default_location_id uuid references public.locations(id) on delete set null,
  full_name text not null default '',
  role text not null default 'employee',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists users_organization_id_idx on public.users(organization_id);
create index if not exists users_default_location_id_idx on public.users(default_location_id);

create table if not exists public.organization_modules (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  module_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (organization_id, module_key)
);

create table if not exists public.role_permissions (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  role text not null,
  permission text not null,
  allowed boolean not null default true,
  primary key (organization_id, role, permission)
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  kind text not null default 'product',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, kind, name)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  category_id uuid references public.categories(id) on delete set null,
  name text not null,
  sku text,
  barcode text,
  item_type text not null default 'product',
  unit text not null default 'pieces',
  track_inventory boolean not null default true,
  cost_price numeric(18,2) not null default 0,
  selling_price numeric(18,2) not null default 0,
  wholesale_price numeric(18,2),
  tax_rate numeric(7,4) not null default 0,
  reorder_level numeric(18,3) not null default 0,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists products_org_sku_unique
  on public.products(organization_id, sku)
  where sku is not null and sku <> '';
create unique index if not exists products_org_barcode_unique
  on public.products(organization_id, barcode)
  where barcode is not null and barcode <> '';
create index if not exists products_organization_id_idx on public.products(organization_id);
create index if not exists products_category_id_idx on public.products(category_id);

create table if not exists public.stock_balances (
  product_id uuid not null references public.products(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  quantity numeric(18,3) not null default 0,
  reserved_quantity numeric(18,3) not null default 0,
  updated_at timestamptz not null default now(),
  primary key (product_id, location_id)
);

create index if not exists stock_balances_location_id_idx on public.stock_balances(location_id);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  movement_type text not null,
  quantity numeric(18,3) not null,
  unit_cost numeric(18,2),
  reference_type text,
  reference_id uuid,
  notes text,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists stock_movements_org_date_idx on public.stock_movements(organization_id, created_at desc);
create index if not exists stock_movements_product_idx on public.stock_movements(product_id, created_at desc);
create index if not exists stock_movements_location_idx on public.stock_movements(location_id, created_at desc);

create table if not exists public.customers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  customer_group text,
  credit_limit numeric(18,2) not null default 0,
  opening_balance numeric(18,2) not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists customers_org_name_idx on public.customers(organization_id, name);

create table if not exists public.suppliers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  phone text,
  email text,
  address text,
  opening_balance numeric(18,2) not null default 0,
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists suppliers_org_name_idx on public.suppliers(organization_id, name);

create table if not exists public.sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  sale_number text,
  channel text not null default 'sale',
  status text not null default 'completed',
  payment_status text not null default 'paid',
  subtotal numeric(18,2) not null default 0,
  discount_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  notes text,
  sold_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists sales_org_date_idx on public.sales(organization_id, created_at desc);
create index if not exists sales_location_date_idx on public.sales(location_id, created_at desc);
create index if not exists sales_customer_idx on public.sales(customer_id, created_at desc);

create table if not exists public.sale_items (
  id uuid primary key default gen_random_uuid(),
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  description text not null,
  quantity numeric(18,3) not null default 1,
  unit_price numeric(18,2) not null default 0,
  unit_cost numeric(18,2),
  discount_amount numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0
);

create index if not exists sale_items_sale_id_idx on public.sale_items(sale_id);
create index if not exists sale_items_product_id_idx on public.sale_items(product_id);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  sale_id uuid references public.sales(id) on delete set null,
  direction text not null default 'in',
  payment_type text not null default 'sale',
  method text not null default 'cash',
  amount numeric(18,2) not null check (amount >= 0),
  reference text,
  notes text,
  received_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payments_org_date_idx on public.payments(organization_id, created_at desc);
create index if not exists payments_sale_id_idx on public.payments(sale_id);
create index if not exists payments_customer_id_idx on public.payments(customer_id);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  supplier_id uuid references public.suppliers(id) on delete set null,
  purchase_number text,
  status text not null default 'draft',
  subtotal numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  total_amount numeric(18,2) not null default 0,
  amount_paid numeric(18,2) not null default 0,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchases_org_date_idx on public.purchases(organization_id, created_at desc);
create index if not exists purchases_supplier_id_idx on public.purchases(supplier_id);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references public.purchases(id) on delete cascade,
  product_id uuid references public.products(id) on delete set null,
  description text not null,
  quantity numeric(18,3) not null default 1,
  unit_cost numeric(18,2) not null default 0,
  tax_amount numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0
);

create index if not exists purchase_items_purchase_id_idx on public.purchase_items(purchase_id);
create index if not exists purchase_items_product_id_idx on public.purchase_items(product_id);

create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  category text not null default 'Other',
  description text not null,
  amount numeric(18,2) not null check (amount >= 0),
  payment_method text not null default 'cash',
  reference text,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists expenses_org_date_idx on public.expenses(organization_id, created_at desc);
create index if not exists expenses_location_date_idx on public.expenses(location_id, created_at desc);

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  account_type text not null default 'bank',
  provider text,
  account_reference text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.banking_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  bank_account_id uuid references public.bank_accounts(id) on delete set null,
  transaction_type text not null default 'deposit',
  amount numeric(18,2) not null check (amount >= 0),
  status text not null default 'confirmed',
  reference text,
  notes text,
  recorded_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists banking_transactions_org_date_idx on public.banking_transactions(organization_id, created_at desc);

create table if not exists public.boms (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  output_product_id uuid not null references public.products(id) on delete restrict,
  name text not null,
  output_quantity numeric(18,3) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.bom_items (
  id uuid primary key default gen_random_uuid(),
  bom_id uuid not null references public.boms(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(18,3) not null
);

create table if not exists public.production_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  bom_id uuid references public.boms(id) on delete set null,
  output_product_id uuid references public.products(id) on delete set null,
  planned_quantity numeric(18,3) not null default 0,
  actual_quantity numeric(18,3),
  waste_quantity numeric(18,3) not null default 0,
  status text not null default 'planned',
  started_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists production_orders_org_date_idx on public.production_orders(organization_id, created_at desc);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid references public.locations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  title text not null,
  description text,
  status text not null default 'open',
  quoted_amount numeric(18,2),
  final_amount numeric(18,2),
  assigned_to uuid references public.users(id) on delete set null,
  due_at timestamptz,
  completed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists work_orders_org_date_idx on public.work_orders(organization_id, created_at desc);

create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  organization_id uuid references public.organizations(id) on delete set null,
  location_id uuid references public.locations(id) on delete set null,
  user_id uuid references public.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  summary text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists audit_log_org_date_idx on public.audit_log(organization_id, created_at desc);

create or replace function public.current_organization_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select organization_id
  from public.users
  where id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.current_user_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role
  from public.users
  where id = auth.uid()
    and active = true
  limit 1
$$;

create or replace function public.has_organization_access(target_org uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select target_org is not null and target_org = public.current_organization_id()
$$;

create or replace function public.has_permission(permission_key text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when public.current_user_role() in ('owner', 'admin', 'super_admin', 'system_admin') then true
    else coalesce((
      select rp.allowed
      from public.role_permissions rp
      where rp.organization_id = public.current_organization_id()
        and rp.role = public.current_user_role()
        and rp.permission = permission_key
      limit 1
    ), false)
  end
$$;

revoke all on function public.current_organization_id() from public;
revoke all on function public.current_user_role() from public;
revoke all on function public.has_organization_access(uuid) from public;
revoke all on function public.has_permission(text) from public;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_organization_access(uuid) to authenticated;
grant execute on function public.has_permission(text) to authenticated;

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
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  select organization_id into org_id from public.users where id = actor limit 1;
  if org_id is not null then
    return org_id;
  end if;

  select coalesce(raw_user_meta_data->>'full_name', email, 'Owner')
  into actor_name
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

  insert into public.users(id, organization_id, default_location_id, full_name, role, active)
  values (actor, org_id, loc_id, actor_name, 'owner', true)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        default_location_id = excluded.default_location_id,
        full_name = excluded.full_name,
        role = 'owner',
        active = true,
        updated_at = now();

  return org_id;
end;
$$;

revoke all on function public.bootstrap_organization(text,text,text,text,text,text,text,text) from public;
grant execute on function public.bootstrap_organization(text,text,text,text,text,text,text,text) to authenticated;

alter table public.organizations enable row level security;
alter table public.locations enable row level security;
alter table public.users enable row level security;
alter table public.organization_modules enable row level security;
alter table public.role_permissions enable row level security;
alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;
alter table public.customers enable row level security;
alter table public.suppliers enable row level security;
alter table public.sales enable row level security;
alter table public.sale_items enable row level security;
alter table public.payments enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.expenses enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.banking_transactions enable row level security;
alter table public.boms enable row level security;
alter table public.bom_items enable row level security;
alter table public.production_orders enable row level security;
alter table public.work_orders enable row level security;
alter table public.audit_log enable row level security;

create policy organizations_member_select on public.organizations
for select to authenticated using (public.has_organization_access(id));
create policy organizations_owner_update on public.organizations
for update to authenticated using (public.has_organization_access(id) and public.current_user_role() in ('owner','admin','super_admin','system_admin'))
with check (public.has_organization_access(id));

create policy locations_org_access on public.locations
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy users_org_select on public.users
for select to authenticated using (public.has_organization_access(organization_id) or id = auth.uid());
create policy users_admin_write on public.users
for all to authenticated using (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
)
with check (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
);

create policy organization_modules_org_access on public.organization_modules
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy role_permissions_org_access on public.role_permissions
for all to authenticated using (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
)
with check (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
);

create policy categories_org_access on public.categories
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy products_org_access on public.products
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy customers_org_access on public.customers
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy suppliers_org_access on public.suppliers
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy sales_org_access on public.sales
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy payments_org_access on public.payments
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy purchases_org_access on public.purchases
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy expenses_org_access on public.expenses
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy bank_accounts_org_access on public.bank_accounts
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy banking_transactions_org_access on public.banking_transactions
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy boms_org_access on public.boms
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy production_orders_org_access on public.production_orders
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy work_orders_org_access on public.work_orders
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy audit_log_org_select on public.audit_log
for select to authenticated using (public.has_organization_access(organization_id));
create policy audit_log_org_insert on public.audit_log
for insert to authenticated with check (public.has_organization_access(organization_id));

create policy stock_balances_org_access on public.stock_balances
for all to authenticated
using (
  exists (
    select 1 from public.products p
    where p.id = stock_balances.product_id
      and public.has_organization_access(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.products p
    where p.id = stock_balances.product_id
      and public.has_organization_access(p.organization_id)
  )
);

create policy stock_movements_org_access on public.stock_movements
for all to authenticated using (public.has_organization_access(organization_id))
with check (public.has_organization_access(organization_id));

create policy sale_items_org_access on public.sale_items
for all to authenticated
using (
  exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and public.has_organization_access(s.organization_id)
  )
)
with check (
  exists (
    select 1 from public.sales s
    where s.id = sale_items.sale_id
      and public.has_organization_access(s.organization_id)
  )
);

create policy purchase_items_org_access on public.purchase_items
for all to authenticated
using (
  exists (
    select 1 from public.purchases p
    where p.id = purchase_items.purchase_id
      and public.has_organization_access(p.organization_id)
  )
)
with check (
  exists (
    select 1 from public.purchases p
    where p.id = purchase_items.purchase_id
      and public.has_organization_access(p.organization_id)
  )
);

create policy bom_items_org_access on public.bom_items
for all to authenticated
using (
  exists (
    select 1 from public.boms b
    where b.id = bom_items.bom_id
      and public.has_organization_access(b.organization_id)
  )
)
with check (
  exists (
    select 1 from public.boms b
    where b.id = bom_items.bom_id
      and public.has_organization_access(b.organization_id)
  )
);

-- This schema intentionally stops short of financial-posting triggers.
-- Stock/cash mutation RPCs will be added in a later migration so posting remains atomic and auditable.
