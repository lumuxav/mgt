-- MGT Business Suite — data migration, opening stock and opening balances

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('migration.view','Data Migration','View migration tools','View migration history, templates and export business data',190),
 ('migration.manage','Data Migration','Run data migrations','Validate and import business master data, opening stock and opening balances',191)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission)
values
 ('manager','migration.view'),('manager','migration.manage'),
 ('accountant','migration.view')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true
from public.organizations o
cross join (values
 ('manager','migration.view'),('manager','migration.manage'),
 ('accountant','migration.view')
) x(role,permission)
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.data_migration_jobs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 entity_type text not null,
 file_name text,
 strategy text not null default 'append',
 status text not null default 'running'
   check(status in ('running','completed','completed_with_errors','failed')),
 total_rows integer not null default 0 check(total_rows>=0),
 valid_rows integer not null default 0 check(valid_rows>=0),
 inserted_rows integer not null default 0 check(inserted_rows>=0),
 updated_rows integer not null default 0 check(updated_rows>=0),
 skipped_rows integer not null default 0 check(skipped_rows>=0),
 failed_rows integer not null default 0 check(failed_rows>=0),
 errors jsonb not null default '[]'::jsonb,
 metadata jsonb not null default '{}'::jsonb,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 completed_at timestamptz
);
create index if not exists data_migration_jobs_org_idx
on public.data_migration_jobs(organization_id,created_at desc);

alter table public.data_migration_jobs enable row level security;
revoke all privileges on public.data_migration_jobs from anon,authenticated;

drop policy if exists data_migration_jobs_deny_client on public.data_migration_jobs;
create policy data_migration_jobs_deny_client on public.data_migration_jobs
for all to authenticated using(false) with check(false);

alter table public.customers
add column if not exists opening_balance_paid numeric(18,2) not null default 0;

update public.customers
set opening_balance_paid=0
where opening_balance_paid is null;

insert into public.accounting_accounts(
 organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,system_code,allow_manual_entries
)
select id,'3990','Opening Balance Equity','equity','opening_balance','credit','financing','opening_balance_equity',false
from public.organizations
on conflict(organization_id,code) do nothing;

create or replace function public.seed_opening_balance_equity_account()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
 insert into public.accounting_accounts(
  organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,system_code,allow_manual_entries
 )
 values(
  new.id,'3990','Opening Balance Equity','equity','opening_balance','credit','financing','opening_balance_equity',false
 )
 on conflict(organization_id,code) do nothing;
 return new;
end;
$$;

revoke all on function public.seed_opening_balance_equity_account() from public;
revoke execute on function public.seed_opening_balance_equity_account() from anon,authenticated;

drop trigger if exists seed_opening_balance_equity_account_trigger on public.organizations;
create trigger seed_opening_balance_equity_account_trigger
after insert on public.organizations
for each row execute function public.seed_opening_balance_equity_account();

create table if not exists public.opening_stock_imports(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid not null references public.locations(id) on delete cascade,
 product_id uuid not null references public.products(id) on delete cascade,
 opening_quantity numeric(18,3) not null default 0 check(opening_quantity>=0),
 unit_cost numeric(18,2) not null default 0 check(unit_cost>=0),
 total_value numeric(18,2) not null default 0 check(total_value>=0),
 migration_job_id uuid references public.data_migration_jobs(id) on delete set null,
 imported_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,location_id,product_id)
);
create index if not exists opening_stock_imports_org_idx
on public.opening_stock_imports(organization_id,location_id,product_id);

alter table public.opening_stock_imports enable row level security;
revoke all privileges on public.opening_stock_imports from anon,authenticated;

drop policy if exists opening_stock_imports_deny_client on public.opening_stock_imports;
create policy opening_stock_imports_deny_client on public.opening_stock_imports
for all to authenticated using(false) with check(false);

create or replace function public.server_import_opening_stock(
 p_organization_id uuid,
 p_actor_id uuid,
 p_product_id uuid,
 p_location_id uuid,
 p_quantity numeric,
 p_unit_cost numeric,
 p_strategy text default 'replace',
 p_notes text default null,
 p_migration_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_product public.products%rowtype;
 v_existing public.opening_stock_imports%rowtype;
 v_current_qty numeric(18,3):=0;
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

 select quantity into v_current_qty
 from public.stock_balances
 where product_id=p_product_id and location_id=p_location_id
 for update;

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
$$;

revoke all on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) from public;
revoke execute on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) from anon,authenticated;
grant execute on function public.server_import_opening_stock(uuid,uuid,uuid,uuid,numeric,numeric,text,text,uuid) to service_role;

