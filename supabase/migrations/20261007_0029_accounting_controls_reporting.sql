-- MGT Business Suite — Advanced Accounting controls and reporting

create or replace function public.post_manual_journal(
 p_journal_date date,p_description text,p_reference text,p_lines jsonb,p_cash_flow_category text default 'operating',p_location_id uuid default null
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.manage') then raise exception 'Permission denied: accounting.manage';end if;
 v_id:=public.accounting_write_journal(v_org,p_location_id,p_journal_date,'manual',null,p_description,p_reference,p_cash_flow_category,p_lines,auth.uid());
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'manual_journal_posted','accounting_journal',v_id::text,p_description,jsonb_build_object('reference',p_reference));
 return v_id;
end;$$;
revoke all on function public.post_manual_journal(date,text,text,jsonb,text,uuid) from public;
revoke execute on function public.post_manual_journal(date,text,text,jsonb,text,uuid) from anon;
grant execute on function public.post_manual_journal(date,text,text,jsonb,text,uuid) to authenticated;

create or replace function public.reverse_accounting_journal(p_journal_id uuid,p_reverse_date date,p_reason text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();j public.accounting_journals%rowtype;l record;v_lines jsonb:='[]'::jsonb;v_new uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.manage') then raise exception 'Permission denied: accounting.manage';end if;
 select * into j from public.accounting_journals where id=p_journal_id and organization_id=v_org and status='posted' for update;
 if not found then raise exception 'Posted journal not found';end if;
 if j.source_type='period_close' then raise exception 'Reopen the accounting period instead of manually reversing its closing journal';end if;
 if exists(select 1 from public.accounting_periods where organization_id=v_org and status='closed' and p_reverse_date between start_date and end_date) then raise exception 'Reversal date is in a closed period';end if;
 for l in select * from public.accounting_journal_lines where journal_id=j.id loop
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object(
   'account_id',l.account_id,'debit',l.credit,'credit',l.debit,'memo',coalesce(p_reason,'Reversal of '||j.journal_number),
   'customer_id',l.customer_id,'supplier_id',l.supplier_id,'product_id',l.product_id,'project_id',l.project_id
  ));
 end loop;
 v_new:=public.accounting_write_journal(v_org,j.location_id,p_reverse_date,'reversal',j.id::text,coalesce(p_reason,'Reversal of '||j.journal_number),j.journal_number,j.cash_flow_category,v_lines,auth.uid());
 update public.accounting_journals set status='reversed',reversed_journal_id=v_new where id=j.id;
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,j.location_id,auth.uid(),'accounting_journal_reversed','accounting_journal',j.id::text,coalesce(p_reason,'Journal reversed'),jsonb_build_object('reversal_journal_id',v_new));
 return v_new;
end;$$;
revoke all on function public.reverse_accounting_journal(uuid,date,text) from public;
revoke execute on function public.reverse_accounting_journal(uuid,date,text) from anon;
grant execute on function public.reverse_accounting_journal(uuid,date,text) to authenticated;

create or replace function public.create_accounting_account(
 p_code text,p_name text,p_account_type text,p_subtype text,p_normal_balance text,p_cash_flow_category text default 'operating'
)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.manage') then raise exception 'Permission denied: accounting.manage';end if;
 insert into public.accounting_accounts(organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,allow_manual_entries)
 values(v_org,trim(p_code),trim(p_name),p_account_type,nullif(trim(p_subtype),''),p_normal_balance,p_cash_flow_category,true)
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_accounting_account(text,text,text,text,text,text) from public;
revoke execute on function public.create_accounting_account(text,text,text,text,text,text) from anon;
grant execute on function public.create_accounting_account(text,text,text,text,text,text) to authenticated;

