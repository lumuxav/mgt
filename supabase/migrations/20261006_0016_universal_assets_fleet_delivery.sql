-- MGT Business Suite — Universal Assets, Maintenance, Fleet & Delivery

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('assets.view','Assets & Fleet','View assets','View equipment, machines, vehicles and maintenance history',120),
 ('assets.manage','Assets & Fleet','Manage assets','Create and edit business assets',121),
 ('assets.maintenance','Assets & Fleet','Manage maintenance','Schedule and complete asset maintenance',122),
 ('fleet.view','Assets & Fleet','View fleet','View vehicles, fuel and delivery activity',123),
 ('fleet.manage','Assets & Fleet','Manage fleet','Create vehicles and manage fleet records',124),
 ('fleet.dispatch','Assets & Fleet','Dispatch deliveries','Create and update deliveries and dispatches',125)
on conflict(code) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select distinct u.organization_id,x.role,x.permission,true
from public.users u
cross join (values
 ('manager','assets.view'),('manager','assets.manage'),('manager','assets.maintenance'),('manager','fleet.view'),('manager','fleet.manage'),('manager','fleet.dispatch'),
 ('storekeeper','assets.view'),('storekeeper','fleet.view'),
 ('production_staff','assets.view'),('production_staff','assets.maintenance'),
 ('salesperson','fleet.view'),('salesperson','fleet.dispatch')
) as x(role,permission)
where u.organization_id is not null
on conflict(organization_id,role,permission) do nothing;

create table if not exists public.assets(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 asset_number text not null,
 name text not null,
 category text,
 asset_type text not null default 'equipment' check(asset_type in ('equipment','machine','tool','vehicle','building','furniture','computer','other')),
 status text not null default 'active' check(status in ('active','maintenance','out_of_service','retired','disposed')),
 manufacturer text,
 model text,
 serial_number text,
 purchase_date date,
 purchase_cost numeric(18,2) not null default 0 check(purchase_cost>=0),
 salvage_value numeric(18,2) not null default 0 check(salvage_value>=0),
 useful_life_months integer check(useful_life_months is null or useful_life_months>0),
 assigned_user_id uuid references public.users(id) on delete set null,
 next_service_date date,
 service_interval_days integer check(service_interval_days is null or service_interval_days>0),
 notes text,
 active boolean not null default true,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,asset_number)
);
create index if not exists assets_org_status_idx on public.assets(organization_id,status,created_at desc);
create index if not exists assets_location_idx on public.assets(location_id);
create index if not exists assets_assigned_user_idx on public.assets(assigned_user_id);
create index if not exists assets_next_service_idx on public.assets(organization_id,next_service_date) where active=true;

create table if not exists public.asset_maintenance(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 asset_id uuid not null references public.assets(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 maintenance_number text not null,
 maintenance_type text not null default 'preventive' check(maintenance_type in ('preventive','corrective','inspection','repair','service','other')),
 priority text not null default 'normal' check(priority in ('low','normal','high','urgent')),
 status text not null default 'scheduled' check(status in ('scheduled','in_progress','completed','cancelled')),
 scheduled_date date,
 started_at timestamptz,
 completed_at timestamptz,
 description text,
 vendor text,
 assigned_user_id uuid references public.users(id) on delete set null,
 meter_reading numeric(18,2),
 cost numeric(18,2) not null default 0 check(cost>=0),
 downtime_hours numeric(12,2) not null default 0 check(downtime_hours>=0),
 next_service_date date,
 expense_id uuid references public.expenses(id) on delete set null,
 notes text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,maintenance_number)
);
create index if not exists asset_maintenance_asset_idx on public.asset_maintenance(asset_id,created_at desc);
create index if not exists asset_maintenance_org_status_idx on public.asset_maintenance(organization_id,status,scheduled_date);
create index if not exists asset_maintenance_assigned_idx on public.asset_maintenance(assigned_user_id);

