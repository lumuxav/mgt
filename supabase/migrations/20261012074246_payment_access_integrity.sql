CREATE OR REPLACE FUNCTION public.server_settle_external_payment(p_transaction_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 t public.external_payment_transactions%rowtype;
 s public.sales%rowtype;
 w public.work_orders%rowtype;
 i public.project_invoices%rowtype;
 o public.online_orders%rowtype;
 v_sale public.sales%rowtype;
 v_customer public.customers%rowtype;
 v_method text;
 v_reference text;
 v_outstanding numeric(18,2);
 v_apply numeric(18,2);
 v_remaining numeric(18,2);
 v_new_paid numeric(18,2);
 v_total numeric(18,2);
 v_opening_due numeric(18,2):=0;
 v_existing numeric(18,2);
 v_status text;
 v_payment_id uuid;
 v_allocations jsonb:='[]'::jsonb;
begin
 select * into t from public.external_payment_transactions where id=p_transaction_id for update;
 if not found then raise exception 'External payment transaction not found'; end if;
 if t.status<>'succeeded' then return jsonb_build_object('settled',false,'reason','Provider transaction is not successful'); end if;
 if t.settlement_status='settled' then return t.settlement_result; end if;

 v_method:=case t.provider when 'mtn_momo' then 'mtn_momo' when 'airtel_money' then 'airtel_money' else 'mobile_money' end;
 v_reference:=coalesce(nullif(t.provider_financial_id,''),nullif(t.provider_reference,''),t.external_reference);

 if t.target_type='sale' then
  select * into s from public.sales where id=t.target_id and organization_id=t.organization_id for update;
  if not found then raise exception 'Target sale not found'; end if;
  v_outstanding:=greatest(s.total_amount-s.refunded_amount-s.amount_paid,0);
  if t.amount>v_outstanding+0.009 then raise exception 'External payment exceeds sale balance'; end if;
  v_new_paid:=s.amount_paid+t.amount;
  update public.sales set amount_paid=v_new_paid,payment_status=case when greatest(total_amount-refunded_amount-v_new_paid,0)<=0.009 then 'paid' else 'partial' end,updated_at=now() where id=s.id;
  insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by)
  values(t.organization_id,s.location_id,s.customer_id,s.id,'in','sale',v_method,t.amount,v_reference,'External payment '||t.external_reference,t.initiated_by)
  returning id into v_payment_id;
  v_allocations:=jsonb_build_array(jsonb_build_object('sale_id',s.id,'payment_id',v_payment_id,'amount',t.amount));

 elsif t.target_type='customer_debt' then
  if t.customer_id is null then raise exception 'Customer is required for debt settlement'; end if;

  select * into v_customer
  from public.customers
  where id=t.customer_id and organization_id=t.organization_id and active=true
  for update;
  if not found then raise exception 'Customer not found'; end if;

  v_opening_due:=greatest(coalesce(v_customer.opening_balance,0)-coalesce(v_customer.opening_balance_paid,0),0);

  select v_opening_due+coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0) into v_total
  from public.sales where organization_id=t.organization_id and customer_id=t.customer_id;

  if t.amount>v_total+0.009 then raise exception 'External payment exceeds customer balance'; end if;
  v_remaining:=t.amount;

  if v_opening_due>0 and v_remaining>0 then
   v_apply:=least(v_remaining,v_opening_due);
   update public.customers
   set opening_balance_paid=opening_balance_paid+v_apply,updated_at=now()
   where id=t.customer_id;

   insert into public.payments(organization_id,location_id,customer_id,direction,payment_type,method,amount,reference,notes,received_by)
   values(t.organization_id,t.location_id,t.customer_id,'in','debt_payment',v_method,v_apply,v_reference,'External opening-balance payment '||t.external_reference,t.initiated_by)
   returning id into v_payment_id;

   v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','opening_balance','payment_id',v_payment_id,'amount',v_apply));
   v_remaining:=v_remaining-v_apply;
  end if;

  for v_sale in
   select * from public.sales
   where organization_id=t.organization_id and customer_id=t.customer_id
     and greatest(total_amount-refunded_amount-amount_paid,0)>0.009
   order by created_at asc for update
  loop
   exit when v_remaining<=0.009;
   v_outstanding:=greatest(v_sale.total_amount-v_sale.refunded_amount-v_sale.amount_paid,0);
   v_apply:=least(v_remaining,v_outstanding);
   v_new_paid:=v_sale.amount_paid+v_apply;
   update public.sales set amount_paid=v_new_paid,payment_status=case when greatest(total_amount-refunded_amount-v_new_paid,0)<=0.009 then 'paid' else 'partial' end,updated_at=now() where id=v_sale.id;
   insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by)
   values(t.organization_id,coalesce(t.location_id,v_sale.location_id),t.customer_id,v_sale.id,'in','debt_payment',v_method,v_apply,v_reference,'External customer debt payment '||t.external_reference,t.initiated_by)
   returning id into v_payment_id;
   v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('type','sale','sale_id',v_sale.id,'payment_id',v_payment_id,'amount',v_apply));
   v_remaining:=v_remaining-v_apply;
  end loop;

 elsif t.target_type='work_order' then
  select * into w from public.work_orders where id=t.target_id and organization_id=t.organization_id for update;
  if not found then raise exception 'Target work order not found'; end if;
  if w.status='cancelled' then raise exception 'Cancelled work orders cannot receive payment'; end if;
  select coalesce(sum(line_total),0) into v_total from public.work_order_lines where work_order_id=w.id;
  if v_total<=0 then v_total:=coalesce(nullif(w.final_amount,0),w.quoted_amount,0); end if;
  select coalesce(sum(case when direction='in' then amount else -amount end),0) into v_existing from public.payments where work_order_id=w.id;
  if v_existing+t.amount>v_total+0.009 then raise exception 'External payment exceeds job balance'; end if;
  insert into public.payments(organization_id,location_id,customer_id,work_order_id,direction,payment_type,method,amount,reference,notes,received_by)
  values(t.organization_id,w.location_id,w.customer_id,w.id,'in',case when v_existing<=0 then 'job_deposit' else 'job_payment' end,v_method,t.amount,v_reference,'External job payment '||t.external_reference,t.initiated_by)
  returning id into v_payment_id;
  v_new_paid:=v_existing+t.amount;
  v_status:=case when v_new_paid>=v_total-0.009 then 'paid' else 'partial' end;
  update public.work_orders set amount_paid=v_new_paid,payment_status=v_status,final_amount=v_total,updated_at=now() where id=w.id;
  insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
  values(t.organization_id,w.id,'payment_received','External mobile-money payment received',jsonb_build_object('transaction_id',t.id,'amount',t.amount,'method',v_method,'reference',v_reference),t.initiated_by);
  v_allocations:=jsonb_build_array(jsonb_build_object('work_order_id',w.id,'payment_id',v_payment_id,'amount',t.amount));

 elsif t.target_type='project_invoice' then
  select * into i from public.project_invoices where id=t.target_id and organization_id=t.organization_id and status in ('issued','partial') for update;
  if not found then raise exception 'Open project invoice not found'; end if;
  if i.amount_paid+t.amount>i.total_amount+0.009 then raise exception 'External payment exceeds invoice balance'; end if;
  insert into public.payments(organization_id,location_id,customer_id,project_id,project_invoice_id,direction,payment_type,method,amount,reference,notes,received_by)
  values(t.organization_id,i.location_id,i.customer_id,i.project_id,i.id,'in','project_invoice',v_method,t.amount,v_reference,'External project invoice payment '||t.external_reference,t.initiated_by)
  returning id into v_payment_id;
  v_new_paid:=i.amount_paid+t.amount;
  v_status:=case when v_new_paid>=i.total_amount-0.009 then 'paid' else 'partial' end;
  update public.project_invoices set amount_paid=v_new_paid,status=v_status,updated_at=now() where id=i.id;
  perform public.recalculate_project_totals(i.project_id);
  insert into public.project_events(organization_id,project_id,event_type,description,metadata,user_id)
  values(t.organization_id,i.project_id,'payment_received','External mobile-money project payment received',jsonb_build_object('transaction_id',t.id,'invoice_id',i.id,'amount',t.amount,'method',v_method,'reference',v_reference),t.initiated_by);
  v_allocations:=jsonb_build_array(jsonb_build_object('project_invoice_id',i.id,'payment_id',v_payment_id,'amount',t.amount));

 elsif t.target_type='online_order' then
  select * into o from public.online_orders where id=t.target_id and organization_id=t.organization_id for update;
  if not found then raise exception 'Target online order not found'; end if;
  if o.status='cancelled' then raise exception 'Cancelled order cannot be paid'; end if;
  if o.payment_status='paid' then
   raise exception 'Online order is already paid. Reconcile this additional collection';
  else
   if abs(t.amount-o.total_amount)>0.009 then raise exception 'Online order payment must equal order total'; end if;
   if o.sale_id is not null then
    select * into s from public.sales where id=o.sale_id and organization_id=t.organization_id for update;
    if not found then raise exception 'Linked online-order sale not found'; end if;
    v_outstanding:=greatest(s.total_amount-s.refunded_amount-s.amount_paid,0);
    if t.amount>v_outstanding+0.009 then raise exception 'External payment exceeds linked sale balance'; end if;
    v_new_paid:=s.amount_paid+t.amount;
    update public.sales set amount_paid=v_new_paid,payment_status=case when v_outstanding-t.amount<=0.009 then 'paid' else 'partial' end,updated_at=now() where id=s.id;
    insert into public.payments(organization_id,location_id,customer_id,sale_id,direction,payment_type,method,amount,reference,notes,received_by)
    values(t.organization_id,s.location_id,s.customer_id,s.id,'in','sale',v_method,t.amount,v_reference,'External online-order payment '||t.external_reference,t.initiated_by)
    returning id into v_payment_id;
   end if;
   update public.online_orders set payment_status='paid' ,payment_method=v_method,payment_reference=v_reference,updated_at=now() where id=o.id;
   v_allocations:=jsonb_build_array(jsonb_build_object('online_order_id',o.id,'amount',t.amount));
  end if;

 elsif t.target_type in ('pos_checkout','unallocated') then
  update public.external_payment_transactions set settlement_status='reconciliation_required',settlement_result=jsonb_build_object('settled',false,'reason','Successful payment requires a linked business transaction'),updated_at=now() where id=t.id;
  return jsonb_build_object('settled',false,'settlement_status','reconciliation_required');

 else
  raise exception 'Unsupported settlement target';
 end if;

 update public.external_payment_transactions
 set settlement_status='settled',settled_at=now(),settlement_result=jsonb_build_object('settled',true,'method',v_method,'reference',v_reference,'allocations',v_allocations),updated_at=now()
 where id=t.id;

 insert into public.external_payment_events(organization_id,transaction_id,event_type,status,provider_status,payload)
 values(t.organization_id,t.id,'settled',t.status,t.provider_status,jsonb_build_object('method',v_method,'reference',v_reference,'allocations',v_allocations));

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(t.organization_id,t.location_id,t.initiated_by,'external_payment_settled','external_payment',t.id::text,'External payment settled: '||t.external_reference,jsonb_build_object('target_type',t.target_type,'target_id',t.target_id,'amount',t.amount,'provider',t.provider));

 return jsonb_build_object('settled',true,'settlement_status','settled','method',v_method,'reference',v_reference,'allocations',v_allocations);
