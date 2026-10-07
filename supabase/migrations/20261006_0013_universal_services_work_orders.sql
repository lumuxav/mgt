-- MGT Business Suite — Universal Services and Work Orders

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('services.view','Operations','View service jobs','View service catalog, jobs and service history',88),
 ('services.pay','Operations','Receive job payments','Record deposits and payments against service work orders',91)
on conflict(code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','services.view'),
 ('manager','services.manage'),
 ('manager','services.pay'),
 ('employee','services.view'),
 ('cashier','services.pay'),
 ('cashier','services.view')
) as x(role,permission)
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

alter table public.work_orders
 add column if not exists job_number text,
 add column if not exists priority text not null default 'normal',
 add column if not exists scheduled_at timestamptz,
 add column if not exists started_at timestamptz,
 add column if not exists amount_paid numeric(18,2) not null default 0,
 add column if not exists payment_status text not null default 'unpaid',
 add column if not exists final_cost numeric(18,2) not null default 0,
 add column if not exists gross_profit numeric(18,2) not null default 0,
 add column if not exists notes text,
 add column if not exists updated_at timestamptz not null default now();

update public.work_orders
set status=case
  when status in ('open','scheduled','in_progress','on_hold','completed','cancelled') then status
  else 'open'
end,
priority=coalesce(nullif(priority,''),'normal'),
payment_status=case
  when coalesce(final_amount,quoted_amount,0)<=coalesce(amount_paid,0)+0.009 and coalesce(final_amount,quoted_amount,0)>0 then 'paid'
  when coalesce(amount_paid,0)>0 then 'partial'
  else 'unpaid'
end;

alter table public.work_orders drop constraint if exists work_orders_status_check;
alter table public.work_orders add constraint work_orders_status_check
 check(status in ('open','scheduled','in_progress','on_hold','completed','cancelled'));

alter table public.work_orders drop constraint if exists work_orders_priority_check;
alter table public.work_orders add constraint work_orders_priority_check
 check(priority in ('low','normal','high','urgent'));

alter table public.work_orders drop constraint if exists work_orders_payment_status_check;
alter table public.work_orders add constraint work_orders_payment_status_check
 check(payment_status in ('unpaid','partial','paid'));

create unique index if not exists work_orders_org_job_number_idx
 on public.work_orders(organization_id,job_number)
 where job_number is not null;

create table if not exists public.work_order_lines(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 work_order_id uuid not null references public.work_orders(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 line_type text not null check(line_type in ('service','material','labor','other')),
 product_id uuid references public.products(id) on delete set null,
 description text not null,
 quantity numeric(18,3) not null default 1 check(quantity>0),
 unit_price numeric(18,2) not null default 0,
 unit_cost numeric(18,2) not null default 0,
 line_total numeric(18,2) not null default 0,
 cost_total numeric(18,2) not null default 0,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);

create table if not exists public.work_order_assignments(
 work_order_id uuid not null references public.work_orders(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 assigned_by uuid references public.users(id) on delete set null,
 assigned_at timestamptz not null default now(),
 primary key(work_order_id,user_id)
);

create table if not exists public.work_order_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 work_order_id uuid not null references public.work_orders(id) on delete cascade,
 event_type text not null,
 description text,
 metadata jsonb not null default '{}'::jsonb,
 user_id uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);

alter table public.payments
 add column if not exists work_order_id uuid references public.work_orders(id) on delete set null;

create index if not exists work_order_lines_order_idx on public.work_order_lines(work_order_id,created_at);
create index if not exists work_order_lines_product_idx on public.work_order_lines(product_id);
create index if not exists work_order_assignments_user_idx on public.work_order_assignments(user_id,assigned_at desc);
create index if not exists work_order_events_order_idx on public.work_order_events(work_order_id,created_at desc);
create index if not exists work_order_events_user_idx on public.work_order_events(user_id);
create index if not exists payments_work_order_id_idx on public.payments(work_order_id);
create index if not exists work_orders_org_status_idx on public.work_orders(organization_id,status,created_at desc);
create index if not exists work_orders_assigned_to_idx on public.work_orders(assigned_to);

alter table public.work_order_lines enable row level security;
alter table public.work_order_assignments enable row level security;
alter table public.work_order_events enable row level security;

drop policy if exists work_orders_org_permission on public.work_orders;
drop policy if exists work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
  public.has_permission('services.view')
  or public.has_permission('services.manage')
 )
);