create table if not exists public.vehicles(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 asset_id uuid not null unique references public.assets(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 registration_number text not null,
 make text,
 model text,
 model_year integer,
 vin text,
 fuel_type text not null default 'petrol' check(fuel_type in ('petrol','diesel','electric','hybrid','gas','other')),
 odometer numeric(18,2) not null default 0 check(odometer>=0),
 service_due_odometer numeric(18,2),
 capacity text,
 assigned_driver_id uuid references public.users(id) on delete set null,
 insurance_expiry date,
 license_expiry date,
 status text not null default 'available' check(status in ('available','assigned','in_transit','maintenance','out_of_service','retired')),
 notes text,
 active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,registration_number)
);
create index if not exists vehicles_org_status_idx on public.vehicles(organization_id,status);
create index if not exists vehicles_location_idx on public.vehicles(location_id);
create index if not exists vehicles_driver_idx on public.vehicles(assigned_driver_id);
create index if not exists vehicles_insurance_idx on public.vehicles(organization_id,insurance_expiry);
create index if not exists vehicles_license_idx on public.vehicles(organization_id,license_expiry);

create table if not exists public.fuel_logs(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 vehicle_id uuid not null references public.vehicles(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 driver_user_id uuid references public.users(id) on delete set null,
 log_date date not null default current_date,
 odometer numeric(18,2) not null check(odometer>=0),
 quantity numeric(18,3) not null check(quantity>0),
 unit_cost numeric(18,2) not null default 0 check(unit_cost>=0),
 total_cost numeric(18,2) not null default 0 check(total_cost>=0),
 supplier text,
 reference text,
 expense_id uuid references public.expenses(id) on delete set null,
 notes text,
 recorded_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now()
);
create index if not exists fuel_logs_vehicle_idx on public.fuel_logs(vehicle_id,log_date desc);
create index if not exists fuel_logs_org_date_idx on public.fuel_logs(organization_id,log_date desc);
create index if not exists fuel_logs_driver_idx on public.fuel_logs(driver_user_id);

create table if not exists public.deliveries(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 delivery_number text not null,
 source_location_id uuid references public.locations(id) on delete set null,
 customer_id uuid references public.customers(id) on delete set null,
 sale_id uuid references public.sales(id) on delete set null,
 work_order_id uuid references public.work_orders(id) on delete set null,
 vehicle_id uuid references public.vehicles(id) on delete set null,
 driver_user_id uuid references public.users(id) on delete set null,
 status text not null default 'pending' check(status in ('pending','scheduled','dispatched','in_transit','delivered','failed','cancelled')),
 destination text not null,
 contact_name text,
 contact_phone text,
 package_description text,
 scheduled_at timestamptz,
 dispatched_at timestamptz,
 delivered_at timestamptz,
 recipient_name text,
 delivery_notes text,
 failure_reason text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,delivery_number)
);
create index if not exists deliveries_org_status_idx on public.deliveries(organization_id,status,created_at desc);
create index if not exists deliveries_vehicle_idx on public.deliveries(vehicle_id,created_at desc);
create index if not exists deliveries_driver_idx on public.deliveries(driver_user_id,created_at desc);
create index if not exists deliveries_sale_idx on public.deliveries(sale_id);
create index if not exists deliveries_work_order_idx on public.deliveries(work_order_id);
create index if not exists deliveries_customer_idx on public.deliveries(customer_id);

alter table public.assets enable row level security;
alter table public.asset_maintenance enable row level security;
alter table public.vehicles enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.deliveries enable row level security;

create policy assets_select on public.assets for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('assets.view') or public.has_permission('assets.manage') or public.has_permission('fleet.view') or public.has_permission('fleet.manage'))
);
create policy assets_manage_insert on public.assets for insert to authenticated with check(
 public.has_organization_access(organization_id)
 and (public.has_permission('assets.manage') or public.has_permission('fleet.manage'))
);
create policy assets_manage_update on public.assets for update to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('assets.manage') or public.has_permission('fleet.manage'))
) with check(
 public.has_organization_access(organization_id)
 and (public.has_permission('assets.manage') or public.has_permission('fleet.manage'))
);

