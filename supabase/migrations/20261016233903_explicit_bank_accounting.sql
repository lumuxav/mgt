alter table public.banking_transactions
 add column source_expense_id uuid references public.expenses(id) on delete restrict,
 add column source_payment_id uuid references public.payments(id) on delete restrict,
 add constraint banking_single_source check (num_nonnulls(source_expense_id,source_payment_id)<=1);
create unique index banking_expense_source_idx on public.banking_transactions(source_expense_id) where source_expense_id is not null;
create unique index banking_payment_source_idx on public.banking_transactions(source_payment_id) where source_payment_id is not null;

create or replace function public.accounting_sync_bank_transaction(p_tx_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare
 b public.banking_transactions%rowtype; v_lines jsonb; v_code text;
begin
 select * into b from public.banking_transactions where id=p_tx_id;
 if not found or b.status<>'confirmed' or coalesce(b.amount,0)<=0 then return; end if;
 if b.source_expense_id is not null then
  if not exists(select 1 from public.expenses e where e.id=b.source_expense_id
   and e.organization_id=b.organization_id and e.bank_account_id=b.bank_account_id
   and e.amount=b.amount and e.payment_method<>'cash' and b.transaction_type='withdrawal') then
   raise exception 'Bank transaction does not match its expense';
  end if;
  return;
 end if;
 if b.source_payment_id is not null then
  if not exists(select 1 from public.payments p where p.id=b.source_payment_id
   and p.organization_id=b.organization_id and p.amount=b.amount
   and b.transaction_type='deposit' and (p.payment_type='bank_deposit' or (p.direction='in' and p.method<>'cash'))) then
   raise exception 'Bank transaction does not match its payment';
  end if;
  return;
 end if;
 select public.accounting_payment_account_code(account_type) into v_code from public.bank_accounts where id=b.bank_account_id and organization_id=b.organization_id;
 v_code:=coalesce(v_code,'1010');
 if b.transaction_type='deposit' then
  v_lines:=jsonb_build_array(jsonb_build_object('code',v_code,'debit',b.amount),jsonb_build_object('code','3900','credit',b.amount));
 else
  v_lines:=jsonb_build_array(jsonb_build_object('code','3900','debit',b.amount),jsonb_build_object('code',v_code,'credit',b.amount));
 end if;
 perform public.accounting_write_journal(b.organization_id,b.location_id,b.created_at::date,'bank_transaction',b.id::text,
  initcap(b.transaction_type)||' - financial account',b.reference,'financing',v_lines,b.recorded_by);
end; $$;
revoke all on function public.accounting_sync_bank_transaction(uuid) from public,anon,authenticated;

create or replace function public.accounting_bank_opening_insert()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_code text; v_amount numeric;
begin
 if new.opening_balance=0 then return new; end if;
 v_code:=public.accounting_payment_account_code(new.account_type);
 v_amount:=abs(new.opening_balance);
 perform public.accounting_write_journal(new.organization_id,null,new.created_at::date,'bank_opening',new.id::text,
  'Opening balance - '||new.name,'Opening balance','noncash',
  case when new.opening_balance>0 then
   jsonb_build_array(jsonb_build_object('code',v_code,'debit',v_amount),jsonb_build_object('code','3990','credit',v_amount))
  else
   jsonb_build_array(jsonb_build_object('code','3990','debit',v_amount),jsonb_build_object('code',v_code,'credit',v_amount)) end,auth.uid());
 return new;
end; $$;
revoke all on function public.accounting_bank_opening_insert() from public,anon,authenticated;
create trigger bank_accounts_opening_accounting after insert on public.bank_accounts for each row execute function public.accounting_bank_opening_insert();


CREATE OR REPLACE FUNCTION public.bank_cash_from_till(p_till_session_id uuid, p_bank_account_id uuid, p_amount numeric, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_payment_id uuid;
  v_org uuid:=public.current_organization_id();
  v_till public.till_sessions%rowtype;
  v_cash_in numeric(18,2):=0;
  v_cash_out numeric(18,2):=0;
  v_available numeric(18,2):=0;
  v_bank_tx uuid;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('finance.manage') then raise exception 'Permission denied: finance.manage'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Banking amount must be greater than zero'; end if;

  select * into v_till
  from public.till_sessions
  where id=p_till_session_id and organization_id=v_org and status='open'
  for update;

  if not found then raise exception 'Open till session not found'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Bank account not found'; end if;

  select
    coalesce(sum(case when direction='in' and method='cash' then amount else 0 end),0),
    coalesce(sum(case when direction='out' and method='cash' then amount else 0 end),0)
  into v_cash_in,v_cash_out
  from public.payments
  where till_session_id=v_till.id;

  v_available:=v_till.opening_cash+v_cash_in-v_cash_out;
  if p_amount>v_available+0.009 then raise exception 'Banking amount exceeds cash available in till'; end if;

  insert into public.payments(
    organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  )
  values(
    v_org,v_till.location_id,'out','bank_deposit','cash',p_amount,nullif(trim(p_reference),''),
    p_notes,auth.uid(),v_till.id
  ) returning id into v_payment_id;

  insert into public.banking_transactions(
    source_payment_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  )
  values(
    v_payment_id,v_org,v_till.location_id,p_bank_account_id,'deposit',p_amount,'confirmed',
    nullif(trim(p_reference),''),p_notes,auth.uid()
  )
  returning id into v_bank_tx;

  insert into public.audit_log(
    organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    v_org,v_till.location_id,auth.uid(),'till_cash_banked','till_session',v_till.id::text,'Cash banked from till',
    jsonb_build_object('amount',p_amount,'bank_account_id',p_bank_account_id,'banking_transaction_id',v_bank_tx)
  );

  return jsonb_build_object(
    'banking_transaction_id',v_bank_tx,
    'amount',p_amount,
    'cash_remaining',v_available-p_amount
  );
end;
$function$
;

CREATE OR REPLACE FUNCTION public.complete_asset_maintenance(p_maintenance_id uuid, p_cost numeric DEFAULT 0, p_downtime_hours numeric DEFAULT 0, p_meter_reading numeric DEFAULT NULL::numeric, p_next_service_date date DEFAULT NULL::date, p_notes text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   insert into public.banking_transactions(source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_expense_id,v_org,v_m.location_id,p_bank_account_id,'withdrawal',p_cost,'confirmed',nullif(trim(p_reference),''),'Maintenance - '||v_asset.name,auth.uid());
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.pay_project_expense(p_project_expense_id uuid, p_payment_method text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_row public.project_expenses%rowtype;
 v_project public.projects%rowtype;
 v_method text:=coalesce(nullif(trim(p_payment_method),''),'cash');
 v_till_id uuid;
 v_finance_expense_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;

 select * into v_row from public.project_expenses
 where id=p_project_expense_id and organization_id=v_org and status='accrued' for update;
 if not found then raise exception 'Accrued project expense not found'; end if;
 select * into v_project from public.projects where id=v_row.project_id and organization_id=v_org;
 if not found then raise exception 'Project not found'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
  where organization_id=v_org and location_id=v_row.location_id and user_id=auth.uid() and status='open'
  order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before paying this expense in cash'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account used for this payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 insert into public.expenses(
  organization_id,location_id,project_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
 ) values(
  v_org,v_row.location_id,v_row.project_id,v_row.category,v_row.description,v_row.amount,v_method,
  nullif(trim(p_reference),''),auth.uid(),v_row.notes,v_till_id,p_bank_account_id
 ) returning id into v_finance_expense_id;

 if v_method='cash' then
  insert into public.payments(
   organization_id,location_id,project_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  ) values(
   v_org,v_row.location_id,v_row.project_id,'out','project_expense','cash',v_row.amount,
   nullif(trim(p_reference),''),v_row.description,auth.uid(),v_till_id
  );
 else
  insert into public.banking_transactions(
   source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_finance_expense_id,v_org,v_row.location_id,p_bank_account_id,'withdrawal',v_row.amount,'confirmed',
   nullif(trim(p_reference),''),'Project expense - '||v_project.project_number||' - '||v_row.description,auth.uid()
  );
 end if;

 update public.project_expenses
 set status='paid',payment_method=v_method,reference=nullif(trim(p_reference),''),
     bank_account_id=p_bank_account_id,finance_expense_id=v_finance_expense_id,paid_at=now()
 where id=v_row.id;

 return jsonb_build_object('project_expense_id',v_row.id,'status','paid','finance_expense_id',v_finance_expense_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.post_expense(p_location_id uuid, p_category text, p_description text, p_amount numeric, p_payment_method text DEFAULT 'cash'::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_org uuid:=public.current_organization_id();
  v_id uuid;
  v_till_id uuid;
  v_method text:=coalesce(nullif(trim(p_payment_method),''),'cash');
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('finance.manage') then raise exception 'Permission denied: finance.manage'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Expense amount must be greater than zero'; end if;
  if coalesce(trim(p_description),'')='' then raise exception 'Expense description is required'; end if;
  if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then
    raise exception 'Location not found';
  end if;

  if v_method='cash' then
    select id into v_till_id
    from public.till_sessions
    where organization_id=v_org and location_id=p_location_id and user_id=auth.uid() and status='open'
    order by opened_at desc limit 1;

    if v_till_id is null then raise exception 'Open your till before recording a cash expense'; end if;
  end if;

  if p_bank_account_id is not null and not exists(
    select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true
  ) then raise exception 'Bank account not found'; end if;

  insert into public.expenses(
    organization_id,location_id,category,description,amount,payment_method,reference,
    recorded_by,notes,till_session_id,bank_account_id
  )
  values(
    v_org,p_location_id,coalesce(nullif(trim(p_category),''),'Other'),trim(p_description),
    p_amount,v_method,nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  )
  returning id into v_id;

  if v_method='cash' then
    insert into public.payments(
      organization_id,location_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
    )
    values(
      v_org,p_location_id,'out','expense','cash',p_amount,nullif(trim(p_reference),''),
      coalesce(p_notes,p_description),auth.uid(),v_till_id
    );
  elsif p_bank_account_id is not null then
    insert into public.banking_transactions(
      source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
    )
    values(
      v_id,v_org,p_location_id,p_bank_account_id,'withdrawal',p_amount,'confirmed',
      nullif(trim(p_reference),''),coalesce(p_notes,p_description),auth.uid()
    );
  end if;

  insert into public.audit_log(
    organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    v_org,p_location_id,auth.uid(),'expense_posted','expense',v_id::text,p_description,
    jsonb_build_object('amount',p_amount,'category',p_category,'method',v_method,'bank_account_id',p_bank_account_id)
  );

  return v_id;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.post_project_expense(p_project_id uuid, p_category text, p_description text, p_amount numeric, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_project public.projects%rowtype;
 v_method text:=nullif(trim(p_payment_method),'');
 v_till_id uuid;
 v_finance_expense_id uuid;
 v_project_expense_id uuid;
 v_status text:='accrued';
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('projects.costs') or public.has_permission('projects.manage')) then raise exception 'Permission denied: projects.costs'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Expense amount must be greater than zero'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Expense description is required'; end if;

 select * into v_project from public.projects where id=p_project_id and organization_id=v_org and status<>'cancelled';
 if not found then raise exception 'Project not found'; end if;

 if v_method is not null then
  v_status:='paid';
  if v_method='cash' then
   select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_project.location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
   if v_till_id is null then raise exception 'Open your till before paying a project expense in cash'; end if;
  else
   if p_bank_account_id is null then raise exception 'Choose the financial account used for this project expense'; end if;
   if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
  end if;

  insert into public.expenses(
   organization_id,location_id,project_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
  ) values(
   v_org,v_project.location_id,v_project.id,coalesce(nullif(trim(p_category),''),'Project'),trim(p_description),
   p_amount,v_method,nullif(trim(p_reference),''),auth.uid(),p_notes,v_till_id,p_bank_account_id
  ) returning id into v_finance_expense_id;

  if v_method='cash' then
   insert into public.payments(
    organization_id,location_id,project_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
   ) values(
    v_org,v_project.location_id,v_project.id,'out','project_expense','cash',p_amount,
    nullif(trim(p_reference),''),coalesce(p_notes,p_description),auth.uid(),v_till_id
   );
  else
   insert into public.banking_transactions(
    source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
   ) values(
    v_finance_expense_id,v_org,v_project.location_id,p_bank_account_id,'withdrawal',p_amount,'confirmed',
    nullif(trim(p_reference),''),'Project expense - '||v_project.project_number||' - '||trim(p_description),auth.uid()
   );
  end if;
 end if;

 insert into public.project_expenses(
  organization_id,project_id,location_id,category,description,amount,status,payment_method,reference,
  bank_account_id,finance_expense_id,notes,recorded_by,paid_at
 ) values(
  v_org,v_project.id,v_project.location_id,coalesce(nullif(trim(p_category),''),'Project'),trim(p_description),
  p_amount,v_status,v_method,nullif(trim(p_reference),''),p_bank_account_id,v_finance_expense_id,p_notes,auth.uid(),
  case when v_status='paid' then now() else null end
 ) returning id into v_project_expense_id;

 perform public.recalculate_project_totals(v_project.id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_project.id,'expense_recorded',trim(p_description),
  jsonb_build_object('project_expense_id',v_project_expense_id,'amount',p_amount,'status',v_status,'payment_method',v_method),auth.uid());

 return jsonb_build_object('project_expense_id',v_project_expense_id,'status',v_status,'finance_expense_id',v_finance_expense_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_fuel_log(p_vehicle_id uuid, p_odometer numeric, p_quantity numeric, p_unit_cost numeric, p_supplier text DEFAULT NULL::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text, p_payment_method text DEFAULT NULL::text, p_bank_account_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
   insert into public.banking_transactions(source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by)
   values(v_expense_id,v_org,v_vehicle.location_id,p_bank_account_id,'withdrawal',v_total,'confirmed',nullif(trim(p_reference),''),'Fuel - '||v_vehicle.registration_number,auth.uid());
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
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_payroll_payment(p_payroll_entry_id uuid, p_method text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_entry public.payroll_entries%rowtype;
 v_period public.payroll_periods%rowtype;
 v_user public.users%rowtype;
 v_location uuid;
 v_till_id uuid;
 v_expense_id uuid;
 v_method text:=coalesce(nullif(trim(p_method),''),'bank');
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('payroll.pay') then raise exception 'Permission denied: payroll.pay'; end if;

 select * into v_entry from public.payroll_entries
 where id=p_payroll_entry_id and organization_id=v_org and payment_status='unpaid' for update;
 if not found then raise exception 'Unpaid payroll entry not found'; end if;
 select * into v_period from public.payroll_periods where id=v_entry.payroll_period_id and organization_id=v_org for update;
 if not found or v_period.status not in ('approved','paid') then raise exception 'Payroll period must be approved before payment'; end if;
 select * into v_user from public.users where id=v_entry.user_id and organization_id=v_org;
 if not found then raise exception 'Employee not found'; end if;

 v_location:=coalesce(v_entry.location_id,v_user.default_location_id,(select id from public.locations where organization_id=v_org and active=true order by created_at limit 1));
 if v_location is null then raise exception 'No business location available for payroll payment'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_location and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before paying payroll in cash'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account used for this payroll payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 insert into public.expenses(
  organization_id,location_id,category,description,amount,payment_method,reference,recorded_by,notes,till_session_id,bank_account_id
 )
 values(
  v_org,v_location,'Payroll','Payroll - '||v_user.full_name||' - '||v_period.name,
  v_entry.net_pay,v_method,nullif(trim(p_reference),''),auth.uid(),
  'Payroll entry '||v_entry.id::text,v_till_id,p_bank_account_id
 ) returning id into v_expense_id;

 if v_method='cash' then
  insert into public.payments(
   organization_id,location_id,employee_user_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,v_location,v_entry.user_id,'out','payroll','cash',v_entry.net_pay,
   nullif(trim(p_reference),''),'Payroll - '||v_period.name,auth.uid(),v_till_id
  );
 else
  insert into public.banking_transactions(
   source_expense_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  )
  values(
   v_expense_id,v_org,v_location,p_bank_account_id,'withdrawal',v_entry.net_pay,'confirmed',
   nullif(trim(p_reference),''),'Payroll - '||v_user.full_name||' - '||v_period.name,auth.uid()
  );
 end if;

 update public.payroll_entries set
  payment_status='paid',paid_at=now(),payment_method=v_method,payment_reference=nullif(trim(p_reference),''),
  bank_account_id=p_bank_account_id,expense_id=v_expense_id
 where id=v_entry.id;

 update public.employee_commissions set status='paid'
 where organization_id=v_org and payroll_entry_id=v_entry.id and status='approved';

 if not exists(select 1 from public.payroll_entries where payroll_period_id=v_period.id and payment_status='unpaid') then
  update public.payroll_periods set status='paid',paid_at=now() where id=v_period.id;
 end if;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  v_org,v_location,auth.uid(),'payroll_paid','payroll_entry',v_entry.id::text,v_user.full_name,
  jsonb_build_object('amount',v_entry.net_pay,'method',v_method,'period',v_period.name)
 );

 return jsonb_build_object('payroll_entry_id',v_entry.id,'status','paid','amount',v_entry.net_pay,'expense_id',v_expense_id);
end; $function$
;

CREATE OR REPLACE FUNCTION public.record_project_invoice_payment(p_invoice_id uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_bank_account_id uuid DEFAULT NULL::uuid, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_payment_id uuid;
 v_org uuid:=public.current_organization_id();
 v_invoice public.project_invoices%rowtype;
 v_project public.projects%rowtype;
 v_method text:=coalesce(nullif(trim(p_method),''),'cash');
 v_till_id uuid;
 v_new_paid numeric(18,2);
 v_status text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (
  public.has_permission('projects.billing')
  or public.has_permission('projects.manage')
  or public.has_permission('finance.manage')
 ) then raise exception 'Permission denied: projects.billing'; end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_invoice from public.project_invoices
 where id=p_invoice_id and organization_id=v_org and status in ('issued','partial') for update;
 if not found then raise exception 'Open project invoice not found'; end if;
 select * into v_project from public.projects where id=v_invoice.project_id and organization_id=v_org;
 if not found then raise exception 'Project not found'; end if;
 if v_invoice.amount_paid+p_amount>v_invoice.total_amount+0.009 then raise exception 'Payment exceeds invoice balance'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
  where organization_id=v_org and location_id=v_invoice.location_id and user_id=auth.uid() and status='open'
  order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before accepting a cash project payment'; end if;
 else
  if p_bank_account_id is null then raise exception 'Choose the financial account receiving this payment'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Financial account not found'; end if;
 end if;

 v_new_paid:=v_invoice.amount_paid+p_amount;
 v_status:=case when v_new_paid>=v_invoice.total_amount-0.009 then 'paid' else 'partial' end;

 insert into public.payments(
  organization_id,location_id,customer_id,project_id,project_invoice_id,direction,payment_type,method,
  amount,reference,notes,received_by,till_session_id
 ) values(
  v_org,v_invoice.location_id,v_invoice.customer_id,v_invoice.project_id,v_invoice.id,'in','project_invoice',
  v_method,p_amount,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
 ) returning id into v_payment_id;

 if v_method<>'cash' then
  insert into public.banking_transactions(
   source_payment_id,organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  ) values(
   v_payment_id,v_org,v_invoice.location_id,p_bank_account_id,'deposit',p_amount,'confirmed',
   nullif(trim(p_reference),''),'Project invoice '||v_invoice.invoice_number||' - '||v_project.project_number,auth.uid()
  );
 end if;

 update public.project_invoices set amount_paid=v_new_paid,status=v_status,updated_at=now() where id=v_invoice.id;
 perform public.recalculate_project_totals(v_invoice.project_id);

 insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
 values(v_org,v_invoice.project_id,'payment_received','Project invoice payment received',
  jsonb_build_object('invoice_id',v_invoice.id,'invoice_number',v_invoice.invoice_number,'amount',p_amount,'method',v_method,'status',v_status),auth.uid());

 return jsonb_build_object('invoice_id',v_invoice.id,'payment_status',v_status,'total_paid',v_new_paid,'balance',greatest(v_invoice.total_amount-v_new_paid,0));
end; $function$
;