create or replace function public.server_set_opening_balance(
 p_organization_id uuid,
 p_actor_id uuid,
 p_entity_type text,
 p_entity_id uuid,
 p_amount numeric,
 p_strategy text default 'replace',
 p_as_of_date date default current_date,
 p_migration_job_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
 v_opening numeric(18,2):=0;
 v_paid numeric(18,2):=0;
 v_new_total numeric(18,2):=0;
 v_name text;
 v_journal uuid;
begin
 if p_organization_id is null or p_actor_id is null then raise exception 'Organization and actor are required'; end if;
 if p_entity_type not in ('customer','supplier') then raise exception 'Opening balance entity must be customer or supplier'; end if;
 if p_strategy not in ('add','replace') then raise exception 'Opening balance strategy must be add or replace'; end if;
 if coalesce(p_amount,-1)<0 then raise exception 'Opening balance cannot be negative'; end if;
 if p_as_of_date is null then p_as_of_date:=current_date; end if;

 if not exists(select 1 from public.users where id=p_actor_id and organization_id=p_organization_id and active=true and archived_at is null) then
  raise exception 'Active migration user not found';
 end if;

 if p_entity_type='customer' then
  select name,opening_balance,opening_balance_paid
  into v_name,v_opening,v_paid
  from public.customers
  where id=p_entity_id and organization_id=p_organization_id and active=true
  for update;
  if not found then raise exception 'Customer not found'; end if;

  v_new_total:=case when p_strategy='add'
    then coalesce(v_opening,0)+p_amount
    else coalesce(v_paid,0)+p_amount
  end;

  update public.customers
  set opening_balance=v_new_total,updated_at=now()
  where id=p_entity_id;

  if v_new_total>0 then
   v_journal:=public.accounting_write_journal(
    p_organization_id,null,p_as_of_date,'migration_customer_opening',p_entity_id::text,
    'Opening receivable - '||v_name,'Data migration','noncash',
    jsonb_build_array(
     jsonb_build_object('code','1100','debit',v_new_total,'customer_id',p_entity_id,'memo','Opening customer receivable'),
     jsonb_build_object('code','3990','credit',v_new_total,'memo','Opening Balance Equity')
    ),
    p_actor_id
   );
  else
   perform public.accounting_remove_source_journal(p_organization_id,'migration_customer_opening',p_entity_id::text);
  end if;
 else
  select name,opening_balance,opening_balance_paid
  into v_name,v_opening,v_paid
  from public.suppliers
  where id=p_entity_id and organization_id=p_organization_id and active=true
  for update;
  if not found then raise exception 'Supplier not found'; end if;

  v_new_total:=case when p_strategy='add'
    then coalesce(v_opening,0)+p_amount
    else coalesce(v_paid,0)+p_amount
  end;

  update public.suppliers
  set opening_balance=v_new_total,updated_at=now()
  where id=p_entity_id;

  if v_new_total>0 then
   v_journal:=public.accounting_write_journal(
    p_organization_id,null,p_as_of_date,'migration_supplier_opening',p_entity_id::text,
    'Opening payable - '||v_name,'Data migration','noncash',
    jsonb_build_array(
     jsonb_build_object('code','3990','debit',v_new_total,'memo','Opening Balance Equity'),
     jsonb_build_object('code','2000','credit',v_new_total,'supplier_id',p_entity_id,'memo','Opening supplier payable')
    ),
    p_actor_id
   );
  else
   perform public.accounting_remove_source_journal(p_organization_id,'migration_supplier_opening',p_entity_id::text);
  end if;
 end if;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  p_organization_id,p_actor_id,'opening_balance_imported',p_entity_type,p_entity_id::text,
  'Opening balance migrated: '||v_name,
  jsonb_build_object(
   'opening_total',v_new_total,'opening_paid',v_paid,'opening_outstanding',greatest(v_new_total-v_paid,0),
   'strategy',p_strategy,'as_of_date',p_as_of_date,'migration_job_id',p_migration_job_id
  )
 );

 return jsonb_build_object(
  'entity_type',p_entity_type,'entity_id',p_entity_id,'opening_total',v_new_total,
  'opening_paid',v_paid,'outstanding',greatest(v_new_total-v_paid,0),'journal_id',v_journal
 );
end;
$$;

revoke all on function public.server_set_opening_balance(uuid,uuid,text,uuid,numeric,text,date,uuid) from public;
revoke execute on function public.server_set_opening_balance(uuid,uuid,text,uuid,numeric,text,date,uuid) from anon,authenticated;
grant execute on function public.server_set_opening_balance(uuid,uuid,text,uuid,numeric,text,date,uuid) to service_role;