create or replace function public.set_expense_account_mapping(p_category text,p_account_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.manage') then raise exception 'Permission denied: accounting.manage';end if;
 if not exists(select 1 from public.accounting_accounts where id=p_account_id and organization_id=v_org and active=true and account_type='expense') then raise exception 'Expense account not found';end if;
 insert into public.accounting_expense_mappings(organization_id,category_key,account_id)
 values(v_org,lower(trim(p_category)),p_account_id)
 on conflict(organization_id,category_key) do update set account_id=excluded.account_id
 returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.set_expense_account_mapping(text,uuid) from public;
revoke execute on function public.set_expense_account_mapping(text,uuid) from anon;
grant execute on function public.set_expense_account_mapping(text,uuid) to authenticated;

create or replace function public.save_accounting_tax_settings(
 p_tax_registered boolean,p_tax_number text,p_filing_frequency text,p_fiscal_year_start_month integer,p_accounting_basis text
)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.tax') then raise exception 'Permission denied: accounting.tax';end if;
 insert into public.accounting_settings(organization_id,tax_registered,tax_number,tax_filing_frequency,fiscal_year_start_month,accounting_basis,updated_at)
 values(v_org,coalesce(p_tax_registered,false),nullif(trim(p_tax_number),''),p_filing_frequency,p_fiscal_year_start_month,p_accounting_basis,now())
 on conflict(organization_id) do update set
  tax_registered=excluded.tax_registered,tax_number=excluded.tax_number,tax_filing_frequency=excluded.tax_filing_frequency,
  fiscal_year_start_month=excluded.fiscal_year_start_month,accounting_basis=excluded.accounting_basis,updated_at=now();
end;$$;
revoke all on function public.save_accounting_tax_settings(boolean,text,text,integer,text) from public;
revoke execute on function public.save_accounting_tax_settings(boolean,text,text,integer,text) from anon;
grant execute on function public.save_accounting_tax_settings(boolean,text,text,integer,text) to authenticated;

create or replace function public.save_accounting_tax_code(p_id uuid,p_code text,p_name text,p_rate numeric,p_scope text,p_active boolean default true)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_id uuid;v_output uuid;v_input uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.tax') then raise exception 'Permission denied: accounting.tax';end if;
 v_output:=public.accounting_account_id(v_org,'2100');v_input:=public.accounting_account_id(v_org,'1150');
 if p_id is null then
  insert into public.accounting_tax_codes(organization_id,code,name,rate,scope,output_account_id,input_account_id,active)
  values(v_org,upper(trim(p_code)),trim(p_name),p_rate,p_scope,v_output,v_input,coalesce(p_active,true)) returning id into v_id;
 else
  update public.accounting_tax_codes set code=upper(trim(p_code)),name=trim(p_name),rate=p_rate,scope=p_scope,active=coalesce(p_active,true),updated_at=now()
  where id=p_id and organization_id=v_org returning id into v_id;
  if v_id is null then raise exception 'Tax code not found';end if;
 end if;
 return v_id;
end;$$;
revoke all on function public.save_accounting_tax_code(uuid,text,text,numeric,text,boolean) from public;
revoke execute on function public.save_accounting_tax_code(uuid,text,text,numeric,text,boolean) from anon;
grant execute on function public.save_accounting_tax_code(uuid,text,text,numeric,text,boolean) to authenticated;

create or replace function public.create_accounting_period(p_name text,p_start_date date,p_end_date date)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_id uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.close') then raise exception 'Permission denied: accounting.close';end if;
 if p_end_date<p_start_date then raise exception 'Period end must be after start';end if;
 if exists(select 1 from public.accounting_periods where organization_id=v_org and daterange(start_date,end_date,'[]')&&daterange(p_start_date,p_end_date,'[]')) then raise exception 'Accounting periods cannot overlap';end if;
 insert into public.accounting_periods(organization_id,name,start_date,end_date,status,created_by)
 values(v_org,trim(p_name),p_start_date,p_end_date,'open',auth.uid()) returning id into v_id;
 return v_id;
end;$$;
revoke all on function public.create_accounting_period(text,date,date) from public;
revoke execute on function public.create_accounting_period(text,date,date) from anon;
grant execute on function public.create_accounting_period(text,date,date) to authenticated;

create or replace function public.close_accounting_period(p_period_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();p public.accounting_periods%rowtype;r record;v_lines jsonb:='[]'::jsonb;
 v_income numeric(18,2):=0;v_expense numeric(18,2):=0;v_net numeric(18,2);v_journal uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.close') then raise exception 'Permission denied: accounting.close';end if;
 select * into p from public.accounting_periods where id=p_period_id and organization_id=v_org for update;
 if not found then raise exception 'Accounting period not found';end if;
 if p.status='closed' then raise exception 'Period is already closed';end if;
 for r in
  select a.id,a.account_type,round(coalesce(sum(l.debit),0),2) debit_total,round(coalesce(sum(l.credit),0),2) credit_total
  from public.accounting_accounts a join public.accounting_journal_lines l on l.account_id=a.id join public.accounting_journals j on j.id=l.journal_id
  where a.organization_id=v_org and a.account_type in('income','expense')
   and j.status in('posted','reversed') and j.source_type<>'period_close' and j.journal_date between p.start_date and p.end_date
  group by a.id,a.account_type
 loop
  if r.account_type='income' then
   v_income:=v_income+(r.credit_total-r.debit_total);
   if r.credit_total-r.debit_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',r.id,'debit',r.credit_total-r.debit_total,'memo','Period close'));
   elsif r.debit_total-r.credit_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',r.id,'credit',r.debit_total-r.credit_total,'memo','Period close'));end if;
  else
   v_expense:=v_expense+(r.debit_total-r.credit_total);
   if r.debit_total-r.credit_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',r.id,'credit',r.debit_total-r.credit_total,'memo','Period close'));
   elsif r.credit_total-r.debit_total>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('account_id',r.id,'debit',r.credit_total-r.debit_total,'memo','Period close'));end if;
  end if;
 end loop;
 v_net:=round(v_income-v_expense,2);
 if v_net>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','3100','credit',v_net,'memo','Retained earnings'));
 elsif v_net<0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','3100','debit',abs(v_net),'memo','Retained earnings'));end if;
 if jsonb_array_length(v_lines)>=2 then
  v_journal:=public.accounting_write_journal(v_org,null,p.end_date,'period_close',p.id::text,'Close '||p.name,p.name,'noncash',v_lines,auth.uid());
 end if;
 update public.accounting_periods set status='closed',closed_by=auth.uid(),closed_at=now() where id=p.id;
 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'accounting_period_closed','accounting_period',p.id::text,'Accounting period closed: '||p.name,jsonb_build_object('closing_journal_id',v_journal,'net_income',v_net));
 return v_journal;
