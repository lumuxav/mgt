-- MGT Business Suite — Universal e-commerce and online orders

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('ecommerce.view','E-commerce','View e-commerce','View storefronts, online catalog and online orders',140),
 ('ecommerce.manage','E-commerce','Manage storefront','Configure storefronts and publish online products',141),
 ('ecommerce.orders','E-commerce','Manage online orders','Confirm, process and manage online customer orders',142),
 ('ecommerce.fulfill','E-commerce','Fulfill online orders','Prepare, dispatch and complete online orders',143)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission)
values
 ('manager','ecommerce.view'),('manager','ecommerce.manage'),('manager','ecommerce.orders'),('manager','ecommerce.fulfill'),
 ('salesperson','ecommerce.view'),('salesperson','ecommerce.orders'),
 ('storekeeper','ecommerce.view'),('storekeeper','ecommerce.fulfill'),
 ('cashier','ecommerce.view'),('cashier','ecommerce.orders')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true
from public.organizations o
cross join (values
 ('owner','ecommerce.view'),('owner','ecommerce.manage'),('owner','ecommerce.orders'),('owner','ecommerce.fulfill'),
 ('admin','ecommerce.view'),('admin','ecommerce.manage'),('admin','ecommerce.orders'),('admin','ecommerce.fulfill'),
 ('manager','ecommerce.view'),('manager','ecommerce.manage'),('manager','ecommerce.orders'),('manager','ecommerce.fulfill'),
 ('salesperson','ecommerce.view'),('salesperson','ecommerce.orders'),
 ('storekeeper','ecommerce.view'),('storekeeper','ecommerce.fulfill'),
 ('cashier','ecommerce.view'),('cashier','ecommerce.orders')
) as x(role,permission)
on conflict(organization_id,role,permission) do update set allowed=true;

create table if not exists public.storefronts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete restrict,
 name text not null,
 slug text not null,
 headline text,
 description text,
 contact_phone text,
 contact_email text,
 currency text not null default 'UGX',
 delivery_fee numeric(18,2) not null default 0 check(delivery_fee>=0),
 allow_pickup boolean not null default true,
 allow_delivery boolean not null default true,
 active boolean not null default true,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 check(slug ~ '^[a-z0-9][a-z0-9-]{2,63}$')
);
create unique index if not exists storefronts_slug_unique on public.storefronts(lower(slug));
create index if not exists storefronts_org_idx on public.storefronts(organization_id,active);

create table if not exists public.storefront_products(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 storefront_id uuid not null references public.storefronts(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 published boolean not null default true,
 featured boolean not null default false,
 title_override text,
 description text,
 image_url text,
 price_override numeric(18,2) check(price_override is null or price_override>=0),
 max_per_order numeric(18,3) check(max_per_order is null or max_per_order>0),
 sort_order integer not null default 0,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(storefront_id,product_id)
);
create index if not exists storefront_products_org_idx on public.storefront_products(organization_id,published);

create table if not exists public.online_orders(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 storefront_id uuid not null references public.storefronts(id) on delete restrict,
 location_id uuid not null references public.locations(id) on delete restrict,
 customer_id uuid references public.customers(id) on delete set null,
 order_number text not null,
 status text not null default 'pending' check(status in ('pending','confirmed','processing','ready','dispatched','completed','cancelled')),
 payment_status text not null default 'unpaid' check(payment_status in ('unpaid','pending','paid','refunded')),
 payment_method text,
 payment_reference text,
 customer_name text not null,
 customer_phone text not null,
 customer_email text,
 delivery_address text,
 fulfillment_method text not null default 'pickup' check(fulfillment_method in ('pickup','delivery')),
 subtotal numeric(18,2) not null default 0,
 tax_amount numeric(18,2) not null default 0,
 delivery_fee numeric(18,2) not null default 0,
 total_amount numeric(18,2) not null default 0,
 notes text,
 sale_id uuid references public.sales(id) on delete set null,
 delivery_id uuid references public.deliveries(id) on delete set null,
 confirmed_by uuid references public.users(id) on delete set null,
 completed_by uuid references public.users(id) on delete set null,
 cancelled_by uuid references public.users(id) on delete set null,
 confirmed_at timestamptz,
 completed_at timestamptz,
 cancelled_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,order_number)
);
create index if not exists online_orders_org_status_idx on public.online_orders(organization_id,status,created_at desc);

