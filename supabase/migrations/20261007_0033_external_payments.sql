-- MGT Business Suite — universal external payments and provider connections

insert into public.permission_catalog(code,section,label,description,sort_order) values
 ('payments.view','Payments','View external payments','View mobile-money and external payment transactions',180),
 ('payments.request','Payments','Request external payments','Initiate customer mobile-money or external payment requests',181),
 ('payments.manage','Payments','Manage external payments','Reconcile and manage external payment transactions',182)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission) values
 ('manager','payments.view'),('manager','payments.request'),('manager','payments.manage'),
 ('accountant','payments.view'),('accountant','payments.request'),('accountant','payments.manage'),
 ('cashier','payments.view'),('cashier','payments.request'),
 ('salesperson','payments.view'),('salesperson','payments.request')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true
from public.organizations o
cross join (values
 ('owner','payments.view'),('owner','payments.request'),('owner','payments.manage'),
 ('admin','payments.view'),('admin','payments.request'),('admin','payments.manage'),
 ('manager','payments.view'),('manager','payments.request'),('manager','payments.manage'),
 ('accountant','payments.view'),('accountant','payments.request'),('accountant','payments.manage'),
 ('cashier','payments.view'),('cashier','payments.request'),
 ('salesperson','payments.view'),('salesperson','payments.request')
) x(role,permission)
on conflict(organization_id,role,permission) do update set allowed=true;

create table if not exists public.payment_provider_connections(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 provider text not null check(provider in ('mtn_momo','airtel_money','gateway')),
 name text not null,
 environment text not null default 'sandbox' check(environment in ('sandbox','production')),
 active boolean not null default false,
 country_code text not null default 'UG',
 currency text not null default 'UGX',
 public_config jsonb not null default '{}'::jsonb,
 vault_secret_id uuid,
 created_by uuid references public.users(id) on delete set null,
 updated_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,provider,name)
);
create index if not exists payment_provider_connections_org_idx on public.payment_provider_connections(organization_id,active,provider);

create table if not exists public.external_payment_transactions(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 connection_id uuid not null references public.payment_provider_connections(id) on delete restrict,
 provider text not null check(provider in ('mtn_momo','airtel_money','gateway')),
 transaction_type text not null default 'collection' check(transaction_type in ('collection','refund','disbursement')),
 target_type text not null check(target_type in ('sale','customer_debt','work_order','project_invoice','online_order','pos_checkout','unallocated')),
 target_id uuid,
 location_id uuid references public.locations(id) on delete set null,
 customer_id uuid references public.customers(id) on delete set null,
 amount numeric(18,2) not null check(amount>0),
 currency text not null default 'UGX',
 payer_phone text,
 external_reference text not null,
 provider_reference text,
 provider_financial_id text,
 status text not null default 'created' check(status in ('created','pending','succeeded','failed','cancelled','expired')),
 settlement_status text not null default 'pending' check(settlement_status in ('pending','settled','reconciliation_required','skipped')),
 provider_status text,
 failure_reason text,
 request_payload jsonb not null default '{}'::jsonb,
 response_payload jsonb not null default '{}'::jsonb,
 metadata jsonb not null default '{}'::jsonb,
 client_token_hash text,
 initiated_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 completed_at timestamptz,
 settled_at timestamptz,
 settlement_result jsonb not null default '{}'::jsonb,
 unique(organization_id,external_reference)
);
create index if not exists external_payment_org_status_idx on public.external_payment_transactions(organization_id,status,settlement_status,created_at desc);
create unique index if not exists external_payment_provider_ref_idx on public.external_payment_transactions(connection_id,provider_reference) where provider_reference is not null;
create index if not exists external_payment_target_idx on public.external_payment_transactions(organization_id,target_type,target_id,created_at desc);

create table if not exists public.external_payment_events(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 transaction_id uuid not null references public.external_payment_transactions(id) on delete cascade,
 event_type text not null,
 status text,
 provider_status text,
 payload jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now()
);
create index if not exists external_payment_events_tx_idx on public.external_payment_events(transaction_id,created_at);

alter table public.payment_provider_connections enable row level security;
alter table public.external_payment_transactions enable row level security;
alter table public.external_payment_events enable row level security;

drop policy if exists payment_provider_connections_select on public.payment_provider_connections;
create policy payment_provider_connections_select on public.payment_provider_connections
for select to authenticated using(
 public.has_organization_access(organization_id) and public.has_permission('integrations.view')
);

drop policy if exists external_payment_transactions_select on public.external_payment_transactions;
create policy external_payment_transactions_select on public.external_payment_transactions
for select to authenticated using(
 public.has_organization_access(organization_id) and (initiated_by=auth.uid() or public.has_permission('payments.view'))
);

