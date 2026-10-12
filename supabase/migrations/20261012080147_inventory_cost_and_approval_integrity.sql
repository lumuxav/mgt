insert into public.accounting_accounts(organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,system_code,allow_manual_entries)
select id,'5300','Inventory Adjustments','expense','inventory_adjustment','debit','noncash','inventory_adjustment',true from public.organizations
on conflict(organization_id,code) do nothing;

create or replace function public.seed_inventory_adjustment_account()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 insert into public.accounting_accounts(organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,system_code,allow_manual_entries)
 values(new.id,'5300','Inventory Adjustments','expense','inventory_adjustment','debit','noncash','inventory_adjustment',true)
 on conflict(organization_id,code) do nothing;
 return new;
end; $$;
revoke all on function public.seed_inventory_adjustment_account() from public,anon,authenticated;
create trigger organizations_inventory_adjustment_account after insert on public.organizations for each row execute function public.seed_inventory_adjustment_account();

create or replace function public.accounting_stock_cost_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_value numeric(18,2); v_code text; v_project uuid;
begin
 if new.movement_type in ('work_order_material','work_order_material_reversal') then v_code:='5100';
 elsif new.movement_type in ('project_material','project_material_reversal') then v_code:='5200';v_project:=new.reference_id;
 elsif new.reference_type='manual_adjustment' or new.movement_type='stocktake_adjustment' then v_code:='5300';
 else return new; end if;
 v_value:=round(abs(new.quantity)*coalesce(new.unit_cost,0),2);
 if v_value<=0 then return new; end if;
 perform public.accounting_write_journal(new.organization_id,new.location_id,new.created_at::date,
  'stock_cost',new.id::text,initcap(replace(new.movement_type,'_',' ')),new.reference_id::text,'noncash',
  case when new.quantity<0 then
   jsonb_build_array(jsonb_build_object('code',v_code,'debit',v_value,'product_id',new.product_id,'project_id',v_project),jsonb_build_object('code','1200','credit',v_value,'product_id',new.product_id))
  else
   jsonb_build_array(jsonb_build_object('code','1200','debit',v_value,'product_id',new.product_id),jsonb_build_object('code',v_code,'credit',v_value,'product_id',new.product_id,'project_id',v_project))
  end,new.recorded_by);
 return new;
end; $$;
revoke all on function public.accounting_stock_cost_trigger() from public,anon,authenticated;
create trigger stock_movements_accounting_cost after insert on public.stock_movements for each row execute function public.accounting_stock_cost_trigger();
revoke execute on function public.adjust_stock(uuid,uuid,numeric,text,text) from public,anon,authenticated;
