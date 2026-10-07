-- MGT Business Suite — Universal POS & Sales Engine

create table if not exists public.till_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed')),
  opening_cash numeric(18,2) not null default 0 check (opening_cash >= 0),
  expected_cash numeric(18,2),
  counted_cash numeric(18,2),
  variance numeric(18,2),
  opening_notes text,
  closing_notes text,
  opened_at timestamptz not null default now(),
  closed_at timestamptz
);

create index if not exists till_sessions_org_location_idx on public.till_sessions(organization_id, location_id, opened_at desc);
create index if not exists till_sessions_user_idx on public.till_sessions(user_id, opened_at desc);
create unique index if not exists till_sessions_one_open_per_user_location on public.till_sessions(user_id, location_id) where status = 'open';

alter table public.sales
  add column if not exists pricing_mode text not null default 'retail' check (pricing_mode in ('retail','wholesale','custom')),
  add column if not exists refunded_amount numeric(18,2) not null default 0,
  add column if not exists till_session_id uuid references public.till_sessions(id) on delete set null;

alter table public.payments add column if not exists till_session_id uuid references public.till_sessions(id) on delete set null;

create index if not exists sales_till_session_id_idx on public.sales(till_session_id);
create index if not exists payments_till_session_id_idx on public.payments(till_session_id);
create index if not exists sales_customer_balance_idx on public.sales(organization_id, customer_id, payment_status, created_at);
create unique index if not exists products_org_barcode_unique on public.products(organization_id, barcode) where barcode is not null and trim(barcode) <> '';

create table if not exists public.sale_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete restrict,
  customer_id uuid references public.customers(id) on delete set null,
  return_number text not null,
  total_amount numeric(18,2) not null default 0,
  credit_reduction numeric(18,2) not null default 0,
  cash_refund_amount numeric(18,2) not null default 0,
  refund_method text,
  refund_reference text,
  reason text,
  processed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (organization_id, return_number)
);

create index if not exists sale_returns_sale_id_idx on public.sale_returns(sale_id, created_at desc);
create index if not exists sale_returns_customer_id_idx on public.sale_returns(customer_id, created_at desc);
create index if not exists sale_returns_processed_by_idx on public.sale_returns(processed_by);

create table if not exists public.sale_return_items (
  id uuid primary key default gen_random_uuid(),
  return_id uuid not null references public.sale_returns(id) on delete cascade,
  sale_item_id uuid not null references public.sale_items(id) on delete restrict,
  product_id uuid references public.products(id) on delete set null,
  quantity numeric(18,3) not null check (quantity > 0),
  unit_refund numeric(18,2) not null default 0,
  line_total numeric(18,2) not null default 0
);

create index if not exists sale_return_items_return_id_idx on public.sale_return_items(return_id);
create index if not exists sale_return_items_sale_item_id_idx on public.sale_return_items(sale_item_id);
create index if not exists sale_return_items_product_id_idx on public.sale_return_items(product_id);

alter table public.till_sessions enable row level security;
alter table public.sale_returns enable row level security;
alter table public.sale_return_items enable row level security;

drop policy if exists till_sessions_select on public.till_sessions;
create policy till_sessions_select on public.till_sessions for select to authenticated
using (public.has_organization_access(organization_id) and public.has_permission('sales.view'));

drop policy if exists sale_returns_select on public.sale_returns;
create policy sale_returns_select on public.sale_returns for select to authenticated
using (public.has_organization_access(organization_id) and public.has_permission('sales.view'));

drop policy if exists sale_return_items_select on public.sale_return_items;
create policy sale_return_items_select on public.sale_return_items for select to authenticated
using (
  public.has_permission('sales.view')
  and exists (
    select 1 from public.sale_returns r
    where r.id = sale_return_items.return_id
      and public.has_organization_access(r.organization_id)
  )
);

