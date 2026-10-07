-- MGT Business Suite — Approvals and Industrial Manufacturing

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('approvals.view','Approvals','View approvals','View approval requests and decisions',34),
 ('approvals.manage','Approvals','Approve sensitive actions','Approve or reject controlled business actions',35),
 ('manufacturing.view','Operations','View manufacturing','View BOMs, production orders and production history',92),
 ('manufacturing.bom','Operations','Manage BOMs','Create bills of materials and production recipes',93),
 ('manufacturing.production','Operations','Run production','Create, start and complete production orders',94)
on conflict(code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','approvals.view'),
 ('manager','manufacturing.view'),
 ('manager','manufacturing.bom'),
 ('manager','manufacturing.production'),
 ('production_staff','manufacturing.view'),
 ('production_staff','manufacturing.production'),
 ('storekeeper','manufacturing.view'),
 ('accountant','approvals.view')
) as x(role,permission)
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.approval_rules(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 rule_type text not null check(rule_type in ('purchase_order','stock_adjustment','production_order')),
 enabled boolean not null default false,
 threshold numeric(18,3) not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,rule_type)
);

create table if not exists public.approval_requests(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 request_type text not null check(request_type in ('purchase_order','stock_adjustment','production_order')),
 entity_type text not null,
 entity_id text,
 title text not null,
 amount numeric(18,3),
 status text not null default 'pending' check(status in ('pending','approved','rejected','cancelled')),
 requested_by uuid references public.users(id) on delete set null,
 reviewed_by uuid references public.users(id) on delete set null,
 review_notes text,
 metadata jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 reviewed_at timestamptz
);

create index if not exists approval_requests_org_status_idx on public.approval_requests(organization_id,status,created_at desc);
create index if not exists approval_requests_requested_by_idx on public.approval_requests(requested_by);
create index if not exists approval_requests_reviewed_by_idx on public.approval_requests(reviewed_by);
create index if not exists approval_rules_org_idx on public.approval_rules(organization_id);

insert into public.approval_rules(organization_id,rule_type,enabled,threshold)
select distinct u.organization_id,x.rule_type,false,x.threshold
from public.users u
cross join (values
 ('purchase_order',1000000::numeric),
 ('stock_adjustment',50::numeric),
 ('production_order',100::numeric)
) as x(rule_type,threshold)
where u.organization_id is not null
on conflict(organization_id,rule_type) do nothing;

alter table public.purchases
 add column if not exists approval_status text not null default 'not_required'
 check(approval_status in ('not_required','pending','approved','rejected'));

alter table public.production_orders
 add column if not exists production_number text,
 add column if not exists notes text,
 add column if not exists total_material_cost numeric(18,2) not null default 0,
 add column if not exists unit_cost numeric(18,2) not null default 0,
 add column if not exists output_variance numeric(18,3) not null default 0,
 add column if not exists approval_status text not null default 'not_required'
 check(approval_status in ('not_required','pending','approved','rejected'));

create unique index if not exists production_orders_org_number_idx
 on public.production_orders(organization_id,production_number)
 where production_number is not null;

create table if not exists public.production_consumption(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 production_order_id uuid not null references public.production_orders(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 planned_quantity numeric(18,3) not null default 0,
 actual_quantity numeric(18,3) not null default 0,
 unit_cost numeric(18,2) not null default 0,
 line_cost numeric(18,2) not null default 0,
 created_at timestamptz not null default now()
);

create table if not exists public.production_outputs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 production_order_id uuid not null references public.production_orders(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 product_id uuid not null references public.products(id) on delete restrict,
 output_type text not null default 'finished' check(output_type in ('finished','byproduct')),
 quantity numeric(18,3) not null check(quantity>=0),
 unit_cost numeric(18,2) not null default 0,
 created_at timestamptz not null default now()
);

create index if not exists production_consumption_order_idx on public.production_consumption(production_order_id);
create index if not exists production_consumption_product_idx on public.production_consumption(product_id);
create index if not exists production_outputs_order_idx on public.production_outputs(production_order_id);
create index if not exists production_outputs_product_idx on public.production_outputs(product_id);

alter table public.approval_rules enable row level security;
alter table public.approval_requests enable row level security;
alter table public.production_consumption enable row level security;
alter table public.production_outputs enable row level security;

drop policy if exists approval_rules_select on public.approval_rules;
create policy approval_rules_select on public.approval_rules
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('approvals.view') or public.has_permission('approvals.manage'))
);

