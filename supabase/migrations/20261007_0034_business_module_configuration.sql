-- MGT Business Suite — database-backed business module configuration

create or replace function public.seed_default_organization_modules()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_enabled text[];
begin
  v_enabled:=case new.business_type
    when 'retail' then array['dashboard','pos','inventory','sales','customers','suppliers','purchasing','finance','reports','documents','alerts','insights','payments']
    when 'wholesale' then array['dashboard','inventory','sales','customers','suppliers','purchasing','fleet','finance','reports','documents','alerts','insights','payments']
    when 'manufacturing' then array['dashboard','inventory','sales','customers','suppliers','purchasing','manufacturing','assets','finance','reports','documents','alerts','insights','payments']
    when 'services' then array['dashboard','sales','customers','suppliers','services','projects','finance','reports','documents','alerts','insights','payments']
    else array['dashboard','pos','inventory','sales','customers','suppliers','purchasing','services','manufacturing','finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','integrations','insights','payments']
  end;

  insert into public.organization_modules(organization_id,module_key,enabled,updated_at)
  select new.id,k,k=any(v_enabled),now()
  from unnest(array[
    'dashboard','pos','inventory','sales','customers','suppliers','purchasing','services','manufacturing',
    'finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','integrations','insights','payments'
  ]) k
  on conflict(organization_id,module_key) do nothing;

  return new;
end;
$$;

revoke all on function public.seed_default_organization_modules() from public;
revoke execute on function public.seed_default_organization_modules() from anon,authenticated;

drop trigger if exists seed_default_organization_modules_trigger on public.organizations;
create trigger seed_default_organization_modules_trigger
after insert on public.organizations
for each row execute function public.seed_default_organization_modules();

with catalog(module_key) as (
  values
   ('dashboard'),('pos'),('inventory'),('sales'),('customers'),('suppliers'),('purchasing'),('services'),('manufacturing'),
   ('finance'),('reports'),('documents'),('alerts'),('hr'),('projects'),('assets'),('fleet'),('ecommerce'),('integrations'),('insights'),('payments')
)
insert into public.organization_modules(organization_id,module_key,enabled,updated_at)
select
  o.id,
  c.module_key,
  case
    when c.module_key in ('dashboard','finance','reports','documents','alerts','insights','payments') then true
    when o.business_type='retail' and c.module_key in ('pos','inventory','sales','customers','suppliers','purchasing') then true
    when o.business_type='wholesale' and c.module_key in ('inventory','sales','customers','suppliers','purchasing','fleet') then true
    when o.business_type='manufacturing' and c.module_key in ('inventory','sales','customers','suppliers','purchasing','manufacturing','assets') then true
    when o.business_type='services' and c.module_key in ('sales','customers','suppliers','services','projects') then true
    when o.business_type not in ('retail','wholesale','manufacturing','services') then true
    else false
  end,
  now()
from public.organizations o
cross join catalog c
on conflict(organization_id,module_key) do nothing;

create or replace function public.get_my_business_configuration()
returns jsonb
language plpgsql
stable
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_default_location uuid;
  v_org_row public.organizations%rowtype;
  v_locations jsonb:='[]'::jsonb;
  v_modules jsonb:='{}'::jsonb;
  v_enabled jsonb:='[]'::jsonb;
begin
  if auth.uid() is null then raise exception 'Authentication required'; end if;
  if v_org is null then
    return jsonb_build_object(
      'organization',null,
      'default_location_id',null,
      'locations','[]'::jsonb,
      'modules','{}'::jsonb,
      'enabled_modules','[]'::jsonb
    );
  end if;

  select * into v_org_row
  from public.organizations
  where id=v_org and active=true;

  if not found then raise exception 'Active organization not found'; end if;

  select default_location_id into v_default_location
  from public.users
  where id=auth.uid() and organization_id=v_org and active=true;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'id',l.id,
      'name',l.name,
      'code',l.code,
      'type',l.type,
      'active',l.active
    )
    order by l.created_at,l.name
  ),'[]'::jsonb)
  into v_locations
  from public.locations l
  where l.organization_id=v_org;

  select
    coalesce(jsonb_object_agg(m.module_key,m.enabled),'{}'::jsonb),
    coalesce(jsonb_agg(m.module_key order by m.module_key) filter(where m.enabled),'[]'::jsonb)
  into v_modules,v_enabled
  from public.organization_modules m
  where m.organization_id=v_org;

  return jsonb_build_object(
    'organization',jsonb_build_object(
      'id',v_org_row.id,
      'name',v_org_row.name,
      'short_name',v_org_row.short_name,
      'legal_name',v_org_row.legal_name,
      'business_type',v_org_row.business_type,
      'country',v_org_row.country,
      'currency',v_org_row.currency,
      'timezone',v_org_row.timezone,
      'active',v_org_row.active
    ),
    'default_location_id',v_default_location,
    'locations',v_locations,
    'modules',v_modules,
    'enabled_modules',v_enabled
  );
end;
$$;

revoke all on function public.get_my_business_configuration() from public;
revoke execute on function public.get_my_business_configuration() from anon;
grant execute on function public.get_my_business_configuration() to authenticated;

create or replace function public.save_organization_modules(p_enabled_modules text[])
returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_org uuid:=public.current_organization_id();
  v_user uuid:=auth.uid();
  v_allowed constant text[]:=array[
    'dashboard','pos','inventory','sales','customers','suppliers','purchasing','services','manufacturing',
    'finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','integrations','insights','payments'
  ];
  v_core constant text[]:=array['dashboard','finance','reports','documents','alerts','insights'];
  v_requested text[]:=coalesce(p_enabled_modules,array[]::text[]);
  k text;
begin
  if v_org is null or v_user is null then raise exception 'Active business session required'; end if;
  if not public.has_permission('settings.manage') then raise exception 'Permission denied: settings.manage'; end if;

  if exists(
    select 1 from unnest(v_requested) requested
    where not requested=any(v_allowed)
  ) then
    raise exception 'Unknown business module requested';
  end if;

  foreach k in array v_allowed loop
    insert into public.organization_modules(organization_id,module_key,enabled,updated_at)
    values(v_org,k,(k=any(v_core) or k=any(v_requested)),now())
    on conflict(organization_id,module_key) do update
      set enabled=excluded.enabled,updated_at=now();
  end loop;

  insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
  values(
    v_org,v_user,'business_modules_updated','organization_modules',v_org::text,
    'Business module configuration updated',
    jsonb_build_object(
      'enabled_modules',
      (select coalesce(jsonb_agg(module_key order by module_key),'[]'::jsonb)
       from public.organization_modules where organization_id=v_org and enabled)
    )
  );

  return public.get_my_business_configuration();
end;
$$;

revoke all on function public.save_organization_modules(text[]) from public;
revoke execute on function public.save_organization_modules(text[]) from anon;
grant execute on function public.save_organization_modules(text[]) to authenticated;

create or replace function public.current_module_enabled(p_module_key text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select coalesce((
    select m.enabled
    from public.organization_modules m
    where m.organization_id=public.current_organization_id()
      and m.module_key=p_module_key
  ),false)
$$;

revoke all on function public.current_module_enabled(text) from public;
revoke execute on function public.current_module_enabled(text) from anon;
grant execute on function public.current_module_enabled(text) to authenticated;

revoke all on public.organization_modules from anon;