create or replace function public.open_till(p_location_id uuid, p_opening_cash numeric default 0, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_org uuid := public.current_organization_id(); v_id uuid;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.create') then raise exception 'Permission denied: sales.create'; end if;
  if coalesce(p_opening_cash,0) < 0 then raise exception 'Opening cash cannot be negative'; end if;
  if not exists (select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
  if exists (select 1 from public.till_sessions where user_id=auth.uid() and location_id=p_location_id and status='open') then raise exception 'You already have an open till at this location'; end if;
  insert into public.till_sessions(organization_id,location_id,user_id,opening_cash,opening_notes)
  values(v_org,p_location_id,auth.uid(),coalesce(p_opening_cash,0),p_notes) returning id into v_id;
  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,p_location_id,auth.uid(),'till_opened','till_session',v_id::text,'Till opened',jsonb_build_object('opening_cash',coalesce(p_opening_cash,0)));
  return v_id;
end;
$$;

revoke all on function public.open_till(uuid,numeric,text) from public;
revoke execute on function public.open_till(uuid,numeric,text) from anon;
grant execute on function public.open_till(uuid,numeric,text) to authenticated;

create or replace function public.close_till(p_session_id uuid, p_counted_cash numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_organization_id();
  v_session public.till_sessions%rowtype;
  v_cash_in numeric(18,2) := 0;
  v_cash_out numeric(18,2) := 0;
  v_expected numeric(18,2);
  v_variance numeric(18,2);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.create') then raise exception 'Permission denied: sales.create'; end if;
  if coalesce(p_counted_cash,0) < 0 then raise exception 'Counted cash cannot be negative'; end if;

  select * into v_session from public.till_sessions
  where id=p_session_id and organization_id=v_org and user_id=auth.uid() and status='open' for update;
  if not found then raise exception 'Open till session not found'; end if;

  select
    coalesce(sum(case when direction='in' and method='cash' then amount else 0 end),0),
    coalesce(sum(case when direction='out' and method='cash' then amount else 0 end),0)
  into v_cash_in,v_cash_out from public.payments where till_session_id=v_session.id;

  v_expected := v_session.opening_cash + v_cash_in - v_cash_out;
  v_variance := coalesce(p_counted_cash,0) - v_expected;

  update public.till_sessions set status='closed',expected_cash=v_expected,counted_cash=coalesce(p_counted_cash,0),
    variance=v_variance,closing_notes=p_notes,closed_at=now() where id=v_session.id;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,v_session.location_id,auth.uid(),'till_closed','till_session',v_session.id::text,'Till closed',
    jsonb_build_object('opening_cash',v_session.opening_cash,'cash_in',v_cash_in,'cash_out',v_cash_out,'expected_cash',v_expected,'counted_cash',coalesce(p_counted_cash,0),'variance',v_variance));

  return jsonb_build_object('session_id',v_session.id,'opening_cash',v_session.opening_cash,'cash_in',v_cash_in,'cash_out',v_cash_out,'expected_cash',v_expected,'counted_cash',coalesce(p_counted_cash,0),'variance',v_variance);
end;
$$;

revoke all on function public.close_till(uuid,numeric,text) from public;
revoke execute on function public.close_till(uuid,numeric,text) from anon;
grant execute on function public.close_till(uuid,numeric,text) to authenticated;

create or replace function public.post_pos_sale(
  p_location_id uuid, p_customer_id uuid, p_items jsonb, p_payments jsonb default '[]'::jsonb,
  p_discount_amount numeric default 0, p_channel text default 'pos', p_pricing_mode text default 'retail', p_notes text default null
)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_org uuid := public.current_organization_id();
  v_sale_id uuid; v_sale_number text; v_item jsonb; v_payment jsonb; v_product public.products%rowtype;
  v_qty numeric(18,3); v_base_price numeric(18,2); v_price numeric(18,2); v_line_discount numeric(18,2);
  v_line_tax numeric(18,2); v_line_before_discount numeric(18,2); v_line_total numeric(18,2);
  v_subtotal numeric(18,2):=0; v_line_discounts numeric(18,2):=0; v_tax numeric(18,2):=0;
  v_total_discount numeric(18,2); v_total numeric(18,2); v_paid numeric(18,2):=0; v_balance numeric(18,2);
  v_payment_status text; v_stock numeric(18,3); v_till_id uuid; v_customer_limit numeric(18,2);
  v_existing_debt numeric(18,2); v_has_cash boolean:=false; v_method text; v_amount numeric(18,2); v_reference text;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.create') then raise exception 'Permission denied: sales.create'; end if;
  if p_pricing_mode not in ('retail','wholesale','custom') then raise exception 'Invalid pricing mode'; end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one sale item is required'; end if;
  if jsonb_typeof(coalesce(p_payments,'[]'::jsonb)) <> 'array' then raise exception 'Payments must be an array'; end if;
  if not exists (select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
  if p_customer_id is not null and not exists (select 1 from public.customers where id=p_customer_id and organization_id=v_org and active=true) then raise exception 'Customer not found'; end if;

  select id into v_till_id from public.till_sessions
  where organization_id=v_org and location_id=p_location_id and user_id=auth.uid() and status='open'
  order by opened_at desc limit 1;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    v_amount:=coalesce(nullif(v_payment->>'amount','')::numeric,0);
    v_method:=coalesce(nullif(trim(v_payment->>'method'),''),'cash');
    if v_amount<=0 then raise exception 'Payment amounts must be greater than zero'; end if;
    v_paid:=v_paid+v_amount;
    if v_method='cash' then v_has_cash:=true; end if;
  end loop;

  if v_has_cash and v_till_id is null then raise exception 'Open a till before accepting cash'; end if;
  if coalesce(p_discount_amount,0)>0 and not public.has_permission('sales.discount') then raise exception 'Permission denied: sales.discount'; end if;

  v_sale_number:='POS-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

  insert into public.sales(organization_id,location_id,customer_id,sale_number,channel,status,payment_status,subtotal,discount_amount,tax_amount,total_amount,amount_paid,notes,sold_by,pricing_mode,refunded_amount,till_session_id)
  values(v_org,p_location_id,p_customer_id,v_sale_number,coalesce(nullif(trim(p_channel),''),'pos'),'completed','credit',0,0,0,0,0,p_notes,auth.uid(),p_pricing_mode,0,v_till_id)
  returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_product from public.products where id=(v_item->>'product_id')::uuid and organization_id=v_org and active=true;
    if not found then raise exception 'Sale item product not found'; end if;
    v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_qty<=0 then raise exception 'Sale quantity must be greater than zero'; end if;

    if p_pricing_mode='wholesale' then v_base_price:=coalesce(v_product.wholesale_price,v_product.selling_price,0);
    else v_base_price:=coalesce(v_product.selling_price,0); end if;

    v_price:=coalesce(nullif(v_item->>'unit_price','')::numeric,v_base_price);
    v_line_discount:=greatest(coalesce(nullif(v_item->>'discount_amount','')::numeric,0),0);
    if v_price<0 then raise exception 'Sale price cannot be negative'; end if;
    if (v_price<v_base_price or v_line_discount>0 or p_pricing_mode='custom') and not public.has_permission('sales.discount') then raise exception 'Permission denied: sales.discount'; end if;

    v_line_before_discount:=round(v_qty*v_price,2);
    if v_line_discount>v_line_before_discount then raise exception 'Line discount cannot exceed line value'; end if;
    v_line_tax:=round((v_line_before_discount-v_line_discount)*coalesce(v_product.tax_rate,0)/100.0,2);
    v_line_total:=v_line_before_discount-v_line_discount+v_line_tax;
    v_subtotal:=v_subtotal+v_line_before_discount; v_line_discounts:=v_line_discounts+v_line_discount; v_tax:=v_tax+v_line_tax;

    insert into public.sale_items(sale_id,product_id,description,quantity,unit_price,unit_cost,discount_amount,tax_amount,line_total)
    values(v_sale_id,v_product.id,v_product.name,v_qty,v_price,v_product.cost_price,v_line_discount,v_line_tax,v_line_total);

    if v_product.track_inventory then
      insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity) values(v_product.id,p_location_id,0,0) on conflict(product_id,location_id) do nothing;
      select quantity into v_stock from public.stock_balances where product_id=v_product.id and location_id=p_location_id for update;
      if coalesce(v_stock,0)<v_qty then raise exception 'Insufficient stock for %',v_product.name; end if;
      update public.stock_balances set quantity=quantity-v_qty,updated_at=now() where product_id=v_product.id and location_id=p_location_id;
      insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
      values(v_org,p_location_id,v_product.id,'sale',-v_qty,v_product.cost_price,'sale',v_sale_id,p_notes,auth.uid());
    end if;
  end loop;

  if coalesce(p_discount_amount,0)>(v_subtotal-v_line_discounts) then raise exception 'Sale discount cannot exceed sale value'; end if;
  v_total_discount:=v_line_discounts+greatest(coalesce(p_discount_amount,0),0);
  v_total:=greatest(0,v_subtotal-v_total_discount+v_tax);
  if v_paid>v_total+0.009 then raise exception 'Payments cannot exceed sale total'; end if;
  v_balance:=greatest(0,v_total-v_paid);

  if v_balance>0 then
    if p_customer_id is null then raise exception 'Select a customer for partial or credit sales'; end if;
    select credit_limit into v_customer_limit from public.customers where id=p_customer_id and organization_id=v_org for update;
    select coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0) into v_existing_debt
    from public.sales where organization_id=v_org and customer_id=p_customer_id and id<>v_sale_id;
    if coalesce(v_customer_limit,0)<=0 then raise exception 'This customer has no credit limit'; end if;
    if v_existing_debt+v_balance>v_customer_limit+0.009 then raise exception 'Customer credit limit would be exceeded'; end if;
  end if;

  if v_total=0 or v_balance<=0.009 then v_payment_status:='paid';
  elsif v_paid>0 then v_payment_status:='partial'; else v_payment_status:='credit'; end if;

  update public.sales set subtotal=v_subtotal,discount_amount=v_total_discount,tax_amount=v_tax,total_amount=v_total,amount_paid=v_paid,payment_status=v_payment_status,updated_at=now() where id=v_sale_id;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb)) loop
    v_amount:=coalesce(nullif(v_payment->>'amount','')::numeric,0);
    v_method:=coalesce(nullif(trim(v_payment->>'method'),''),'cash');
    v_reference:=nullif(trim(v_payment->>'reference'),'');
    insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
    values(v_org,p_location_id,p_customer_id,v_sale_id,'in','sale',v_method,v_amount,v_reference,p_notes,auth.uid(),v_till_id);
  end loop;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,p_location_id,auth.uid(),'pos_sale_posted','sale',v_sale_id::text,v_sale_number,
    jsonb_build_object('pricing_mode',p_pricing_mode,'subtotal',v_subtotal,'discount',v_total_discount,'tax',v_tax,'total',v_total,'amount_paid',v_paid,'balance',v_balance,'payment_status',v_payment_status));

  return jsonb_build_object('sale_id',v_sale_id,'sale_number',v_sale_number,'subtotal',v_subtotal,'discount_amount',v_total_discount,'tax_amount',v_tax,'total_amount',v_total,'amount_paid',v_paid,'balance_due',v_balance,'payment_status',v_payment_status);
