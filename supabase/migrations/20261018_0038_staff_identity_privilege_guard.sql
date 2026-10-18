-- Protect MGT business accounts from direct PostgREST privilege escalation.
-- Authorized staff changes run through validated service-role endpoints.
create or replace function public.mgt_protect_staff_identity()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'') = 'authenticated' and old.organization_id is not null
     and (new.organization_id is distinct from old.organization_id
       or new.role is distinct from old.role
       or new.active is distinct from old.active
       or new.archived_at is distinct from old.archived_at) then
    raise exception 'Staff role and status changes require the authorized administration API' using errcode='42501';
  end if;
  return new;
end; $$;
drop trigger if exists mgt_protect_staff_identity_update on public.users;
create trigger mgt_protect_staff_identity_update
before update on public.users for each row execute function public.mgt_protect_staff_identity();

create or replace function public.mgt_block_platform_role_keys()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(),'')='authenticated' and new.key in ('super_admin','system_admin') then
    raise exception 'Platform administrator role names are reserved' using errcode='42501';
  end if;
  return new;
end; $$;
drop trigger if exists mgt_block_platform_roles on public.roles;
create trigger mgt_block_platform_roles
before insert or update on public.roles for each row execute function public.mgt_block_platform_role_keys();

revoke all on function public.mgt_protect_staff_identity() from public,anon,authenticated;
revoke all on function public.mgt_block_platform_role_keys() from public,anon,authenticated;

-- Direct inserts cannot create platform-wide administrator accounts.
create or replace function public.mgt_block_direct_platform_staff()
returns trigger language plpgsql security definer set search_path=public as $$
begin
  if coalesce(auth.role(), '')='authenticated'
     and new.role in ('super_admin','system_admin') then
    raise exception 'Platform administrator role is reserved' using errcode='42501';
  end if;
  return new;
end; $$;
drop trigger if exists mgt_block_direct_platform_staff_insert on public.users;
create trigger mgt_block_direct_platform_staff_insert
before insert on public.users for each row execute function public.mgt_block_direct_platform_staff();
revoke all on function public.mgt_block_direct_platform_staff() from public,anon,authenticated;

-- Existing-business sessions may not re-seed or change custom roles.
CREATE OR REPLACE FUNCTION public.bootstrap_organization(business_name text, business_type text DEFAULT 'hybrid'::text, currency_code text DEFAULT 'UGX'::text, country_name text DEFAULT 'Uganda'::text, timezone_name text DEFAULT 'Africa/Kampala'::text, short_code text DEFAULT NULL::text, location_name text DEFAULT 'Main Location'::text, location_type text DEFAULT 'branch'::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  actor uuid := auth.uid();
  org_id uuid;
  loc_id uuid;
  actor_name text;
  actor_email text;
begin
  if actor is null then
    raise exception 'Authentication required';
  end if;

  -- A signed-in employee must never reset their business's custom roles.
  select organization_id into org_id from public.users
    where id = actor and active and archived_at is null limit 1;
  if org_id is not null then return org_id; end if;
  if exists (select 1 from public.users where id = actor) then
    raise exception 'Existing staff account cannot bootstrap another business';
  end if;

  select
    coalesce(raw_user_meta_data->>'full_name', email, 'Owner'),
    email
  into actor_name, actor_email
  from auth.users
  where id = actor;

  insert into public.organizations(name, short_name, business_type, currency, country, timezone)
  values (
    coalesce(nullif(trim(business_name), ''), 'My Business'),
    nullif(trim(short_code), ''),
    coalesce(nullif(trim(business_type), ''), 'hybrid'),
    coalesce(nullif(trim(currency_code), ''), 'UGX'),
    coalesce(nullif(trim(country_name), ''), 'Uganda'),
    coalesce(nullif(trim(timezone_name), ''), 'Africa/Kampala')
  )
  returning id into org_id;

  insert into public.locations(organization_id, name, type)
  values (
    org_id,
    coalesce(nullif(trim(location_name), ''), 'Main Location'),
    coalesce(nullif(trim(location_type), ''), 'branch')
  )
  returning id into loc_id;

  insert into public.users(id, organization_id, default_location_id, full_name, email, role, active)
  values (actor, org_id, loc_id, actor_name, actor_email, 'owner', true)
  on conflict (id) do update
    set organization_id = excluded.organization_id,
        default_location_id = excluded.default_location_id,
        full_name = excluded.full_name,
        email = excluded.email,
        role = 'owner',
        active = true,
        archived_at = null,
        updated_at = now();

  perform public.seed_default_roles(org_id);

  return org_id;
end;
$function$
