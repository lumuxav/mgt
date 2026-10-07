-- MGT Business Suite — Atomic posting functions
-- Apply after 20261004_0001_universal_core.sql on the NEW universal Supabase project.

alter table public.payments
  add column if not exists supplier_id uuid references public.suppliers(id) on delete set null;

create index if not exists payments_supplier_id_idx on public.payments(supplier_id);

create or replace function public.adjust_stock(
  p_location_id uuid,
  p_product_id uuid,
  p_quantity_delta numeric,
  p_reason text default 'adjustment',
  p_notes text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_organization_id();
  v_product public.products%rowtype;
  v_location public.locations%rowtype;
  v_current numeric(18,3) := 0;
  v_new numeric(18,3);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if p_quantity_delta = 0 then raise exception 'Quantity change cannot be zero'; end if;

  select * into v_product from public.products where id = p_product_id and organization_id = v_org and active = true;
  if not found then raise exception 'Product not found'; end if;
  if not v_product.track_inventory then raise exception 'This item does not track inventory'; end if;

  select * into v_location from public.locations where id = p_location_id and organization_id = v_org and active = true;
  if not found then raise exception 'Location not found'; end if;

  insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
  values (p_product_id, p_location_id, 0, 0)
  on conflict (product_id, location_id) do nothing;

  select quantity into v_current
  from public.stock_balances
  where product_id = p_product_id and location_id = p_location_id
  for update;

  v_new := coalesce(v_current, 0) + p_quantity_delta;
  if v_new < 0 then raise exception 'Insufficient stock'; end if;

  update public.stock_balances
  set quantity = v_new, updated_at = now()
  where product_id = p_product_id and location_id = p_location_id;

  insert into public.stock_movements(
    organization_id, location_id, product_id, movement_type, quantity,
    unit_cost, reference_type, notes, recorded_by
  )
  values (
    v_org, p_location_id, p_product_id, coalesce(nullif(p_reason,''),'adjustment'),
    p_quantity_delta, v_product.cost_price, 'manual_adjustment', p_notes, auth.uid()
  );

  insert into public.audit_log(organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata)
  values (
    v_org, p_location_id, auth.uid(), 'stock_adjusted', 'product', p_product_id::text,
    coalesce(p_reason,'adjustment'),
    jsonb_build_object('quantity_delta', p_quantity_delta, 'new_quantity', v_new)
  );

  return v_new;
end;
$$;

revoke all on function public.adjust_stock(uuid,uuid,numeric,text,text) from public;
grant execute on function public.adjust_stock(uuid,uuid,numeric,text,text) to authenticated;

create or replace function public.post_sale(
  p_location_id uuid,
  p_customer_id uuid,
  p_items jsonb,
  p_amount_paid numeric default 0,
  p_payment_method text default 'cash',
  p_discount_amount numeric default 0,
  p_tax_amount numeric default 0,
  p_channel text default 'sale',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_organization_id();
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(18,3);
  v_price numeric(18,2);
  v_line numeric(18,2);
  v_subtotal numeric(18,2) := 0;
  v_total numeric(18,2);
  v_current numeric(18,3);
  v_status text;
begin
  if v_org is null then raise exception 'Active organization required'; end if;

  if not exists (select 1 from public.locations where id = p_location_id and organization_id = v_org and active = true) then
    raise exception 'Location not found';
  end if;

  if p_customer_id is not null and not exists (select 1 from public.customers where id = p_customer_id and organization_id = v_org) then
    raise exception 'Customer not found';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one sale item is required';
  end if;

  v_sale_number := 'S-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS');

  insert into public.sales(
    organization_id, location_id, customer_id, sale_number, channel,
    status, payment_status, subtotal, discount_amount, tax_amount,
    total_amount, amount_paid, notes, sold_by
  )
  values (
    v_org, p_location_id, p_customer_id, v_sale_number, coalesce(nullif(p_channel,''),'sale'),
    'completed', 'credit', 0, greatest(coalesce(p_discount_amount,0),0), greatest(coalesce(p_tax_amount,0),0),
    0, greatest(coalesce(p_amount_paid,0),0), p_notes, auth.uid()
  )
  returning id into v_sale_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and organization_id = v_org
      and active = true;

    if not found then raise exception 'Sale item product not found'; end if;

    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    if v_qty <= 0 then raise exception 'Sale quantity must be greater than zero'; end if;

    v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_product.selling_price, 0);
    if v_price < 0 then raise exception 'Sale price cannot be negative'; end if;

    v_line := round(v_qty * v_price, 2);
    v_subtotal := v_subtotal + v_line;

    insert into public.sale_items(
      sale_id, product_id, description, quantity, unit_price, unit_cost, line_total
    )
    values (
      v_sale_id, v_product.id, v_product.name, v_qty, v_price, v_product.cost_price, v_line
    );

    if v_product.track_inventory then
      insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
      values (v_product.id, p_location_id, 0, 0)
      on conflict (product_id, location_id) do nothing;

      select quantity into v_current
      from public.stock_balances
      where product_id = v_product.id and location_id = p_location_id
      for update;

      if coalesce(v_current,0) < v_qty then
        raise exception 'Insufficient stock for %', v_product.name;
      end if;

      update public.stock_balances
      set quantity = quantity - v_qty, updated_at = now()
      where product_id = v_product.id and location_id = p_location_id;

      insert into public.stock_movements(
        organization_id, location_id, product_id, movement_type, quantity,
        unit_cost, reference_type, reference_id, notes, recorded_by
      )
      values (
        v_org, p_location_id, v_product.id, 'sale', -v_qty,
        v_product.cost_price, 'sale', v_sale_id, p_notes, auth.uid()
      );
    end if;
  end loop;

  v_total := greatest(0, v_subtotal - greatest(coalesce(p_discount_amount,0),0) + greatest(coalesce(p_tax_amount,0),0));

  if coalesce(p_amount_paid,0) >= v_total and v_total > 0 then v_status := 'paid';
  elsif coalesce(p_amount_paid,0) > 0 then v_status := 'partial';
  else v_status := 'credit';
  end if;

  update public.sales
  set subtotal = v_subtotal,
      total_amount = v_total,
      amount_paid = least(greatest(coalesce(p_amount_paid,0),0), v_total),
      payment_status = v_status,
      updated_at = now()
  where id = v_sale_id;

  if coalesce(p_amount_paid,0) > 0 then
    insert into public.payments(
      organization_id, location_id, customer_id, sale_id, direction,
      payment_type, method, amount, notes, received_by
    )
    values (
      v_org, p_location_id, p_customer_id, v_sale_id, 'in',
      'sale', coalesce(nullif(p_payment_method,''),'cash'),
      least(greatest(p_amount_paid,0), v_total), p_notes, auth.uid()
    );
  end if;

  insert into public.audit_log(organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata)
  values (
    v_org, p_location_id, auth.uid(), 'sale_posted', 'sale', v_sale_id::text,
    v_sale_number,
    jsonb_build_object('subtotal', v_subtotal, 'total', v_total, 'amount_paid', least(greatest(coalesce(p_amount_paid,0),0), v_total))
  );

  return v_sale_id;
