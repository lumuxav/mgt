-- MGT Business Suite — Universal Inventory & Purchasing Operations

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('inventory.transfer','Inventory','Transfer inventory','Transfer stock between business locations',32),
 ('inventory.stocktake','Inventory','Perform stocktakes','Count physical stock and post variances',33),
 ('purchasing.receive','Purchasing','Receive purchases','Receive purchase orders into inventory',65),
 ('purchasing.pay','Purchasing','Pay suppliers','Record and allocate supplier payments',66)
on conflict (code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','inventory.transfer'),
 ('manager','inventory.stocktake'),
 ('manager','purchasing.receive'),
 ('storekeeper','inventory.transfer'),
 ('storekeeper','inventory.stocktake'),
 ('storekeeper','purchasing.receive'),
 ('accountant','purchasing.pay')
) as x(role,permission)
where u.organization_id is not null
on conflict (organization_id,role,permission) do nothing;

alter table public.suppliers
  add column if not exists opening_balance_paid numeric(18,2) not null default 0;

alter table public.purchases
  add column if not exists supplier_invoice_number text,
  add column if not exists due_date date,
  add column if not exists payment_status text not null default 'unpaid'
    check (payment_status in ('unpaid','partial','paid')),
  add column if not exists ordered_at timestamptz,
  add column if not exists received_at timestamptz;

alter table public.purchase_items
  add column if not exists received_quantity numeric(18,3) not null default 0;

alter table public.payments
  add column if not exists purchase_id uuid references public.purchases(id) on delete set null;

update public.purchases
set payment_status=case
 when total_amount<=amount_paid+0.009 then 'paid'
 when amount_paid>0 then 'partial'
 else 'unpaid' end;

update public.purchase_items pi
set received_quantity=pi.quantity
from public.purchases p
where p.id=pi.purchase_id
  and p.status in ('received','completed')
  and pi.received_quantity=0;

create index if not exists payments_purchase_id_idx on public.payments(purchase_id);
create index if not exists purchases_supplier_payment_idx on public.purchases(organization_id,supplier_id,payment_status,created_at);
create index if not exists purchases_due_date_idx on public.purchases(organization_id,due_date) where payment_status<>'paid';

create table if not exists public.stock_transfers(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 from_location_id uuid not null references public.locations(id) on delete restrict,
 to_location_id uuid not null references public.locations(id) on delete restrict,
 transfer_number text not null,
 status text not null default 'completed' check(status in ('completed','cancelled')),
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(organization_id,transfer_number),
 check(from_location_id<>to_location_id)
);

