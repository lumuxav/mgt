-- MGT Business Suite — Universal Finance Ledger

alter table public.bank_accounts
  add column if not exists opening_balance numeric(18,2) not null default 0;

alter table public.expenses
  add column if not exists notes text,
  add column if not exists till_session_id uuid references public.till_sessions(id) on delete set null,
  add column if not exists bank_account_id uuid references public.bank_accounts(id) on delete set null;

create index if not exists expenses_till_session_id_idx on public.expenses(till_session_id);
create index if not exists expenses_bank_account_id_idx on public.expenses(bank_account_id);

create or replace function public.post_expense(
  p_location_id uuid,
  p_category text,
  p_description text,
  p_amount numeric,
  p_payment_method text default 'cash',
  p_bank_account_id uuid default null,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
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
      organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
    )
    values(
      v_org,p_location_id,p_bank_account_id,'withdrawal',p_amount,'confirmed',
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
$$;

revoke all on function public.post_expense(uuid,text,text,numeric,text,uuid,text,text) from public;
revoke execute on function public.post_expense(uuid,text,text,numeric,text,uuid,text,text) from anon;
grant execute on function public.post_expense(uuid,text,text,numeric,text,uuid,text,text) to authenticated;

create or replace function public.record_bank_transaction(
  p_bank_account_id uuid,
  p_location_id uuid,
  p_transaction_type text,
  p_amount numeric,
  p_reference text default null,
  p_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_id uuid;
begin
  if v_org is null then raise exception 'Active organization required'; end if;
  if not public.has_permission('finance.manage') then raise exception 'Permission denied: finance.manage'; end if;
  if p_transaction_type not in ('deposit','withdrawal') then raise exception 'Transaction type must be deposit or withdrawal'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'Transaction amount must be greater than zero'; end if;
  if not exists(select 1 from public.bank_accounts where id=p_bank_account_id and organization_id=v_org and active=true) then raise exception 'Bank account not found'; end if;
  if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then raise exception 'Location not found'; end if;

  insert into public.banking_transactions(
    organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  )
  values(v_org,p_location_id,p_bank_account_id,p_transaction_type,p_amount,'confirmed',nullif(trim(p_reference),''),p_notes,auth.uid())
  returning id into v_id;

  insert into public.audit_log(
    organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
  )
  values(
    v_org,p_location_id,auth.uid(),'bank_transaction_posted','banking_transaction',v_id::text,p_transaction_type,
    jsonb_build_object('bank_account_id',p_bank_account_id,'amount',p_amount,'transaction_type',p_transaction_type)
  );

  return v_id;
end;
$$;

revoke all on function public.record_bank_transaction(uuid,uuid,text,numeric,text,text) from public;
revoke execute on function public.record_bank_transaction(uuid,uuid,text,numeric,text,text) from anon;
grant execute on function public.record_bank_transaction(uuid,uuid,text,numeric,text,text) to authenticated;

create or replace function public.bank_cash_from_till(
  p_till_session_id uuid,
  p_bank_account_id uuid,
  p_amount numeric,
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
  );

  insert into public.banking_transactions(
    organization_id,location_id,bank_account_id,transaction_type,amount,status,reference,notes,recorded_by
  )
  values(
    v_org,v_till.location_id,p_bank_account_id,'deposit',p_amount,'confirmed',
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
$$;

revoke all on function public.bank_cash_from_till(uuid,uuid,numeric,text,text) from public;
revoke execute on function public.bank_cash_from_till(uuid,uuid,numeric,text,text) from anon;
grant execute on function public.bank_cash_from_till(uuid,uuid,numeric,text,text) to authenticated;