create or replace function public.record_customer_payment(
 p_customer_id uuid,
 p_location_id uuid,
 p_amount numeric,
 p_method text default 'cash',
 p_reference text default null,
 p_notes text default null
)
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_customer public.customers%rowtype;
  v_sale public.sales%rowtype;
  v_remaining numeric(18,2):=coalesce(p_amount,0);
  v_opening_due numeric(18,2):=0;
  v_opening_apply numeric(18,2):=0;
  v_sales_due numeric(18,2):=0;
  v_total_debt numeric(18,2):=0;
  v_apply numeric(18,2);
  v_outstanding numeric(18,2);
  v_new_paid numeric(18,2);
  v_till_id uuid;
  v_method text:=coalesce(nullif(trim(p_method),''),'cash');
  v_allocations jsonb:='[]'::jsonb;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not (public.has_permission('sales.create') or public.has_permission('finance.manage')) then
    raise exception 'Permission denied';
  end if;
  if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;

  select * into v_customer
  from public.customers
  where id=p_customer_id and organization_id=v_org and active=true
  for update;
  if not found then raise exception 'Customer not found'; end if;

  if not exists(
    select 1 from public.locations
    where id=p_location_id and organization_id=v_org and active=true
  ) then raise exception 'Location not found'; end if;

  v_opening_due:=greatest(coalesce(v_customer.opening_balance,0)-coalesce(v_customer.opening_balance_paid,0),0);

  select coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0)
  into v_sales_due
  from public.sales
  where organization_id=v_org and customer_id=p_customer_id;

  v_total_debt:=v_opening_due+v_sales_due;

  if v_remaining>v_total_debt+0.009 then
    raise exception 'Payment exceeds customer outstanding balance';
  end if;

  if v_method='cash' then
    select id into v_till_id
    from public.till_sessions
    where organization_id=v_org
      and location_id=p_location_id
      and user_id=auth.uid()
      and status='open'
    order by opened_at desc
    limit 1;

    if v_till_id is null then raise exception 'Open a till before accepting cash'; end if;
  end if;

  if v_opening_due>0 and v_remaining>0 then
    v_opening_apply:=least(v_remaining,v_opening_due);

    update public.customers
    set opening_balance_paid=opening_balance_paid+v_opening_apply,updated_at=now()
    where id=p_customer_id;

    insert into public.payments(
      organization_id,location_id,customer_id,direction,payment_type,method,amount,
      reference,notes,received_by,till_session_id
    )
    values(
      v_org,p_location_id,p_customer_id,'in','debt_payment',v_method,v_opening_apply,
      nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
    );

    v_allocations:=v_allocations||jsonb_build_array(
      jsonb_build_object('type','opening_balance','amount',v_opening_apply)
    );
    v_remaining:=v_remaining-v_opening_apply;
  end if;

  for v_sale in
    select *
    from public.sales
    where organization_id=v_org
      and customer_id=p_customer_id
      and greatest(total_amount-refunded_amount-amount_paid,0)>0.009
    order by created_at asc
    for update
  loop
    exit when v_remaining<=0.009;

    v_outstanding:=greatest(v_sale.total_amount-v_sale.refunded_amount-v_sale.amount_paid,0);
    v_apply:=least(v_remaining,v_outstanding);
    v_new_paid:=v_sale.amount_paid+v_apply;

    update public.sales
    set amount_paid=v_new_paid,
        payment_status=case
          when greatest(total_amount-refunded_amount-v_new_paid,0)<=0.009 then 'paid'
          else 'partial'
        end,
        updated_at=now()
    where id=v_sale.id;

    insert into public.payments(
      organization_id,location_id,customer_id,sale_id,direction,
      payment_type,method,amount,reference,notes,received_by,till_session_id
    )
    values(
      v_org,p_location_id,p_customer_id,v_sale.id,'in',
      'debt_payment',v_method,v_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
    );

    v_allocations:=v_allocations||jsonb_build_array(
      jsonb_build_object('type','sale','sale_id',v_sale.id,'sale_number',v_sale.sale_number,'amount',v_apply)
    );
    v_remaining:=v_remaining-v_apply;
  end loop;

  insert into public.audit_log(
    organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    v_org,p_location_id,auth.uid(),'customer_payment_received','customer',p_customer_id::text,
    'Customer debt payment received',
    jsonb_build_object('amount',p_amount,'method',v_method,'allocations',v_allocations)
  );

  return jsonb_build_object(
    'amount_received',p_amount,
    'remaining_balance',greatest(v_total_debt-p_amount,0),
    'allocations',v_allocations
  );
end;
$$;

revoke all on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) from public;
revoke execute on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) from anon;
grant execute on function public.record_customer_payment(uuid,uuid,numeric,text,text,text) to authenticated;