end;
$function$;


CREATE OR REPLACE FUNCTION public.record_work_order_payment(p_work_order_id uuid, p_amount numeric, p_method text DEFAULT 'cash'::text, p_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
 v_org uuid:=public.current_organization_id();
 v_order public.work_orders%rowtype;
 v_total numeric(18,2);
 v_existing numeric(18,2);
 v_new_paid numeric(18,2);
 v_till_id uuid;
 v_method text:=coalesce(nullif(trim(p_method),''),'cash');
 v_status text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not (public.has_permission('services.pay') or public.has_permission('services.manage') or public.has_permission('finance.manage')) then
  raise exception 'Permission denied: services.pay';
 end if;
 if coalesce(p_amount,0)<=0 then raise exception 'Payment amount must be greater than zero'; end if;

 select * into v_order from public.work_orders where id=p_work_order_id and organization_id=v_org for update;
 if not found then raise exception 'Work order not found'; end if;
 if v_order.status='cancelled' then raise exception 'Cannot receive payment on a cancelled job'; end if;

 select coalesce(sum(line_total),0) into v_total from public.work_order_lines where work_order_id=v_order.id;
 if v_total<=0 then v_total:=coalesce(nullif(v_order.final_amount,0),v_order.quoted_amount,0); end if;
 if v_total<=0 then raise exception 'Add job charges or a quoted amount before receiving payment'; end if;

 select coalesce(sum(case when direction='in' then amount else -amount end),0)
 into v_existing from public.payments where work_order_id=v_order.id;

 if v_existing+p_amount>v_total+0.009 then raise exception 'Payment exceeds job balance'; end if;

 if v_method='cash' then
  select id into v_till_id from public.till_sessions
   where organization_id=v_org and location_id=v_order.location_id and user_id=auth.uid() and status='open'
   order by opened_at desc limit 1;
  if v_till_id is null then raise exception 'Open your till before accepting a cash job payment'; end if;
 end if;

 insert into public.payments(
  organization_id,location_id,customer_id,work_order_id,direction,payment_type,method,amount,
  reference,notes,received_by,till_session_id
 )
 values(
  v_org,v_order.location_id,v_order.customer_id,v_order.id,'in',
  case when v_existing<=0 then 'job_deposit' else 'job_payment' end,
  v_method,p_amount,nullif(trim(p_reference),''),p_notes,auth.uid(),v_till_id
 );

 v_new_paid:=v_existing+p_amount;
 v_status:=case when v_new_paid>=v_total-0.009 then 'paid' else 'partial' end;

 update public.work_orders
 set amount_paid=v_new_paid,payment_status=v_status,final_amount=v_total,updated_at=now()
 where id=v_order.id;

 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,v_order.id,'payment_received','Job payment received',
  jsonb_build_object('amount',p_amount,'method',v_method,'reference',p_reference,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0)),auth.uid());

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,v_order.location_id,auth.uid(),'work_order_payment_received','work_order',v_order.id::text,coalesce(v_order.job_number,v_order.title),
  jsonb_build_object('amount',p_amount,'method',v_method,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0)));

 return jsonb_build_object('work_order_id',v_order.id,'amount_paid',p_amount,'total_paid',v_new_paid,'balance',greatest(v_total-v_new_paid,0),'payment_status',v_status);
