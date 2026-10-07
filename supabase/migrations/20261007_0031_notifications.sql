-- MGT Business Suite — in-app notifications, user preferences and workflow alerts

create table if not exists public.notifications(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  recipient_user_id uuid references public.users(id) on delete cascade,
  audience_permission text,
  dedupe_key text,
  category text not null default 'system' check(category in ('approvals','finance','inventory','operations','hr','projects','fleet','documents','system')),
  severity text not null default 'info' check(severity in ('info','success','warning','critical')),
  title text not null,
  body text,
  href text,
  action_label text,
  entity_type text,
  entity_id text,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  expires_at timestamptz
);

create unique index if not exists notifications_dedupe_idx
on public.notifications(
  organization_id,
  coalesce(recipient_user_id,'00000000-0000-0000-0000-000000000000'::uuid),
  dedupe_key
)
where dedupe_key is not null;

create index if not exists notifications_org_active_idx
on public.notifications(organization_id,created_at desc)
where resolved_at is null;

create index if not exists notifications_recipient_idx
on public.notifications(recipient_user_id,created_at desc)
where resolved_at is null;

create table if not exists public.notification_states(
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  read_at timestamptz,
  dismissed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(notification_id,user_id)
);

create index if not exists notification_states_user_idx
on public.notification_states(user_id,updated_at desc);

create table if not exists public.notification_preferences(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  browser_enabled boolean not null default false,
  categories jsonb not null default '{"approvals":true,"finance":true,"inventory":true,"operations":true,"hr":true,"projects":true,"fleet":true,"documents":true,"system":true}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(organization_id,user_id)
);

alter table public.notifications enable row level security;
alter table public.notification_states enable row level security;
alter table public.notification_preferences enable row level security;

drop policy if exists notifications_select on public.notifications;
create policy notifications_select on public.notifications
for select to authenticated
using(
  public.has_organization_access(organization_id)
  and (
    recipient_user_id = auth.uid()
    or (
      recipient_user_id is null
      and (audience_permission is null or public.has_permission(audience_permission))
    )
  )
);

drop policy if exists notification_states_select on public.notification_states;
create policy notification_states_select on public.notification_states
for select to authenticated
using(user_id=auth.uid());

drop policy if exists notification_preferences_select on public.notification_preferences;
create policy notification_preferences_select on public.notification_preferences
for select to authenticated
using(
  user_id=auth.uid()
  and public.has_organization_access(organization_id)
);

grant select on public.notifications,public.notification_states,public.notification_preferences to authenticated;

