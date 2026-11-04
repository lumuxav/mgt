-- Batch repair for confirmed stock, production, alert, and asset logic issues.

create table if not exists public.sale_stock_holds (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sale_id uuid not null references public.sales(id) on delete cascade,
  product_id uuid not null references public.products(id) on delete restrict,
  location_id uuid not null references public.locations(id) on delete restrict,
  quantity numeric(18,3) not null check (quantity >= 0),
  status text not null default 'held' check (status in ('held','consumed','released')),
  dispatched boolean not null default false,
  created_at timestamptz not null default now(),
  consumed_at timestamptz,
  primary key (sale_id,product_id)
);

alter table public.sale_stock_holds enable row level security;
revoke all on public.sale_stock_holds from public,anon,authenticated;

create or replace function public.mgt_deduct_dispatched_sale_stock(p_organization_id uuid,p_sale_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_sale public.sales%rowtype;
  v_hold public.sale_stock_holds%rowtype;
  v_stock numeric(18,3);
  v_reserved numeric(18,3);
  v_hold_count integer:=0;
  v_item record;
begin
  select * into v_sale
  from public.sales
  where id=p_sale_id and organization_id=p_organization_id
  for update;
  if not found or v_sale.channel not in ('pos','ecommerce') or v_sale.status in ('refunded','cancelled') then return; end if;
  if coalesce(v_sale.amount_paid,0)<=0 and coalesce(v_sale.total_amount,0)>0.009 then return; end if;

  for v_hold in
    select * from public.sale_stock_holds
    where organization_id=p_organization_id and sale_id=p_sale_id and status='held' and dispatched
    order by product_id
    for update
  loop
    select quantity,reserved_quantity into v_stock,v_reserved
    from public.stock_balances
    where product_id=v_hold.product_id and location_id=v_hold.location_id
    for update;
    if not found or coalesce(v_stock,0)<v_hold.quantity or coalesce(v_reserved,0)<v_hold.quantity then
      raise exception 'Reserved stock is no longer available for sale %',v_sale.sale_number;
    end if;

    update public.stock_balances
    set quantity=quantity-v_hold.quantity,
        reserved_quantity=reserved_quantity-v_hold.quantity,
        updated_at=now()
    where product_id=v_hold.product_id and location_id=v_hold.location_id;

    insert into public.stock_movements(
      organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
    )
    select p_organization_id,v_hold.location_id,v_hold.product_id,'sale',-v_hold.quantity,
           p.cost_price,'sale',p_sale_id,'Payment confirmed for dispatched sale '||v_sale.sale_number,v_sale.sold_by
    from public.products p where p.id=v_hold.product_id;

    update public.sale_stock_holds
    set status='consumed',consumed_at=now()
    where sale_id=v_hold.sale_id and product_id=v_hold.product_id;
    v_hold_count:=v_hold_count+1;
  end loop;

  if v_hold_count=0 and not exists(
    select 1 from public.stock_movements
    where organization_id=p_organization_id
      and reference_type='sale' and reference_id=p_sale_id
      and movement_type in ('sale','ecommerce_sale','sale_payment_confirmed')
  ) and not exists(
    select 1 from public.sale_stock_holds
    where organization_id=p_organization_id and sale_id=p_sale_id
  ) then
    for v_item in
      select si.product_id,sum(si.quantity)::numeric(18,3) as quantity,
             max(si.unit_cost)::numeric(18,2) as unit_cost
      from public.sale_items si
      join public.products p on p.id=si.product_id and p.organization_id=p_organization_id and p.track_inventory
      where si.sale_id=p_sale_id and si.product_id is not null
      group by si.product_id
      order by si.product_id
    loop
      insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
      values(v_item.product_id,v_sale.location_id,0,0)
      on conflict(product_id,location_id) do nothing;

      select quantity-reserved_quantity into v_stock
      from public.stock_balances
      where product_id=v_item.product_id and location_id=v_sale.location_id
      for update;
      if coalesce(v_stock,0)<v_item.quantity then
        raise exception 'Insufficient stock for %',v_item.product_id;
      end if;

      update public.stock_balances
      set quantity=quantity-v_item.quantity,updated_at=now()
      where product_id=v_item.product_id and location_id=v_sale.location_id;

      insert into public.stock_movements(
        organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
      ) values(
        p_organization_id,v_sale.location_id,v_item.product_id,'sale_payment_confirmed',-v_item.quantity,
        v_item.unit_cost,'sale',p_sale_id,'Payment confirmed for dispatched sale '||v_sale.sale_number,v_sale.sold_by
      );
    end loop;
  end if;
end;
$$;
revoke all on function public.mgt_deduct_dispatched_sale_stock(uuid,uuid) from public,anon,authenticated;

create or replace function public.mgt_settle_pos_sale_stock_on_payment()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.direction='in' and new.sale_id is not null and new.amount>0 then
    perform public.mgt_deduct_dispatched_sale_stock(new.organization_id,new.sale_id);
  end if;
  return new;
end;
$$;
revoke all on function public.mgt_settle_pos_sale_stock_on_payment() from public,anon,authenticated;
drop trigger if exists mgt_settle_pos_sale_stock_on_payment on public.payments;
create trigger mgt_settle_pos_sale_stock_on_payment
after insert on public.payments
for each row execute function public.mgt_settle_pos_sale_stock_on_payment();

create or replace function public.mgt_settle_sale_stock_on_update()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if new.amount_paid>old.amount_paid or new.payment_status is distinct from old.payment_status then
    perform public.mgt_deduct_dispatched_sale_stock(new.organization_id,new.id);
  end if;
  return new;
end;
$$;
revoke all on function public.mgt_settle_sale_stock_on_update() from public,anon,authenticated;
drop trigger if exists mgt_settle_sale_stock_on_update on public.sales;
create trigger mgt_settle_sale_stock_on_update
after update of amount_paid,payment_status on public.sales
for each row execute function public.mgt_settle_sale_stock_on_update();

create or replace function public.mgt_settle_sale_stock_on_delivery()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid;
  v_should_settle boolean;
begin
  v_should_settle:=tg_op='INSERT';
  if tg_op='UPDATE' then
    v_should_settle:=old.status is distinct from new.status;
  end if;
  if new.sale_id is not null and new.status in ('dispatched','in_transit','delivered') and v_should_settle then
    select organization_id into v_org from public.sales where id=new.sale_id;
    update public.sale_stock_holds
    set dispatched=true
    where sale_id=new.sale_id and status='held';
    if v_org is not null then
      perform public.mgt_deduct_dispatched_sale_stock(v_org,new.sale_id);
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.mgt_settle_sale_stock_on_delivery() from public,anon,authenticated;
drop trigger if exists mgt_settle_sale_stock_on_delivery on public.deliveries;
create trigger mgt_settle_sale_stock_on_delivery
after insert or update on public.deliveries
for each row execute function public.mgt_settle_sale_stock_on_delivery();

do $migration$
declare
  v_definition text;
  v_patched text;
  v_stock_block text;
  v_new_stock_block text;
begin
  v_definition:=pg_get_functiondef('public.post_pos_sale(uuid,uuid,jsonb,jsonb,numeric,text,text,text)'::regprocedure);
  v_stock_block:=$stock$
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
$stock$;
  v_new_stock_block:=$replacement$
    if v_product.track_inventory then
      insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
      values(v_product.id,p_location_id,0,0)
      on conflict(product_id,location_id) do nothing;

      select quantity-reserved_quantity into v_stock
      from public.stock_balances
      where product_id=v_product.id and location_id=p_location_id
      for update;
      if coalesce(v_stock,0)<v_qty then
        raise exception 'Insufficient stock for %',v_product.name;
      end if;

      if v_paid>0 then
        update public.stock_balances
        set quantity=quantity-v_qty,updated_at=now()
        where product_id=v_product.id and location_id=p_location_id;

        insert into public.stock_movements(
          organization_id,location_id,product_id,movement_type,quantity,
          unit_cost,reference_type,reference_id,notes,recorded_by
        ) values(
          v_org,p_location_id,v_product.id,'sale',-v_qty,
          v_product.cost_price,'sale',v_sale_id,p_notes,auth.uid()
        );
      else
        update public.stock_balances
        set reserved_quantity=reserved_quantity+v_qty,updated_at=now()
        where product_id=v_product.id and location_id=p_location_id;

        insert into public.sale_stock_holds(organization_id,sale_id,product_id,location_id,quantity,dispatched)
        values(v_org,v_sale_id,v_product.id,p_location_id,v_qty,true)
        on conflict(sale_id,product_id) do update
        set quantity=public.sale_stock_holds.quantity+excluded.quantity,
            dispatched=true;
      end if;
    end if;
$replacement$;
  if position(v_stock_block in v_definition)=0 then
    raise exception 'Could not locate the expected POS stock deduction block; migration stopped.';
  end if;
  v_patched:=replace(v_definition,v_stock_block,v_new_stock_block);
  if v_patched=v_definition then raise exception 'POS stock deduction block was not updated'; end if;
  execute v_patched;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_old_block text;
  v_new_block text;
begin
  v_definition:=pg_get_functiondef('public.process_sale_return(uuid,jsonb,text,text,text)'::regprocedure);
  v_patched:=replace(
    v_definition,
    'v_item_value numeric(18,2);',
    'v_item_value numeric(18,2);
  v_hold public.sale_stock_holds%rowtype;
  v_release numeric(18,3);'
  );
  if v_patched=v_definition then raise exception 'Could not add sale-return reservation variables'; end if;
  v_definition:=v_patched;

  v_old_block:=$old$
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
$old$;
  v_new_block:=$new$
    if v_sale_item.product_id is not null and exists(select 1 from public.products where id=v_sale_item.product_id and track_inventory=true) then
      select * into v_hold
      from public.sale_stock_holds
      where sale_id=v_sale.id and product_id=v_sale_item.product_id and status in ('held','released') and quantity>0
      for update;

      if found then
        v_release:=least(v_qty,v_hold.quantity);
        update public.stock_balances
        set reserved_quantity=reserved_quantity-v_release,updated_at=now()
        where product_id=v_hold.product_id and location_id=v_hold.location_id
          and reserved_quantity>=v_release;
        if not found then raise exception 'Reserved stock is inconsistent for returned sale item'; end if;

        update public.sale_stock_holds
        set quantity=quantity-v_release,
            status=case when quantity-v_release<=0.0009 then 'released' else 'held' end
        where sale_id=v_hold.sale_id and product_id=v_hold.product_id;
      else
        insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity) values(v_sale_item.product_id,v_sale.location_id,v_qty,0)
        on conflict(product_id,location_id) do update set quantity=public.stock_balances.quantity+excluded.quantity,updated_at=now();
        insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by)
        values(v_org,v_sale.location_id,v_sale_item.product_id,'sale_return',v_qty,v_sale_item.unit_cost,'sale_return',v_return_id,p_reason,auth.uid());
      end if;
    end if;