end;
$$;

revoke all on function public.post_pos_sale(uuid,uuid,jsonb,jsonb,numeric,text,text,text) from public;
revoke execute on function public.post_pos_sale(uuid,uuid,jsonb,jsonb,numeric,text,text,text) from anon;
grant execute on function public.post_pos_sale(uuid,uuid,jsonb,jsonb,numeric,text,text,text) to authenticated;

create or replace function public.record_customer_payment(p_customer_id uuid,p_location_id uuid,p_amount numeric,p_method text default 'cash',p_reference text default null,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.current_organization_id(); v_sale public.sales%rowtype; v_remaining numeric(18,2):=coalesce(p_amount,0);
  v_total_debt numeric(18,2):=0; v_apply numeric(18,2); v_outstanding numeric(18,2); v_new_paid numeric(18,2);
  v_till_id uuid; v_allocations jsonb:='[]'::jsonb;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not (public.has_permission('sales.create') or public.has_permission('finance.manage')) then raise exception 'Permission denied'; end if;
  if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;
  if not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org and active=true) then raise exception 'Customer not found'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;

  select coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0) into v_total_debt from public.sales where organization_id=v_org and customer_id=p_customer_id;
  if v_remaining>v_total_debt+0.009 then raise exception 'Payment exceeds customer outstanding balance'; end if;

  select id into v_till_id from public.till_sessions where organization_id=v_org and location_id=p_location_id and user_id=auth.uid() and status='open' order by opened_at desc limit 1;
  if coalesce(nullif(trim(p_method),''),'cash')='cash' and v_till_id is null then raise exception 'Open a till before accepting cash'; end if;

  for v_sale in
    select * from public.sales where organization_id=v_org and customer_id=p_customer_id and greatest(total_amount-refunded_amount-amount_paid,0)>0.009 order by created_at asc for update
  loop
    exit when v_remaining<=0.009;
    v_outstanding:=greatest(v_sale.total_amount-v_sale.refunded_amount-v_sale.amount_paid,0);
    v_apply:=least(v_remaining,v_outstanding); v_new_paid:=v_sale.amount_paid+v_apply;
    update public.sales set amount_paid=v_new_paid,payment_status=case when greatest(total_amount-refunded_amount-v_new_paid,0)<=0.009 then 'paid' else 'partial' end,updated_at=now() where id=v_sale.id;
    insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
    values(v_org,p_location_id,p_customer_id,v_sale.id,'in','debt_payment',coalesce(nullif(trim(p_method),''),'cash'),v_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id);
    v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('sale_id',v_sale.id,'sale_number',v_sale.sale_number,'amount',v_apply));
    v_remaining:=v_remaining-v_apply;
  end loop;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,p_location_id,auth.uid(),'customer_payment_received','customer',p_customer_id::text,'Customer debt payment received',
    jsonb_build_object('amount',p_amount,'method',p_method,'allocations',v_allocations));

  return jsonb_build_object('amount_received',p_amount,'remaining_balance',greatest(v_total_debt-p_amount,0),'allocations',v_allocations);