drop policy if exists approval_rules_manage on public.approval_rules;
create policy approval_rules_manage on public.approval_rules
for all to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('approvals.manage'))
with check(public.has_organization_access(organization_id) and public.has_permission('approvals.manage'));

drop policy if exists approval_requests_select on public.approval_requests;
create policy approval_requests_select on public.approval_requests
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   requested_by=auth.uid()
   or public.has_permission('approvals.view')
   or public.has_permission('approvals.manage')
 )
);

drop policy if exists production_consumption_select on public.production_consumption;
create policy production_consumption_select on public.production_consumption
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.view') or public.has_permission('manufacturing.manage'))
);

drop policy if exists production_outputs_select on public.production_outputs;
create policy production_outputs_select on public.production_outputs
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.view') or public.has_permission('manufacturing.manage'))
);

drop policy if exists boms_org_permission on public.boms;
drop policy if exists boms_select on public.boms;
create policy boms_select on public.boms
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.view') or public.has_permission('manufacturing.manage'))
);

drop policy if exists boms_manage on public.boms;
create policy boms_manage on public.boms
for all to authenticated
using(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.bom') or public.has_permission('manufacturing.manage'))
)
with check(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.bom') or public.has_permission('manufacturing.manage'))
);

drop policy if exists bom_items_permission on public.bom_items;
drop policy if exists bom_items_select on public.bom_items;
create policy bom_items_select on public.bom_items
for select to authenticated using(
 exists(
  select 1 from public.boms b
  where b.id=bom_items.bom_id
   and public.has_organization_access(b.organization_id)
   and (public.has_permission('manufacturing.view') or public.has_permission('manufacturing.manage'))
 )
);

drop policy if exists bom_items_manage on public.bom_items;
create policy bom_items_manage on public.bom_items
for all to authenticated
using(
 exists(
  select 1 from public.boms b
  where b.id=bom_items.bom_id
   and public.has_organization_access(b.organization_id)
   and (public.has_permission('manufacturing.bom') or public.has_permission('manufacturing.manage'))
 )
)
with check(
 exists(
  select 1 from public.boms b
  where b.id=bom_items.bom_id
   and public.has_organization_access(b.organization_id)
   and (public.has_permission('manufacturing.bom') or public.has_permission('manufacturing.manage'))
 )
);

drop policy if exists production_orders_org_permission on public.production_orders;
drop policy if exists production_orders_select on public.production_orders;
create policy production_orders_select on public.production_orders
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('manufacturing.view') or public.has_permission('manufacturing.manage'))
);

create or replace function public.create_bom(
 p_name text,
 p_output_product_id uuid,
 p_output_quantity numeric,
 p_items jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_bom_id uuid;
 v_item jsonb;
 v_component public.products%rowtype;
 v_output public.products%rowtype;
 v_qty numeric(18,3);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('manufacturing.bom') or public.has_permission('manufacturing.manage')) then
  raise exception 'Permission denied: manufacturing.bom';
 end if;
 if coalesce(trim(p_name),'')='' then raise exception 'BOM name is required'; end if;
 if coalesce(p_output_quantity,0)<=0 then raise exception 'Output quantity must be greater than zero'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one component is required'; end if;

 select * into v_output from public.products
 where id=p_output_product_id and organization_id=v_org and active=true and track_inventory=true;
 if not found then raise exception 'Finished product not found or is not stock-tracked'; end if;

 insert into public.boms(organization_id,output_product_id,name,output_quantity,active)
 values(v_org,p_output_product_id,trim(p_name),p_output_quantity,true)
 returning id into v_bom_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_component from public.products
   where id=(v_item->>'product_id')::uuid and organization_id=v_org and active=true and track_inventory=true;
  if not found then raise exception 'BOM component not found or is not stock-tracked'; end if;
  if v_component.id=p_output_product_id then raise exception 'Finished product cannot also be its own BOM component'; end if;

  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  if v_qty<=0 then raise exception 'Component quantity must be greater than zero'; end if;

  insert into public.bom_items(bom_id,product_id,quantity)
  values(v_bom_id,v_component.id,v_qty);
 end loop;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'bom_created','bom',v_bom_id::text,trim(p_name),
  jsonb_build_object('output_product_id',p_output_product_id,'output_quantity',p_output_quantity));

 return jsonb_build_object('bom_id',v_bom_id,'name',trim(p_name));