create policy asset_maintenance_select on public.asset_maintenance for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('assets.view') or public.has_permission('assets.maintenance'))
);

create policy vehicles_select on public.vehicles for select to authenticated using(
 public.has_organization_access(organization_id)
 and (public.has_permission('fleet.view') or public.has_permission('fleet.manage') or public.has_permission('assets.view'))
);
create policy vehicles_manage_insert on public.vehicles for insert to authenticated with check(
 public.has_organization_access(organization_id) and public.has_permission('fleet.manage')
);
create policy vehicles_manage_update on public.vehicles for update to authenticated using(
 public.has_organization_access(organization_id) and public.has_permission('fleet.manage')
) with check(
 public.has_organization_access(organization_id) and public.has_permission('fleet.manage')
);

create policy fuel_logs_select on public.fuel_logs for select to authenticated using(
 public.has_organization_access(organization_id) and (public.has_permission('fleet.view') or public.has_permission('fleet.manage'))
);

create policy deliveries_select on public.deliveries for select to authenticated using(
 public.has_organization_access(organization_id) and (public.has_permission('fleet.view') or public.has_permission('fleet.dispatch') or public.has_permission('fleet.manage'))
);

create or replace function public.create_asset(
 p_location_id uuid,p_name text,p_category text,p_asset_type text,
 p_manufacturer text default null,p_model text default null,p_serial_number text default null,
 p_purchase_date date default null,p_purchase_cost numeric default 0,p_salvage_value numeric default 0,
 p_useful_life_months integer default null,p_assigned_user_id uuid default null,
 p_next_service_date date default null,p_service_interval_days integer default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_id uuid;v_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.manage') then raise exception 'Permission denied: assets.manage'; end if;
 if coalesce(trim(p_name),'')='' then raise exception 'Asset name is required'; end if;
 if p_asset_type not in ('equipment','machine','tool','vehicle','building','furniture','computer','other') then raise exception 'Invalid asset type'; end if;
 if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_assigned_user_id is not null and not exists(select 1 from public.users where id=p_assigned_user_id and organization_id=v_org and active=true) then raise exception 'Assigned employee not found'; end if;

 v_number:='AST-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.assets(
  organization_id,location_id,asset_number,name,category,asset_type,manufacturer,model,serial_number,
  purchase_date,purchase_cost,salvage_value,useful_life_months,assigned_user_id,next_service_date,
  service_interval_days,notes,created_by
 ) values(
  v_org,p_location_id,v_number,trim(p_name),nullif(trim(p_category),''),p_asset_type,nullif(trim(p_manufacturer),''),
  nullif(trim(p_model),''),nullif(trim(p_serial_number),''),p_purchase_date,coalesce(p_purchase_cost,0),
  coalesce(p_salvage_value,0),p_useful_life_months,p_assigned_user_id,p_next_service_date,p_service_interval_days,p_notes,auth.uid()
 ) returning id into v_id;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,p_location_id,auth.uid(),'asset_created','asset',v_id::text,v_number||' · '||p_name);
 return jsonb_build_object('asset_id',v_id,'asset_number',v_number);
end; $$;
revoke all on function public.create_asset(uuid,text,text,text,text,text,text,date,numeric,numeric,integer,uuid,date,integer,text) from public;
revoke execute on function public.create_asset(uuid,text,text,text,text,text,text,date,numeric,numeric,integer,uuid,date,integer,text) from anon;
grant execute on function public.create_asset(uuid,text,text,text,text,text,text,date,numeric,numeric,integer,uuid,date,integer,text) to authenticated;

