-- MGT Business Suite — external email notification delivery

create extension if not exists pg_net;
create extension if not exists pg_cron;

alter table public.notification_preferences
  add column if not exists email_enabled boolean not null default false;

create table if not exists public.notification_delivery_settings(
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  email_enabled boolean not null default false,
  email_min_severity text not null default 'warning' check(email_min_severity in ('info','success','warning','critical')),
  email_categories jsonb not null default '{"approvals":true,"finance":true,"inventory":true,"operations":true,"hr":true,"projects":true,"fleet":true,"documents":true,"system":true}'::jsonb,
  sender_name text,
  reply_to_email text,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.notification_deliveries(
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  channel text not null default 'email' check(channel in ('email','sms','whatsapp')),
  recipient text not null,
  status text not null default 'queued' check(status in ('queued','processing','delivered','failed','abandoned','skipped')),
  attempt_count integer not null default 0 check(attempt_count>=0),
  next_attempt_at timestamptz not null default now(),
  last_attempt_at timestamptz,
  provider text,
  provider_message_id text,
  response_code integer,
  response_excerpt text,
  error_message text,
  delivered_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(notification_id,user_id,channel)
);

create index if not exists notification_deliveries_org_status_idx
on public.notification_deliveries(organization_id,status,next_attempt_at,created_at);

create index if not exists notification_deliveries_user_idx
on public.notification_deliveries(user_id,created_at desc);

create table if not exists public.notification_dispatch_auth(
  id text primary key,
  token_hash text not null,
  updated_at timestamptz not null default now()
);

alter table public.notification_delivery_settings enable row level security;
alter table public.notification_deliveries enable row level security;
alter table public.notification_dispatch_auth enable row level security;

drop policy if exists notification_delivery_settings_select on public.notification_delivery_settings;
create policy notification_delivery_settings_select on public.notification_delivery_settings
for select to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('integrations.view'));

drop policy if exists notification_deliveries_select on public.notification_deliveries;
create policy notification_deliveries_select on public.notification_deliveries
for select to authenticated
using(
  public.has_organization_access(organization_id)
  and (user_id=auth.uid() or public.has_permission('integrations.view'))
);

grant select on public.notification_delivery_settings,public.notification_deliveries to authenticated;
revoke all on public.notification_dispatch_auth from anon,authenticated;

create or replace function public.user_has_permission_for(
  p_user_id uuid,
  p_organization_id uuid,
  p_permission text
)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists(
    select 1
    from public.users u
    where u.id=p_user_id
      and u.organization_id=p_organization_id
      and u.active=true
      and (
        p_permission is null
        or u.role in ('owner','admin','super_admin','system_admin')
        or exists(
          select 1
          from public.role_permissions rp
          where rp.organization_id=p_organization_id
            and rp.role=u.role
            and rp.permission=p_permission
            and rp.allowed=true
        )
      )
  )
$$;
revoke all on function public.user_has_permission_for(uuid,uuid,text) from public;
revoke execute on function public.user_has_permission_for(uuid,uuid,text) from anon,authenticated;

create or replace function public.notification_severity_rank(p_severity text)
returns integer
language sql
immutable
as $$
  select case p_severity
    when 'info' then 1
    when 'success' then 1
    when 'warning' then 2
    when 'critical' then 3
    else 0
  end
$$;
revoke all on function public.notification_severity_rank(text) from public;
revoke execute on function public.notification_severity_rank(text) from anon,authenticated;

create or replace function public.queue_notification_email(p_notification_id uuid)
returns integer
language plpgsql
security definer
set search_path=public
as $$
declare
  n public.notifications%rowtype;
  s public.notification_delivery_settings%rowtype;
  r record;
  v_count integer:=0;
begin
  select * into n from public.notifications where id=p_notification_id;
  if n.id is null or n.resolved_at is not null or (n.expires_at is not null and n.expires_at<=now()) then
    return 0;
  end if;

  select * into s from public.notification_delivery_settings where organization_id=n.organization_id;
  if s.organization_id is null or not s.email_enabled then return 0; end if;
  if public.notification_severity_rank(n.severity)<public.notification_severity_rank(s.email_min_severity) then return 0; end if;
  if coalesce((s.email_categories->>n.category)::boolean,true)=false then return 0; end if;

  for r in
    select u.id,u.email,np.email_enabled,np.categories
    from public.users u
    join public.notification_preferences np
      on np.organization_id=u.organization_id and np.user_id=u.id
    where u.organization_id=n.organization_id
      and u.active=true
      and nullif(trim(u.email),'') is not null
      and np.email_enabled=true
      and coalesce((np.categories->>n.category)::boolean,true)=true
      and (
        (n.recipient_user_id is not null and u.id=n.recipient_user_id)
        or (
          n.recipient_user_id is null
          and public.user_has_permission_for(u.id,n.organization_id,n.audience_permission)
        )
      )
  loop
    insert into public.notification_deliveries(
      organization_id,notification_id,user_id,channel,recipient,status,next_attempt_at
    )
    values(n.organization_id,n.id,r.id,'email',lower(trim(r.email)),'queued',now())
    on conflict(notification_id,user_id,channel) do nothing;

    if found then v_count:=v_count+1; end if;
  end loop;

  return v_count;