drop policy if exists work_order_lines_select on public.work_order_lines;
create policy work_order_lines_select on public.work_order_lines
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
  public.has_permission('services.view')
  or public.has_permission('services.manage')
 )
);

drop policy if exists work_order_assignments_select on public.work_order_assignments;
create policy work_order_assignments_select on public.work_order_assignments
for select to authenticated using(
 exists(
  select 1 from public.work_orders w
  where w.id=work_order_assignments.work_order_id
   and public.has_organization_access(w.organization_id)
   and (public.has_permission('services.view') or public.has_permission('services.manage'))
 )
);

drop policy if exists work_order_events_select on public.work_order_events;
create policy work_order_events_select on public.work_order_events
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
  public.has_permission('services.view')
  or public.has_permission('services.manage')
 )
);

drop policy if exists payments_org_select on public.payments;
create policy payments_org_select on public.payments
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
  public.has_permission('finance.view')
  or public.has_permission('sales.view')
  or public.has_permission('purchasing.view')
  or public.has_permission('services.view')
  or public.has_permission('services.manage')
 )
);

drop policy if exists products_org_select on public.products;
create policy products_org_select on public.products
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
  public.has_permission('catalog.view')
  or public.has_permission('services.view')
  or public.has_permission('services.manage')
  or public.has_permission('manufacturing.view')
  or public.has_permission('manufacturing.manage')
 )
);

create or replace function public.create_service_work_order(
 p_location_id uuid,
 p_customer_id uuid,
 p_title text,
 p_description text default null,
 p_quoted_amount numeric default null,
 p_due_at timestamptz default null,
 p_scheduled_at timestamptz default null,
 p_priority text default 'normal',
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_id uuid;
 v_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage'; end if;
 if coalesce(trim(p_title),'')='' then raise exception 'Job title is required'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org and active=true) then raise exception 'Customer not found'; end if;
 if p_quoted_amount is not null and p_quoted_amount<0 then raise exception 'Quoted amount cannot be negative'; end if;

 v_number:='JOB-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.work_orders(
  organization_id,location_id,customer_id,title,description,status,quoted_amount,due_at,scheduled_at,
  priority,created_by,job_number,notes
 )
 values(
  v_org,p_location_id,p_customer_id,trim(p_title),p_description,
  case when p_scheduled_at is not null then 'scheduled' else 'open' end,
  p_quoted_amount,p_due_at,p_scheduled_at,p_priority,auth.uid(),v_number,p_notes
 )
 returning id into v_id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(
  v_org,v_id,'created','Work order created',
  jsonb_build_object('job_number',v_number,'quoted_amount',p_quoted_amount,'due_at',p_due_at,'scheduled_at',p_scheduled_at,'priority',p_priority),
  auth.uid()
 );

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  v_org,p_location_id,auth.uid(),'work_order_created','work_order',v_id::text,v_number,
  jsonb_build_object('title',p_title,'customer_id',p_customer_id,'quoted_amount',p_quoted_amount)
 );

 return jsonb_build_object('work_order_id',v_id,'job_number',v_number);
end; $$;

revoke all on function public.create_service_work_order(uuid,uuid,text,text,numeric,timestamptz,timestamptz,text,text) from public;
revoke execute on function public.create_service_work_order(uuid,uuid,text,text,numeric,timestamptz,timestamptz,text,text) from anon;
grant execute on function public.create_service_work_order(uuid,uuid,text,text,numeric,timestamptz,timestamptz,text,text) to authenticated;