$new$;
  if position(v_old_block in v_definition)=0 then raise exception 'Could not locate sale-return stock restoration block'; end if;
  v_patched:=replace(v_definition,v_old_block,v_new_block);
  if v_patched=v_definition then raise exception 'Sale-return stock handling was not updated'; end if;
  execute v_patched;
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_old_block text;
  v_new_block text;
  v_patched text;
begin
  v_definition:=pg_get_functiondef('public.transition_online_order(uuid,text)'::regprocedure);
  v_patched:=replace(
    v_definition,
    ' v_allowed boolean:=false;',
    ' v_allowed boolean:=false;
 v_stock numeric(18,3);
 v_reserved numeric(18,3);'
  );
  if v_patched=v_definition then raise exception 'Could not add e-commerce stock reservation variables'; end if;
  v_definition:=v_patched;
  v_old_block:=$old$
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
$old$;
  v_new_block:=$new$
  if v_product.track_inventory then
   select quantity,reserved_quantity into v_stock,v_reserved
   from public.stock_balances
   where product_id=v_line.product_id and location_id=v_order.location_id
   for update;
   if not found or coalesce(v_stock,0)<v_line.quantity or coalesce(v_reserved,0)<v_line.quantity then
    raise exception 'Reserved stock is no longer available for %',v_product.name;
   end if;

   if v_order.payment_status='paid'
      and (v_order.fulfillment_method='pickup' or v_order.status='dispatched') then
    update public.stock_balances
    set quantity=quantity-v_line.quantity,
        reserved_quantity=reserved_quantity-v_line.quantity,
        updated_at=now()
    where product_id=v_line.product_id and location_id=v_order.location_id;

    insert into public.stock_movements(
     organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,reference_id,notes,recorded_by
    ) values(
     v_org,v_order.location_id,v_line.product_id,'ecommerce_sale',-v_line.quantity,v_line.unit_cost,
     'sale',v_sale_id,'Paid and handed over online order '||v_order.order_number,auth.uid()
    );
   else
    insert into public.sale_stock_holds(
     organization_id,sale_id,product_id,location_id,quantity,dispatched
    ) values(
     v_org,v_sale_id,v_line.product_id,v_order.location_id,v_line.quantity,
     v_order.fulfillment_method='pickup' or v_order.status='dispatched'
    )
    on conflict(sale_id,product_id) do update
    set quantity=public.sale_stock_holds.quantity+excluded.quantity,
        dispatched=public.sale_stock_holds.dispatched or excluded.dispatched;
   end if;
  end if;