drop policy if exists external_payment_events_select on public.external_payment_events;
create policy external_payment_events_select on public.external_payment_events
for select to authenticated using(
 exists(
  select 1 from public.external_payment_transactions t
  where t.id=transaction_id
    and public.has_organization_access(t.organization_id)
    and (t.initiated_by=auth.uid() or public.has_permission('payments.view'))
 )
);

revoke all on public.payment_provider_connections from anon,authenticated;
revoke all on public.external_payment_transactions from anon,authenticated;
revoke all on public.external_payment_events from anon,authenticated;
grant select on public.external_payment_transactions,public.external_payment_events to authenticated;

CREATE OR REPLACE FUNCTION public.notify_external_payment_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_title text;
  v_body text;
  v_severity text;
  v_recipient uuid;
  v_permission text;
begin
  if tg_op<>'UPDATE' then return new; end if;

  if new.status='succeeded' and new.settlement_status='settled'
     and (old.status is distinct from new.status or old.settlement_status is distinct from new.settlement_status) then
    v_title:='Mobile-money payment confirmed';
    v_body:=coalesce(new.external_reference,'Payment')||' · '||trim(to_char(new.amount,'FM999G999G999G990D00'))||' '||new.currency;
    v_severity:='success';
    v_recipient:=new.initiated_by;
    v_permission:=case when new.initiated_by is null then
      case when new.target_type='online_order' then 'ecommerce.orders' else 'payments.view' end
      else null end;

    perform public.emit_notification(
      new.organization_id,v_recipient,v_permission,'external-payment-settled-'||new.id,
      'finance',v_severity,v_title,v_body,'/payments','Open payments',
      'external_payment',new.id::text,'payment_provider',
      jsonb_build_object('provider',new.provider,'target_type',new.target_type,'amount',new.amount,'currency',new.currency),null
    );
  elsif new.status in ('failed','cancelled','expired') and old.status is distinct from new.status then
    v_title:='Mobile-money payment '||replace(new.status,'_',' ');
    v_body:=coalesce(new.external_reference,'Payment')||' · '||coalesce(new.failure_reason,new.provider_status,'Provider did not complete the payment');
    v_recipient:=new.initiated_by;
    v_permission:=case when new.initiated_by is null then
      case when new.target_type='online_order' then 'ecommerce.orders' else 'payments.view' end
      else null end;

    perform public.emit_notification(
      new.organization_id,v_recipient,v_permission,'external-payment-result-'||new.id||'-'||new.status,
      'finance','critical',v_title,v_body,'/payments','Open payments',
      'external_payment',new.id::text,'payment_provider',
      jsonb_build_object('provider',new.provider,'target_type',new.target_type,'status',new.status),null
    );
  end if;

  if new.status='succeeded' and new.settlement_status='reconciliation_required'
     and new.target_type<>'pos_checkout'
     and old.settlement_status is distinct from new.settlement_status then
    perform public.emit_notification(
      new.organization_id,null,'payments.manage','external-payment-reconcile-'||new.id,
      'finance','warning','Payment needs reconciliation',
      coalesce(new.external_reference,'Payment')||' was confirmed by '||
        case new.provider when 'mtn_momo' then 'MTN MoMo' when 'airtel_money' then 'Airtel Money' else 'the provider' end||
        ' but is not yet linked to an MGT business record.',
      '/payments','Reconcile payment','external_payment',new.id::text,'payment_provider',
      jsonb_build_object('provider',new.provider,'target_type',new.target_type,'amount',new.amount,'currency',new.currency),null
    );
  end if;

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.server_delete_payment_provider_connection(p_organization_id uuid, p_user_id uuid, p_connection_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare v_secret uuid;v_name text;
begin
 select vault_secret_id,name into v_secret,v_name
 from public.payment_provider_connections
 where id=p_connection_id and organization_id=p_organization_id
 for update;
 if not found then raise exception 'Payment provider connection not found'; end if;

 if exists(select 1 from public.external_payment_transactions where connection_id=p_connection_id) then
  update public.payment_provider_connections set active=false,updated_by=p_user_id,updated_at=now() where id=p_connection_id;
 else
  delete from public.payment_provider_connections where id=p_connection_id;
  if v_secret is not null then delete from vault.secrets where id=v_secret; end if;
 end if;

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary)
 values(p_organization_id,p_user_id,'payment_provider_connection_removed','payment_provider_connection',p_connection_id::text,'Payment provider connection removed/disabled: '||coalesce(v_name,'Provider'));
end;
$function$;