end; $$;

revoke all on function public.create_bom(text,uuid,numeric,jsonb) from public;
revoke execute on function public.create_bom(text,uuid,numeric,jsonb) from anon;
grant execute on function public.create_bom(text,uuid,numeric,jsonb) to authenticated;

create or replace function public.create_production_order(
 p_location_id uuid,
 p_bom_id uuid,
 p_planned_quantity numeric,
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_bom public.boms%rowtype;
 v_order_id uuid;
 v_number text;
 v_rule public.approval_rules%rowtype;
 v_requires boolean:=false;
 v_request_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('manufacturing.production') or public.has_permission('manufacturing.manage')) then
  raise exception 'Permission denied: manufacturing.production';
 end if;
 if coalesce(p_planned_quantity,0)<=0 then raise exception 'Planned quantity must be greater than zero'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;

 select * into v_bom from public.boms where id=p_bom_id and organization_id=v_org and active=true;
 if not found then raise exception 'Active BOM not found'; end if;

 select * into v_rule from public.approval_rules
 where organization_id=v_org and rule_type='production_order';
 if found then v_requires:=v_rule.enabled and p_planned_quantity>=v_rule.threshold; end if;

 v_number:='PROD-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.production_orders(
  organization_id,location_id,bom_id,output_product_id,planned_quantity,status,
  created_by,production_number,notes,approval_status
 )
 values(
  v_org,p_location_id,p_bom_id,v_bom.output_product_id,p_planned_quantity,
  case when v_requires then 'pending_approval' else 'planned' end,
  auth.uid(),v_number,p_notes,case when v_requires then 'pending' else 'not_required' end
 )
 returning id into v_order_id;

 if v_requires then
  insert into public.approval_requests(
   organization_id,location_id,request_type,entity_type,entity_id,title,amount,status,requested_by,metadata
  )
  values(
   v_org,p_location_id,'production_order','production_order',v_order_id::text,
   'Approve production order '||v_number,p_planned_quantity,'pending',auth.uid(),
   jsonb_build_object('production_number',v_number,'bom_id',p_bom_id,'planned_quantity',p_planned_quantity)
  )
  returning id into v_request_id;
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'production_order_created','production_order',v_order_id::text,v_number,
  jsonb_build_object('bom_id',p_bom_id,'planned_quantity',p_planned_quantity,'approval_required',v_requires));

 return jsonb_build_object(
  'production_order_id',v_order_id,'production_number',v_number,
  'status',case when v_requires then 'pending_approval' else 'planned' end,
  'approval_required',v_requires,'approval_request_id',v_request_id
 );
end; $$;

revoke all on function public.create_production_order(uuid,uuid,numeric,text) from public;
revoke execute on function public.create_production_order(uuid,uuid,numeric,text) from anon;
grant execute on function public.create_production_order(uuid,uuid,numeric,text) to authenticated;

create or replace function public.start_production_order(p_production_order_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.production_orders%rowtype;
 v_bom public.boms%rowtype;
 v_item record;
 v_required numeric(18,3);
 v_available numeric(18,3);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('manufacturing.production') or public.has_permission('manufacturing.manage')) then raise exception 'Permission denied: manufacturing.production'; end if;

 select * into v_order from public.production_orders where id=p_production_order_id and organization_id=v_org for update;
 if not found then raise exception 'Production order not found'; end if;
 if v_order.status<>'planned' then raise exception 'Only approved/planned production orders can be started'; end if;

 select * into v_bom from public.boms where id=v_order.bom_id and organization_id=v_org;
 if not found then raise exception 'BOM not found'; end if;

 for v_item in
  select bi.product_id,bi.quantity,p.name
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
 loop
  v_required:=round((v_item.quantity/v_bom.output_quantity)*v_order.planned_quantity,3);
  select coalesce(quantity-reserved_quantity,0) into v_available
   from public.stock_balances where product_id=v_item.product_id and location_id=v_order.location_id;
  if coalesce(v_available,0)<v_required then
   raise exception 'Insufficient material %: required %, available %',v_item.name,v_required,coalesce(v_available,0);
  end if;
 end loop;

 update public.production_orders set status='in_progress',started_at=now() where id=v_order.id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,v_order.location_id,auth.uid(),'production_started','production_order',v_order.id::text,v_order.production_number);

 return jsonb_build_object('production_order_id',v_order.id,'production_number',v_order.production_number,'status','in_progress');