create table if not exists public.stock_transfer_items(
 id uuid primary key default gen_random_uuid(),
 transfer_id uuid not null references public.stock_transfers(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 quantity numeric(18,3) not null check(quantity>0),
 unit_cost numeric(18,2) not null default 0
);

create table if not exists public.stocktakes(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 stocktake_number text not null,
 status text not null default 'completed' check(status in ('completed','cancelled')),
 total_variance_units numeric(18,3) not null default 0,
 total_variance_value numeric(18,2) not null default 0,
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 unique(organization_id,stocktake_number)
);

create table if not exists public.stocktake_items(
 id uuid primary key default gen_random_uuid(),
 stocktake_id uuid not null references public.stocktakes(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 system_quantity numeric(18,3) not null default 0,
 counted_quantity numeric(18,3) not null default 0,
 variance numeric(18,3) not null default 0,
 unit_cost numeric(18,2) not null default 0,
 variance_value numeric(18,2) not null default 0,
 unique(stocktake_id,product_id)
);

create index if not exists stock_transfers_org_date_idx on public.stock_transfers(organization_id,created_at desc);
create index if not exists stock_transfers_from_location_idx on public.stock_transfers(from_location_id,created_at desc);
create index if not exists stock_transfers_to_location_idx on public.stock_transfers(to_location_id,created_at desc);
create index if not exists stock_transfers_created_by_idx on public.stock_transfers(created_by);
create index if not exists stock_transfer_items_transfer_idx on public.stock_transfer_items(transfer_id);
create index if not exists stock_transfer_items_product_idx on public.stock_transfer_items(product_id);
create index if not exists stocktakes_org_date_idx on public.stocktakes(organization_id,created_at desc);
create index if not exists stocktakes_location_idx on public.stocktakes(location_id,created_at desc);
create index if not exists stocktakes_created_by_idx on public.stocktakes(created_by);
create index if not exists stocktake_items_stocktake_idx on public.stocktake_items(stocktake_id);
create index if not exists stocktake_items_product_idx on public.stocktake_items(product_id);

alter table public.stock_transfers enable row level security;
alter table public.stock_transfer_items enable row level security;
alter table public.stocktakes enable row level security;
alter table public.stocktake_items enable row level security;

drop policy if exists stock_transfers_select on public.stock_transfers;
create policy stock_transfers_select on public.stock_transfers
for select to authenticated using(public.has_organization_access(organization_id) and public.has_permission('inventory.view'));

drop policy if exists stock_transfer_items_select on public.stock_transfer_items;
create policy stock_transfer_items_select on public.stock_transfer_items
for select to authenticated using(
 public.has_permission('inventory.view') and exists(
  select 1 from public.stock_transfers t
  where t.id=stock_transfer_items.transfer_id and public.has_organization_access(t.organization_id)
 )
);

drop policy if exists stocktakes_select on public.stocktakes;
create policy stocktakes_select on public.stocktakes
for select to authenticated using(public.has_organization_access(organization_id) and public.has_permission('inventory.view'));

drop policy if exists stocktake_items_select on public.stocktake_items;
create policy stocktake_items_select on public.stocktake_items
for select to authenticated using(
 public.has_permission('inventory.view') and exists(
  select 1 from public.stocktakes s
  where s.id=stocktake_items.stocktake_id and public.has_organization_access(s.organization_id)
 )
);

create or replace function public.transfer_stock(
 p_from_location_id uuid,p_to_location_id uuid,p_items jsonb,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_transfer_id uuid; v_number text; v_item jsonb;
 v_product public.products%rowtype; v_qty numeric(18,3); v_available numeric(18,3);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('inventory.transfer') then raise exception 'Permission denied: inventory.transfer'; end if;
 if p_from_location_id=p_to_location_id then raise exception 'Source and destination must be different'; end if;
 if not exists(select 1 from public.locations where id=p_from_location_id and organization_id=v_org and active=true) then raise exception 'Source location not found'; end if;
 if not exists(select 1 from public.locations where id=p_to_location_id and organization_id=v_org and active=true) then raise exception 'Destination location not found'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one transfer item is required'; end if;

 v_number:='TRF-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.stock_transfers(organization_id,from_location_id,to_location_id,transfer_number,status,notes,created_by)
 values(v_org,p_from_location_id,p_to_location_id,v_number,'completed',p_notes,auth.uid()) returning id into v_transfer_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_product from public.products
   where id=(v_item->>'product_id')::uuid and organization_id=v_org and active=true and track_inventory=true;
  if not found then raise exception 'Transfer product not found or is not stock-tracked'; end if;
  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  if v_qty<=0 then raise exception 'Transfer quantity must be greater than zero'; end if;

  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product.id,p_from_location_id,0,0) on conflict(product_id,location_id) do nothing;
  select quantity-reserved_quantity into v_available from public.stock_balances
   where product_id=v_product.id and location_id=p_from_location_id for update;
  if coalesce(v_available,0)<v_qty then raise exception 'Insufficient available stock for %',v_product.name; end if;

  update public.stock_balances set quantity=quantity-v_qty,updated_at=now()
   where product_id=v_product.id and location_id=p_from_location_id;
  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product.id,p_to_location_id,v_qty,0)
   on conflict(product_id,location_id) do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();

  insert into public.stock_transfer_items(transfer_id,product_id,quantity,unit_cost)
   values(v_transfer_id,v_product.id,v_qty,v_product.cost_price);

  insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
   values
   (v_org,p_from_location_id,v_product.id,'transfer_out',-v_qty,v_product.cost_price,'stock_transfer',v_transfer_id,p_notes,auth.uid()),
   (v_org,p_to_location_id,v_product.id,'transfer_in',v_qty,v_product.cost_price,'stock_transfer',v_transfer_id,p_notes,auth.uid());
 end loop;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_from_location_id,auth.uid(),'stock_transferred','stock_transfer',v_transfer_id::text,v_number,
  jsonb_build_object('from_location_id',p_from_location_id,'to_location_id',p_to_location_id));

 return jsonb_build_object('transfer_id',v_transfer_id,'transfer_number',v_number);