create or replace function public.schedule_asset_maintenance(
 p_asset_id uuid,p_maintenance_type text,p_priority text,p_scheduled_date date,
 p_description text,p_assigned_user_id uuid default null,p_vendor text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_asset public.assets%rowtype;v_id uuid;v_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.maintenance') then raise exception 'Permission denied: assets.maintenance'; end if;
 select * into v_asset from public.assets where id=p_asset_id and organization_id=v_org and active=true;
 if not found then raise exception 'Asset not found'; end if;
 if p_maintenance_type not in ('preventive','corrective','inspection','repair','service','other') then raise exception 'Invalid maintenance type'; end if;
 if p_priority not in ('low','normal','high','urgent') then raise exception 'Invalid priority'; end if;
 if p_assigned_user_id is not null and not exists(select 1 from public.users where id=p_assigned_user_id and organization_id=v_org and active=true) then raise exception 'Assigned employee not found'; end if;

 v_number:='MNT-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.asset_maintenance(
  organization_id,asset_id,location_id,maintenance_number,maintenance_type,priority,status,scheduled_date,
  description,vendor,assigned_user_id,notes,created_by
 ) values(
  v_org,v_asset.id,v_asset.location_id,v_number,p_maintenance_type,p_priority,'scheduled',p_scheduled_date,
  p_description,nullif(trim(p_vendor),''),p_assigned_user_id,p_notes,auth.uid()
 ) returning id into v_id;

 update public.assets set next_service_date=coalesce(p_scheduled_date,next_service_date),updated_at=now() where id=v_asset.id;
 return jsonb_build_object('maintenance_id',v_id,'maintenance_number',v_number);
end; $$;
revoke all on function public.schedule_asset_maintenance(uuid,text,text,date,text,uuid,text,text) from public;
revoke execute on function public.schedule_asset_maintenance(uuid,text,text,date,text,uuid,text,text) from anon;
grant execute on function public.schedule_asset_maintenance(uuid,text,text,date,text,uuid,text,text) to authenticated;