create table if not exists public.online_order_items(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 order_id uuid not null references public.online_orders(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete restrict,
 description text not null,
 quantity numeric(18,3) not null check(quantity>0),
 unit_price numeric(18,2) not null check(unit_price>=0),
 unit_cost numeric(18,2) not null default 0,
 tax_rate numeric(7,4) not null default 0,
 tax_amount numeric(18,2) not null default 0,
 line_total numeric(18,2) not null default 0,
 created_at timestamptz not null default now()
);

alter table public.storefronts enable row level security;
alter table public.storefront_products enable row level security;
alter table public.online_orders enable row level security;
alter table public.online_order_items enable row level security;

create policy storefronts_select on public.storefronts for select to authenticated using(
 public.has_organization_access(organization_id) and
 (public.has_permission('ecommerce.view') or public.has_permission('ecommerce.manage') or public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill'))
);
create policy storefronts_manage_insert on public.storefronts for insert to authenticated with check(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
);
create policy storefronts_manage_update on public.storefronts for update to authenticated using(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
) with check(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
);

create policy storefront_products_select on public.storefront_products for select to authenticated using(
 public.has_organization_access(organization_id) and
 (public.has_permission('ecommerce.view') or public.has_permission('ecommerce.manage') or public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill'))
);
create policy storefront_products_manage_insert on public.storefront_products for insert to authenticated with check(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
);
create policy storefront_products_manage_update on public.storefront_products for update to authenticated using(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
) with check(
 public.has_organization_access(organization_id) and public.has_permission('ecommerce.manage')
);

create policy online_orders_select on public.online_orders for select to authenticated using(
 public.has_organization_access(organization_id) and
 (public.has_permission('ecommerce.view') or public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill') or public.has_permission('ecommerce.manage'))
);
create policy online_order_items_select on public.online_order_items for select to authenticated using(
 public.has_organization_access(organization_id) and
 (public.has_permission('ecommerce.view') or public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill') or public.has_permission('ecommerce.manage'))
);

create or replace function public.create_online_order_public(
 p_store_slug text,
 p_customer_name text,
 p_customer_phone text,
 p_customer_email text,
 p_delivery_address text,
 p_fulfillment_method text,
 p_payment_method text,
 p_notes text,
 p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_store public.storefronts%rowtype;
 v_item jsonb;
 v_listing public.storefront_products%rowtype;
 v_product public.products%rowtype;
 v_order_id uuid;
 v_order_number text;
 v_qty numeric(18,3);
 v_available numeric(18,3);
 v_price numeric(18,2);
 v_tax numeric(18,2);
 v_line numeric(18,2);
 v_subtotal numeric(18,2):=0;
 v_tax_total numeric(18,2):=0;
 v_delivery numeric(18,2):=0;
 v_total numeric(18,2):=0;
 v_fulfillment text:=coalesce(nullif(trim(p_fulfillment_method),''),'pickup');
begin
 if coalesce(trim(p_customer_name),'')='' then raise exception 'Customer name is required'; end if;
 if coalesce(trim(p_customer_phone),'')='' then raise exception 'Customer phone is required'; end if;
 if v_fulfillment not in ('pickup','delivery') then raise exception 'Invalid fulfillment method'; end if;
 if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Your cart is empty'; end if;

 select * into v_store from public.storefronts
 where lower(slug)=lower(trim(p_store_slug)) and active=true
 limit 1 for update;
 if not found then raise exception 'Storefront not found or unavailable'; end if;
 if v_fulfillment='pickup' and not v_store.allow_pickup then raise exception 'Pickup is not available'; end if;
 if v_fulfillment='delivery' and not v_store.allow_delivery then raise exception 'Delivery is not available'; end if;
 if v_fulfillment='delivery' and coalesce(trim(p_delivery_address),'')='' then raise exception 'Delivery address is required'; end if;

 v_order_number:='WEB-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.online_orders(
  organization_id,storefront_id,location_id,order_number,status,payment_status,payment_method,
  customer_name,customer_phone,customer_email,delivery_address,fulfillment_method,notes
 ) values(
  v_store.organization_id,v_store.id,v_store.location_id,v_order_number,'pending',
  case when coalesce(trim(p_payment_method),'')='' or lower(trim(p_payment_method)) in ('cash','cash_on_delivery') then 'unpaid' else 'pending' end,
  nullif(trim(p_payment_method),''),trim(p_customer_name),trim(p_customer_phone),nullif(trim(p_customer_email),''),
  nullif(trim(p_delivery_address),''),v_fulfillment,nullif(trim(p_notes),'')
 ) returning id into v_order_id;

 for v_item in select value from jsonb_array_elements(p_items) loop
  v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
  if v_qty<=0 then raise exception 'Order quantities must be greater than zero'; end if;

  select * into v_listing from public.storefront_products
  where storefront_id=v_store.id and product_id=(v_item->>'product_id')::uuid
    and organization_id=v_store.organization_id and published=true
  for update;
  if not found then raise exception 'One of the selected products is no longer available online'; end if;
  if v_listing.max_per_order is not null and v_qty>v_listing.max_per_order then raise exception 'Order quantity exceeds the allowed maximum'; end if;

  select * into v_product from public.products
  where id=v_listing.product_id and organization_id=v_store.organization_id and active=true
  for update;
  if not found then raise exception 'One of the selected products is unavailable'; end if;

  if v_product.track_inventory then
   insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
   values(v_product.id,v_store.location_id,0,0)
   on conflict(product_id,location_id) do nothing;

   select quantity-reserved_quantity into v_available
   from public.stock_balances
   where product_id=v_product.id and location_id=v_store.location_id
   for update;

   if coalesce(v_available,0)<v_qty then raise exception 'Insufficient stock for %',v_product.name; end if;

   update public.stock_balances
   set reserved_quantity=reserved_quantity+v_qty,updated_at=now()
   where product_id=v_product.id and location_id=v_store.location_id;
  end if;

  v_price:=coalesce(v_listing.price_override,v_product.selling_price,0);
  v_tax:=round(v_qty*v_price*coalesce(v_product.tax_rate,0)/100.0,2);
  v_line:=round(v_qty*v_price,2)+v_tax;
  v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  v_tax_total:=v_tax_total+v_tax;

  insert into public.online_order_items(
   organization_id,order_id,product_id,description,quantity,unit_price,unit_cost,tax_rate,tax_amount,line_total
  ) values(
   v_store.organization_id,v_order_id,v_product.id,coalesce(nullif(trim(v_listing.title_override),''),v_product.name),
   v_qty,v_price,coalesce(v_product.cost_price,0),coalesce(v_product.tax_rate,0),v_tax,v_line
  );
 end loop;

 v_delivery:=case when v_fulfillment='delivery' then coalesce(v_store.delivery_fee,0) else 0 end;
 v_total:=round(v_subtotal+v_tax_total+v_delivery,2);

 update public.online_orders
 set subtotal=v_subtotal,tax_amount=v_tax_total,delivery_fee=v_delivery,total_amount=v_total,updated_at=now()
 where id=v_order_id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_store.organization_id,v_store.location_id,null,'online_order_created','online_order',v_order_id::text,v_order_number,
 jsonb_build_object('customer_name',trim(p_customer_name),'total_amount',v_total,'fulfillment_method',v_fulfillment));

 return jsonb_build_object('order_id',v_order_id,'order_number',v_order_number,'total_amount',v_total,'currency',v_store.currency,'status','pending');
end;
$$;

revoke all on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) from public;
grant execute on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) to service_role;

create or replace function public.transition_online_order(p_order_id uuid,p_status text)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.online_orders%rowtype;
 v_line public.online_order_items%rowtype;
 v_product public.products%rowtype;
 v_customer_id uuid;
 v_sale_id uuid;
 v_sale_number text;
 v_delivery_id uuid;
 v_delivery_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill') or public.has_permission('ecommerce.manage')) then raise exception 'Permission denied: ecommerce.orders'; end if;
 if p_status not in ('confirmed','processing','ready','dispatched','completed','cancelled') then raise exception 'Invalid online order status'; end if;

 select * into v_order from public.online_orders where id=p_order_id and organization_id=v_org for update;
 if not found then raise exception 'Online order not found'; end if;
 if v_order.status in ('completed','cancelled') then raise exception 'Completed or cancelled orders cannot be changed'; end if;

 if p_status='cancelled' then
  if v_order.sale_id is not null then raise exception 'Orders already converted to sales cannot be cancelled here'; end if;
  for v_line in select * from public.online_order_items where order_id=v_order.id loop
   select * into v_product from public.products where id=v_line.product_id;
   if found and v_product.track_inventory then
    update public.stock_balances set reserved_quantity=greatest(reserved_quantity-v_line.quantity,0),updated_at=now()
    where product_id=v_line.product_id and location_id=v_order.location_id;
   end if;
  end loop;
  update public.online_orders set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),updated_at=now() where id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'status','cancelled');
 end if;

 if p_status<>'completed' then
  update public.online_orders
  set status=p_status,confirmed_by=coalesce(confirmed_by,auth.uid()),confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
  where id=v_order.id;
  return jsonb_build_object('order_id',v_order.id,'status',p_status);
 end if;

 select id into v_customer_id
 from public.customers
 where organization_id=v_org and active=true and
 ((v_order.customer_phone is not null and phone=v_order.customer_phone) or
  (v_order.customer_email is not null and lower(email)=lower(v_order.customer_email)))
 order by created_at limit 1;

 if v_customer_id is null then
  insert into public.customers(organization_id,name,phone,email,address,customer_group,notes)
  values(v_org,v_order.customer_name,v_order.customer_phone,v_order.customer_email,v_order.delivery_address,'Online','Created from e-commerce order')
  returning id into v_customer_id;
 end if;

 v_sale_number:='WEB-SALE-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

 insert into public.sales(
  organization_id,location_id,customer_id,sale_number,channel,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,notes,sold_by
 ) values(
  v_org,v_order.location_id,v_customer_id,v_sale_number,'ecommerce','completed',
  case when v_order.payment_status='paid' then 'paid' else 'credit' end,
  v_order.subtotal,0,v_order.tax_amount,v_order.total_amount,
  case when v_order.payment_status='paid' then v_order.total_amount else 0 end,
  'Online order '||v_order.order_number,auth.uid()
 ) returning id into v_sale_id;

 for v_line in select * from public.online_order_items where order_id=v_order.id order by created_at loop
  select * into v_product from public.products where id=v_line.product_id and organization_id=v_org for update;
  if not found then raise exception 'Order product no longer exists'; end if;

  if v_product.track_inventory then
   if not exists(select 1 from public.stock_balances where product_id=v_line.product_id and location_id=v_order.location_id and quantity>=v_line.quantity)
   then raise exception 'Insufficient stock to complete order for %',v_product.name; end if;

   update public.stock_balances
   set quantity=quantity-v_line.quantity,reserved_quantity=greatest(reserved_quantity-v_line.quantity,0),updated_at=now()
   where product_id=v_line.product_id and location_id=v_order.location_id;

   insert into public.stock_movements(
    organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
   ) values(v_org,v_order.location_id,v_line.product_id,'ecommerce_sale',-v_line.quantity,v_line.unit_cost,'sale',v_sale_id,'Online order '||v_order.order_number,auth.uid());
  end if;

  insert into public.sale_items(sale_id,product_id,description,quantity,unit_price,unit_cost,discount_amount,tax_amount,line_total)
  values(v_sale_id,v_line.product_id,v_line.description,v_line.quantity,v_line.unit_price,v_line.unit_cost,0,v_line.tax_amount,v_line.line_total);
 end loop;

 if v_order.payment_status='paid' then
  insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by)
  values(v_org,v_order.location_id,v_customer_id,v_sale_id,'in','sale',coalesce(v_order.payment_method,'online'),v_order.total_amount,v_order.payment_reference,'Online order payment',auth.uid());
 end if;

 if v_order.fulfillment_method='delivery' and coalesce(trim(v_order.delivery_address),'')<>'' then
  v_delivery_number:='DLV-WEB-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.deliveries(
   organization_id,delivery_number,source_location_id,customer_id,sale_id,status,destination,contact_name,contact_phone,package_description,created_by
  ) values(v_org,v_delivery_number,v_order.location_id,v_customer_id,v_sale_id,'pending',v_order.delivery_address,v_order.customer_name,v_order.customer_phone,'Online order '||v_order.order_number,auth.uid())
  returning id into v_delivery_id;
 end if;

 update public.online_orders
 set customer_id=v_customer_id,sale_id=v_sale_id,delivery_id=v_delivery_id,status='completed',
     completed_by=auth.uid(),completed_at=now(),confirmed_by=coalesce(confirmed_by,auth.uid()),
     confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
 where id=v_order.id;

 return jsonb_build_object('order_id',v_order.id,'status','completed','sale_id',v_sale_id,'sale_number',v_sale_number,'delivery_id',v_delivery_id);
