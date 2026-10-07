CREATE OR REPLACE FUNCTION public.server_import_opening_stock(p_organization_id uuid, p_actor_id uuid, p_product_id uuid, p_location_id uuid, p_quantity numeric, p_unit_cost numeric, p_strategy text DEFAULT 'replace'::text, p_notes text DEFAULT NULL::text, p_migration_job_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_product public.products%rowtype;
 v_existing public.opening_stock_imports%rowtype;
 v_current_qty numeric(18,3):=0;
 v_reserved_qty numeric(18,3):=0;
 v_new_qty numeric(18,3):=0;
 v_new_cost numeric(18,2):=0;
 v_new_value numeric(18,2):=0;
 v_delta numeric(18,3):=0;
 v_row_id uuid;
 v_journal uuid;
begin
 if p_organization_id is null or p_actor_id is null then raise exception 'Organization and actor are required'; end if;
 if not exists(select 1 from public.users where id=p_actor_id and organization_id=p_organization_id and active=true and archived_at is null) then
  raise exception 'Active migration user not found';
 end if;
 if p_strategy not in ('add','replace') then raise exception 'Opening stock strategy must be add or replace'; end if;
 if coalesce(p_quantity,-1)<0 then raise exception 'Opening quantity cannot be negative'; end if;
 if coalesce(p_unit_cost,-1)<0 then raise exception 'Unit cost cannot be negative'; end if;

 select * into v_product
 from public.products
 where id=p_product_id and organization_id=p_organization_id and active=true
 for update;
 if not found then raise exception 'Product not found'; end if;
 if not v_product.track_inventory then raise exception 'Opening stock can only be imported for inventory-tracked products'; end if;

 if not exists(
  select 1 from public.locations
  where id=p_location_id and organization_id=p_organization_id and active=true
 ) then raise exception 'Location not found'; end if;

 if exists(
  select 1 from public.stock_movements
  where organization_id=p_organization_id
    and product_id=p_product_id
    and location_id=p_location_id
    and movement_type not in ('opening_stock','opening_stock_adjustment')
 ) then
  raise exception 'Operational stock movements already exist for this product/location. Use a normal stock adjustment instead of changing opening stock';
 end if;

 insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity)
 values(p_product_id,p_location_id,0,0)
 on conflict(product_id,location_id) do nothing;

 select quantity,reserved_quantity into v_current_qty,v_reserved_qty
 from public.stock_balances
 where product_id=p_product_id and location_id=p_location_id
 for update;

 if coalesce(v_reserved_qty,0)>0 then
  raise exception 'Reserved stock already exists for this product/location. Resolve live reservations before changing opening stock';
 end if;

 select * into v_existing
 from public.opening_stock_imports
 where organization_id=p_organization_id and product_id=p_product_id and location_id=p_location_id
 for update;

 if p_strategy='add' and found then
  v_new_qty:=round(coalesce(v_existing.opening_quantity,0)+p_quantity,3);
  v_new_value:=round(coalesce(v_existing.total_value,0)+(p_quantity*p_unit_cost),2);
  v_new_cost:=case when v_new_qty>0 then round(v_new_value/v_new_qty,2) else 0 end;
 else
  v_new_qty:=round(p_quantity,3);
  v_new_cost:=round(p_unit_cost,2);
  v_new_value:=round(v_new_qty*v_new_cost,2);
 end if;

 v_delta:=v_new_qty-coalesce(v_current_qty,0);

 update public.stock_balances
 set quantity=v_new_qty,reserved_quantity=0,updated_at=now()
 where product_id=p_product_id and location_id=p_location_id;

 if abs(v_delta)>0.0005 then
  insert into public.stock_movements(
   organization_id,location_id,product_id,movement_type,quantity,unit_cost,reference_type,notes,recorded_by
  )
  values(
   p_organization_id,p_location_id,p_product_id,
   case when v_existing.id is null then 'opening_stock' else 'opening_stock_adjustment' end,
   v_delta,v_new_cost,'data_migration',
   coalesce(nullif(trim(p_notes),''),'Opening stock migration'),p_actor_id
  );
 end if;

 insert into public.opening_stock_imports(
  organization_id,location_id,product_id,opening_quantity,unit_cost,total_value,migration_job_id,imported_by
 )
 values(
  p_organization_id,p_location_id,p_product_id,v_new_qty,v_new_cost,v_new_value,p_migration_job_id,p_actor_id
 )
 on conflict(organization_id,location_id,product_id) do update set
  opening_quantity=excluded.opening_quantity,
  unit_cost=excluded.unit_cost,
  total_value=excluded.total_value,
  migration_job_id=excluded.migration_job_id,
  imported_by=excluded.imported_by,
  updated_at=now()
 returning id into v_row_id;

 if v_new_qty>0 and v_new_cost>=0 then
  update public.products
  set cost_price=v_new_cost,updated_at=now()
  where id=p_product_id and organization_id=p_organization_id;
 end if;

 if v_new_value>0 then
  v_journal:=public.accounting_write_journal(
   p_organization_id,p_location_id,current_date,'migration_opening_stock',v_row_id::text,
   'Opening inventory - '||v_product.name,'Data migration','noncash',
   jsonb_build_array(
    jsonb_build_object('code','1200','debit',v_new_value,'product_id',p_product_id,'memo','Opening inventory'),
    jsonb_build_object('code','3990','credit',v_new_value,'memo','Opening Balance Equity')
   ),
   p_actor_id
  );
 else
  perform public.accounting_remove_source_journal(p_organization_id,'migration_opening_stock',v_row_id::text);
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  p_organization_id,p_location_id,p_actor_id,'opening_stock_imported','product',p_product_id::text,
  'Opening stock migrated: '||v_product.name,
  jsonb_build_object('quantity',v_new_qty,'unit_cost',v_new_cost,'value',v_new_value,'strategy',p_strategy,'migration_job_id',p_migration_job_id)
 );

 return jsonb_build_object(
  'opening_stock_id',v_row_id,'quantity',v_new_qty,'unit_cost',v_new_cost,'total_value',v_new_value,'journal_id',v_journal
 );
end;
$function$;

revoke all on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) from public;
revoke execute on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) from anon,authenticated;
grant execute on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) to service_role;