end;
$$;

revoke all on function public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text) from public;
grant execute on function public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text) to authenticated;

create or replace function public.receive_purchase(
  p_location_id uuid,
  p_supplier_id uuid,
  p_items jsonb,
  p_amount_paid numeric default 0,
  p_payment_method text default 'cash',
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := public.current_organization_id();
  v_purchase_id uuid;
  v_number text;
  v_item jsonb;
  v_product public.products%rowtype;
  v_qty numeric(18,3);
  v_cost numeric(18,2);
  v_line numeric(18,2);
  v_total numeric(18,2) := 0;
begin
  if v_org is null then raise exception 'Active organization required'; end if;

  if not exists (select 1 from public.locations where id = p_location_id and organization_id = v_org and active = true) then
    raise exception 'Location not found';
  end if;

  if p_supplier_id is not null and not exists (select 1 from public.suppliers where id = p_supplier_id and organization_id = v_org) then
    raise exception 'Supplier not found';
  end if;

  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one purchase item is required';
  end if;

  v_number := 'P-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS');

  insert into public.purchases(
    organization_id, location_id, supplier_id, purchase_number, status,
    subtotal, tax_amount, total_amount, amount_paid, notes, created_by
  )
  values (v_org, p_location_id, p_supplier_id, v_number, 'received', 0, 0, 0, greatest(coalesce(p_amount_paid,0),0), p_notes, auth.uid())
  returning id into v_purchase_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and organization_id = v_org
      and active = true;

    if not found then raise exception 'Purchase item product not found'; end if;

    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric, 0);
    v_cost := coalesce(nullif(v_item->>'unit_cost','')::numeric, v_product.cost_price, 0);
    if v_qty <= 0 then raise exception 'Purchase quantity must be greater than zero'; end if;
    if v_cost < 0 then raise exception 'Purchase cost cannot be negative'; end if;

    v_line := round(v_qty * v_cost, 2);
    v_total := v_total + v_line;

    insert into public.purchase_items(purchase_id, product_id, description, quantity, unit_cost, line_total)
    values (v_purchase_id, v_product.id, v_product.name, v_qty, v_cost, v_line);

    update public.products set cost_price = v_cost, updated_at = now() where id = v_product.id;

    if v_product.track_inventory then
      insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
      values (v_product.id, p_location_id, v_qty, 0)
      on conflict (product_id, location_id)
      do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();

      insert into public.stock_movements(
        organization_id, location_id, product_id, movement_type, quantity,
        unit_cost, reference_type, reference_id, notes, recorded_by
      )
      values (
        v_org, p_location_id, v_product.id, 'purchase_receipt', v_qty,
        v_cost, 'purchase', v_purchase_id, p_notes, auth.uid()
      );
    end if;
  end loop;

  update public.purchases
  set subtotal = v_total,
      total_amount = v_total,
      amount_paid = least(greatest(coalesce(p_amount_paid,0),0), v_total),
      updated_at = now()
  where id = v_purchase_id;

  if coalesce(p_amount_paid,0) > 0 then
    insert into public.payments(
      organization_id, location_id, supplier_id, direction, payment_type,
      method, amount, notes, received_by
    )
    values (
      v_org, p_location_id, p_supplier_id, 'out', 'supplier_payment',
      coalesce(nullif(p_payment_method,''),'cash'),
      least(greatest(p_amount_paid,0), v_total), p_notes, auth.uid()
    );
  end if;

  insert into public.audit_log(organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata)
  values (
    v_org, p_location_id, auth.uid(), 'purchase_received', 'purchase', v_purchase_id::text,
    v_number, jsonb_build_object('total', v_total, 'amount_paid', least(greatest(coalesce(p_amount_paid,0),0), v_total))
  );

  return v_purchase_id;
end;
$$;

revoke all on function public.receive_purchase(uuid,uuid,jsonb,numeric,text,text) from public;
grant execute on function public.receive_purchase(uuid,uuid,jsonb,numeric,text,text) to authenticated;