$new$;
  if position(v_old_block in v_definition)=0 then
    raise exception 'Could not locate online-order stock posting block; migration stopped.';
  end if;
  v_patched:=replace(v_definition,v_old_block,v_new_block);
  if v_patched=v_definition then raise exception 'Online-order stock posting block was not updated'; end if;
  v_definition:=v_patched;
  v_patched:=replace(
    v_definition,
    ' update public.online_orders
 set customer_id=v_customer_id',
    ' if coalesce(v_order.total_amount,0)<=0.009 then
  perform public.mgt_deduct_dispatched_sale_stock(v_org,v_sale_id);
 end if;

 update public.online_orders
 set customer_id=v_customer_id'
  );
  if v_patched=v_definition then raise exception 'Could not add zero-total online order stock settlement'; end if;
  execute v_patched;
end;
$migration$;

create table if not exists public.production_material_reservations(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  production_order_id uuid not null references public.production_orders(id) on delete cascade,
  location_id uuid not null references public.locations(id) on delete restrict,
  product_id uuid not null references public.products(id) on delete restrict,
  quantity numeric(18,3) not null check(quantity>0),
  status text not null default 'held' check(status in ('held','consumed')),
  created_at timestamptz not null default now(),
  released_at timestamptz,
  primary key(production_order_id,product_id)
);
alter table public.production_material_reservations enable row level security;
revoke all on public.production_material_reservations from public,anon,authenticated;

