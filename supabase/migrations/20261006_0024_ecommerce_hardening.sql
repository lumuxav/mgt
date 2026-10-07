-- MGT Business Suite — E-commerce accounting and workflow hardening

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
 v_allowed boolean:=false;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.fulfill') or public.has_permission('ecommerce.manage')) then
  raise exception 'Permission denied: ecommerce.orders';
 end if;
 if p_status not in ('confirmed','processing','ready','dispatched','completed','cancelled') then
  raise exception 'Invalid online order status';
 end if;

 select * into v_order from public.online_orders where id=p_order_id and organization_id=v_org for update;
 if not found then raise exception 'Online order not found'; end if;
 if v_order.status in ('completed','cancelled') then raise exception 'Completed or cancelled orders cannot be changed'; end if;

 v_allowed:=case
  when p_status='cancelled' then true
  when v_order.status='pending' and p_status='confirmed' then true
  when v_order.status='confirmed' and p_status='processing' then true
  when v_order.status='processing' and p_status='ready' then true
  when v_order.status='ready' and v_order.fulfillment_method='delivery' and p_status='dispatched' then true
  when v_order.status='ready' and v_order.fulfillment_method='pickup' and p_status='completed' then true
  when v_order.status='dispatched' and p_status='completed' then true
  else false
 end;
 if not v_allowed then raise exception 'Invalid order transition from % to %',v_order.status,p_status; end if;

 if p_status='cancelled' then
  if v_order.sale_id is not null then raise exception 'Orders already converted to sales cannot be cancelled here'; end if;

  for v_line in select * from public.online_order_items where order_id=v_order.id loop
   select * into v_product from public.products where id=v_line.product_id;
   if found and v_product.track_inventory then
    update public.stock_balances
    set reserved_quantity=greatest(reserved_quantity-v_line.quantity,0),updated_at=now()
    where product_id=v_line.product_id and location_id=v_order.location_id;
   end if;
  end loop;

  update public.online_orders
  set status='cancelled',cancelled_by=auth.uid(),cancelled_at=now(),updated_at=now()
  where id=v_order.id;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,v_order.location_id,auth.uid(),'online_order_cancelled','online_order',v_order.id::text,v_order.order_number,
   jsonb_build_object('from_status',v_order.status,'to_status','cancelled'));

  return jsonb_build_object('order_id',v_order.id,'status','cancelled');
 end if;

 if p_status<>'completed' then
  update public.online_orders
  set status=p_status,confirmed_by=coalesce(confirmed_by,auth.uid()),confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
  where id=v_order.id;

  insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(v_org,v_order.location_id,auth.uid(),'online_order_status_changed','online_order',v_order.id::text,v_order.order_number,
   jsonb_build_object('from_status',v_order.status,'to_status',p_status));

  return jsonb_build_object('order_id',v_order.id,'status',p_status);
 end if;

 select id into v_customer_id
 from public.customers
 where organization_id=v_org and active=true
   and ((v_order.customer_phone is not null and phone=v_order.customer_phone)
     or (v_order.customer_email is not null and lower(email)=lower(v_order.customer_email)))
 order by created_at
 limit 1;

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
  v_order.subtotal+v_order.delivery_fee,0,v_order.tax_amount,v_order.total_amount,
  case when v_order.payment_status='paid' then v_order.total_amount else 0 end,
  'Online order '||v_order.order_number,auth.uid()
 ) returning id into v_sale_id;

 for v_line in select * from public.online_order_items where order_id=v_order.id order by created_at loop
  select * into v_product from public.products where id=v_line.product_id and organization_id=v_org for update;
  if not found then raise exception 'Order product no longer exists'; end if;

  if v_product.track_inventory then
   if not exists(
    select 1 from public.stock_balances
    where product_id=v_line.product_id and location_id=v_order.location_id and quantity>=v_line.quantity
   ) then raise exception 'Insufficient stock to complete order for %',v_product.name; end if;

   update public.stock_balances
   set quantity=quantity-v_line.quantity,
       reserved_quantity=greatest(reserved_quantity-v_line.quantity,0),
       updated_at=now()
   where product_id=v_line.product_id and location_id=v_order.location_id;

   insert into public.stock_movements(
    organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
   ) values(
    v_org,v_order.location_id,v_line.product_id,'ecommerce_sale',-v_line.quantity,v_line.unit_cost,
    'sale',v_sale_id,'Online order '||v_order.order_number,auth.uid()
   );
  end if;

  insert into public.sale_items(
   sale_id,product_id,description,quantity,unit_price,unit_cost,discount_amount,tax_amount,line_total
  ) values(
   v_sale_id,v_line.product_id,v_line.description,v_line.quantity,v_line.unit_price,v_line.unit_cost,0,v_line.tax_amount,v_line.line_total
  );
 end loop;

 if v_order.delivery_fee>0 then
  insert into public.sale_items(
   sale_id,product_id,description,quantity,unit_price,unit_cost,discount_amount,tax_amount,line_total
  ) values(
   v_sale_id,null,'Delivery fee',1,v_order.delivery_fee,0,0,0,v_order.delivery_fee
  );
 end if;

 if v_order.payment_status='paid' then
  insert into public.payments(
   organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by
  ) values(
   v_org,v_order.location_id,v_customer_id,v_sale_id,'in','sale',coalesce(v_order.payment_method,'online'),
   v_order.total_amount,v_order.payment_reference,'Online order payment',auth.uid()
  );
 end if;

 if v_order.fulfillment_method='delivery' and coalesce(trim(v_order.delivery_address),'')<>'' then
  v_delivery_number:='DLV-WEB-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));

  insert into public.deliveries(
   organization_id,delivery_number,source_location_id,customer_id,sale_id,status,destination,contact_name,contact_phone,package_description,created_by
  ) values(
   v_org,v_delivery_number,v_order.location_id,v_customer_id,v_sale_id,'pending',v_order.delivery_address,
   v_order.customer_name,v_order.customer_phone,'Online order '||v_order.order_number,auth.uid()
  ) returning id into v_delivery_id;
 end if;

 update public.online_orders
 set customer_id=v_customer_id,sale_id=v_sale_id,delivery_id=v_delivery_id,status='completed',
     completed_by=auth.uid(),completed_at=now(),confirmed_by=coalesce(confirmed_by,auth.uid()),
     confirmed_at=coalesce(confirmed_at,now()),updated_at=now()
 where id=v_order.id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_order.location_id,auth.uid(),'online_order_completed','online_order',v_order.id::text,v_order.order_number,
  jsonb_build_object('sale_id',v_sale_id,'sale_number',v_sale_number,'delivery_id',v_delivery_id,'total_amount',v_order.total_amount));

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
 if not (public.has_permission('ecommerce.orders') or public.has_permission('ecommerce.manage') or public.has_permission('finance.manage')) then
  raise exception 'Permission denied: ecommerce.orders';
 end if;

 select * into v_order from public.online_orders where id=p_order_id and organization_id=v_org for update;
 if not found then raise exception 'Online order not found'; end if;
 if v_order.status='cancelled' then raise exception 'Cancelled orders cannot be paid'; end if;
 if v_order.payment_status='paid' then raise exception 'Order is already marked paid'; end if;

 update public.online_orders
 set payment_status='paid',
     payment_method=coalesce(nullif(trim(p_method),''),'online'),
     payment_reference=nullif(trim(p_reference),''),
     updated_at=now()
 where id=v_order.id;

 if v_order.sale_id is not null then
  insert into public.payments(
   organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by
  ) values(
   v_org,v_order.location_id,v_order.customer_id,v_order.sale_id,'in','sale',
   coalesce(nullif(trim(p_method),''),'online'),v_order.total_amount,nullif(trim(p_reference),''),
   'Online order payment',auth.uid()
  );

  update public.sales
  set amount_paid=v_order.total_amount,payment_status='paid',updated_at=now()
  where id=v_order.sale_id and organization_id=v_org;
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_order.location_id,auth.uid(),'online_order_payment_recorded','online_order',v_order.id::text,v_order.order_number,
  jsonb_build_object('amount',v_order.total_amount,'method',coalesce(nullif(trim(p_method),''),'online'),'reference',p_reference));

 return jsonb_build_object('order_id',v_order.id,'payment_status','paid','amount',v_order.total_amount);
end;
$$;

revoke all on function public.record_online_order_payment(uuid,text,text) from public;
grant execute on function public.record_online_order_payment(uuid,text,text) to authenticated;
