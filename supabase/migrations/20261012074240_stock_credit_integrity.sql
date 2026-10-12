CREATE OR REPLACE FUNCTION public.post_pos_sale(p_location_id uuid, p_customer_id uuid, p_items jsonb, p_payments jsonb DEFAULT '[]'::jsonb, p_discount_amount numeric DEFAULT 0, p_channel text DEFAULT 'pos'::text, p_pricing_mode text DEFAULT 'retail'::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_organization_id();
  v_sale_id uuid;
  v_sale_number text;
  v_item jsonb;
  v_payment jsonb;
  v_product public.products%rowtype;
  v_qty numeric(18,3);
  v_base_price numeric(18,2);
  v_price numeric(18,2);
  v_line_discount numeric(18,2);
  v_line_tax numeric(18,2);
  v_line_before_discount numeric(18,2);
  v_line_total numeric(18,2);
  v_subtotal numeric(18,2) := 0;
  v_line_discounts numeric(18,2) := 0;
  v_tax numeric(18,2) := 0;
  v_total_discount numeric(18,2);
  v_total numeric(18,2);
  v_paid numeric(18,2) := 0;
  v_balance numeric(18,2);
  v_payment_status text;
  v_stock numeric(18,3);
  v_till_id uuid;
  v_customer_limit numeric(18,2);
  v_existing_debt numeric(18,2);
  v_has_cash boolean := false;
  v_method text;
  v_amount numeric(18,2);
  v_reference text;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not (public.current_module_enabled('pos') or public.current_module_enabled('sales')) then raise exception 'Sales and POS modules are disabled'; end if;
  if not public.has_permission('sales.create') then raise exception 'Permission denied: sales.create'; end if;

  if p_pricing_mode is null or p_pricing_mode not in ('retail','wholesale','custom') then
    raise exception 'Invalid pricing mode';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one sale item is required';
  end if;

  if jsonb_typeof(coalesce(p_payments,'[]'::jsonb)) <> 'array' then
    raise exception 'Payments must be an array';
  end if;

  if not exists (
    select 1 from public.locations
    where id = p_location_id and organization_id = v_org and active = true
  ) then
    raise exception 'Location not found';
  end if;

  if p_customer_id is not null and not exists (
    select 1 from public.customers
    where id = p_customer_id and organization_id = v_org and active = true
  ) then
    raise exception 'Customer not found';
  end if;

  select id into v_till_id
  from public.till_sessions
  where organization_id = v_org
    and location_id = p_location_id
    and user_id = auth.uid()
    and status = 'open'
  order by opened_at desc
  limit 1 for update;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb))
  loop
    v_amount := coalesce(nullif(v_payment->>'amount','')::numeric,0);
    v_method := coalesce(nullif(trim(v_payment->>'method'),''),'cash');
    if v_amount <= 0 then raise exception 'Payment amounts must be greater than zero'; end if;
    v_paid := v_paid + v_amount;
    if v_method = 'cash' then v_has_cash := true; end if;
  end loop;

  if v_has_cash and v_till_id is null then
    raise exception 'Open a till before accepting cash';
  end if;

  if coalesce(p_discount_amount,0)<0 then raise exception 'Sale discount cannot be negative'; end if;
  if coalesce(p_discount_amount,0) > 0 and not public.has_permission('sales.discount') then
    raise exception 'Permission denied: sales.discount';
  end if;

  v_sale_number := 'POS-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

  insert into public.sales(
    organization_id, location_id, customer_id, sale_number, channel,
    status, payment_status, subtotal, discount_amount, tax_amount,
    total_amount, amount_paid, notes, sold_by, pricing_mode, refunded_amount, till_session_id
  )
  values (
    v_org, p_location_id, p_customer_id, v_sale_number, coalesce(nullif(trim(p_channel),''),'pos'),
    'completed', 'credit', 0, 0, 0,
    0, 0, p_notes, auth.uid(), p_pricing_mode, 0, v_till_id
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

    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_qty <= 0 then raise exception 'Sale quantity must be greater than zero'; end if;

    if p_pricing_mode = 'wholesale' then
      v_base_price := coalesce(v_product.wholesale_price, v_product.selling_price, 0);
    else
      v_base_price := coalesce(v_product.selling_price,0);
    end if;

    v_price := coalesce(nullif(v_item->>'unit_price','')::numeric, v_base_price);
    v_line_discount := coalesce(nullif(v_item->>'discount_amount','')::numeric,0);
    if v_line_discount<0 then raise exception 'Line discount cannot be negative'; end if;

    if v_price < 0 then raise exception 'Sale price cannot be negative'; end if;
    if (v_price < v_base_price or v_line_discount > 0 or p_pricing_mode = 'custom')
       and not public.has_permission('sales.discount') then
      raise exception 'Permission denied: sales.discount';
    end if;

    v_line_before_discount := round(v_qty * v_price, 2);
    if v_line_discount > v_line_before_discount then
      raise exception 'Line discount cannot exceed line value';
    end if;

    v_line_tax := round((v_line_before_discount - v_line_discount) * coalesce(v_product.tax_rate,0) / 100.0, 2);
    v_line_total := v_line_before_discount - v_line_discount + v_line_tax;

    v_subtotal := v_subtotal + v_line_before_discount;
    v_line_discounts := v_line_discounts + v_line_discount;
    v_tax := v_tax + v_line_tax;

    insert into public.sale_items(
      sale_id, product_id, description, quantity, unit_price, unit_cost,
      discount_amount, tax_amount, line_total
    )
    values (
      v_sale_id, v_product.id, v_product.name, v_qty, v_price, v_product.cost_price,
      v_line_discount, v_line_tax, v_line_total
    );

    if v_product.track_inventory then
      insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
      values (v_product.id, p_location_id, 0, 0)
      on conflict (product_id, location_id) do nothing;

      select quantity-reserved_quantity into v_stock
      from public.stock_balances
      where product_id = v_product.id and location_id = p_location_id
      for update;

      if coalesce(v_stock,0) < v_qty then
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

  if coalesce(p_discount_amount,0) > (v_subtotal - v_line_discounts) then
    raise exception 'Sale discount cannot exceed sale value';
  end if;

  v_total_discount := v_line_discounts + greatest(coalesce(p_discount_amount,0),0);
  v_total := greatest(0, v_subtotal - v_total_discount + v_tax);

  if v_paid > v_total + 0.009 then
    raise exception 'Payments cannot exceed sale total';
  end if;

  v_balance := greatest(0, v_total - v_paid);

  if v_balance > 0 then
    if p_customer_id is null then
      raise exception 'Select a customer for partial or credit sales';
    end if;

    select credit_limit into v_customer_limit
    from public.customers
    where id = p_customer_id and organization_id = v_org
    for update;

    select coalesce(sum(greatest(total_amount - refunded_amount - amount_paid,0)),0)
      + (select greatest(opening_balance-opening_balance_paid,0) from public.customers where id=p_customer_id)
    into v_existing_debt
    from public.sales
    where organization_id = v_org
      and customer_id = p_customer_id
      and id <> v_sale_id;

    if coalesce(v_customer_limit,0) <= 0 then
      raise exception 'This customer has no credit limit';
    end if;

    if v_existing_debt + v_balance > v_customer_limit + 0.009 then
      raise exception 'Customer credit limit would be exceeded';
    end if;
  end if;

  if v_total = 0 or v_balance <= 0.009 then
    v_payment_status := 'paid';
  elsif v_paid > 0 then
    v_payment_status := 'partial';
  else
    v_payment_status := 'credit';
  end if;

  update public.sales
  set subtotal = v_subtotal,
      discount_amount = v_total_discount,
      tax_amount = v_tax,
      total_amount = v_total,
      amount_paid = v_paid,
      payment_status = v_payment_status,
      updated_at = now()
  where id = v_sale_id;

  for v_payment in select value from jsonb_array_elements(coalesce(p_payments,'[]'::jsonb))
  loop
    v_amount := coalesce(nullif(v_payment->>'amount','')::numeric,0);
    v_method := coalesce(nullif(trim(v_payment->>'method'),''),'cash');
    v_reference := nullif(trim(v_payment->>'reference'),'');

    insert into public.payments(
      organization_id, location_id, customer_id, sale_id, direction,
      payment_type, method, amount, reference, notes, received_by, till_session_id
    )
    values (
      v_org, p_location_id, p_customer_id, v_sale_id, 'in',
      'sale', v_method, v_amount, v_reference, p_notes, auth.uid(), v_till_id
    );
  end loop;

  insert into public.audit_log(
    organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata
  )
  values (
    v_org, p_location_id, auth.uid(), 'pos_sale_posted', 'sale', v_sale_id::text,
    v_sale_number,
    jsonb_build_object(
      'pricing_mode', p_pricing_mode,
      'subtotal', v_subtotal,
      'discount', v_total_discount,
      'tax', v_tax,
      'total', v_total,
      'amount_paid', v_paid,
      'balance', v_balance,
      'payment_status', v_payment_status
    )
  );

  return jsonb_build_object(
    'sale_id', v_sale_id,
    'sale_number', v_sale_number,
    'subtotal', v_subtotal,
    'discount_amount', v_total_discount,
    'tax_amount', v_tax,
    'total_amount', v_total,
    'amount_paid', v_paid,
    'balance_due', v_balance,
    'payment_status', v_payment_status
  );
end;
$function$;


CREATE OR REPLACE FUNCTION public.adjust_stock(p_location_id uuid, p_product_id uuid, p_quantity_delta numeric, p_reason text DEFAULT 'adjustment'::text, p_notes text DEFAULT NULL::text)
 RETURNS numeric
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_organization_id();
  v_product public.products%rowtype;
  v_location public.locations%rowtype;
  v_current numeric(18,3) := 0;
  v_new numeric(18,3); v_reserved numeric(18,3);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('inventory.adjust') then raise exception 'Permission denied: inventory.adjust'; end if;
  if p_quantity_delta = 0 then raise exception 'Quantity change cannot be zero'; end if;

  select * into v_product from public.products where id = p_product_id and organization_id = v_org and active = true;
  if not found then raise exception 'Product not found'; end if;
  if not v_product.track_inventory then raise exception 'This item does not track inventory'; end if;

  select * into v_location from public.locations where id = p_location_id and organization_id = v_org and active = true;
  if not found then raise exception 'Location not found'; end if;

  insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
  values (p_product_id, p_location_id, 0, 0)
  on conflict (product_id, location_id) do nothing;

  select quantity,reserved_quantity into v_current,v_reserved
  from public.stock_balances
  where product_id = p_product_id and location_id = p_location_id
  for update;

  v_new := coalesce(v_current, 0) + p_quantity_delta;
  if v_new < coalesce(v_reserved,0) then raise exception 'Adjustment would consume reserved stock'; end if;

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
$function$;


CREATE OR REPLACE FUNCTION public.post_stocktake(p_location_id uuid, p_items jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id(); v_stocktake_id uuid; v_number text; v_item jsonb;
 v_product public.products%rowtype; v_system numeric(18,3); v_counted numeric(18,3); v_variance numeric(18,3);
 v_reserved numeric(18,3);
 v_units numeric(18,3):=0; v_value numeric(18,2):=0;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('inventory.stocktake') then raise exception 'Permission denied: inventory.stocktake'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'At least one stocktake item is required'; end if;

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
  select quantity,reserved_quantity into v_system,v_reserved from public.stock_balances
   where product_id=v_product.id and location_id=p_location_id for update;

  if v_counted<coalesce(v_reserved,0) then raise exception 'Counted stock is below reserved quantity. Resolve affected orders first'; end if;
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
end; $function$;


CREATE OR REPLACE FUNCTION public.complete_production_order(p_production_order_id uuid, p_actual_output numeric, p_waste_quantity numeric DEFAULT 0, p_consumption jsonb DEFAULT '[]'::jsonb, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  select quantity-reserved_quantity into v_stock from public.stock_balances
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
end; $function$;


CREATE OR REPLACE FUNCTION public.process_sale_return(p_sale_id uuid, p_items jsonb, p_refund_method text DEFAULT 'cash'::text, p_reference text DEFAULT NULL::text, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid := public.current_organization_id();
  v_sale public.sales%rowtype;
  v_item jsonb;
  v_sale_item public.sale_items%rowtype;
  v_return_id uuid;
  v_return_number text;
  v_qty numeric(18,3);
  v_previously_returned numeric(18,3);
  v_available numeric(18,3);
  v_sale_items_total numeric(18,2);
  v_sale_factor numeric(18,8);
  v_unit_refund numeric(18,2);
  v_line_refund numeric(18,2);
  v_total_return numeric(18,2) := 0;
  v_outstanding_before numeric(18,2);
  v_credit_reduction numeric(18,2);
  v_cash_refund numeric(18,2);
  v_till_id uuid;
  v_new_refunded numeric(18,2); v_previous_value numeric(18,2); v_item_value numeric(18,2);
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('sales.refund') then raise exception 'Permission denied: sales.refund'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'At least one return item is required';
  end if;

  select * into v_sale
  from public.sales
  where id = p_sale_id and organization_id = v_org
  for update;

  if not found then raise exception 'Sale not found'; end if;
  if v_sale.status = 'refunded' then raise exception 'Sale is already fully refunded'; end if;

  select coalesce(sum(line_total),0)
  into v_sale_items_total
  from public.sale_items
  where sale_id = v_sale.id;

  if v_sale_items_total <= 0 then raise exception 'Sale has no refundable value'; end if;
  v_sale_factor := v_sale.total_amount / v_sale_items_total;

  v_return_number := 'RET-' || to_char(clock_timestamp(), 'YYYYMMDD-HH24MISS-MS') || '-' ||
    upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

  insert into public.sale_returns(
    organization_id, location_id, sale_id, customer_id, return_number,
    total_amount, credit_reduction, cash_refund_amount,
    refund_method, refund_reference, reason, processed_by
  )
  values (
    v_org, v_sale.location_id, v_sale.id, v_sale.customer_id, v_return_number,
    0, 0, 0, nullif(trim(p_refund_method),''), nullif(trim(p_reference),''),
    p_reason, auth.uid()
  )
  returning id into v_return_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    select * into v_sale_item
    from public.sale_items
    where id = (v_item->>'sale_item_id')::uuid
      and sale_id = v_sale.id;

    if not found then raise exception 'Return item does not belong to this sale'; end if;

    v_qty := coalesce(nullif(v_item->>'quantity','')::numeric,0);
    if v_qty <= 0 then raise exception 'Return quantity must be greater than zero'; end if;

    select coalesce(sum(sri.quantity),0)
    into v_previously_returned
    from public.sale_return_items sri
    join public.sale_returns sr on sr.id = sri.return_id
    where sr.sale_id = v_sale.id
      and sri.sale_item_id = v_sale_item.id;

    v_available := v_sale_item.quantity - v_previously_returned;
    if v_qty > v_available + 0.0009 then
      raise exception 'Return quantity exceeds quantity available for %', v_sale_item.description;
    end if;

    select coalesce(sum(sri.line_total),0) into v_previous_value
    from public.sale_return_items sri join public.sale_returns sr on sr.id=sri.return_id
    where sr.sale_id=v_sale.id and sri.sale_item_id=v_sale_item.id;
    select round(coalesce(sum(line_total),0)*v_sale_factor,2)
      -round(coalesce(sum(line_total) filter(where id<v_sale_item.id),0)*v_sale_factor,2)
    into v_item_value from public.sale_items where sale_id=v_sale.id and id<=v_sale_item.id;
    v_unit_refund := round(v_item_value/v_sale_item.quantity,2);
    v_line_refund := round(v_item_value*(v_previously_returned+v_qty)/v_sale_item.quantity,2)-v_previous_value;
    v_total_return := v_total_return + v_line_refund;

    insert into public.sale_return_items(
      return_id, sale_item_id, product_id, quantity, unit_refund, line_total
    )
    values (
      v_return_id, v_sale_item.id, v_sale_item.product_id, v_qty, v_unit_refund, v_line_refund
    );

    if v_sale_item.product_id is not null
       and exists (select 1 from public.products where id=v_sale_item.product_id and track_inventory=true) then
      insert into public.stock_balances(product_id, location_id, quantity, reserved_quantity)
      values (v_sale_item.product_id, v_sale.location_id, v_qty, 0)
      on conflict (product_id, location_id)
      do update set quantity = public.stock_balances.quantity + excluded.quantity, updated_at = now();

      insert into public.stock_movements(
        organization_id, location_id, product_id, movement_type, quantity,
        unit_cost, reference_type, reference_id, notes, recorded_by
      )
      values (
        v_org, v_sale.location_id, v_sale_item.product_id, 'sale_return', v_qty,
        v_sale_item.unit_cost, 'sale_return', v_return_id, p_reason, auth.uid()
      );
    end if;
  end loop;

  if v_total_return < 0 then raise exception 'Return value cannot be negative'; end if;

  if v_sale.refunded_amount + v_total_return > v_sale.total_amount + 0.01 then
    raise exception 'Return value exceeds remaining refundable sale value';
  end if;

  v_outstanding_before := greatest(v_sale.total_amount - v_sale.refunded_amount - v_sale.amount_paid,0);
  v_credit_reduction := least(v_total_return, v_outstanding_before);
  v_cash_refund := greatest(v_total_return - v_credit_reduction,0);

  if v_cash_refund > 0 and coalesce(nullif(trim(p_refund_method),''),'cash') = 'cash' then
    select id into v_till_id
    from public.till_sessions
    where organization_id = v_org
      and location_id = v_sale.location_id
      and user_id = auth.uid()
      and status = 'open'
    order by opened_at desc
    limit 1;

    if v_till_id is null then raise exception 'Open a till before issuing a cash refund'; end if;
  else
    select id into v_till_id
    from public.till_sessions
    where organization_id = v_org
      and location_id = v_sale.location_id
      and user_id = auth.uid()
      and status = 'open'
    order by opened_at desc
    limit 1;
  end if;

  update public.sale_returns
  set total_amount = v_total_return,
      credit_reduction = v_credit_reduction,
      cash_refund_amount = v_cash_refund
  where id = v_return_id;

  if v_cash_refund > 0 then
    insert into public.payments(
      organization_id, location_id, customer_id, sale_id, direction,
      payment_type, method, amount, reference, notes, received_by, till_session_id
    )
    values (
      v_org, v_sale.location_id, v_sale.customer_id, v_sale.id, 'out',
      'refund', coalesce(nullif(trim(p_refund_method),''),'cash'),
      v_cash_refund, nullif(trim(p_reference),''), p_reason, auth.uid(), v_till_id
    );
  end if;

  v_new_refunded := v_sale.refunded_amount + v_total_return;

  update public.sales
  set refunded_amount = v_new_refunded,
      status = case
        when not exists (select 1 from public.sale_items si where si.sale_id=v_sale.id and si.quantity>(select coalesce(sum(ri.quantity),0) from public.sale_return_items ri join public.sale_returns sr on sr.id=ri.return_id where sr.sale_id=v_sale.id and ri.sale_item_id=si.id)+0.0009) then 'refunded'
        else 'partially_refunded'
      end,
      payment_status = case
        when greatest(total_amount - v_new_refunded - amount_paid,0) <= 0.009 then 'paid'
        when amount_paid > 0 then 'partial'
        else 'credit'
      end,
      updated_at = now()
  where id = v_sale.id;

  insert into public.audit_log(
    organization_id, location_id, user_id, action, entity_type, entity_id, summary, metadata
  )
  values (
    v_org, v_sale.location_id, auth.uid(), 'sale_return_processed', 'sale_return', v_return_id::text,
    v_return_number,
    jsonb_build_object(
      'sale_id',v_sale.id,
      'sale_number',v_sale.sale_number,
      'total_return',v_total_return,
      'credit_reduction',v_credit_reduction,
      'cash_refund',v_cash_refund,
      'refund_method',p_refund_method
    )
  );

  return jsonb_build_object(
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total_return', v_total_return,
    'credit_reduction', v_credit_reduction,
    'cash_refund_amount', v_cash_refund
  );
end;
$function$;


create or replace function public.get_customer_sales_balances()
returns table(customer_id uuid,name text,phone text,credit_limit numeric,opening_due numeric,sales_due numeric,balance_due numeric,sale_count bigint,last_sale_at timestamptz)
language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('sales.view') or public.has_permission('sales.create') or public.has_permission('finance.view') or public.has_permission('customers.view') or public.has_permission('payments.view') or public.has_permission('payments.request') or public.has_permission('reports.view')) then raise exception 'Permission denied'; end if;
 return query select c.id,c.name,c.phone,c.credit_limit,
 greatest(c.opening_balance-c.opening_balance_paid,0),
 coalesce(sum(greatest(s.total_amount-s.refunded_amount-s.amount_paid,0)),0),
 greatest(c.opening_balance-c.opening_balance_paid,0)+coalesce(sum(greatest(s.total_amount-s.refunded_amount-s.amount_paid,0)),0),
 count(s.id) filter(where s.total_amount-s.refunded_amount-s.amount_paid>0.009),max(s.created_at)
 from public.customers c left join public.sales s on s.customer_id=c.id and s.organization_id=v_org
 where c.organization_id=v_org group by c.id;
end; $$;
revoke all on function public.get_customer_sales_balances() from public,anon;
grant execute on function public.get_customer_sales_balances() to authenticated;
