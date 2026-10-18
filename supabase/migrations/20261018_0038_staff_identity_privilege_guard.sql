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