end; $$;

revoke all on function public.transfer_stock(uuid,uuid,jsonb,text) from public;
revoke execute on function public.transfer_stock(uuid,uuid,jsonb,text) from anon;
grant execute on function public.transfer_stock(uuid,uuid,jsonb,text) to authenticated;

create or replace function public.post_stocktake(
 p_location_id uuid,p_items jsonb,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_stocktake_id uuid; v_number text; v_item jsonb;
 v_product public.products%rowtype; v_system numeric(18,3); v_counted numeric(18,3); v_variance numeric(18,3);
 v_units numeric(18,3):=0; v_value numeric(18,2):=0;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('inventory.stocktake') then raise exception 'Permission denied: inventory.stocktake'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one stocktake item is required'; end if;

 v_number:='STK-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.stocktakes(organization_id,location_id,stocktake_number,status,notes,created_by)
 values(v_org,p_location_id,v_number,'completed',p_notes,auth.uid()) returning id into v_stocktake_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_product from public.products
   where id=(v_item->>'product_id')::uuid and organization_id=v_org and active=true and track_inventory=true;
  if not found then raise exception 'Stocktake product not found or not stock-tracked'; end if;

  v_counted:=coalesce(nullif(v_item->>'counted_quantity','')::numeric,-1);
  if v_counted<0 then raise exception 'Counted quantity cannot be negative'; end if;

  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product.id,p_location_id,0,0) on conflict(product_id,location_id) do nothing;
  select quantity into v_system from public.stock_balances
   where product_id=v_product.id and location_id=p_location_id for update;

  v_variance:=v_counted-coalesce(v_system,0);
  v_units:=v_units+v_variance;
  v_value:=v_value+round(v_variance*v_product.cost_price,2);

  insert into public.stocktake_items(stocktake_id,product_id,system_quantity,counted_quantity,variance,unit_cost,variance_value)
   values(v_stocktake_id,v_product.id,coalesce(v_system,0),v_counted,v_variance,v_product.cost_price,round(v_variance*v_product.cost_price,2));

  if abs(v_variance)>0.0009 then
   update public.stock_balances set quantity=v_counted,updated_at=now()
    where product_id=v_product.id and location_id=p_location_id;
   insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
    values(v_org,p_location_id,v_product.id,'stocktake_adjustment',v_variance,v_product.cost_price,'stocktake',v_stocktake_id,p_notes,auth.uid());
  end if;
 end loop;

 update public.stocktakes set total_variance_units=v_units,total_variance_value=v_value where id=v_stocktake_id;
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'stocktake_posted','stocktake',v_stocktake_id::text,v_number,
  jsonb_build_object('variance_units',v_units,'variance_value',v_value));

 return jsonb_build_object('stocktake_id',v_stocktake_id,'stocktake_number',v_number,'variance_units',v_units,'variance_value',v_value);
end; $$;

revoke all on function public.post_stocktake(uuid,jsonb,text) from public;
revoke execute on function public.post_stocktake(uuid,jsonb,text) from anon;
grant execute on function public.post_stocktake(uuid,jsonb,text) to authenticated;

create or replace function public.create_purchase_order(
 p_location_id uuid,p_supplier_id uuid,p_items jsonb,p_due_date date default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_purchase_id uuid; v_number text; v_item jsonb;
 v_product public.products%rowtype; v_qty numeric(18,3); v_cost numeric(18,2); v_line numeric(18,2); v_total numeric(18,2):=0;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('purchasing.create') then raise exception 'Permission denied: purchasing.create'; end if;
 if p_supplier_id is null then raise exception 'Supplier is required for a purchase order'; end if;
 if not exists(select 1 from public.suppliers where id=p_supplier_id and organization_id=v_org and active=true) then raise exception 'Supplier not found'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one purchase item is required'; end if;

 v_number:='PO-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.purchases(organization_id,location_id,supplier_id,purchase_number,status,subtotal,tax_amount,total_amount,amount_paid,payment_status,due_date,ordered_at,notes,created_by)
 values(v_org,p_location_id,p_supplier_id,v_number,'ordered',0,0,0,0,'unpaid',p_due_date,now(),p_notes,auth.uid())
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

 update public.purchases set subtotal=v_total,total_amount=v_total,updated_at=now() where id=v_purchase_id;
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'purchase_order_created','purchase',v_purchase_id::text,v_number,
  jsonb_build_object('supplier_id',p_supplier_id,'total',v_total,'due_date',p_due_date));

 return jsonb_build_object('purchase_id',v_purchase_id,'purchase_number',v_number,'total_amount',v_total);
