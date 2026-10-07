-- MGT Business Suite — Finance consistency hardening

create index if not exists sale_returns_location_id_idx on public.sale_returns(location_id);
create index if not exists till_sessions_location_id_idx on public.till_sessions(location_id);

drop policy if exists till_sessions_select on public.till_sessions;
create policy till_sessions_select on public.till_sessions
for select to authenticated using(
  public.has_organization_access(organization_id)
  and (public.has_permission('sales.view') or public.has_permission('finance.view'))
);

create or replace function public.record_supplier_payment(
 p_supplier_id uuid,p_location_id uuid,p_amount numeric,p_method text default 'bank',
 p_reference text default null,p_notes text default null
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_supplier public.suppliers%rowtype;
 v_purchase public.purchases%rowtype;
 v_remaining numeric(18,2):=coalesce(p_amount,0);
 v_opening_due numeric(18,2);
 v_opening_apply numeric(18,2);
 v_purchase_due numeric(18,2);
 v_apply numeric(18,2);
 v_new_paid numeric(18,2);
 v_total_due numeric(18,2);
 v_allocations jsonb:='[]'::jsonb;
 v_method text:=coalesce(nullif(trim(p_method),''),'bank');
 v_till_id uuid;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('purchasing.pay') or public.has_permission('finance.manage')) then raise exception 'Permission denied'; end if;
 if v_remaining<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_supplier from public.suppliers
  where id=p_supplier_id and organization_id=v_org and active=true for update;
 if not found then raise exception 'Supplier not found'; end if;

 if not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org and active=true) then
  raise exception 'Location not found';
 end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=p_location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before recording a cash supplier payment'; end if;
 end if;

 v_opening_due:=greatest(v_supplier.opening_balance-v_supplier.opening_balance_paid,0);
 select v_opening_due+coalesce(sum(greatest(total_amount-amount_paid,0)),0)
 into v_total_due from public.purchases where organization_id=v_org and supplier_id=p_supplier_id;

 if v_remaining>v_total_due+0.009 then raise exception 'Payment exceeds supplier outstanding balance'; end if;

 if v_opening_due>0 and v_remaining>0 then
  v_opening_apply:=least(v_remaining,v_opening_due);
  update public.suppliers set opening_balance_paid=opening_balance_paid+v_opening_apply,updated_at=now() where id=p_supplier_id;

  insert into public.payments(
   organization_id,location_id,supplier_id,direction,payment_type,method,amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,p_location_id,p_supplier_id,'out','supplier_payment',v_method,
   v_opening_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
  );

  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','opening_balance','amount',v_opening_apply));
  v_remaining:=v_remaining-v_opening_apply;
 end if;

 for v_purchase in
  select * from public.purchases
  where organization_id=v_org and supplier_id=p_supplier_id and greatest(total_amount-amount_paid,0)>0.009
  order by created_at asc for update
 loop
  exit when v_remaining<=0.009;

  v_purchase_due:=greatest(v_purchase.total_amount-v_purchase.amount_paid,0);
  v_apply:=least(v_remaining,v_purchase_due);
  v_new_paid:=v_purchase.amount_paid+v_apply;

  update public.purchases set
   amount_paid=v_new_paid,
   payment_status=case when total_amount<=v_new_paid+0.009 then 'paid' else 'partial' end,
   updated_at=now()
  where id=v_purchase.id;

  insert into public.payments(
   organization_id,location_id,supplier_id,purchase_id,direction,payment_type,method,
   amount,reference,notes,received_by,till_session_id
  )
  values(
   v_org,p_location_id,p_supplier_id,v_purchase.id,'out','supplier_payment',v_method,
   v_apply,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
  );

  v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object(
   'type','purchase','purchase_id',v_purchase.id,'purchase_number',v_purchase.purchase_number,'amount',v_apply
  ));
  v_remaining:=v_remaining-v_apply;
 end loop;

 insert into public.audit_log(
  organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata
 )
 values(
  v_org,p_location_id,auth.uid(),'supplier_payment_recorded','supplier',p_supplier_id::text,'Supplier payment',
  jsonb_build_object('amount',p_amount,'method',v_method,'allocations',v_allocations,'till_session_id',v_till_id)
 );

 return jsonb_build_object(
  'amount_paid',p_amount,
  'remaining_balance',greatest(v_total_due-p_amount,0),
  'allocations',v_allocations
 );
end; $$;

revoke all on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) from public;
revoke execute on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) from anon;
grant execute on function public.record_supplier_payment(uuid,uuid,numeric,text,text,text) to authenticated;