end; $$;

revoke all on function public.start_production_order(uuid) from public;
revoke execute on function public.start_production_order(uuid) from anon;
grant execute on function public.start_production_order(uuid) to authenticated;

create or replace function public.complete_production_order(
 p_production_order_id uuid,
 p_actual_output numeric,
 p_waste_quantity numeric default 0,
 p_consumption jsonb default '[]'::jsonb,
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.production_orders%rowtype;
 v_bom public.boms%rowtype;
 v_output public.products%rowtype;
 v_item record;
 v_payload jsonb;
 v_planned numeric(18,3);
 v_actual numeric(18,3);
 v_stock numeric(18,3);
 v_line_cost numeric(18,2);
 v_total_cost numeric(18,2):=0;
 v_unit_cost numeric(18,2):=0;
 v_existing_output_stock numeric(18,3):=0;
 v_new_output_cost numeric(18,2);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('manufacturing.production') or public.has_permission('manufacturing.manage')) then raise exception 'Permission denied: manufacturing.production'; end if;
 if coalesce(p_actual_output,0)<=0 then raise exception 'Actual output must be greater than zero'; end if;
 if coalesce(p_waste_quantity,0)<0 then raise exception 'Waste quantity cannot be negative'; end if;
 if jsonb_typeof(coalesce(p_consumption,'[]'::jsonb))<>'array' then raise exception 'Consumption must be an array'; end if;

 select * into v_order from public.production_orders where id=p_production_order_id and organization_id=v_org for update;
 if not found then raise exception 'Production order not found'; end if;
 if v_order.status not in ('planned','in_progress') then raise exception 'Production order cannot be completed from its current status'; end if;

 select * into v_bom from public.boms where id=v_order.bom_id and organization_id=v_org;
 if not found then raise exception 'BOM not found'; end if;

 select * into v_output from public.products where id=v_order.output_product_id and organization_id=v_org and active=true and track_inventory=true;
 if not found then raise exception 'Finished product not found'; end if;

 for v_item in
  select bi.product_id,bi.quantity,p.name,p.cost_price
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
 loop
  v_planned:=round((v_item.quantity/v_bom.output_quantity)*v_order.planned_quantity,3);
  v_actual:=v_planned;

  select value into v_payload
  from jsonb_array_elements(coalesce(p_consumption,'[]'::jsonb))
  where value->>'product_id'=v_item.product_id::text
  limit 1;

  if v_payload is not null then
   v_actual:=coalesce(nullif(v_payload->>'quantity','')::numeric,v_planned);
  end if;

  if v_actual<0 then raise exception 'Material consumption cannot be negative'; end if;

  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_item.product_id,v_order.location_id,0,0)
   on conflict(product_id,location_id) do nothing;

  select quantity into v_stock from public.stock_balances
   where product_id=v_item.product_id and location_id=v_order.location_id for update;

  if coalesce(v_stock,0)<v_actual then raise exception 'Insufficient material %',v_item.name; end if;

  update public.stock_balances
   set quantity=quantity-v_actual,updated_at=now()
   where product_id=v_item.product_id and location_id=v_order.location_id;

  v_line_cost:=round(v_actual*coalesce(v_item.cost_price,0),2);
  v_total_cost:=v_total_cost+v_line_cost;

  insert into public.production_consumption(
   organization_id,production_order_id,location_id,product_id,planned_quantity,actual_quantity,unit_cost,line_cost
  )
  values(v_org,v_order.id,v_order.location_id,v_item.product_id,v_planned,v_actual,v_item.cost_price,v_line_cost);

  insert into public.stock_movements(
   organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
  )
  values(
   v_org,v_order.location_id,v_item.product_id,'production_consumption',-v_actual,v_item.cost_price,
   'production_order',v_order.id,coalesce(p_notes,v_order.notes),auth.uid()
  );

  v_payload:=null;
 end loop;

 v_unit_cost:=round(v_total_cost/p_actual_output,2);

 insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
  values(v_output.id,v_order.location_id,0,0)
  on conflict(product_id,location_id) do nothing;

 select quantity into v_existing_output_stock
 from public.stock_balances where product_id=v_output.id and location_id=v_order.location_id for update;

 if coalesce(v_existing_output_stock,0)>0 then
  v_new_output_cost:=round(
   ((v_existing_output_stock*v_output.cost_price)+(p_actual_output*v_unit_cost))
   /(v_existing_output_stock+p_actual_output),2
  );
 else
  v_new_output_cost:=v_unit_cost;
 end if;

 update public.stock_balances
  set quantity=quantity+p_actual_output,updated_at=now()
  where product_id=v_output.id and location_id=v_order.location_id;

 update public.products set cost_price=v_new_output_cost,updated_at=now() where id=v_output.id;

 insert into public.production_outputs(
  organization_id,production_order_id,location_id,product_id,output_type,quantity,unit_cost
 )
 values(v_org,v_order.id,v_order.location_id,v_output.id,'finished',p_actual_output,v_unit_cost);

 insert into public.stock_movements(
  organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
 )
 values(
  v_org,v_order.location_id,v_output.id,'production_output',p_actual_output,v_unit_cost,
  'production_order',v_order.id,coalesce(p_notes,v_order.notes),auth.uid()
 );

 update public.production_orders
 set actual_quantity=p_actual_output,
     waste_quantity=coalesce(p_waste_quantity,0),
     total_material_cost=v_total_cost,
     unit_cost=v_unit_cost,
     output_variance=p_actual_output-planned_quantity,
     status='completed',
     completed_at=now(),
     notes=coalesce(p_notes,notes)
 where id=v_order.id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  v_org,v_order.location_id,auth.uid(),'production_completed','production_order',v_order.id::text,v_order.production_number,
  jsonb_build_object(
   'planned_output',v_order.planned_quantity,'actual_output',p_actual_output,
   'waste_quantity',p_waste_quantity,'material_cost',v_total_cost,'unit_cost',v_unit_cost
  )
 );

 return jsonb_build_object(
  'production_order_id',v_order.id,'production_number',v_order.production_number,
  'actual_output',p_actual_output,'material_cost',v_total_cost,'unit_cost',v_unit_cost,
  'output_variance',p_actual_output-v_order.planned_quantity
 );