create or replace function public.assign_work_order_staff(
 p_work_order_id uuid,
 p_user_ids jsonb
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.work_orders%rowtype;
 v_value jsonb;
 v_user_id uuid;
 v_names text[]:=array[]::text[];
 v_name text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage'; end if;
 if jsonb_typeof(coalesce(p_user_ids,'[]'::jsonb))<>'array' then raise exception 'Staff list must be an array'; end if;

 select * into v_order from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status in ('completed','cancelled') then raise exception 'Completed or cancelled jobs cannot be reassigned'; end if;

 delete from public.work_order_assignments where work_order_id=v_order.id;

 for v_value in select value from jsonb_array_elements(coalesce(p_user_ids,'[]'::jsonb)) loop
  v_user_id:=trim(both '"' from v_value::text)::uuid;
  select full_name into v_name from public.users
   where id=v_user_id and organization_id=v_org and active=true;
  if not found then raise exception 'Assigned staff member not found or inactive'; end if;

  insert into public.work_order_assignments(work_order_id,user_id,assigned_by)
   values(v_order.id,v_user_id,auth.uid())
   on conflict(work_order_id,user_id) do nothing;
  v_names:=array_append(v_names,v_name);
 end loop;

 update public.work_orders
 set assigned_to=case when jsonb_array_length(coalesce(p_user_ids,'[]'::jsonb))>0
   then trim(both '"' from (p_user_ids->0)::text)::uuid else null end,
     updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,v_order.id,'assignment_changed','Job staff assignment updated',jsonb_build_object('staff_names',v_names),auth.uid());

 return jsonb_build_object('work_order_id',v_order.id,'assigned_staff',to_jsonb(v_names));
end; $$;

revoke all on function public.assign_work_order_staff(uuid,jsonb) from public;
revoke execute on function public.assign_work_order_staff(uuid,jsonb) from anon;
grant execute on function public.assign_work_order_staff(uuid,jsonb) to authenticated;

create or replace function public.add_work_order_line(
 p_work_order_id uuid,
 p_line_type text,
 p_product_id uuid,
 p_description text,
 p_quantity numeric,
 p_unit_price numeric default null,
 p_unit_cost numeric default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.work_orders%rowtype;
 v_product public.products%rowtype;
 v_description text;
 v_price numeric(18,2);
 v_cost numeric(18,2);
 v_total numeric(18,2);
 v_cost_total numeric(18,2);
 v_stock numeric(18,3);
 v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage'; end if;
 if p_line_type not in ('service','material','labor','other') then raise exception 'Invalid work order line type'; end if;
 if coalesce(p_quantity,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;

 select * into v_order from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status in ('completed','cancelled') then raise exception 'Cannot add charges to a completed or cancelled job'; end if;

 if p_product_id is not null then
  select * into v_product from public.products where id=p_product_id and organization_id=v_org and active=true;
  if not found then raise exception 'Catalog item not found'; end if;
  v_description:=coalesce(nullif(trim(p_description),''),v_product.name);
  v_price:=coalesce(p_unit_price,v_product.selling_price,0);
  v_cost:=coalesce(p_unit_cost,v_product.cost_price,0);
 else
  if coalesce(trim(p_description),'')='' then raise exception 'Description is required for a custom line'; end if;
  v_description:=trim(p_description);
  v_price:=coalesce(p_unit_price,0);
  v_cost:=coalesce(p_unit_cost,0);
 end if;

 if v_price<0 or v_cost<0 then raise exception 'Price and cost cannot be negative'; end if;
 if p_line_type='material' then
  if p_product_id is null then raise exception 'Material lines must use a stock catalog item'; end if;
  if not v_product.track_inventory then raise exception 'Selected material does not track stock'; end if;

  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product.id,v_order.location_id,0,0)
   on conflict(product_id,location_id) do nothing;

  select quantity-reserved_quantity into v_stock from public.stock_balances
   where product_id=v_product.id and location_id=v_order.location_id for update;

  if coalesce(v_stock,0)<p_quantity then raise exception 'Insufficient stock for %',v_product.name; end if;

  update public.stock_balances
   set quantity=quantity-p_quantity,updated_at=now()
   where product_id=v_product.id and location_id=v_order.location_id;
 end if;

 v_total:=round(p_quantity*v_price,2);
 v_cost_total:=round(p_quantity*v_cost,2);

 insert into public.work_order_lines(
  organization_id,work_order_id,location_id,line_type,product_id,description,quantity,
  unit_price,unit_cost,line_total,cost_total,created_by
 )
 values(
  v_org,v_order.id,v_order.location_id,p_line_type,p_product_id,v_description,p_quantity,
  v_price,v_cost,v_total,v_cost_total,auth.uid()
 )
 returning id into v_id;

 if p_line_type='material' then
  insert into public.stock_movements(
   organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
  )
  values(
   v_org,v_order.location_id,v_product.id,'work_order_material',-p_quantity,v_cost,
   'work_order',v_order.id,v_description,auth.uid()
  );
 end if;

 update public.work_orders
 set final_amount=(select coalesce(sum(line_total),0) from public.work_order_lines where work_order_id=v_order.id),
     final_cost=(select coalesce(sum(cost_total),0) from public.work_order_lines where work_order_id=v_order.id),
     gross_profit=(select coalesce(sum(line_total-cost_total),0) from public.work_order_lines where work_order_id=v_order.id),
     updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(
  v_org,v_order.id,'line_added',v_description,
  jsonb_build_object('line_id',v_id,'line_type',p_line_type,'quantity',p_quantity,'unit_price',v_price,'unit_cost',v_cost,'line_total',v_total),
  auth.uid()
 );

 return jsonb_build_object('line_id',v_id,'line_total',v_total,'cost_total',v_cost_total);
end; $$;

revoke all on function public.add_work_order_line(uuid,text,uuid,text,numeric,numeric,numeric) from public;
revoke execute on function public.add_work_order_line(uuid,text,uuid,text,numeric,numeric,numeric) from anon;
grant execute on function public.add_work_order_line(uuid,text,uuid,text,numeric,numeric,numeric) to authenticated;

create or replace function public.remove_work_order_line(p_line_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_line public.work_order_lines%rowtype;
 v_order public.work_orders%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('services.manage') then raise exception 'Permission denied: services.manage'; end if;

 select * into v_line from public.work_order_lines where id=p_line_id and organization_id=v_org for update;
 if not found then raise exception 'Job line not found'; end if;
 select * into v_order from public.work_orders where id=v_line.work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status in ('completed','cancelled') then raise exception 'Cannot remove lines from a completed or cancelled job'; end if;

 if v_line.line_type='material' and v_line.product_id is not null then
  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_line.product_id,v_order.location_id,v_line.quantity,0)
   on conflict(product_id,location_id)
   do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();

  insert into public.stock_movements(
   organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
  )
  values(
   v_org,v_order.location_id,v_line.product_id,'work_order_material_reversal',v_line.quantity,v_line.unit_cost,
   'work_order',v_order.id,'Removed job material line: '||v_line.description,auth.uid()
  );
 end if;

 delete from public.work_order_lines where id=v_line.id;

 update public.work_orders
 set final_amount=(select coalesce(sum(line_total),0) from public.work_order_lines where work_order_id=v_order.id),
     final_cost=(select coalesce(sum(cost_total),0) from public.work_order_lines where work_order_id=v_order.id),
     gross_profit=(select coalesce(sum(line_total-cost_total),0) from public.work_order_lines where work_order_id=v_order.id),
     updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,v_order.id,'line_removed',v_line.description,jsonb_build_object('line_id',v_line.id,'line_type',v_line.line_type),auth.uid());

 return jsonb_build_object('work_order_id',v_order.id,'removed_line_id',v_line.id);