end; $$;

revoke all on function public.create_purchase_order(uuid,uuid,jsonb,date,text) from public;
revoke execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text) from anon;
grant execute on function public.create_purchase_order(uuid,uuid,jsonb,date,text) to authenticated;

create or replace function public.receive_purchase_order(
 p_purchase_id uuid,p_items jsonb,p_supplier_invoice_number text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_purchase public.purchases%rowtype; v_item jsonb;
 v_line public.purchase_items%rowtype; v_product public.products%rowtype; v_qty numeric(18,3);
 v_remaining numeric(18,3); v_current_stock numeric(18,3); v_new_cost numeric(18,2); v_all_received boolean;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('purchasing.receive') then raise exception 'Permission denied: purchasing.receive'; end if;
 if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one received item is required'; end if;

 select * into v_purchase from public.purchases
 where id=p_purchase_id and organization_id=v_org and status in ('ordered','partial') for update;
 if not found then raise exception 'Open purchase order not found'; end if;

 for v_item in select value from jsonb_array_elements(p_items) loop
  select * into v_line from public.purchase_items
   where id=(v_item->>'purchase_item_id')::uuid and purchase_id=v_purchase.id for update;
  if not found then raise exception 'Purchase order item not found'; end if;
  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  v_remaining:=v_line.quantity-v_line.received_quantity;
  if v_qty<=0 then raise exception 'Received quantity must be greater than zero'; end if;
  if v_qty>v_remaining+0.0009 then raise exception 'Received quantity exceeds outstanding ordered quantity'; end if;

  select * into v_product from public.products where id=v_line.product_id and organization_id=v_org;
  if not found then raise exception 'Product not found'; end if;
  update public.purchase_items set received_quantity=received_quantity+v_qty where id=v_line.id;

  if v_product.track_inventory then
   insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
    values(v_product.id,v_purchase.location_id,0,0) on conflict(product_id,location_id) do nothing;
   select quantity into v_current_stock from public.stock_balances
    where product_id=v_product.id and location_id=v_purchase.location_id for update;

   if coalesce(v_current_stock,0)>0 then
    v_new_cost:=round(((coalesce(v_current_stock,0)*v_product.cost_price)+(v_qty*v_line.unit_cost))/(coalesce(v_current_stock,0)+v_qty),2);
   else v_new_cost:=v_line.unit_cost; end if;

   update public.stock_balances set quantity=quantity+v_qty,updated_at=now()
    where product_id=v_product.id and location_id=v_purchase.location_id;
   update public.products set cost_price=v_new_cost,updated_at=now() where id=v_product.id;

   insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
    values(v_org,v_purchase.location_id,v_product.id,'purchase_receipt',v_qty,v_line.unit_cost,'purchase',v_purchase.id,coalesce(p_notes,v_purchase.notes),auth.uid());
  end if;
 end loop;

 select not exists(select 1 from public.purchase_items where purchase_id=v_purchase.id and received_quantity<quantity-0.0009)
 into v_all_received;

 update public.purchases
 set status=case when v_all_received then 'received' else 'partial' end,
     supplier_invoice_number=coalesce(nullif(trim(p_supplier_invoice_number),''),supplier_invoice_number),
     received_at=case when v_all_received then coalesce(received_at,now()) else received_at end,
     notes=coalesce(p_notes,notes),updated_at=now()
 where id=v_purchase.id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_purchase.location_id,auth.uid(),'purchase_received','purchase',v_purchase.id::text,v_purchase.purchase_number,
  jsonb_build_object('fully_received',v_all_received,'supplier_invoice_number',p_supplier_invoice_number));

 return jsonb_build_object('purchase_id',v_purchase.id,'purchase_number',v_purchase.purchase_number,
  'status',case when v_all_received then 'received' else 'partial' end);