end; $$;

revoke all on function public.complete_production_order(uuid,numeric,numeric,jsonb,text) from public;
revoke execute on function public.complete_production_order(uuid,numeric,numeric,jsonb,text) from anon;
grant execute on function public.complete_production_order(uuid,numeric,numeric,jsonb,text) to authenticated;

create or replace function public.submit_stock_adjustment(
 p_location_id uuid,
 p_product_id uuid,
 p_quantity_delta numeric,
 p_reason text default 'adjustment',
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_rule public.approval_rules%rowtype;
 v_requires boolean:=false;
 v_request_id uuid;
 v_product public.products%rowtype;
 v_new numeric(18,3);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('inventory.adjust') then raise exception 'Permission denied: inventory.adjust'; end if;
 if coalesce(p_quantity_delta,0)=0 then raise exception 'Quantity change cannot be zero'; end if;

 select * into v_product from public.products
 where id=p_product_id and organization_id=v_org and active=true and track_inventory=true;
 if not found then raise exception 'Product not found or is not stock-tracked'; end if;

 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then
  raise exception 'Location not found';
 end if;

 select * into v_rule from public.approval_rules
 where organization_id=v_org and rule_type='stock_adjustment';
 if found then v_requires:=v_rule.enabled and abs(p_quantity_delta)>=v_rule.threshold; end if;

 if v_requires then
  insert into public.approval_requests(
   organization_id,location_id,request_type,entity_type,entity_id,title,amount,status,requested_by,metadata
  )
  values(
   v_org,p_location_id,'stock_adjustment','product',p_product_id::text,
   'Approve stock adjustment for '||v_product.name,abs(p_quantity_delta),'pending',auth.uid(),
   jsonb_build_object(
    'product_id',p_product_id,'quantity_delta',p_quantity_delta,
    'reason',p_reason,'notes',p_notes
   )
  )
  returning id into v_request_id;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,p_location_id,auth.uid(),'stock_adjustment_requested','approval_request',v_request_id::text,v_product.name,
   jsonb_build_object('product_id',p_product_id,'quantity_delta',p_quantity_delta,'reason',p_reason));

  return jsonb_build_object('status','pending_approval','approval_request_id',v_request_id);
 end if;

 v_new:=public.adjust_stock(p_location_id,p_product_id,p_quantity_delta,p_reason,p_notes);
 return jsonb_build_object('status','posted','new_quantity',v_new);
end; $$;

