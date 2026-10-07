-- MGT Business Suite — security, audit, ownership and rate-limit hardening

revoke all privileges on all tables in schema public from anon;
revoke all privileges on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke execute on functions from public;

revoke insert,update,delete,truncate,references,trigger on public.roles from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.role_permissions from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.staff_invitations from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.organization_modules from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.permission_catalog from authenticated;
revoke all privileges on public.default_role_permission_templates from authenticated;

revoke insert,update,delete,truncate,references,trigger on public.users from authenticated;
grant update(full_name,email,default_location_id,updated_at) on public.users to authenticated;

revoke insert,update,delete,truncate,references,trigger on public.audit_log from authenticated;

revoke insert,update,delete,truncate,references,trigger on public.notifications from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.notification_states from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.notification_preferences from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.notification_delivery_settings from authenticated;
revoke insert,update,delete,truncate,references,trigger on public.notification_deliveries from authenticated;

revoke all privileges on public.integration_api_keys from authenticated;
revoke all privileges on public.webhook_endpoints from authenticated;
revoke all privileges on public.integration_events from authenticated;
revoke all privileges on public.integration_event_deliveries from authenticated;
revoke all privileges on public.notification_dispatch_auth from authenticated;
revoke all privileges on public.payment_provider_connections from authenticated;

drop policy if exists default_role_permission_templates_deny_client on public.default_role_permission_templates;
create policy default_role_permission_templates_deny_client on public.default_role_permission_templates
for all to authenticated using(false) with check(false);

drop policy if exists integration_api_keys_deny_client on public.integration_api_keys;
create policy integration_api_keys_deny_client on public.integration_api_keys
for all to authenticated using(false) with check(false);

drop policy if exists webhook_endpoints_deny_client on public.webhook_endpoints;
create policy webhook_endpoints_deny_client on public.webhook_endpoints
for all to authenticated using(false) with check(false);

drop policy if exists integration_events_deny_client on public.integration_events;
create policy integration_events_deny_client on public.integration_events
for all to authenticated using(false) with check(false);

drop policy if exists integration_event_deliveries_deny_client on public.integration_event_deliveries;
create policy integration_event_deliveries_deny_client on public.integration_event_deliveries
for all to authenticated using(false) with check(false);

drop policy if exists notification_dispatch_auth_deny_client on public.notification_dispatch_auth;
create policy notification_dispatch_auth_deny_client on public.notification_dispatch_auth
for all to authenticated using(false) with check(false);

alter function public.notification_severity_rank(text) set search_path=pg_catalog,public;

create or replace function public.enforce_user_account_protection()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_actor_role text:=public.current_user_role();
  v_jwt_role text:=coalesce(auth.role(),'');
  v_other_active_owners integer:=0;
begin
  if tg_op='DELETE' then
    if old.role='owner' then
      select count(*) into v_other_active_owners
      from public.users
      where organization_id=old.organization_id
        and id<>old.id
        and role='owner'
        and active=true
        and archived_at is null;

      if v_other_active_owners=0 then
        raise exception 'The last active Owner cannot be removed';
      end if;

      if v_jwt_role<>'service_role' and v_actor_role not in ('owner','super_admin','system_admin') then
        raise exception 'Only an Owner can remove another Owner';
      end if;

      if auth.uid()=old.id then
        raise exception 'You cannot remove your own Owner account';
      end if;
    end if;
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
     and old.organization_id is not null
     and v_jwt_role<>'service_role' then
    raise exception 'A staff account cannot be moved to another organization directly';
  end if;

  if auth.uid()=old.id and (
    new.role is distinct from old.role
    or new.active is distinct from old.active
    or new.archived_at is distinct from old.archived_at
    or new.organization_id is distinct from old.organization_id
  ) then
    raise exception 'You cannot change your own role, organization or account status';
  end if;

  if old.role='owner' and (
    new.role is distinct from old.role
    or new.active=false
    or new.archived_at is not null
  ) then
    select count(*) into v_other_active_owners
    from public.users
    where organization_id=old.organization_id
      and id<>old.id
      and role='owner'
      and active=true
      and archived_at is null;

    if v_other_active_owners=0 then
      raise exception 'The last active Owner cannot be disabled, archived or demoted';
    end if;

    if v_jwt_role<>'service_role' and v_actor_role not in ('owner','super_admin','system_admin') then
      raise exception 'Only an Owner can modify another Owner';
    end if;
  end if;

  if new.role='owner' and old.role is distinct from 'owner'
     and v_jwt_role<>'service_role'
     and v_actor_role not in ('owner','super_admin','system_admin') then
    raise exception 'Only an Owner can assign the Owner role';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_user_account_protection() from public;