end;
$$;

revoke all on function public.transition_online_order(uuid,text) from public;
grant execute on function public.transition_online_order(uuid,text) to authenticated;

create or replace function public.record_online_order_payment(p_order_id uuid,p_method text,p_reference text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.online_orders%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.manage') or public.has_permission('finance.manage')) then raise exception 'Permission denied: ecommerce.orders'; end if;

 select * into v_order from public.online_orders where id=p_order_id and organization_id=v_org for update;
 if not found then raise exception 'Online order not found'; end if;
 if v_order.status='cancelled' then raise exception 'Cancelled orders cannot be paid'; end if;
 if v_order.payment_status='paid' then raise exception 'Order is already marked paid'; end if;

 update public.online_orders
 set payment_status='paid',payment_method=coalesce(nullif(trim(p_method),''),'online'),payment_reference=nullif(trim(p_reference),''),updated_at=now()
 where id=v_order.id;

 if v_order.sale_id is not null then
  insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by)
  values(v_org,v_order.location_id,v_order.customer_id,v_order.sale_id,'in','sale',coalesce(nullif(trim(p_method),''),'online'),v_order.total_amount,nullif(trim(p_reference),''),'Online order payment',auth.uid());

  update public.sales set amount_paid=v_order.total_amount,payment_status='paid',updated_at=now()
  where id=v_order.sale_id and organization_id=v_org;
 end if;

 return jsonb_build_object('order_id',v_order.id,'payment_status','paid','amount',v_order.total_amount);
end;
$$;

revoke all on function public.record_online_order_payment(uuid,text,text) from public;
grant execute on function public.record_online_order_payment(uuid,text,text) to authenticated;