end; $function$;

create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public as $$
 select u.role from public.users u where u.id=auth.uid() and u.active and u.archived_at is null
 and (u.role in ('owner','admin','super_admin','system_admin') or exists(select 1 from public.roles r where r.organization_id=u.organization_id and r.key=u.role and r.active)) limit 1
$$;
create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
 select organization_id from public.users where id=auth.uid() and active and archived_at is null limit 1
$$;
revoke all on function public.current_user_role(),public.current_organization_id() from public,anon;
grant execute on function public.current_user_role(),public.current_organization_id() to authenticated;

create or replace function public.server_customer_sales_balance(p_organization_id uuid,p_customer_id uuid)
returns numeric language sql stable security definer set search_path=public as $$
 select greatest(c.opening_balance-c.opening_balance_paid,0)
 +coalesce((select sum(greatest(s.total_amount-s.refunded_amount-s.amount_paid,0)) from public.sales s where s.organization_id=p_organization_id and s.customer_id=c.id),0)
 from public.customers c where c.id=p_customer_id and c.organization_id=p_organization_id
$$;
revoke all on function public.server_customer_sales_balance(uuid,uuid) from public,anon,authenticated;
grant execute on function public.server_customer_sales_balance(uuid,uuid) to service_role;

revoke insert,update,delete on public.sale_returns,public.sale_return_items from anon,authenticated;
alter table public.sale_returns alter column created_at set default clock_timestamp();
alter table public.stock_balances add constraint stock_reservations_within_on_hand check(reserved_quantity>=0 and reserved_quantity<=quantity);