revoke all on function public.submit_stock_adjustment(uuid,uuid,numeric,text,text) from public;
revoke execute on function public.submit_stock_adjustment(uuid,uuid,numeric,text,text) from anon;
grant execute on function public.submit_stock_adjustment(uuid,uuid,numeric,text,text) to authenticated;

create or replace function public.review_approval_request(
 p_request_id uuid,
 p_decision text,
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
 if p_decision not in ('approved','rejected') then raise exception 'Decision must be approved or rejected'; end if;

 select * into v_req from public.approval_requests
 where id=p_request_id and organization_id=v_org and status='pending' for update;
 if not found then raise exception 'Pending approval request not found'; end if;

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
end; $$;

revoke all on function public.review_approval_request(uuid,text,text) from public;
revoke execute on function public.review_approval_request(uuid,text,text) from anon;
grant execute on function public.review_approval_request(uuid,text,text) to authenticated;

create or replace function public.create_purchase_order(
 p_location_id uuid,p_supplier_id uuid,p_items jsonb,p_due_date date default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_purchase_id uuid; v_number text; v_item jsonb;
 v_product public.products%rowtype; v_qty numeric(18,3); v_cost numeric(18,2); v_line numeric(18,2); v_total numeric(18,2):=0;
 v_rule public.approval_rules%rowtype; v_requires boolean:=false; v_request_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('purchasing.create') then raise exception 'Permission denied: purchasing.create'; end if;
 if p_supplier_id is null then raise exception 'Supplier is required for a purchase order'; end if;
 if not exists(select 1 from public.suppliers where id=p_supplier_id and organization_id=v_org and active=true) then raise exception 'Supplier not found'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one purchase item is required'; end if;

 v_number:='PO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.purchases(
  organization_id,location_id,supplier_id,purchase_number,status,subtotal,tax_amount,total_amount,
  amount_paid,payment_status,due_date,ordered_at,notes,created_by,approval_status
 )
 values(v_org,p_location_id,p_supplier_id,v_number,'draft',0,0,0,0,'unpaid',p_due_date,now(),p_notes,auth.uid(),'not_required')
 returning id into v_purchase_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_product from public.products where id=(v_item->>'product_id')::uuid and organization_id=v_org and active=true;
  if not found then raise exception 'Purchase item product not found'; end if;

  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  v_cost:=coalesce(nullif(v_item->>'unit_cost','')::numeric,v_product.cost_price,0);
  if v_qty<=0 then raise exception 'Purchase quantity must be greater than zero'; end if;
  if v_cost<0 then raise exception 'Purchase cost cannot be negative'; end if;

  v_line:=round(v_qty*v_cost,2); v_total:=v_total+v_line;
  insert into public.purchase_items(purchase_id,product_id,description,quantity,received_quantity,unit_cost,line_total)
   values(v_purchase_id,v_product.id,v_product.name,v_qty,0,v_cost,v_line);
 end loop;

 select * into v_rule from public.approval_rules where organization_id=v_org and rule_type='purchase_order';
 if found then v_requires:=v_rule.enabled and v_total>=v_rule.threshold; end if;

 update public.purchases
 set subtotal=v_total,total_amount=v_total,
     status=case when v_requires then 'pending_approval' else 'ordered' end,
     approval_status=case when v_requires then 'pending' else 'not_required' end,
     updated_at=now()
 where id=v_purchase_id;

 if v_requires then
  insert into public.approval_requests(
   organization_id,location_id,request_type,entity_type,entity_id,title,amount,status,requested_by,metadata
  )
  values(
   v_org,p_location_id,'purchase_order','purchase',v_purchase_id::text,
   'Approve purchase order '||v_number,v_total,'pending',auth.uid(),
   jsonb_build_object('purchase_number',v_number,'supplier_id',p_supplier_id,'total_amount',v_total)
  )
  returning id into v_request_id;
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'purchase_order_created','purchase',v_purchase_id::text,v_number,
  jsonb_build_object('supplier_id',p_supplier_id,'total',v_total,'due_date',p_due_date,'approval_required',v_requires));

 return jsonb_build_object(
  'purchase_id',v_purchase_id,'purchase_number',v_number,'total_amount',v_total,
  'status',case when v_requires then 'pending_approval' else 'ordered' end,
  'approval_required',v_requires,'approval_request_id',v_request_id
 );
end; $$;

revoke all on function public.create_purchase_order(uuid,uuid,jsonb,date,text) from public;
revoke execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text) from anon;
grant execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text) to authenticated;