end; $$;

revoke all on function public.remove_work_order_line(uuid) from public;
revoke execute on function public.remove_work_order_line(uuid) from anon;
grant execute on function public.remove_work_order_line(uuid) to authenticated;

create or replace function public.set_work_order_status(
 p_work_order_id uuid,
 p_status text,
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
end; $$;

revoke all on function public.set_work_order_status(uuid,text,text) from public;
revoke execute on function public.set_work_order_status(uuid,text,text) from anon;
grant execute on function public.set_work_order_status(uuid,text,text) to authenticated;

create or replace function public.record_work_order_payment(
 p_work_order_id uuid,
 p_amount numeric,
 p_method text default 'cash',
 p_reference text default null,
 p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
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
 if v_total<=0 then v_total:=coalesce(v_order.final_amount,v_order.quoted_amount,0); end if;
 if v_total<=0 then raise exception 'Add job charges or a quoted amount before receiving payment'; end if;

 select coalesce(sum(case when direction='in' then amount else -amount end),0)
 into v_existing from public.payments where work_order_id=v_order.id;

 if v_existing+p_amount>v_total+0.009 then raise exception 'Payment exceeds job balance'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_order.location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
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
end; $$;

revoke all on function public.record_work_order_payment(uuid,numeric,text,text,text) from public;
revoke execute on function public.record_work_order_payment(uuid,numeric,text,text,text) from anon;
grant execute on function public.record_work_order_payment(uuid,numeric,text,text,text) to authenticated;