end;
$$;

revoke all on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) from public;
revoke execute on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) from anon;
grant execute on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) to authenticated;

create or replace function public.process_sale_return(p_sale_id uuid,p_items jsonb,p_refund_method text default 'cash',p_reference text default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_org uuid:=public.current_organization_id(); v_sale public.sales%rowtype; v_item jsonb; v_sale_item public.sale_items%rowtype;
  v_return_id uuid; v_return_number text; v_qty numeric(18,3); v_previously_returned numeric(18,3); v_available numeric(18,3);
  v_sale_items_total numeric(18,2); v_sale_factor numeric(18,8); v_unit_refund numeric(18,2); v_line_refund numeric(18,2);
  v_total_return numeric(18,2):=0; v_outstanding_before numeric(18,2); v_credit_reduction numeric(18,2); v_cash_refund numeric(18,2);
  v_till_id uuid; v_new_refunded numeric(18,2);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.refund') then raise exception 'Permission denied: sales.refund'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one return item is required'; end if;

  select * into v_sale from public.sales where id=p_sale_id and organization_id=v_org for update;
  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status='refunded' then raise exception 'Sale is already fully refunded'; end if;

  select coalesce(sum(line_total),0) into v_sale_items_total from public.sale_items where sale_id=v_sale.id;
  if v_sale_items_total<=0 then raise exception 'Sale has no refundable value'; end if;
  v_sale_factor:=v_sale.total_amount/v_sale_items_total;

  v_return_number:='RET-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
  insert into public.sale_returns(organization_id,location_id,sale_id,customer_id,return_number,total_amount,credit_reduction,cash_refund_amount,refund_method,refund_reference,reason,processed_by)
  values(v_org,v_sale.location_id,v_sale.id,v_sale.customer_id,v_return_number,0,0,0,nullif(trim(p_refund_method),''),nullif(trim(p_reference),''),p_reason,auth.uid())
  returning id into v_return_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    select * into v_sale_item from public.sale_items where id=(v_item->>'sale_item_id')::uuid and sale_id=v_sale.id;
    if not found then raise exception 'Return item does not belong to this sale'; end if;
    v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_qty<=0 then raise exception 'Return quantity must be greater than zero'; end if;

    select coalesce(sum(sri.quantity),0) into v_previously_returned
    from public.sale_return_items sri join public.sale_returns sr on sr.id=sri.return_id
    where sr.sale_id=v_sale.id and sri.sale_item_id=v_sale_item.id;

    v_available:=v_sale_item.quantity-v_previously_returned;
    if v_qty>v_available+0.0009 then raise exception 'Return quantity exceeds quantity available for %',v_sale_item.description; end if;

    v_unit_refund:=round((v_sale_item.line_total/v_sale_item.quantity)*v_sale_factor,2);
    v_line_refund:=round(v_unit_refund*v_qty,2); v_total_return:=v_total_return+v_line_refund;

    insert into public.sale_return_items(return_id,sale_item_id,product_id,quantity,unit_refund,line_total)
    values(v_return_id,v_sale_item.id,v_sale_item.product_id,v_qty,v_unit_refund,v_line_refund);

    if v_sale_item.product_id is not null and exists(select 1 from public.products where id=v_sale_item.product_id and track_inventory=true) then
      insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity) values(v_sale_item.product_id,v_sale.location_id,v_qty,0)
      on conflict(product_id,location_id) do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();
      insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
      values(v_org,v_sale.location_id,v_sale_item.product_id,'sale_return',v_qty,v_sale_item.unit_cost,'sale_return',v_return_id,p_reason,auth.uid());
    end if;
  end loop;

  if v_total_return<=0 then raise exception 'Return value must be greater than zero'; end if;
  if v_sale.refunded_amount+v_total_return>v_sale.total_amount+0.01 then raise exception 'Return value exceeds remaining refundable sale value'; end if;

  v_outstanding_before:=greatest(v_sale.total_amount-v_sale.refunded_amount-v_sale.amount_paid,0);
  v_credit_reduction:=least(v_total_return,v_outstanding_before);
  v_cash_refund:=greatest(v_total_return-v_credit_reduction,0);

  select id into v_till_id from public.till_sessions where organization_id=v_org and location_id=v_sale.location_id and user_id=auth.uid() and status='open' order by opened_at desc limit 1;
  if v_cash_refund>0 and coalesce(nullif(trim(p_refund_method),''),'cash')='cash' and v_till_id is null then raise exception 'Open a till before issuing a cash refund'; end if;

  update public.sale_returns set total_amount=v_total_return,credit_reduction=v_credit_reduction,cash_refund_amount=v_cash_refund where id=v_return_id;

  if v_cash_refund>0 then
    insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
    values(v_org,v_sale.location_id,v_sale.customer_id,v_sale.id,'out','refund',coalesce(nullif(trim(p_refund_method),''),'cash'),v_cash_refund,nullif(trim(p_reference),''),p_reason,auth.uid(),v_till_id);
  end if;

  v_new_refunded:=v_sale.refunded_amount+v_total_return;
  update public.sales set refunded_amount=v_new_refunded,
    status=case when v_new_refunded>=total_amount-0.009 then 'refunded' else 'partially_refunded' end,
    payment_status=case when greatest(total_amount-v_new_refunded-amount_paid,0)<=0.009 then 'paid' when amount_paid>0 then 'partial' else 'credit' end,
    updated_at=now() where id=v_sale.id;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,v_sale.location_id,auth.uid(),'sale_return_processed','sale_return',v_return_id::text,v_return_number,
    jsonb_build_object('sale_id',v_sale.id,'sale_number',v_sale.sale_number,'total_return',v_total_return,'credit_reduction',v_credit_reduction,'cash_refund',v_cash_refund,'refund_method',p_refund_method));

  return jsonb_build_object('return_id',v_return_id,'return_number',v_return_number,'total_return',v_total_return,'credit_reduction',v_credit_reduction,'cash_refund_amount',v_cash_refund);
end;
$$;

revoke all on function public.process_sale_return(uuid,jsonb,text,text,text) from public;
revoke execute on function public.process_sale_return(uuid,jsonb,text,text,text) from anon;
grant execute on function public.process_sale_return(uuid,jsonb,text,text,text) to authenticated;