end;
$$;
revoke all on function public.queue_notification_email(uuid) from public;
revoke execute on function public.queue_notification_email(uuid) from anon,authenticated;

create or replace function public.notification_delivery_queue_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='UPDATE' and old.resolved_at is not null and new.resolved_at is null then
    delete from public.notification_deliveries where notification_id=new.id;
  end if;

  if new.resolved_at is not null or (new.expires_at is not null and new.expires_at<=now()) then
    update public.notification_deliveries
    set status='skipped',error_message='Notification resolved before delivery.',updated_at=now()
    where notification_id=new.id and status in ('queued','failed','processing');
    return new;
  end if;

  perform public.queue_notification_email(new.id);
  return new;
end;
$$;
revoke all on function public.notification_delivery_queue_trigger() from public;
revoke execute on function public.notification_delivery_queue_trigger() from anon,authenticated;

drop trigger if exists notification_delivery_queue_trigger on public.notifications;
create trigger notification_delivery_queue_trigger
after insert or update of recipient_user_id,audience_permission,category,severity,title,body,href,resolved_at,expires_at
on public.notifications
for each row execute function public.notification_delivery_queue_trigger();

create or replace function public.save_notification_delivery_settings(
  p_email_enabled boolean,
  p_email_min_severity text,
  p_email_categories jsonb,
  p_sender_name text,
  p_reply_to_email text
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_user uuid:=auth.uid();
  r record;
begin
  if v_org is null or v_user is null then raise exception 'Active business session required'; end if;
  if not public.has_permission('integrations.manage') then raise exception 'Permission denied: integrations.manage'; end if;
  if p_email_min_severity not in ('info','success','warning','critical') then raise exception 'Invalid minimum severity'; end if;
  if p_reply_to_email is not null and trim(p_reply_to_email)<>'' and p_reply_to_email !~* '^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$' then
    raise exception 'Reply-to email is invalid';
  end if;

  insert into public.notification_delivery_settings(
    organization_id,email_enabled,email_min_severity,email_categories,sender_name,reply_to_email,created_by,updated_by,updated_at
  )
  values(
    v_org,coalesce(p_email_enabled,false),p_email_min_severity,coalesce(p_email_categories,'{}'::jsonb),
    nullif(trim(p_sender_name),''),nullif(lower(trim(p_reply_to_email)),''),v_user,v_user,now()
  )
  on conflict(organization_id) do update set
    email_enabled=excluded.email_enabled,
    email_min_severity=excluded.email_min_severity,
    email_categories=excluded.email_categories,
    sender_name=excluded.sender_name,
    reply_to_email=excluded.reply_to_email,
    updated_by=v_user,
    updated_at=now();

  if coalesce(p_email_enabled,false) then
    for r in
      select id from public.notifications
      where organization_id=v_org
        and resolved_at is null
        and (expires_at is null or expires_at>now())
    loop
      perform public.queue_notification_email(r.id);
    end loop;
  else
    update public.notification_deliveries
    set status='skipped',error_message='Email delivery disabled by business settings.',updated_at=now()
    where organization_id=v_org and channel='email' and status in ('queued','failed','processing');
  end if;

  insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(
    v_org,v_user,'notification_delivery_settings_updated','notification_delivery_settings',v_org::text,
    'Notification email delivery settings updated',
    jsonb_build_object('email_enabled',coalesce(p_email_enabled,false),'email_min_severity',p_email_min_severity)
  );
end;
$$;
revoke all on function public.save_notification_delivery_settings(boolean,text,jsonb,text,text) from public;
revoke execute on function public.save_notification_delivery_settings(boolean,text,jsonb,text,text) from anon;
grant execute on function public.save_notification_delivery_settings(boolean,text,jsonb,text,text) to authenticated;

create or replace function public.save_notification_preferences(
  p_browser_enabled boolean,
  p_categories jsonb,
  p_email_enabled boolean
)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_user uuid:=auth.uid();
  v_org uuid:=public.current_organization_id();
  r record;
begin
  if v_user is null or v_org is null then raise exception 'Active business session required'; end if;

  insert into public.notification_preferences(organization_id,user_id,browser_enabled,email_enabled,categories,updated_at)
  values(v_org,v_user,coalesce(p_browser_enabled,false),coalesce(p_email_enabled,false),coalesce(p_categories,'{}'::jsonb),now())
  on conflict(organization_id,user_id) do update set
    browser_enabled=excluded.browser_enabled,
    email_enabled=excluded.email_enabled,
    categories=excluded.categories,
    updated_at=now();

  if coalesce(p_email_enabled,false) then
    for r in
      select n.id
      from public.notifications n
      where n.organization_id=v_org
        and n.resolved_at is null
        and (n.expires_at is null or n.expires_at>now())
        and (
          n.recipient_user_id=v_user
          or (n.recipient_user_id is null and public.user_has_permission_for(v_user,v_org,n.audience_permission))
        )
    loop
      perform public.queue_notification_email(r.id);
    end loop;
  else
    update public.notification_deliveries
    set status='skipped',error_message='Email notifications disabled by user preference.',updated_at=now()
    where organization_id=v_org and user_id=v_user and channel='email' and status in ('queued','failed','processing');
  end if;
end;
$$;
revoke all on function public.save_notification_preferences(boolean,jsonb,boolean) from public;
revoke execute on function public.save_notification_preferences(boolean,jsonb,boolean) from anon;
grant execute on function public.save_notification_preferences(boolean,jsonb,boolean) to authenticated;

create or replace function public.queue_test_notification_email()
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_user uuid:=auth.uid();
  v_notification uuid;
  v_email text;
  v_org_enabled boolean;
  v_user_enabled boolean;
begin
  if v_org is null or v_user is null then raise exception 'Active business session required'; end if;
  if not public.has_permission('integrations.manage') then raise exception 'Permission denied: integrations.manage'; end if;

  select email into v_email from public.users where id=v_user and organization_id=v_org and active=true;
  select email_enabled into v_org_enabled from public.notification_delivery_settings where organization_id=v_org;
  select email_enabled into v_user_enabled from public.notification_preferences where organization_id=v_org and user_id=v_user;

  if nullif(trim(v_email),'') is null then raise exception 'Your MGT user account has no email address'; end if;
  if not coalesce(v_org_enabled,false) then raise exception 'Business email delivery is disabled'; end if;
  if not coalesce(v_user_enabled,false) then raise exception 'Enable email notifications in your personal Settings first'; end if;

  v_notification:=public.emit_notification(
    v_org,v_user,null,'email-test-'||gen_random_uuid()::text,
    'system','critical','MGT email delivery test',
    'This is a test of the external email notification delivery pipeline.',
    '/notifications','Open notification center','system',null,'email_test',
    jsonb_build_object('test',true),now()+interval '1 day'
  );

  return v_notification;
end;
$$;
revoke all on function public.queue_test_notification_email() from public;
revoke execute on function public.queue_test_notification_email() from anon;
grant execute on function public.queue_test_notification_email() to authenticated;

do $$
declare
  v_token text;
begin
  if exists(select 1 from vault.decrypted_secrets where name='mgt_notification_dispatch_token') then
    select decrypted_secret into v_token
    from vault.decrypted_secrets
    where name='mgt_notification_dispatch_token'
    order by created_at desc
    limit 1;
  else
    v_token:=encode(gen_random_bytes(32),'hex');
    perform vault.create_secret(v_token,'mgt_notification_dispatch_token','MGT notification email dispatcher token');
  end if;

  insert into public.notification_dispatch_auth(id,token_hash,updated_at)
  values('email-dispatch',encode(digest(v_token,'sha256'),'hex'),now())
  on conflict(id) do update set token_hash=excluded.token_hash,updated_at=now();
end
$$;

select cron.schedule(
  'mgt-notification-email-dispatch',
  '* * * * *',
  $cron$
  select net.http_post(
    url:='https://mehuiivevjqmwvaapbgz.supabase.co/functions/v1/mgt-notification-email-dispatch',
    headers:=jsonb_build_object(
      'Content-Type','application/json',
      'x-mgt-dispatch-token',(
        select decrypted_secret
        from vault.decrypted_secrets
        where name='mgt_notification_dispatch_token'
        order by created_at desc
        limit 1
      )
    ),
    body:=jsonb_build_object('source','supabase-cron','time',now()),
    timeout_milliseconds:=10000
  );
  $cron$
);