revoke execute on function public.enforce_user_account_protection() from anon,authenticated;

drop trigger if exists enforce_user_account_protection_trigger on public.users;
create trigger enforce_user_account_protection_trigger
before update or delete on public.users
for each row execute function public.enforce_user_account_protection();

create table if not exists public.api_rate_limits(
  scope text not null,
  key_hash text not null,
  window_started_at timestamptz not null default now(),
  request_count integer not null default 0 check(request_count>=0),
  updated_at timestamptz not null default now(),
  primary key(scope,key_hash)
);

alter table public.api_rate_limits enable row level security;
revoke all privileges on public.api_rate_limits from anon,authenticated;

drop policy if exists api_rate_limits_deny_client on public.api_rate_limits;
create policy api_rate_limits_deny_client on public.api_rate_limits
for all to authenticated using(false) with check(false);

create or replace function public.server_consume_rate_limit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.api_rate_limits%rowtype;
  v_now timestamptz:=clock_timestamp();
  v_window interval;
  v_retry integer:=0;
begin
  if coalesce(trim(p_scope),'')='' or coalesce(trim(p_key_hash),'')='' then
    raise exception 'Rate-limit scope and key are required';
  end if;
  if p_limit<1 or p_limit>10000 then raise exception 'Invalid rate-limit maximum'; end if;
  if p_window_seconds<1 or p_window_seconds>86400 then raise exception 'Invalid rate-limit window'; end if;

  v_window:=make_interval(secs=>p_window_seconds);

  delete from public.api_rate_limits
  where scope=p_scope and updated_at<v_now-interval '2 days';

  select * into v_row
  from public.api_rate_limits
  where scope=p_scope and key_hash=p_key_hash
  for update;

  if not found then
    insert into public.api_rate_limits(scope,key_hash,window_started_at,request_count,updated_at)
    values(p_scope,p_key_hash,v_now,1,v_now);
    return jsonb_build_object('allowed',true,'remaining',greatest(p_limit-1,0),'retry_after',0);
  end if;

  if v_row.window_started_at+v_window<=v_now then
    update public.api_rate_limits
    set window_started_at=v_now,request_count=1,updated_at=v_now
    where scope=p_scope and key_hash=p_key_hash;
    return jsonb_build_object('allowed',true,'remaining',greatest(p_limit-1,0),'retry_after',0);
  end if;

  if v_row.request_count>=p_limit then
    v_retry:=greatest(1,ceil(extract(epoch from ((v_row.window_started_at+v_window)-v_now)))::integer);
    update public.api_rate_limits set updated_at=v_now where scope=p_scope and key_hash=p_key_hash;
    return jsonb_build_object('allowed',false,'remaining',0,'retry_after',v_retry);
  end if;

  update public.api_rate_limits
  set request_count=request_count+1,updated_at=v_now
  where scope=p_scope and key_hash=p_key_hash;

  return jsonb_build_object(
    'allowed',true,
    'remaining',greatest(p_limit-(v_row.request_count+1),0),
    'retry_after',0
  );
end;
$$;

revoke all on function public.server_consume_rate_limit(text,text,integer,integer) from public;
revoke execute on function public.server_consume_rate_limit(text,text,integer,integer) from anon,authenticated;
grant execute on function public.server_consume_rate_limit(text,text,integer,integer) to service_role;

CREATE OR REPLACE FUNCTION public.create_online_order_public(p_store_slug text, p_customer_name text, p_customer_phone text, p_customer_email text, p_delivery_address text, p_fulfillment_method text, p_payment_method text, p_notes text, p_items jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
 if not exists(
  select 1 from public.organization_modules
  where organization_id=v_store.organization_id
    and module_key='ecommerce'
    and enabled=true
 ) then
  raise exception 'This online store is currently unavailable';
 end if;
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
$function$;

revoke all on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) from public;
revoke execute on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) from anon,authenticated;
grant execute on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) to service_role;