end; $$;

revoke all on function public.receive_purchase_order(uuid,jsonb,text,text) from public;
revoke execute on function public.receive_purchase_order(uuid,jsonb,text,text) from anon;
grant execute on function public.receive_purchase_order(uuid,jsonb,text,text) to authenticated;

create or replace function public.record_supplier_payment(
 p_supplier_id uuid,p_location_id uuid,p_amount numeric,p_method text default 'bank',
 p_reference text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id(); v_supplier public.suppliers%rowtype; v_purchase public.purchases%rowtype;
 v_remaining numeric(18,2):=coalesce(p_amount,0); v_opening_due numeric(18,2); v_opening_apply numeric(18,2);
 v_purchase_due numeric(18,2); v_apply numeric(18,2); v_new_paid numeric(18,2); v_total_due numeric(18,2);
 v_allocations jsonb:='[]'::jsonb;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('purchasing.pay') or public.has_permission('finance.manage')) then raise exception 'Permission denied'; end if;
 if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_supplier from public.suppliers
  where id=p_supplier_id and organization_id=v_org and active=true for update;
 if not found then raise exception 'Supplier not found'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;

 v_opening_due:=greatest(v_supplier.opening_balance-v_supplier.opening_balance_paid,0);
 select v_opening_due+coalesce(sum(greatest(total_amount-amount_paid,0)),0)
 into v_total_due from public.purchases where organization_id=v_org and supplier_id=p_supplier_id;

 if v_remaining>v_total_due+0.009 then raise exception 'Payment exceeds supplier outstanding balance'; end if;

 if v_opening_due>0 and v_remaining>0 then
  v_opening_apply:=least(v_remaining,v_opening_due);
  update public.suppliers set opening_balance_paid=opening_balance_paid+v_opening_apply,updated_at=now() where id=p_supplier_id;
  insert into public.payments(organization_id,location_id,supplier_id,direction,payment_type,method,amount,reference,notes,received_by)
   values(v_org,p_location_id,p_supplier_id,'out','supplier_payment',coalesce(nullif(trim(p_method),''),'bank'),
    v_opening_apply,nullif(trim(p_reference),''),p_notes,auth.uid());
  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','opening_balance','amount',v_opening_apply));
  v_remaining:=v_remaining-v_opening_apply;
 end if;

 for v_purchase in
  select * from public.purchases
  where organization_id=v_org and supplier_id=p_supplier_id and greatest(total_amount-amount_paid,0)>0.009
  order by created_at asc for update
 loop
  exit when v_remaining<=0.009;
  v_purchase_due:=greatest(v_purchase.total_amount-v_purchase.amount_paid,0);
  v_apply:=least(v_remaining,v_purchase_due);
  v_new_paid:=v_purchase.amount_paid+v_apply;

  update public.purchases set amount_paid=v_new_paid,
   payment_status=case when total_amount<=v_new_paid+0.009 then 'paid' else 'partial' end,
   updated_at=now() where id=v_purchase.id;

  insert into public.payments(organization_id,location_id,supplier_id,purchase_id,direction,payment_type,method,amount,reference,notes,received_by)
   values(v_org,p_location_id,p_supplier_id,v_purchase.id,'out','supplier_payment',
    coalesce(nullif(trim(p_method),''),'bank'),v_apply,nullif(trim(p_reference),''),p_notes,auth.uid());

  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','purchase','purchase_id',v_purchase.id,
   'purchase_number',v_purchase.purchase_number,'amount',v_apply));
  v_remaining:=v_remaining-v_apply;
 end loop;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'supplier_payment_recorded','supplier',p_supplier_id::text,'Supplier payment',
  jsonb_build_object('amount',p_amount,'method',p_method,'allocations',v_allocations));

 return jsonb_build_object('amount_paid',p_amount,'remaining_balance',greatest(v_total_due-p_amount,0),'allocations',v_allocations);
end; $$;

revoke all on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) from public;
revoke execute on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) from anon;
grant execute on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) to authenticated;