end;$$;
revoke all on function public.close_accounting_period(uuid) from public;
revoke execute on function public.close_accounting_period(uuid) from anon;
grant execute on function public.close_accounting_period(uuid) to authenticated;

create or replace function public.reopen_accounting_period(p_period_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();p public.accounting_periods%rowtype;j uuid;
begin
 if v_org is null then raise exception 'Active organization required';end if;
 if not public.has_permission('accounting.close') then raise exception 'Permission denied: accounting.close';end if;
 select * into p from public.accounting_periods where id=p_period_id and organization_id=v_org for update;
 if not found then raise exception 'Accounting period not found';end if;
 if p.status='open' then return;end if;
 if exists(select 1 from public.accounting_periods where organization_id=v_org and status='closed' and start_date>p.end_date) then raise exception 'Reopen later closed periods first';end if;
 select id into j from public.accounting_journals where organization_id=v_org and source_type='period_close' and source_id=p.id::text and status='posted' limit 1;
 if j is not null then delete from public.accounting_journals where id=j;end if;
 update public.accounting_periods set status='open',closed_by=null,closed_at=null where id=p.id;
 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,auth.uid(),'accounting_period_reopened','accounting_period',p.id::text,'Accounting period reopened: '||p.name);
end;$$;
revoke all on function public.reopen_accounting_period(uuid) from public;
revoke execute on function public.reopen_accounting_period(uuid) from anon;
grant execute on function public.reopen_accounting_period(uuid) to authenticated;

create or replace view public.accounting_general_ledger_v with(security_invoker=true) as
select j.organization_id,j.id journal_id,j.location_id,j.journal_number,j.journal_date,j.status,j.source_type,j.source_id,
 j.description,j.reference,j.cash_flow_category,j.posted_at,l.id line_id,l.account_id,a.code account_code,a.name account_name,
 a.account_type,a.subtype,a.normal_balance,l.debit,l.credit,l.memo,l.customer_id,l.supplier_id,l.product_id,l.project_id
from public.accounting_journals j
join public.accounting_journal_lines l on l.journal_id=j.id
join public.accounting_accounts a on a.id=l.account_id;
grant select on public.accounting_general_ledger_v to authenticated;

-- Security hardening carried forward from the previous e-commerce phase.
revoke execute on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) from public,anon;
grant execute on function public.create_online_order_public(text,text,text,text,text,text,text,text,jsonb) to service_role;
revoke execute on function public.record_online_order_payment(uuid,text,text) from public,anon;
grant execute on function public.record_online_order_payment(uuid,text,text) to authenticated;
revoke execute on function public.transition_online_order(uuid,text) from public,anon;
grant execute on function public.transition_online_order(uuid,text) to authenticated;
