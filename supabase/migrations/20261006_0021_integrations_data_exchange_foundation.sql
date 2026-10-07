-- MGT Business Suite — Integrations and Data Exchange foundation

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('integrations.view','Integrations','View integrations','View API keys, webhooks and integration activity',150),
 ('integrations.manage','Integrations','Manage integrations','Create/revoke API keys, configure webhooks and manage data exchange',151),
 ('integrations.api','Integrations','Issue API access','Create scoped external API credentials for business applications',152)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission)
values ('manager','integrations.view')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,'manager','integrations.view',true
from public.users u
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.integration_api_keys(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 key_prefix text not null,
 key_hash text not null unique,
 scopes text[] not null default '{}'::text[],
 active boolean not null default true,
 expires_at timestamptz,
 last_used_at timestamptz,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 revoked_at timestamptz,
 check(array_length(scopes,1) is null or array_length(scopes,1)<=32)
);
create index if not exists integration_api_keys_org_idx on public.integration_api_keys(organization_id,active,created_at desc);
create index if not exists integration_api_keys_created_by_idx on public.integration_api_keys(created_by);

create table if not exists public.webhook_endpoints(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,
 url text not null,
 signing_secret text not null,
 events text[] not null default '{}'::text[],
 active boolean not null default true,
 failure_count integer not null default 0,
 last_delivery_at timestamptz,
 last_success_at timestamptz,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 deleted_at timestamptz,
 check(array_length(events,1) is null or array_length(events,1)<=64)
);
create index if not exists webhook_endpoints_org_idx on public.webhook_endpoints(organization_id,active,created_at desc);
create index if not exists webhook_endpoints_created_by_idx on public.webhook_endpoints(created_by);

create table if not exists public.integration_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 event_type text not null,
 entity_type text not null,
 entity_id text,
 payload jsonb not null default '{}'::jsonb,
 status text not null default 'queued' check(status in ('queued','processing','delivered','failed','ignored')),
 created_at timestamptz not null default now(),
 processed_at timestamptz
);
create index if not exists integration_events_org_status_idx on public.integration_events(organization_id,status,created_at);
create index if not exists integration_events_entity_idx on public.integration_events(organization_id,entity_type,entity_id,created_at desc);

create table if not exists public.integration_event_deliveries(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 event_id uuid not null references public.integration_events(id) on delete cascade,
 endpoint_id uuid references public.webhook_endpoints(id) on delete set null,
 endpoint_url text not null,
 status text not null default 'queued' check(status in ('queued','delivered','failed','abandoned')),
 attempt_count integer not null default 0,
 next_attempt_at timestamptz not null default now(),
 last_attempt_at timestamptz,
 response_code integer,
 response_excerpt text,
 error_message text,
 delivered_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(event_id,endpoint_id)
);
create index if not exists integration_deliveries_queue_idx on public.integration_event_deliveries(organization_id,status,next_attempt_at);
create index if not exists integration_deliveries_endpoint_idx on public.integration_event_deliveries(endpoint_id,created_at desc);
create index if not exists integration_deliveries_event_idx on public.integration_event_deliveries(event_id);

alter table public.integration_api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;
alter table public.integration_events enable row level security;
alter table public.integration_event_deliveries enable row level security;

-- Intentionally no direct authenticated table policies for secrets/integration internals.
-- Management is performed through organization-authorized server routes using the service client.

create or replace function public.queue_integration_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
 v_row jsonb;
 v_org uuid;
 v_entity_id text;
 v_entity text;
 v_event_type text;
 v_event_id uuid;
begin
 v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_org:=nullif(v_row->>'organization_id','')::uuid;
 if v_org is null then return coalesce(new,old); end if;

 v_entity:=case tg_table_name
   when 'products' then 'product'
   when 'customers' then 'customer'
   when 'suppliers' then 'supplier'
   when 'sales' then 'sale'
   when 'payments' then 'payment'
   when 'purchases' then 'purchase'
   when 'work_orders' then 'work_order'
   when 'projects' then 'project'
   when 'project_invoices' then 'project_invoice'
   when 'deliveries' then 'delivery'
   when 'stock_movements' then 'stock_movement'
   else tg_table_name
 end;
 v_entity_id:=coalesce(v_row->>'id',v_row->>'project_id',v_row->>'product_id');
 v_event_type:=v_entity||'.'||case when tg_op='INSERT' then 'created' when tg_op='UPDATE' then 'updated' else 'deleted' end;

 insert into public.integration_events(organization_id,event_type,entity_type,entity_id,payload)
 values(v_org,v_event_type,v_entity,v_entity_id,v_row)
 returning id into v_event_id;

 insert into public.integration_event_deliveries(
   organization_id,event_id,endpoint_id,endpoint_url,status,next_attempt_at
 )
 select v_org,v_event_id,w.id,w.url,'queued',now()
 from public.webhook_endpoints w
 where w.organization_id=v_org
   and w.active=true
   and w.deleted_at is null
   and ('*'=any(w.events) or v_event_type=any(w.events));

 if not exists(select 1 from public.integration_event_deliveries d where d.event_id=v_event_id) then
   update public.integration_events set status='ignored',processed_at=now() where id=v_event_id;
 end if;

 return coalesce(new,old);
exception when others then
 -- Integration queuing must never make the core business transaction fail.
 return coalesce(new,old);
end;
$$;

revoke all on function public.queue_integration_event() from public;
revoke execute on function public.queue_integration_event() from anon;
revoke execute on function public.queue_integration_event() from authenticated;

drop trigger if exists products_integration_events on public.products;
create trigger products_integration_events after insert or update on public.products
for each row execute function public.queue_integration_event();

drop trigger if exists customers_integration_events on public.customers;
create trigger customers_integration_events after insert or update on public.customers
for each row execute function public.queue_integration_event();

drop trigger if exists suppliers_integration_events on public.suppliers;
create trigger suppliers_integration_events after insert or update on public.suppliers
for each row execute function public.queue_integration_event();

drop trigger if exists sales_integration_events on public.sales;
create trigger sales_integration_events after insert or update on public.sales
for each row execute function public.queue_integration_event();

drop trigger if exists payments_integration_events on public.payments;
create trigger payments_integration_events after insert on public.payments
for each row execute function public.queue_integration_event();

drop trigger if exists purchases_integration_events on public.purchases;
create trigger purchases_integration_events after insert or update on public.purchases
for each row execute function public.queue_integration_event();

drop trigger if exists work_orders_integration_events on public.work_orders;
create trigger work_orders_integration_events after insert or update on public.work_orders
for each row execute function public.queue_integration_event();

drop trigger if exists projects_integration_events on public.projects;
create trigger projects_integration_events after insert or update on public.projects
for each row execute function public.queue_integration_event();

drop trigger if exists project_invoices_integration_events on public.project_invoices;
create trigger project_invoices_integration_events after insert or update on public.project_invoices
for each row execute function public.queue_integration_event();

drop trigger if exists deliveries_integration_events on public.deliveries;
create trigger deliveries_integration_events after insert or update on public.deliveries
for each row execute function public.queue_integration_event();

drop trigger if exists stock_movements_integration_events on public.stock_movements;
create trigger stock_movements_integration_events after insert on public.stock_movements
for each row execute function public.queue_integration_event();
