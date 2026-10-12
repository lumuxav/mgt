create or replace function public.accounting_sale_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;
begin
 if tg_table_name='sales' then
  if tg_op='UPDATE' and old.status in ('completed','partially_refunded','refunded') and new.status in ('completed','partially_refunded','refunded')
   and row(new.total_amount,new.tax_amount,new.subtotal,new.discount_amount,new.organization_id,new.location_id,new.customer_id,new.sold_by)
    is not distinct from row(old.total_amount,old.tax_amount,old.subtotal,old.discount_amount,old.organization_id,old.location_id,old.customer_id,old.sold_by) then return new; end if;
  v_id:=coalesce(new.id,old.id);
 else v_id:=coalesce(new.sale_id,old.sale_id); end if;
 perform public.accounting_sync_sale(v_id);
 return coalesce(new,old);
end; $$;
revoke all on function public.accounting_sale_trigger() from public,anon,authenticated;

create or replace function public.accounting_work_order_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and row(new.status,new.final_amount,new.completed_at,new.organization_id,new.location_id,new.customer_id,new.created_by)
  is not distinct from row(old.status,old.final_amount,old.completed_at,old.organization_id,old.location_id,old.customer_id,old.created_by) then return new; end if;
 perform public.accounting_sync_work_order(coalesce(new.id,old.id));
 return coalesce(new,old);
end; $$;
revoke all on function public.accounting_work_order_trigger() from public,anon,authenticated;

create or replace function public.accounting_project_invoice_trigger()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if tg_op='UPDATE' and old.status<>'void' and new.status<>'void'
  and row(new.total_amount,new.tax_amount,new.issue_date,new.organization_id,new.location_id,new.customer_id,new.project_id,new.created_by)
  is not distinct from row(old.total_amount,old.tax_amount,old.issue_date,old.organization_id,old.location_id,old.customer_id,old.project_id,old.created_by) then return new; end if;
 perform public.accounting_sync_project_invoice(coalesce(new.id,old.id));
 return coalesce(new,old);
end; $$;
revoke all on function public.accounting_project_invoice_trigger() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.accounting_write_journal(p_org uuid, p_location uuid, p_date date, p_source_type text, p_source_id text, p_description text, p_reference text, p_cash_flow_category text, p_lines jsonb, p_actor uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_journal_id uuid; v_existing uuid; v_number text; v_line jsonb; v_account uuid;
 v_debit numeric(18,2); v_credit numeric(18,2); v_total_debit numeric(18,2):=0; v_total_credit numeric(18,2):=0;
begin
 if p_org is null then raise exception 'Organization required'; end if;
 if p_date is null then raise exception 'Journal date required'; end if;
 if coalesce(trim(p_description),'')='' then raise exception 'Journal description required'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))<2 then raise exception 'A balanced journal requires at least two lines'; end if;
 if p_source_type<>'period_close' and exists(
  select 1 from public.accounting_periods where organization_id=p_org and status='closed' and p_date between start_date and end_date
 ) then raise exception 'Accounting period is closed for %',p_date; end if;

 select id into v_existing from public.accounting_journals
 where organization_id=p_org and source_type=p_source_type and source_id=p_source_id and status='posted'
 limit 1 for update;
 if v_existing is not null then
  if exists(select 1 from public.accounting_journals j join public.accounting_periods p on p.organization_id=j.organization_id and p.status='closed' and j.journal_date between p.start_date and p.end_date where j.id=v_existing) then raise exception 'Cannot replace an existing journal in a closed accounting period'; end if;
  delete from public.accounting_journals where id=v_existing;
 end if;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_debit:=round(coalesce(nullif(v_line->>'debit','')::numeric,0),2);
  v_credit:=round(coalesce(nullif(v_line->>'credit','')::numeric,0),2);
  if v_debit<0 or v_credit<0 or (v_debit>0 and v_credit>0) or (v_debit=0 and v_credit=0) then raise exception 'Each journal line must contain one positive debit or credit'; end if;
  v_total_debit:=v_total_debit+v_debit; v_total_credit:=v_total_credit+v_credit;
 end loop;
 if abs(v_total_debit-v_total_credit)>0.009 or v_total_debit<=0 then raise exception 'Journal is not balanced: debit %, credit %',v_total_debit,v_total_credit; end if;

 v_number:='JRN-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.accounting_journals(organization_id,location_id,journal_number,journal_date,status,source_type,source_id,description,reference,cash_flow_category,created_by,posted_by,posted_at)
 values(p_org,p_location,v_number,p_date,'posted',coalesce(nullif(trim(p_source_type),''),'manual'),p_source_id,trim(p_description),nullif(trim(p_reference),''),
  coalesce(nullif(trim(p_cash_flow_category),''),'operating'),p_actor,p_actor,now())
 returning id into v_journal_id;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_account:=null;
  if coalesce(v_line->>'account_id','')<>'' then
   select id into v_account from public.accounting_accounts where id=(v_line->>'account_id')::uuid and organization_id=p_org and active=true;
  elsif coalesce(v_line->>'code','')<>'' then
   v_account:=public.accounting_account_id(p_org,v_line->>'code');
  end if;
  if v_account is null then raise exception 'Journal account not found'; end if;

  insert into public.accounting_journal_lines(organization_id,journal_id,account_id,debit,credit,memo,customer_id,supplier_id,product_id,project_id)
  values(p_org,v_journal_id,v_account,
   round(coalesce(nullif(v_line->>'debit','')::numeric,0),2),
   round(coalesce(nullif(v_line->>'credit','')::numeric,0),2),
   nullif(v_line->>'memo',''),nullif(v_line->>'customer_id','')::uuid,nullif(v_line->>'supplier_id','')::uuid,
   nullif(v_line->>'product_id','')::uuid,nullif(v_line->>'project_id','')::uuid);
 end loop;
 return v_journal_id;
end;
$function$;