do $migration$
declare
  v_definition text;
  v_patched text;
  v_old_query text;
  v_new_query text;
  v_insert_point text;
  v_reserve_code text;
begin
  v_definition:=pg_get_functiondef('public.create_bom(text,uuid,numeric,jsonb)'::regprocedure);
  v_old_query:=$old$  insert into public.bom_items(bom_id,product_id,quantity)
  values(v_bom_id,v_component.id,v_qty);$old$;
  v_new_query:=$new$  if exists(select 1 from public.bom_items where bom_id=v_bom_id and product_id=v_component.id) then
   raise exception 'A BOM can include each material only once';
  end if;
  insert into public.bom_items(bom_id,product_id,quantity)
  values(v_bom_id,v_component.id,v_qty);$new$;
  if position(v_old_query in v_definition)=0 then raise exception 'Could not locate BOM insertion point'; end if;
  execute replace(v_definition,v_old_query,v_new_query);

  v_definition:=pg_get_functiondef('public.start_production_order(uuid)'::regprocedure);
  v_old_query:=$old$  select bi.product_id,bi.quantity,p.name
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
 loop$old$;
  v_new_query:=$new$  select bi.product_id,sum(bi.quantity) as quantity,p.name
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
  group by bi.product_id,p.name order by bi.product_id
 loop$new$;
  if position(v_old_query in v_definition)=0 then raise exception 'Could not locate production-start BOM query'; end if;
  v_patched:=replace(v_definition,v_old_query,v_new_query);

  v_insert_point:=$point$ update public.production_orders set status='in_progress',started_at=now() where id=v_order.id;$point$;
  v_reserve_code:=$code$
 for v_item in
  select bi.product_id,sum(bi.quantity) as quantity
  from public.bom_items bi
  where bi.bom_id=v_bom.id
  group by bi.product_id
  order by bi.product_id
 loop
  v_required:=round((v_item.quantity/v_bom.output_quantity)*v_order.planned_quantity,3);
  insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
  values(v_item.product_id,v_order.location_id,0,0)
  on conflict(product_id,location_id) do nothing;

  select quantity-reserved_quantity into v_available
  from public.stock_balances
  where product_id=v_item.product_id and location_id=v_order.location_id
  for update;
  if coalesce(v_available,0)<v_required then
   raise exception 'Insufficient material %: required %, available %',v_item.product_id,v_required,coalesce(v_available,0);
  end if;

  update public.stock_balances
  set reserved_quantity=reserved_quantity+v_required,updated_at=now()
  where product_id=v_item.product_id and location_id=v_order.location_id;
  insert into public.production_material_reservations(
   organization_id,production_order_id,location_id,product_id,quantity
  ) values(v_org,v_order.id,v_order.location_id,v_item.product_id,v_required);
 end loop;