CREATE OR REPLACE FUNCTION public.dismiss_notification(p_notification_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1
    from public.notifications n
    where n.id=p_notification_id
      and public.has_organization_access(n.organization_id)
      and (
        n.recipient_user_id=v_user
        or (n.recipient_user_id is null and (n.audience_permission is null or public.has_permission(n.audience_permission)))
      )
  ) then raise exception 'Notification not available'; end if;

  insert into public.notification_states(notification_id,user_id,read_at,dismissed_at,updated_at)
  values(p_notification_id,v_user,now(),now(),now())
  on conflict(notification_id,user_id) do update set
    read_at=coalesce(public.notification_states.read_at,now()),
    dismissed_at=now(),
    updated_at=now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.emit_notification(p_organization_id uuid, p_recipient_user_id uuid, p_audience_permission text, p_dedupe_key text, p_category text, p_severity text, p_title text, p_body text, p_href text, p_action_label text, p_entity_type text, p_entity_id text, p_source text, p_metadata jsonb DEFAULT '{}'::jsonb, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_was_resolved boolean:=false;
begin
  if p_organization_id is null then raise exception 'Organization required'; end if;
  if p_category not in ('approvals','finance','inventory','operations','hr','projects','fleet','documents','system') then raise exception 'Invalid notification category'; end if;
  if p_severity not in ('info','success','warning','critical') then raise exception 'Invalid notification severity'; end if;

  if p_recipient_user_id is not null and not exists(
    select 1 from public.users
    where id=p_recipient_user_id and organization_id=p_organization_id and active=true
  ) then
    return null;
  end if;

  if p_audience_permission is not null and not exists(
    select 1 from public.permission_catalog where code=p_audience_permission
  ) then
    raise exception 'Unknown audience permission';
  end if;

  if p_dedupe_key is not null then
    select id,(resolved_at is not null) into v_id,v_was_resolved
    from public.notifications
    where organization_id=p_organization_id
      and recipient_user_id is not distinct from p_recipient_user_id
      and dedupe_key=p_dedupe_key
    limit 1;
  end if;

  if v_id is null then
    insert into public.notifications(
      organization_id,recipient_user_id,audience_permission,dedupe_key,category,severity,title,body,
      href,action_label,entity_type,entity_id,source,metadata,expires_at
    )
    values(
      p_organization_id,p_recipient_user_id,p_audience_permission,p_dedupe_key,p_category,p_severity,p_title,p_body,
      p_href,p_action_label,p_entity_type,p_entity_id,coalesce(nullif(p_source,''),'system'),coalesce(p_metadata,'{}'::jsonb),p_expires_at
    )
    returning id into v_id;
  else
    update public.notifications set
      audience_permission=p_audience_permission,
      category=p_category,
      severity=p_severity,
      title=p_title,
      body=p_body,
      href=p_href,
      action_label=p_action_label,
      entity_type=p_entity_type,
      entity_id=p_entity_id,
      source=coalesce(nullif(p_source,''),source),
      metadata=coalesce(p_metadata,'{}'::jsonb),
      expires_at=p_expires_at,
      resolved_at=null,
      updated_at=now()
    where id=v_id;

    if v_was_resolved then
      delete from public.notification_states where notification_id=v_id;
    end if;
  end if;

  return v_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_all_notifications_read()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid:=auth.uid();
  v_count integer:=0;
begin
  if v_user is null then raise exception 'Authentication required'; end if;

  with visible as (
    select n.id
    from public.notifications n
    where public.has_organization_access(n.organization_id)
      and n.resolved_at is null
      and (n.expires_at is null or n.expires_at>now())
      and (
        n.recipient_user_id=v_user
        or (n.recipient_user_id is null and (n.audience_permission is null or public.has_permission(n.audience_permission)))
      )
  ), upserted as (
    insert into public.notification_states(notification_id,user_id,read_at,updated_at)
    select id,v_user,now(),now() from visible
    on conflict(notification_id,user_id) do update set read_at=now(),updated_at=now()
    returning 1
  )
  select count(*) into v_count from upserted;

  return v_count;
end;
$function$;

CREATE OR REPLACE FUNCTION public.mark_notification_read(p_notification_id uuid, p_read boolean DEFAULT true)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid:=auth.uid();
begin
  if v_user is null then raise exception 'Authentication required'; end if;
  if not exists(
    select 1
    from public.notifications n
    where n.id=p_notification_id
      and public.has_organization_access(n.organization_id)
      and (
        n.recipient_user_id=v_user
        or (n.recipient_user_id is null and (n.audience_permission is null or public.has_permission(n.audience_permission)))
      )
  ) then raise exception 'Notification not available'; end if;

  insert into public.notification_states(notification_id,user_id,read_at,dismissed_at,updated_at)
  values(p_notification_id,v_user,case when p_read then now() else null end,null,now())
  on conflict(notification_id,user_id) do update set
    read_at=case when p_read then now() else null end,
    dismissed_at=null,
    updated_at=now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_approval_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if tg_op='INSERT' and new.status='pending' then
    perform public.emit_notification(
      new.organization_id,null,'approvals.view','approval-pending-'||new.id,
      'approvals','warning','Approval requested',new.title,
      '/approvals','Review approval','approval_request',new.id::text,'workflow',
      jsonb_build_object('request_type',new.request_type,'amount',new.amount),null
    );
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status<>'pending' then
    perform public.resolve_notification(new.organization_id,null,'approval-pending-'||new.id);
    if new.requested_by is not null then
      perform public.emit_notification(
        new.organization_id,new.requested_by,null,'approval-result-'||new.id||'-'||new.status,
        'approvals',case when new.status='approved' then 'success' when new.status='rejected' then 'critical' else 'info' end,
        'Approval '||new.status,new.title||case when new.review_notes is not null then ' · '||new.review_notes else '' end,
        '/approvals','Open approvals','approval_request',new.id::text,'workflow',
        jsonb_build_object('status',new.status,'request_type',new.request_type),null
      );
    end if;
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_delivery_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  if new.driver_user_id is not null and (tg_op='INSERT' or old.driver_user_id is distinct from new.driver_user_id) then
    perform public.emit_notification(
      new.organization_id,new.driver_user_id,null,'delivery-assigned-'||new.id||'-'||new.driver_user_id,
      'fleet','info','Delivery assigned',
      new.delivery_number||' · '||new.destination,
      '/fleet','Open delivery','delivery',new.id::text,'workflow',
      jsonb_build_object('scheduled_at',new.scheduled_at,'status',new.status),null
    );
  end if;

  if tg_op='UPDATE' and old.status is distinct from new.status and new.driver_user_id is not null then
    perform public.emit_notification(
      new.organization_id,new.driver_user_id,null,'delivery-status-'||new.id||'-'||new.status,
      'fleet',case when new.status='delivered' then 'success' when new.status='failed' then 'critical' else 'info' end,
      'Delivery '||replace(new.status,'_',' '),
      new.delivery_number||' · '||new.destination,
      '/fleet','Open delivery','delivery',new.id::text,'workflow',
      jsonb_build_object('status',new.status,'recipient_name',new.recipient_name,'failure_reason',new.failure_reason),null
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_leave_request_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_name text;
begin
  select full_name into v_name from public.users where id=new.user_id;
  if tg_op='INSERT' and new.status='pending' then
    perform public.emit_notification(
      new.organization_id,null,'leave.manage','leave-review-'||new.id,
      'hr','warning','Leave request awaiting review',
      coalesce(v_name,'Employee')||' requested '||new.total_days||' day(s) of leave',
      '/hr','Review leave','leave_request',new.id::text,'workflow',
      jsonb_build_object('user_id',new.user_id,'start_date',new.start_date,'end_date',new.end_date),null
    );
  elsif tg_op='UPDATE' and old.status is distinct from new.status and new.status<>'pending' then
    perform public.resolve_notification(new.organization_id,null,'leave-review-'||new.id);
    perform public.emit_notification(
      new.organization_id,new.user_id,null,'leave-result-'||new.id||'-'||new.status,
      'hr',case when new.status='approved' then 'success' when new.status='rejected' then 'critical' else 'info' end,
      'Leave request '||new.status,
      to_char(new.start_date,'DD Mon YYYY')||' → '||to_char(new.end_date,'DD Mon YYYY')||
        case when new.review_notes is not null then ' · '||new.review_notes else '' end,
      '/hr','Open HR','leave_request',new.id::text,'workflow',
      jsonb_build_object('status',new.status),null
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_payroll_entry_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_period text;
begin
  select name into v_period from public.payroll_periods where id=new.payroll_period_id;
  if tg_op='INSERT' then
    perform public.emit_notification(
      new.organization_id,new.user_id,null,'payroll-entry-'||new.id,
      'hr','info','Payslip prepared',
      coalesce(v_period,'Payroll period')||' · net pay '||trim(to_char(new.net_pay,'FM999G999G999G990D00')),
      '/hr/payslips/'||new.id,'Open payslip','payroll_entry',new.id::text,'workflow',
      jsonb_build_object('payment_status',new.payment_status),null
    );
  elsif tg_op='UPDATE' and old.payment_status is distinct from new.payment_status and new.payment_status='paid' then
    perform public.emit_notification(
      new.organization_id,new.user_id,null,'payroll-paid-'||new.id,
      'hr','success','Payroll payment recorded',
      coalesce(v_period,'Payroll period')||' · net pay '||trim(to_char(new.net_pay,'FM999G999G999G990D00')),
      '/hr/payslips/'||new.id,'Open payslip','payroll_entry',new.id::text,'workflow',
      jsonb_build_object('paid_at',new.paid_at,'payment_method',new.payment_method),null
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_project_task_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_project text;
begin
  select project_number||' · '||name into v_project from public.projects where id=new.project_id;
  if new.assigned_user_id is not null and (tg_op='INSERT' or old.assigned_user_id is distinct from new.assigned_user_id) then
    perform public.emit_notification(
      new.organization_id,new.assigned_user_id,null,'project-task-assigned-'||new.id||'-'||new.assigned_user_id,
      'projects',case when new.priority='urgent' then 'warning' else 'info' end,
      'Project task assigned',new.title||' · '||coalesce(v_project,'Project'),
      '/projects','Open project','project_task',new.id::text,'workflow',
      jsonb_build_object('priority',new.priority,'due_date',new.due_date),null
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.notify_work_order_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_org uuid;v_job text;v_title text;
begin
  select organization_id,job_number,title into v_org,v_job,v_title
  from public.work_orders where id=new.work_order_id;
  if v_org is not null then
    perform public.emit_notification(
      v_org,new.user_id,null,'work-order-assigned-'||new.work_order_id||'-'||new.user_id,
      'operations','info','Service job assigned',
      coalesce(v_job,'Job')||' · '||coalesce(v_title,'Service job'),
      '/work-orders','Open job','work_order',new.work_order_id::text,'workflow','{}'::jsonb,null
    );
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.resolve_notification(p_organization_id uuid, p_recipient_user_id uuid, p_dedupe_key text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.notifications
  set resolved_at=coalesce(resolved_at,now()),updated_at=now()
  where organization_id=p_organization_id
    and recipient_user_id is not distinct from p_recipient_user_id
    and dedupe_key=p_dedupe_key
    and resolved_at is null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.save_notification_preferences(p_browser_enabled boolean, p_categories jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid:=auth.uid();
  v_org uuid:=public.current_organization_id();
begin
  if v_user is null or v_org is null then raise exception 'Active business session required'; end if;

  insert into public.notification_preferences(organization_id,user_id,browser_enabled,categories,updated_at)
  values(v_org,v_user,coalesce(p_browser_enabled,false),coalesce(p_categories,'{}'::jsonb),now())
  on conflict(organization_id,user_id) do update set
    browser_enabled=excluded.browser_enabled,
    categories=excluded.categories,
    updated_at=now();
end;
$function$;

CREATE OR REPLACE FUNCTION public.sync_my_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_user uuid:=auth.uid();
  v_org uuid:=public.current_organization_id();
  v_currency text;
  r record;
  v_count integer:=0;
  v_due numeric;
  v_available numeric;
  v_limit numeric;
  v_owed numeric;
  v_sync_started timestamptz:=now();
begin
  if v_user is null or v_org is null then return 0; end if;
  select currency into v_currency from public.organizations where id=v_org;

  for r in
    select sb.product_id,sb.location_id,sb.quantity,sb.reserved_quantity,p.name,p.sku,p.reorder_level,p.cost_price,l.name as location_name
    from public.stock_balances sb
    join public.products p on p.id=sb.product_id and p.organization_id=v_org and p.active=true and p.track_inventory=true
    join public.locations l on l.id=sb.location_id and l.organization_id=v_org
    where coalesce(p.reorder_level,0)>0
  loop
    v_available:=coalesce(r.quantity,0)-coalesce(r.reserved_quantity,0);
    if v_available<=coalesce(r.reorder_level,0) then
      perform public.emit_notification(
        v_org,null,'inventory.view','stock-'||r.product_id||'-'||r.location_id,
        'inventory',case when v_available<=0 then 'critical' else 'warning' end,
        case when v_available<=0 then 'Out of stock' else 'Low stock' end||': '||r.name,
        r.location_name||' · '||v_available||' available · reorder level '||r.reorder_level,
        '/inventory','Open inventory','product',r.product_id::text,'system_sync',
        jsonb_build_object('product_id',r.product_id,'location_id',r.location_id,'available',v_available,'reorder_level',r.reorder_level),null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select p.id,p.purchase_number,p.total_amount,p.amount_paid,p.due_date,p.payment_status,p.status,p.created_at,
           s.name as supplier_name,l.name as location_name
    from public.purchases p
    left join public.suppliers s on s.id=p.supplier_id
    left join public.locations l on l.id=p.location_id
    where p.organization_id=v_org
  loop
    v_due:=greatest(0,coalesce(r.total_amount,0)-coalesce(r.amount_paid,0));
    if r.due_date is not null and r.payment_status<>'paid' and v_due>0.009 and r.due_date<current_date then
      perform public.emit_notification(
        v_org,null,'purchasing.view','purchase-due-'||r.id,
        'finance','critical','Supplier payment overdue',
        coalesce(r.supplier_name,'Supplier')||' is owed '||trim(to_char(v_due,'FM999G999G999G990D00'))||' '||coalesce(v_currency,''),
        '/purchasing','Open purchasing','purchase',r.id::text,'system_sync',
        jsonb_build_object('purchase_number',r.purchase_number,'balance',v_due,'due_date',r.due_date),null
      );
      v_count:=v_count+1;
    end if;

    if r.status in ('ordered','partial') and r.created_at<now()-interval '7 days' then
      perform public.emit_notification(
        v_org,null,'purchasing.view','purchase-open-'||r.id,
        'operations','warning','Purchase order awaiting stock',
        coalesce(r.purchase_number,'Purchase order')||' has remained open for '||floor(extract(epoch from (now()-r.created_at))/86400)::int||' days',
        '/purchasing','Open purchasing','purchase',r.id::text,'system_sync',
        jsonb_build_object('status',r.status,'supplier',r.supplier_name),null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select c.id,c.name,c.credit_limit,
      coalesce(sum(greatest(0,coalesce(s.total_amount,0)-coalesce(s.refunded_amount,0)-coalesce(s.amount_paid,0))),0) as owed
    from public.customers c
    left join public.sales s on s.customer_id=c.id and s.organization_id=v_org
    where c.organization_id=v_org and c.active=true
    group by c.id,c.name,c.credit_limit
  loop
    v_owed:=coalesce(r.owed,0);v_limit:=coalesce(r.credit_limit,0);
    if v_limit>0 and v_owed>=v_limit*0.8 then
      perform public.emit_notification(
        v_org,null,'sales.view','credit-'||r.id,
        'finance',case when v_owed>v_limit then 'critical' else 'warning' end,
        case when v_owed>v_limit then 'Customer credit limit exceeded' else 'Customer credit limit warning' end,
        r.name||' owes '||trim(to_char(v_owed,'FM999G999G999G990D00'))||' '||coalesce(v_currency,'')||' against a limit of '||trim(to_char(v_limit,'FM999G999G999G990D00'))||' '||coalesce(v_currency,''),
        '/sales','Open customer credit','customer',r.id::text,'system_sync',
        jsonb_build_object('owed',v_owed,'credit_limit',v_limit),null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select w.id,w.job_number,w.title,w.status,w.priority,w.due_at,w.scheduled_at,c.name as customer_name,l.name as location_name
    from public.work_orders w
    left join public.customers c on c.id=w.customer_id
    left join public.locations l on l.id=w.location_id
    where w.organization_id=v_org and w.status not in ('completed','cancelled')
  loop
    if r.due_at is not null and r.due_at<now() then
      perform public.emit_notification(
        v_org,null,'services.view','job-overdue-'||r.id,
        'operations','critical','Service job overdue',
        coalesce(r.job_number,'Job')||' · '||r.title||' · due '||to_char(r.due_at,'DD Mon YYYY HH24:MI'),
        '/work-orders','Open service jobs','work_order',r.id::text,'system_sync',
        jsonb_build_object('priority',r.priority,'customer',r.customer_name),null
      );
      v_count:=v_count+1;
    elsif r.priority='urgent' then
      perform public.emit_notification(
        v_org,null,'services.view','job-urgent-'||r.id,
        'operations','warning','Urgent service job',
        coalesce(r.job_number,'Job')||' · '||r.title,
        '/work-orders','Open service jobs','work_order',r.id::text,'system_sync',
        jsonb_build_object('scheduled_at',r.scheduled_at,'customer',r.customer_name),null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select a.id,a.asset_number,a.name,a.next_service_date,l.name as location_name
    from public.assets a left join public.locations l on l.id=a.location_id
    where a.organization_id=v_org and a.active=true and a.next_service_date is not null
      and a.next_service_date<=current_date+7
  loop
    perform public.emit_notification(
      v_org,null,'assets.view','asset-service-'||r.id,
      'operations',case when r.next_service_date<current_date then 'critical' else 'warning' end,
      case when r.next_service_date<current_date then 'Asset service overdue' else 'Asset service due soon' end,
      coalesce(r.asset_number,'Asset')||' · '||r.name||' · '||coalesce(r.location_name,'Location')||' · '||to_char(r.next_service_date,'DD Mon YYYY'),
      '/assets','Open assets','asset',r.id::text,'system_sync',
      jsonb_build_object('next_service_date',r.next_service_date),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select m.id,m.maintenance_number,m.scheduled_date,m.status,m.priority,m.description,a.name as asset_name,a.asset_number
    from public.asset_maintenance m
    left join public.assets a on a.id=m.asset_id
    where m.organization_id=v_org and m.status in ('scheduled','in_progress')
      and m.scheduled_date is not null and m.scheduled_date<current_date
  loop
    perform public.emit_notification(
      v_org,null,'assets.view','maintenance-overdue-'||r.id,
      'operations','critical','Maintenance overdue',
      coalesce(r.maintenance_number,'Maintenance')||' · '||coalesce(r.asset_name,'Asset')||' · scheduled '||to_char(r.scheduled_date,'DD Mon YYYY'),
      '/assets','Open maintenance','asset_maintenance',r.id::text,'system_sync',
      jsonb_build_object('priority',r.priority,'description',r.description),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select id,registration_number,odometer,service_due_odometer,insurance_expiry,license_expiry
    from public.vehicles
    where organization_id=v_org and active=true
  loop
    if r.service_due_odometer is not null and coalesce(r.odometer,0)>=r.service_due_odometer then
      perform public.emit_notification(
        v_org,null,'fleet.view','vehicle-service-'||r.id,
        'fleet','warning','Vehicle service mileage reached',
        r.registration_number||' · odometer '||coalesce(r.odometer,0)||' km · service due at '||r.service_due_odometer||' km',
        '/fleet','Open fleet','vehicle',r.id::text,'system_sync','{}'::jsonb,null
      );
      v_count:=v_count+1;
    end if;
    if r.insurance_expiry is not null and r.insurance_expiry<=current_date+30 then
      perform public.emit_notification(
        v_org,null,'fleet.view','vehicle-insurance-'||r.id,
        'fleet',case when r.insurance_expiry<current_date then 'critical' else 'warning' end,
        case when r.insurance_expiry<current_date then 'Vehicle insurance expired' else 'Vehicle insurance expiring' end,
        r.registration_number||' · '||to_char(r.insurance_expiry,'DD Mon YYYY'),
        '/fleet','Open fleet','vehicle',r.id::text,'system_sync',jsonb_build_object('insurance_expiry',r.insurance_expiry),null
      );
      v_count:=v_count+1;
    end if;
    if r.license_expiry is not null and r.license_expiry<=current_date+30 then
      perform public.emit_notification(
        v_org,null,'fleet.view','vehicle-license-'||r.id,
        'fleet',case when r.license_expiry<current_date then 'critical' else 'warning' end,
        case when r.license_expiry<current_date then 'Vehicle licence expired' else 'Vehicle licence expiring' end,
        r.registration_number||' · '||to_char(r.license_expiry,'DD Mon YYYY'),
        '/fleet','Open fleet','vehicle',r.id::text,'system_sync',jsonb_build_object('license_expiry',r.license_expiry),null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select id,delivery_number,destination,status,scheduled_at
    from public.deliveries
    where organization_id=v_org and status not in ('delivered','cancelled','failed')
      and scheduled_at is not null and scheduled_at<now()
  loop
    perform public.emit_notification(
      v_org,null,'fleet.view','delivery-late-'||r.id,
      'fleet','critical','Delivery overdue',
      r.delivery_number||' · '||r.destination||' · scheduled '||to_char(r.scheduled_at,'DD Mon YYYY HH24:MI'),
      '/fleet','Open deliveries','delivery',r.id::text,'system_sync',jsonb_build_object('status',r.status),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select id,project_number,name,status,priority,due_date,progress_percent
    from public.projects
    where organization_id=v_org and status not in ('completed','cancelled')
  loop
    if r.due_date is not null and r.due_date<current_date then
      perform public.emit_notification(
        v_org,null,'projects.view','project-overdue-'||r.id,
        'projects','critical','Project overdue',
        r.project_number||' · '||r.name||' · '||coalesce(r.progress_percent,0)||'% complete · due '||to_char(r.due_date,'DD Mon YYYY'),
        '/projects','Open projects','project',r.id::text,'system_sync','{}'::jsonb,null
      );
      v_count:=v_count+1;
    elsif r.priority='urgent' then
      perform public.emit_notification(
        v_org,null,'projects.view','project-urgent-'||r.id,
        'projects','warning','Urgent project',
        r.project_number||' · '||r.name||' · '||coalesce(r.progress_percent,0)||'% complete',
        '/projects','Open projects','project',r.id::text,'system_sync','{}'::jsonb,null
      );
      v_count:=v_count+1;
    end if;
  end loop;

  for r in
    select t.id,t.title,t.due_date,t.assigned_user_id,p.project_number,p.name as project_name
    from public.project_tasks t join public.projects p on p.id=t.project_id
    where t.organization_id=v_org and t.status not in ('completed','cancelled')
      and t.due_date is not null and t.due_date<current_date
  loop
    perform public.emit_notification(
      v_org,case when r.assigned_user_id is not null then r.assigned_user_id else null end,
      case when r.assigned_user_id is null then 'projects.view' else null end,
      'project-task-overdue-'||r.id,
      'projects','critical','Project task overdue',
      r.title||' · '||r.project_number||' · due '||to_char(r.due_date,'DD Mon YYYY'),
      '/projects','Open project tasks','project_task',r.id::text,'system_sync',
      jsonb_build_object('project_number',r.project_number,'project_name',r.project_name),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select m.id,m.name,m.due_date,p.project_number,p.name as project_name
    from public.project_milestones m join public.projects p on p.id=m.project_id
    where m.organization_id=v_org and m.status not in ('completed','cancelled')
      and m.due_date is not null and m.due_date<current_date
  loop
    perform public.emit_notification(
      v_org,null,'projects.view','project-milestone-overdue-'||r.id,
      'projects','critical','Project milestone overdue',
      r.name||' · '||r.project_number||' · due '||to_char(r.due_date,'DD Mon YYYY'),
      '/projects','Open milestones','project_milestone',r.id::text,'system_sync',
      jsonb_build_object('project_name',r.project_name),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select i.id,i.invoice_number,i.total_amount,i.amount_paid,i.due_date,p.project_number,c.name as customer_name
    from public.project_invoices i
    join public.projects p on p.id=i.project_id
    left join public.customers c on c.id=i.customer_id
    where i.organization_id=v_org and i.status in ('issued','partial')
      and i.due_date is not null and i.due_date<current_date
      and greatest(0,coalesce(i.total_amount,0)-coalesce(i.amount_paid,0))>0.009
  loop
    v_due:=greatest(0,coalesce(r.total_amount,0)-coalesce(r.amount_paid,0));
    perform public.emit_notification(
      v_org,null,'projects.billing','project-invoice-overdue-'||r.id,
      'finance','critical','Project invoice overdue',
      r.invoice_number||' · '||coalesce(r.customer_name,'Client')||' · balance '||trim(to_char(v_due,'FM999G999G999G990D00'))||' '||coalesce(v_currency,''),
      '/projects','Open project billing','project_invoice',r.id::text,'system_sync',
      jsonb_build_object('project_number',r.project_number,'balance',v_due,'due_date',r.due_date),null
    );
    v_count:=v_count+1;
  end loop;

  for r in
    select id,quotation_number,valid_until,status
    from public.quotations
    where organization_id=v_org and status in ('draft','sent')
      and valid_until is not null and valid_until<current_date
  loop
    perform public.emit_notification(
      v_org,null,'documents.view','quotation-expired-'||r.id,
      'documents','warning','Quotation validity expired',
      r.quotation_number||' expired on '||to_char(r.valid_until,'DD Mon YYYY'),
      '/documents','Open quotations','quotation',r.id::text,'system_sync',
      jsonb_build_object('status',r.status,'valid_until',r.valid_until),null
    );
    v_count:=v_count+1;
  end loop;

  update public.notifications
  set resolved_at=now(),updated_at=now()
  where organization_id=v_org
    and source='system_sync'
    and resolved_at is null
    and updated_at<v_sync_started;

  return v_count;
end;
$function$;


revoke all on function public.emit_notification(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,timestamptz) from public;
revoke execute on function public.emit_notification(uuid,uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb,timestamptz) from anon,authenticated;
revoke all on function public.resolve_notification(uuid,uuid,text) from public;
revoke execute on function public.resolve_notification(uuid,uuid,text) from anon,authenticated;
revoke all on function public.mark_notification_read(uuid,boolean) from public;
revoke execute on function public.mark_notification_read(uuid,boolean) from anon;
grant execute on function public.mark_notification_read(uuid,boolean) to authenticated;
revoke all on function public.dismiss_notification(uuid) from public;
revoke execute on function public.dismiss_notification(uuid) from anon;
grant execute on function public.dismiss_notification(uuid) to authenticated;
revoke all on function public.mark_all_notifications_read() from public;
revoke execute on function public.mark_all_notifications_read() from anon;
grant execute on function public.mark_all_notifications_read() to authenticated;
revoke all on function public.save_notification_preferences(boolean,jsonb) from public;
revoke execute on function public.save_notification_preferences(boolean,jsonb) from anon;
grant execute on function public.save_notification_preferences(boolean,jsonb) to authenticated;
revoke all on function public.sync_my_notifications() from public;
revoke execute on function public.sync_my_notifications() from anon;
grant execute on function public.sync_my_notifications() to authenticated;
revoke all on function public.notify_approval_request_change() from public;
revoke execute on function public.notify_approval_request_change() from anon,authenticated;
revoke all on function public.notify_leave_request_change() from public;
revoke execute on function public.notify_leave_request_change() from anon,authenticated;
revoke all on function public.notify_payroll_entry_change() from public;
revoke execute on function public.notify_payroll_entry_change() from anon,authenticated;
revoke all on function public.notify_project_task_change() from public;
revoke execute on function public.notify_project_task_change() from anon,authenticated;
revoke all on function public.notify_work_order_assignment() from public;
revoke execute on function public.notify_work_order_assignment() from anon,authenticated;
revoke all on function public.notify_delivery_change() from public;
revoke execute on function public.notify_delivery_change() from anon,authenticated;

drop trigger if exists approval_request_notification_trigger on public.approval_requests;
create trigger approval_request_notification_trigger
after insert or update of status on public.approval_requests
for each row execute function public.notify_approval_request_change();

drop trigger if exists leave_request_notification_trigger on public.leave_requests;
create trigger leave_request_notification_trigger
after insert or update of status on public.leave_requests
for each row execute function public.notify_leave_request_change();

drop trigger if exists payroll_entry_notification_trigger on public.payroll_entries;
create trigger payroll_entry_notification_trigger
after insert or update of payment_status on public.payroll_entries
for each row execute function public.notify_payroll_entry_change();

drop trigger if exists project_task_notification_trigger on public.project_tasks;
create trigger project_task_notification_trigger
after insert or update of assigned_user_id on public.project_tasks
for each row execute function public.notify_project_task_change();

drop trigger if exists work_order_assignment_notification_trigger on public.work_order_assignments;
create trigger work_order_assignment_notification_trigger
after insert on public.work_order_assignments
for each row execute function public.notify_work_order_assignment();

drop trigger if exists delivery_notification_trigger on public.deliveries;
create trigger delivery_notification_trigger
after insert or update of status,driver_user_id on public.deliveries
for each row execute function public.notify_delivery_change();

do $$
begin
  if exists(select 1 from pg_publication where pubname='supabase_realtime') then
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notifications') then
      execute 'alter publication supabase_realtime add table public.notifications';
    end if;
    if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='notification_states') then
      execute 'alter publication supabase_realtime add table public.notification_states';
    end if;
  end if;
end
$$;


-- Backfill currently pending workflow items when upgrading an existing business.
select public.emit_notification(
  a.organization_id,null,'approvals.view','approval-pending-'||a.id,
  'approvals','warning','Approval requested',a.title,
  '/approvals','Review approval','approval_request',a.id::text,'workflow',
  jsonb_build_object('request_type',a.request_type,'amount',a.amount),null
)
from public.approval_requests a
where a.status='pending';

select public.emit_notification(
  l.organization_id,null,'leave.manage','leave-review-'||l.id,
  'hr','warning','Leave request awaiting review',
  coalesce(u.full_name,'Employee')||' requested '||l.total_days||' day(s) of leave',
  '/hr','Review leave','leave_request',l.id::text,'workflow',
  jsonb_build_object('user_id',l.user_id,'start_date',l.start_date,'end_date',l.end_date),null
)
from public.leave_requests l
left join public.users u on u.id=l.user_id
where l.status='pending';