create or replace function public.complete_asset_maintenance(
 p_maintenance_id uuid,p_cost numeric default 0,p_downtime_hours numeric default 0,
 p_meter_reading numeric default null,p_next_service_date date default null,p_notes text default null,
 p_payment_method text default null,p_bank_account_id uuid default null,p_reference text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_m public.asset_maintenance%rowtype;v_asset public.assets%rowtype;
 v_method text:=nullif(trim(p_payment_method),'');v_till_id uuid;v_expense_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.maintenance') then raise exception 'Permission denied: assets.maintenance'; end if;
 select * into v_m from public.asset_maintenance where id=p_maintenance_id and organization_id=v_org and status<>'completed' for update;
 if not found then raise exception 'Open maintenance record not found'; end if;
 select * into v_asset from public.assets where id=v_m.asset_id and organization_id=v_org for update;
 if not found then raise exception 'Asset not found'; end if;
 if coalesce(p_cost,0)<0 or coalesce(p_downtime_hours,0)<0 then raise exception 'Cost and downtime cannot be negative'; end if;

 if coalesce(p_cost,0)>0 and v_method is not null then
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
    where organization_id=v_org and location_id=v_m.location_id and user_id=auth.uid() and status='open'
    order by opened_at desc limit 1;
   if v_till_id is null then raise exception 'Open your till before paying maintenance in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for maintenance payment'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_m.location_id,'Maintenance','Maintenance - '||v_asset.name||' - '||v_m.maintenance_number,
   p_cost,v_method,nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_expense_id;

  if v_method='cash' then
   insert into public.payments(organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
   values(v_org,v_m.location_id,'out','asset_maintenance','cash',p_cost,nullif(trim(p_reference),''),v_asset.name,auth.uid(),v_till_id);
  else
   insert into public.banking_transactions(organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_org,v_m.location_id,p_bank_account_id,'withdrawal',p_cost,'confirmed',nullif(trim(p_reference),''),'Maintenance - '||v_asset.name,auth.uid());
  end if;
 end if;

 update public.asset_maintenance set
  status='completed',started_at=coalesce(started_at,now()),completed_at=now(),cost=coalesce(p_cost,0),
  downtime_hours=coalesce(p_downtime_hours,0),meter_reading=p_meter_reading,next_service_date=p_next_service_date,
  expense_id=v_expense_id,notes=coalesce(p_notes,notes),updated_at=now()
 where id=v_m.id;

 update public.assets set status='active',next_service_date=coalesce(p_next_service_date,next_service_date),updated_at=now() where id=v_asset.id;
 update public.vehicles set status='available',updated_at=now()
 where asset_id=v_asset.id and organization_id=v_org and active=true;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_m.location_id,auth.uid(),'maintenance_completed','asset_maintenance',v_m.id::text,v_m.maintenance_number,
  jsonb_build_object('asset_id',v_asset.id,'cost',p_cost,'downtime_hours',p_downtime_hours));

 return jsonb_build_object('maintenance_id',v_m.id,'status','completed','expense_id',v_expense_id);
end; $$;
revoke all on function public.complete_asset_maintenance(uuid,numeric,numeric,numeric,date,text,text,uuid,text) from public;
revoke execute on function public.complete_asset_maintenance(uuid,numeric,numeric,numeric,date,text,text,uuid,text) from anon;
grant execute on function public.complete_asset_maintenance(uuid,numeric,numeric,numeric,date,text,text,uuid,text) to authenticated;

create or replace function public.create_vehicle(
 p_location_id uuid,p_registration_number text,p_make text,p_model text,p_model_year integer default null,
 p_vin text default null,p_fuel_type text default 'petrol',p_odometer numeric default 0,
 p_service_due_odometer numeric default null,p_capacity text default null,p_driver_user_id uuid default null,
 p_insurance_expiry date default null,p_license_expiry date default null,p_purchase_date date default null,
 p_purchase_cost numeric default 0,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_asset_id uuid;v_vehicle_id uuid;v_asset_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.manage') then raise exception 'Permission denied: fleet.manage'; end if;
 if coalesce(trim(p_registration_number),'')='' then raise exception 'Registration number is required'; end if;
 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;
 if p_driver_user_id is not null and not exists(select 1 from public.users where id=p_driver_user_id and organization_id=v_org and active=true) then raise exception 'Driver not found'; end if;
 if p_fuel_type not in ('petrol','diesel','electric','hybrid','gas','other') then raise exception 'Invalid fuel type'; end if;

 v_asset_number:='VEH-'||upper(regexp_replace(trim(p_registration_number),'[^A-Za-z0-9]','','g'));
 if exists(select 1 from public.assets where organization_id=v_org and asset_number=v_asset_number) then
  v_asset_number:=v_asset_number||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 end if;

 insert into public.assets(
  organization_id,location_id,asset_number,name,category,asset_type,manufacturer,model,purchase_date,purchase_cost,
  assigned_user_id,notes,created_by
 ) values(
  v_org,p_location_id,v_asset_number,concat_ws(' ',nullif(trim(p_make),''),nullif(trim(p_model),''),trim(p_registration_number)),
  'Vehicle','vehicle',nullif(trim(p_make),''),nullif(trim(p_model),''),p_purchase_date,coalesce(p_purchase_cost,0),p_driver_user_id,p_notes,auth.uid()
 ) returning id into v_asset_id;

 insert into public.vehicles(
  organization_id,asset_id,location_id,registration_number,make,model,model_year,vin,fuel_type,odometer,
  service_due_odometer,capacity,assigned_driver_id,insurance_expiry,license_expiry,notes
 ) values(
  v_org,v_asset_id,p_location_id,upper(trim(p_registration_number)),nullif(trim(p_make),''),nullif(trim(p_model),''),
  p_model_year,nullif(trim(p_vin),''),p_fuel_type,coalesce(p_odometer,0),p_service_due_odometer,
  nullif(trim(p_capacity),''),p_driver_user_id,p_insurance_expiry,p_license_expiry,p_notes
 ) returning id into v_vehicle_id;

 return jsonb_build_object('vehicle_id',v_vehicle_id,'asset_id',v_asset_id,'asset_number',v_asset_number);
end; $$;
revoke all on function public.create_vehicle(uuid,text,text,text,integer,text,text,numeric,numeric,text,uuid,date,date,date,numeric,text) from public;
revoke execute on function public.create_vehicle(uuid,text,text,text,integer,text,text,numeric,numeric,text,uuid,date,date,date,numeric,text) from anon;
grant execute on function public.create_vehicle(uuid,text,text,text,integer,text,text,numeric,numeric,text,uuid,date,date,date,numeric,text) to authenticated;

create or replace function public.record_fuel_log(
 p_vehicle_id uuid,p_odometer numeric,p_quantity numeric,p_unit_cost numeric,
 p_supplier text default null,p_reference text default null,p_notes text default null,
 p_payment_method text default null,p_bank_account_id uuid default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_vehicle public.vehicles%rowtype;v_total numeric(18,2);
 v_method text:=nullif(trim(p_payment_method),'');v_till_id uuid;v_expense_id uuid;v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.manage') then raise exception 'Permission denied: fleet.manage'; end if;
 select * into v_vehicle from public.vehicles where id=p_vehicle_id and organization_id=v_org and active=true for update;
 if not found then raise exception 'Vehicle not found'; end if;
 if p_odometer<v_vehicle.odometer then raise exception 'Odometer cannot go backwards'; end if;
 if coalesce(p_quantity,0)<=0 or coalesce(p_unit_cost,0)<0 then raise exception 'Invalid fuel quantity or cost'; end if;
 v_total:=round(p_quantity*p_unit_cost,2);

 if v_total>0 and v_method is not null then
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
    where organization_id=v_org and location_id=v_vehicle.location_id and user_id=auth.uid() and status='open'
    order by opened_at desc limit 1;
   if v_till_id is null then raise exception 'Open your till before paying for fuel in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for fuel'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_vehicle.location_id,'Fuel','Fuel - '||v_vehicle.registration_number,v_total,v_method,
   nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_expense_id;

  if v_method='cash' then
   insert into public.payments(organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id)
   values(v_org,v_vehicle.location_id,'out','fuel','cash',v_total,nullif(trim(p_reference),''),v_vehicle.registration_number,auth.uid(),v_till_id);
  else
   insert into public.banking_transactions(organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_org,v_vehicle.location_id,p_bank_account_id,'withdrawal',v_total,'confirmed',nullif(trim(p_reference),''),'Fuel - '||v_vehicle.registration_number,auth.uid());
  end if;
 end if;

 insert into public.fuel_logs(
  organization_id,vehicle_id,location_id,driver_user_id,log_date,odometer,quantity,unit_cost,total_cost,
  supplier,reference,expense_id,notes,recorded_by
 ) values(
  v_org,v_vehicle.id,v_vehicle.location_id,v_vehicle.assigned_driver_id,current_date,p_odometer,p_quantity,p_unit_cost,v_total,
  nullif(trim(p_supplier),''),nullif(trim(p_reference),''),v_expense_id,p_notes,auth.uid()
 ) returning id into v_id;

 update public.vehicles set odometer=p_odometer,updated_at=now() where id=v_vehicle.id;
 return jsonb_build_object('fuel_log_id',v_id,'total_cost',v_total,'expense_id',v_expense_id);
end; $$;
revoke all on function public.record_fuel_log(uuid,numeric,numeric,numeric,text,text,text,text,uuid) from public;
revoke execute on function public.record_fuel_log(uuid,numeric,numeric,numeric,text,text,text,text,uuid) from anon;
grant execute on function public.record_fuel_log(uuid,numeric,numeric,numeric,text,text,text,text,uuid) to authenticated;

create or replace function public.create_delivery(
 p_source_location_id uuid,p_destination text,p_customer_id uuid default null,p_sale_id uuid default null,
 p_work_order_id uuid default null,p_vehicle_id uuid default null,p_driver_user_id uuid default null,
 p_contact_name text default null,p_contact_phone text default null,p_package_description text default null,
 p_scheduled_at timestamptz default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_id uuid;v_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.dispatch') then raise exception 'Permission denied: fleet.dispatch'; end if;
 if coalesce(trim(p_destination),'')='' then raise exception 'Destination is required'; end if;
 if p_source_location_id is not null and not exists(select 1 from public.locations where id=p_source_location_id and organization_id=v_org and active=true) then raise exception 'Source location not found'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org) then raise exception 'Customer not found'; end if;
 if p_sale_id is not null and not exists(select 1 from public.sales where id=p_sale_id and organization_id=v_org) then raise exception 'Sale not found'; end if;
 if p_work_order_id is not null and not exists(select 1 from public.work_orders where id=p_work_order_id and organization_id=v_org) then raise exception 'Work order not found'; end if;
 if p_vehicle_id is not null and not exists(select 1 from public.vehicles where id=p_vehicle_id and organization_id=v_org and active=true) then raise exception 'Vehicle not found'; end if;
 if p_driver_user_id is not null and not exists(select 1 from public.users where id=p_driver_user_id and organization_id=v_org and active=true) then raise exception 'Driver not found'; end if;

 v_number:='DLV-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.deliveries(
  organization_id,delivery_number,source_location_id,customer_id,sale_id,work_order_id,vehicle_id,driver_user_id,
  status,destination,contact_name,contact_phone,package_description,scheduled_at,delivery_notes,created_by
 ) values(
  v_org,v_number,p_source_location_id,p_customer_id,p_sale_id,p_work_order_id,p_vehicle_id,p_driver_user_id,
  case when p_scheduled_at is not null then 'scheduled' else 'pending' end,trim(p_destination),
  nullif(trim(p_contact_name),''),nullif(trim(p_contact_phone),''),p_package_description,p_scheduled_at,p_notes,auth.uid()
 ) returning id into v_id;

 return jsonb_build_object('delivery_id',v_id,'delivery_number',v_number);
end; $$;
revoke all on function public.create_delivery(uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text) from public;
revoke execute on function public.create_delivery(uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text) from anon;
grant execute on function public.create_delivery(uuid,text,uuid,uuid,uuid,uuid,uuid,text,text,text,timestamptz,text) to authenticated;

create or replace function public.update_delivery_status(
 p_delivery_id uuid,p_status text,p_recipient_name text default null,p_notes text default null,p_failure_reason text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_d public.deliveries%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('fleet.dispatch') then raise exception 'Permission denied: fleet.dispatch'; end if;
 if p_status not in ('pending','scheduled','dispatched','in_transit','delivered','failed','cancelled') then raise exception 'Invalid delivery status'; end if;

 select * into v_d from public.deliveries where id=p_delivery_id and organization_id=v_org for update;
 if not found then raise exception 'Delivery not found'; end if;
 if v_d.status in ('delivered','cancelled') and p_status<>v_d.status then raise exception 'Completed/cancelled delivery cannot be reopened automatically'; end if;

 update public.deliveries set
  status=p_status,
  dispatched_at=case when p_status in ('dispatched','in_transit','delivered') then coalesce(dispatched_at,now()) else dispatched_at end,
  delivered_at=case when p_status='delivered' then now() else delivered_at end,
  recipient_name=case when p_status='delivered' then coalesce(nullif(trim(p_recipient_name),''),recipient_name) else recipient_name end,
  delivery_notes=coalesce(p_notes,delivery_notes),
  failure_reason=case when p_status='failed' then p_failure_reason else failure_reason end,
  updated_at=now()
 where id=v_d.id;

 if v_d.vehicle_id is not null then
  update public.vehicles set status=case when p_status in ('dispatched','in_transit') then 'in_transit' else 'available' end,updated_at=now()
  where id=v_d.vehicle_id and organization_id=v_org and status<>'maintenance';
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_d.source_location_id,auth.uid(),'delivery_status_changed','delivery',v_d.id::text,v_d.delivery_number,
  jsonb_build_object('from_status',v_d.status,'to_status',p_status,'recipient_name',p_recipient_name));

 return jsonb_build_object('delivery_id',v_d.id,'delivery_number',v_d.delivery_number,'status',p_status);
end; $$;
revoke all on function public.update_delivery_status(uuid,text,text,text,text) from public;
revoke execute on function public.update_delivery_status(uuid,text,text,text,text) from anon;
grant execute on function public.update_delivery_status(uuid,text,text,text,text) to authenticated;