$code$||v_insert_point;
  if position(v_insert_point in v_patched)=0 then raise exception 'Could not locate production-start transition'; end if;
  execute replace(v_patched,v_insert_point,v_reserve_code);

  v_definition:=pg_get_functiondef('public.complete_production_order(uuid,numeric,numeric,jsonb,text)'::regprocedure);
  v_old_query:=$old$  select bi.product_id,bi.quantity,p.name,p.cost_price
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
 loop$old$;
  v_new_query:=$new$  select bi.product_id,sum(bi.quantity) as quantity,p.name,p.cost_price
  from public.bom_items bi join public.products p on p.id=bi.product_id
  where bi.bom_id=v_bom.id
  group by bi.product_id,p.name,p.cost_price order by bi.product_id
 loop$new$;
  if position(v_old_query in v_definition)=0 then raise exception 'Could not locate production-completion BOM query'; end if;
  v_patched:=replace(v_definition,v_old_query,v_new_query);

  v_patched:=replace(v_patched,' v_new_output_cost numeric(18,2);',' v_new_output_cost numeric(18,2);
 v_balance_reserved numeric(18,3):=0;
 v_reserved numeric(18,3):=0;');
  if v_patched=v_definition then raise exception 'Could not add production reservation tracking variable'; end if;

  v_old_query:=$old$  select quantity-reserved_quantity into v_stock from public.stock_balances
   where product_id=v_item.product_id and location_id=v_order.location_id for update;

  if coalesce(v_stock,0)<v_actual then raise exception 'Insufficient material %',v_item.name; end if;

  update public.stock_balances
   set quantity=quantity-v_actual,updated_at=now()
   where product_id=v_item.product_id and location_id=v_order.location_id;$old$;
  v_new_query:=$new$  select quantity-reserved_quantity,reserved_quantity into v_stock,v_balance_reserved from public.stock_balances
   where product_id=v_item.product_id and location_id=v_order.location_id for update;
  select coalesce(sum(quantity),0) into v_reserved
   from public.production_material_reservations
   where production_order_id=v_order.id and product_id=v_item.product_id and status='held';
  if v_balance_reserved<v_reserved then raise exception 'Production material reservation is inconsistent'; end if;
  v_stock:=coalesce(v_stock,0)+v_reserved;

  if v_stock<v_actual then raise exception 'Insufficient material %',v_item.name; end if;

  update public.stock_balances
   set quantity=quantity-v_actual,
       reserved_quantity=reserved_quantity-v_reserved,
       updated_at=now()
   where product_id=v_item.product_id and location_id=v_order.location_id;
  update public.production_material_reservations
   set status='consumed',released_at=now()
   where production_order_id=v_order.id and product_id=v_item.product_id and status='held';$new$;
  if position(v_old_query in v_patched)=0 then raise exception 'Could not locate production-completion stock update'; end if;
  execute replace(v_patched,v_old_query,v_new_query);
end;
$migration$;

do $migration$
declare
  v_definition text;
  v_patched text;
begin
  v_definition:=pg_get_functiondef('public.sync_my_notifications()'::regprocedure);
  v_patched:=replace(
    v_definition,
    'select sb.product_id,sb.location_id,sb.quantity,sb.reserved_quantity,p.name,p.sku,p.reorder_level,p.cost_price,l.name as location_name
    from public.stock_balances sb
    join public.products p on p.id=sb.product_id and p.organization_id=v_org and p.active=true and p.track_inventory=true
    join public.locations l on l.id=sb.location_id and l.organization_id=v_org
    where coalesce(p.reorder_level,0)>0',
    'select p.id as product_id,l.id as location_id,coalesce(sb.quantity,0) as quantity,coalesce(sb.reserved_quantity,0) as reserved_quantity,p.name,p.sku,p.reorder_level,p.cost_price,l.name as location_name
    from public.products p
    cross join public.locations l
    left join public.stock_balances sb on sb.product_id=p.id and sb.location_id=l.id
    where p.organization_id=v_org and p.active=true and p.track_inventory=true
      and l.organization_id=v_org and l.active=true and coalesce(p.reorder_level,0)>0'
  );
  v_patched:=replace(
    v_patched,
    'p.payment_status,p.status,p.created_at,',
    'p.payment_status,p.status,p.approval_status,p.created_at,'
  );
  v_patched:=replace(
    v_patched,
    'if r.due_date is not null and r.payment_status<>''paid'' and v_due>0.009 and r.due_date<current_date then',
    'if r.due_date is not null and r.payment_status<>''paid'' and v_due>0.009 and r.due_date<current_date
       and r.approval_status in (''not_required'',''approved'')
       and r.status not in (''draft'',''pending_approval'',''rejected'',''cancelled'') then'
  );
  v_patched:=replace(
    v_patched,
    'if r.status in (''ordered'',''partial'') and r.created_at<now()-interval ''7 days'' then',
    'if r.status in (''ordered'',''partial'') and r.created_at<now()-interval ''7 days''
       and r.approval_status in (''not_required'',''approved'') then'
  );
  v_patched:=replace(
    v_patched,
    'select c.id,c.name,c.credit_limit,',
    'select c.id,c.name,c.credit_limit,c.opening_balance,c.opening_balance_paid,'
  );
  v_patched:=replace(
    v_patched,
    'coalesce(sum(greatest(0,coalesce(s.total_amount,0)-coalesce(s.refunded_amount,0)-coalesce(s.amount_paid,0))),0) as owed',
    'case when public.mgt_record_scope_allows(v_org,null,null)
        then greatest(coalesce(c.opening_balance,0)-coalesce(c.opening_balance_paid,0),0) else 0 end
      +coalesce(sum(greatest(0,coalesce(s.total_amount,0)-coalesce(s.refunded_amount,0)-coalesce(s.amount_paid,0)))
        filter(where public.mgt_record_scope_allows(v_org,s.location_id,s.sold_by)),0) as owed'
  );
  v_patched:=replace(
    v_patched,
    'left join public.sales s on s.customer_id=c.id and s.organization_id=v_org',
    'left join public.sales s on s.customer_id=c.id and s.organization_id=v_org
      and public.mgt_record_scope_allows(v_org,s.location_id,s.sold_by)'
  );
  v_patched:=replace(
    v_patched,
    'where c.organization_id=v_org and c.active=true',
    'where c.organization_id=v_org and c.active=true and public.has_permission(''sales.view'')'
  );
  v_patched:=replace(
    v_patched,
    'v_org,null,''sales.view'',''credit-''||r.id,',
    'v_org,v_user,null,''credit-''||r.id||''-''||v_user,'
  );
  v_patched:=replace(
    v_patched,
    'group by c.id,c.name,c.credit_limit',
    'group by c.id,c.name,c.credit_limit,c.opening_balance,c.opening_balance_paid'
  );
  if v_patched=v_definition then raise exception 'Notification sync logic was not updated'; end if;
  if position('r.approval_status in' in v_patched)=0
     or position('c.opening_balance_paid' in v_patched)=0
     or position('cross join public.locations' in v_patched)=0
     or position('and r.approval_status in (''not_required'',''approved'') then' in v_patched)=0
     or position('mgt_record_scope_allows(v_org,s.location_id,s.sold_by)' in v_patched)=0
     or position('v_org,v_user,null,''credit-''||r.id||''-''||v_user,' in v_patched)=0
     or position('group by c.id,c.name,c.credit_limit,c.opening_balance,c.opening_balance_paid' in v_patched)=0 then
    raise exception 'Could not update all notification eligibility and credit calculations';
  end if;
  execute v_patched;
end;
$migration$;

create or replace function public.set_asset_status(p_asset_id uuid,p_status text,p_notes text default null)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_asset public.assets%rowtype;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  perform public.mgt_require_modules(array['assets']);
  if not public.has_permission('assets.manage') then raise exception 'Permission denied: assets.manage'; end if;
  if p_status not in ('active','maintenance','out_of_service','retired','disposed') then raise exception 'Invalid asset status'; end if;

  select * into v_asset from public.assets where id=p_asset_id and organization_id=v_org for update;
  if not found then raise exception 'Asset not found'; end if;
  perform public.mgt_require_scope(v_asset.location_id,v_asset.assigned_user_id,false);
  if v_asset.status='disposed' and p_status='active' then raise exception 'Disposed assets cannot be reactivated'; end if;

  update public.assets
  set status=p_status,
      active=case
        when p_status in ('retired','disposed') then false
        when p_status='active' then true
        else active
      end,
      notes=coalesce(p_notes,notes),
      updated_at=now()
  where id=v_asset.id;

  update public.vehicles
  set status=case
        when p_status='maintenance' then 'maintenance'
        when p_status='out_of_service' then 'out_of_service'
        when p_status in ('retired','disposed') then 'retired'
        when p_status='active' and status in ('maintenance','out_of_service','retired') then 'available'
        else status
      end,
      active=case
        when p_status in ('retired','disposed') then false
        when p_status='active' then true
        else active
      end,
      updated_at=now()
  where asset_id=v_asset.id and organization_id=v_org;

  return jsonb_build_object('asset_id',v_asset.id,'status',p_status);
end;
$$;
revoke all on function public.set_asset_status(uuid,text,text) from public,anon;
grant execute on function public.set_asset_status(uuid,text,text) to authenticated;

notify pgrst,'reload schema';
