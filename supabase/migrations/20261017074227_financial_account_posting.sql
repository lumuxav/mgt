-- A selected financial account determines the ledger, including cash boxes.
create or replace function public.accounting_bank_account_code(p_type text)
returns text language sql immutable set search_path=public as $$
 select public.accounting_payment_account_code(case when p_type='cashbox' then 'cash' else p_type end)
$$;
revoke all on function public.accounting_bank_account_code(text) from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accounting_sync_expense(p_expense_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare e public.expenses%rowtype; v_expense_code text:='6000'; v_cash_code text; v_mapped uuid; v_lines jsonb:='[]'::jsonb;
begin
 select * into e from public.expenses where id=p_expense_id;
 if not found or coalesce(e.amount,0)<=0 then return; end if;
 select account_id into v_mapped from public.accounting_expense_mappings where organization_id=e.organization_id and category_key=lower(trim(e.category)) limit 1;

 v_cash_code:=coalesce((select public.accounting_bank_account_code(b.account_type)
  from public.bank_accounts b where b.id=e.bank_account_id and b.organization_id=e.organization_id and e.payment_method<>'cash'),
  public.accounting_payment_account_code(e.payment_method));
 if v_mapped is not null then
  v_lines:=jsonb_build_array(
   jsonb_build_object('account_id',v_mapped,'debit',e.amount,'project_id',e.project_id,'memo',e.description),
   jsonb_build_object('code',v_cash_code,'credit',e.amount,'memo','Expense payment')
  );
 else
  if lower(coalesce(e.category,'')) ~ '(payroll|salary|wage)' then v_expense_code:='6100';
  elsif lower(coalesce(e.category,'')) ~ '(fuel|maintenance|vehicle|fleet|repair)' then v_expense_code:='6300';
  elsif e.project_id is not null then v_expense_code:='5200';
  end if;
  v_lines:=jsonb_build_array(
   jsonb_build_object('code',v_expense_code,'debit',e.amount,'project_id',e.project_id,'memo',e.description),
   jsonb_build_object('code',v_cash_code,'credit',e.amount,'memo','Expense payment')
  );
 end if;

 perform public.accounting_write_journal(e.organization_id,e.location_id,e.created_at::date,'expense',e.id::text,e.description,e.reference,'operating',v_lines,e.recorded_by);
end; $function$;

CREATE OR REPLACE FUNCTION public.accounting_sync_payment(p_payment_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare p public.payments%rowtype; v_cash_code text; v_lines jsonb:='[]'::jsonb;
begin
 select * into p from public.payments where id=p_payment_id;
 if not found or coalesce(p.amount,0)<=0 then return; end if;

 if p.payment_type='expense' or p.employee_user_id is not null then
  perform public.accounting_remove_source_journal(p.organization_id,'payment',p.id::text);
  return;
 end if;

 v_cash_code:=coalesce((select public.accounting_bank_account_code(a.account_type)
  from public.banking_transactions b join public.bank_accounts a on a.id=b.bank_account_id and a.organization_id=b.organization_id
  where b.source_payment_id=p.id and b.organization_id=p.organization_id),
  public.accounting_payment_account_code(case when p.payment_type='bank_deposit' then 'bank' else p.method end));

 if p.payment_type='bank_deposit' then
  v_lines:=jsonb_build_array(
   jsonb_build_object('code',v_cash_code,'debit',p.amount,'memo','Cash deposited to bank'),
   jsonb_build_object('code','1000','credit',p.amount,'memo','Cash removed from till')
  );
 elsif p.supplier_id is not null or p.payment_type='supplier_payment' then
  v_lines:=jsonb_build_array(
   jsonb_build_object('code','2000','debit',p.amount,'supplier_id',p.supplier_id,'memo','Supplier payment'),
   jsonb_build_object('code',v_cash_code,'credit',p.amount,'memo','Payment out')
  );
 elsif p.direction='in' then
  v_lines:=jsonb_build_array(
   jsonb_build_object('code',v_cash_code,'debit',p.amount,'memo','Customer receipt'),
   jsonb_build_object('code','1100','credit',p.amount,'customer_id',p.customer_id,'project_id',p.project_id,'memo','Reduce receivable')
  );
 else
  v_lines:=jsonb_build_array(
   jsonb_build_object('code','1100','debit',p.amount,'customer_id',p.customer_id,'project_id',p.project_id,'memo','Refund / receivable adjustment'),
   jsonb_build_object('code',v_cash_code,'credit',p.amount,'memo','Refund paid')
  );
 end if;

 perform public.accounting_write_journal(p.organization_id,p.location_id,p.created_at::date,'payment',p.id::text,
  initcap(replace(coalesce(p.payment_type,'payment'),'_',' ')),p.reference,'operating',v_lines,p.received_by);
end; $function$;

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
  perform public.accounting_sync_payment(b.source_payment_id);
  return;
 end if;
 select public.accounting_bank_account_code(account_type) into v_code from public.bank_accounts where id=b.bank_account_id and organization_id=b.organization_id;
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
 v_code:=public.accounting_bank_account_code(new.account_type);
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