CREATE OR REPLACE FUNCTION public.server_get_payment_provider_connection(p_organization_id uuid, p_connection_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare c public.payment_provider_connections%rowtype;v_secret jsonb:='{}'::jsonb;
begin
 select * into c from public.payment_provider_connections
 where id=p_connection_id and organization_id=p_organization_id;
 if not found then raise exception 'Payment provider connection not found'; end if;

 if c.vault_secret_id is not null then
  select decrypted_secret::jsonb into v_secret
  from vault.decrypted_secrets where id=c.vault_secret_id;
 end if;

 return jsonb_build_object(
  'id',c.id,'organization_id',c.organization_id,'provider',c.provider,'name',c.name,
  'environment',c.environment,'active',c.active,'country_code',c.country_code,'currency',c.currency,
  'public_config',c.public_config,'credentials',coalesce(v_secret,'{}'::jsonb)
 );
end;
$function$;

CREATE OR REPLACE FUNCTION public.server_link_pos_external_payment(p_transaction_id uuid, p_sale_id uuid, p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare t public.external_payment_transactions%rowtype;s public.sales%rowtype;v_reference text;v_method text;
begin
 select * into t from public.external_payment_transactions where id=p_transaction_id for update;
 if not found then raise exception 'External payment not found'; end if;
 if t.status<>'succeeded' then raise exception 'External payment is not successful'; end if;
 if t.target_type<>'pos_checkout' then raise exception 'External payment is not a POS checkout'; end if;
 select * into s from public.sales where id=p_sale_id and organization_id=t.organization_id;
 if not found then raise exception 'Sale not found'; end if;
 v_method:=case t.provider when 'mtn_momo' then 'mtn_momo' when 'airtel_money' then 'airtel_money' else 'mobile_money' end;
 v_reference:=coalesce(nullif(t.provider_financial_id,''),nullif(t.provider_reference,''),t.external_reference);
 if not exists(select 1 from public.payments where sale_id=s.id and method=v_method and reference=v_reference and abs(amount-t.amount)<=0.009) then
  raise exception 'Matching POS payment record not found';
 end if;
 update public.external_payment_transactions
 set target_type='sale',target_id=s.id,customer_id=s.customer_id,location_id=s.location_id,settlement_status='settled',settled_at=now(),
     settlement_result=jsonb_build_object('settled',true,'sale_id',s.id,'sale_number',s.sale_number,'method',v_method,'reference',v_reference),updated_at=now()
 where id=t.id;
 insert into public.external_payment_events(organization_id,transaction_id,event_type,status,provider_status,payload)
 values(t.organization_id,t.id,'pos_sale_linked',t.status,t.provider_status,jsonb_build_object('sale_id',s.id,'sale_number',s.sale_number,'user_id',p_user_id));
 return jsonb_build_object('settled',true,'sale_id',s.id,'sale_number',s.sale_number);
end;
$function$;

CREATE OR REPLACE FUNCTION public.server_save_payment_provider_connection(p_organization_id uuid, p_user_id uuid, p_connection_id uuid, p_provider text, p_name text, p_environment text, p_active boolean, p_country_code text, p_currency text, p_public_config jsonb, p_credentials jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'vault'
AS $function$
declare
 v_id uuid:=p_connection_id;
 v_secret_id uuid;
 v_secret_name text;
begin
 if p_provider not in ('mtn_momo','airtel_money','gateway') then raise exception 'Unsupported payment provider'; end if;
 if p_environment not in ('sandbox','production') then raise exception 'Invalid provider environment'; end if;
 if coalesce(trim(p_name),'')='' then raise exception 'Connection name is required'; end if;
 if not exists(select 1 from public.users where id=p_user_id and organization_id=p_organization_id and active=true) then
  raise exception 'Invalid connection owner';
 end if;

 if v_id is not null then
  select vault_secret_id into v_secret_id
  from public.payment_provider_connections
  where id=v_id and organization_id=p_organization_id
  for update;
  if not found then raise exception 'Payment provider connection not found'; end if;
 else
  v_id:=gen_random_uuid();
 end if;

 v_secret_name:='mgt_payment_provider_'||v_id::text;

 if p_credentials is not null and p_credentials<>'{}'::jsonb then
  if v_secret_id is null then
   v_secret_id:=vault.create_secret(p_credentials::text,v_secret_name,'MGT encrypted payment-provider credentials');
  else
   perform vault.update_secret(v_secret_id,p_credentials::text,v_secret_name,'MGT encrypted payment-provider credentials');
  end if;
 elsif v_secret_id is null then
  raise exception 'Provider credentials are required when creating a connection';
 end if;

 insert into public.payment_provider_connections(
  id,organization_id,provider,name,environment,active,country_code,currency,public_config,vault_secret_id,created_by,updated_by,updated_at
 )
 values(
  v_id,p_organization_id,p_provider,trim(p_name),p_environment,coalesce(p_active,false),
  upper(coalesce(nullif(trim(p_country_code),''),'UG')),upper(coalesce(nullif(trim(p_currency),''),'UGX')),
  coalesce(p_public_config,'{}'::jsonb),v_secret_id,p_user_id,p_user_id,now()
 )
 on conflict(id) do update set
  provider=excluded.provider,
  name=excluded.name,
  environment=excluded.environment,
  active=excluded.active,
  country_code=excluded.country_code,
  currency=excluded.currency,
  public_config=excluded.public_config,
  vault_secret_id=excluded.vault_secret_id,
  updated_by=p_user_id,
  updated_at=now();

 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(
  p_organization_id,p_user_id,'payment_provider_connection_saved','payment_provider_connection',v_id::text,
  'Payment provider connection saved: '||trim(p_name),
  jsonb_build_object('provider',p_provider,'environment',p_environment,'active',coalesce(p_active,false))
 );

 return v_id;
end;
$function$;

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
 v_method text;
 v_reference text;
 v_outstanding numeric(18,2);
 v_apply numeric(18,2);
 v_remaining numeric(18,2);
 v_new_paid numeric(18,2);
 v_total numeric(18,2);
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
  select coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0) into v_total
  from public.sales where organization_id=t.organization_id and customer_id=t.customer_id;
  if t.amount>v_total+0.009 then raise exception 'External payment exceeds customer balance'; end if;
  v_remaining:=t.amount;
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
   v_allocations:=v_allocations||jsonb_build_array(jsonb_build_object('sale_id',v_sale.id,'payment_id',v_payment_id,'amount',v_apply));
   v_remaining:=v_remaining-v_apply;
  end loop;

 elsif t.target_type='work_order' then
  select * into w from public.work_orders where id=t.target_id and organization_id=t.organization_id for update;
  if not found then raise exception 'Target work order not found'; end if;
  if w.status='cancelled' then raise exception 'Cancelled work orders cannot receive payment'; end if;
  select coalesce(sum(line_total),0) into v_total from public.work_order_lines where work_order_id=w.id;
  if v_total<=0 then v_total:=coalesce(w.final_amount,w.quoted_amount,0); end if;
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
   v_allocations:=jsonb_build_array(jsonb_build_object('online_order_id',o.id,'already_paid',true));
  else
   if abs(t.amount-o.total_amount)>0.009 then raise exception 'Online order payment must equal order total'; end if;
   update public.online_orders set payment_status='paid',payment_method=v_method,payment_reference=v_reference,updated_at=now() where id=o.id;
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


revoke all on function public.server_save_payment_provider_connection(uuid,uuid,uuid,text,text,text,boolean,text,text,jsonb,jsonb) from public;
revoke execute on function public.server_save_payment_provider_connection(uuid,uuid,uuid,text,text,text,boolean,text,text,jsonb,jsonb) from anon,authenticated;
grant execute on function public.server_save_payment_provider_connection(uuid,uuid,uuid,text,text,text,boolean,text,text,jsonb,jsonb) to service_role;

revoke all on function public.server_get_payment_provider_connection(uuid,uuid) from public;
revoke execute on function public.server_get_payment_provider_connection(uuid,uuid) from anon,authenticated;
grant execute on function public.server_get_payment_provider_connection(uuid,uuid) to service_role;

revoke all on function public.server_delete_payment_provider_connection(uuid,uuid,uuid) from public;
revoke execute on function public.server_delete_payment_provider_connection(uuid,uuid,uuid) from anon,authenticated;
grant execute on function public.server_delete_payment_provider_connection(uuid,uuid,uuid) to service_role;

revoke all on function public.server_link_pos_external_payment(uuid,uuid,uuid) from public;
revoke execute on function public.server_link_pos_external_payment(uuid,uuid,uuid) from anon,authenticated;
grant execute on function public.server_link_pos_external_payment(uuid,uuid,uuid) to service_role;

revoke all on function public.server_settle_external_payment(uuid) from public;
revoke execute on function public.server_settle_external_payment(uuid) from anon,authenticated;
grant execute on function public.server_settle_external_payment(uuid) to service_role;

revoke all on function public.notify_external_payment_change() from public;
revoke execute on function public.notify_external_payment_change() from anon,authenticated;

drop trigger if exists external_payment_notification_trigger on public.external_payment_transactions;
create trigger external_payment_notification_trigger
after update of status,settlement_status on public.external_payment_transactions
for each row execute function public.notify_external_payment_change();
