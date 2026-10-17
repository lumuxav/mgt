create or replace function public.server_manage_organization_role(
 p_organization_id uuid,p_actor_id uuid,p_action text,p_key text,p_changes jsonb default '{}'
)
returns jsonb language plpgsql security definer set search_path=public as $$
declare actor public.users%rowtype; target public.roles%rowtype; permissions text[]; role_name text;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server access required'; end if;
 perform 1 from public.organizations where id=p_organization_id and active for update;
 if not found then raise exception 'Active business required'; end if;
 select * into actor from public.users where id=p_actor_id and organization_id=p_organization_id and active and archived_at is null;
 if not found then raise exception 'Active staff account required'; end if;
 if actor.role not in ('owner','admin','super_admin','system_admin') and not exists(
  select 1 from public.roles r join public.role_permissions rp on rp.organization_id=r.organization_id and rp.role=r.key
  where r.organization_id=p_organization_id and r.key=actor.role and r.active and rp.permission='roles.manage' and rp.allowed
 ) then raise exception 'Permission denied: roles.manage'; end if;
 if p_action is null or p_action not in ('create','update','delete') then raise exception 'Invalid role action'; end if;
 if p_key is null or p_key !~ '^[a-z0-9_]{1,48}$' then raise exception 'Invalid role key'; end if;
 if jsonb_typeof(p_changes) is distinct from 'object' then raise exception 'Role changes must be an object'; end if;
 if p_changes ? 'active' and jsonb_typeof(p_changes->'active') is distinct from 'boolean' then raise exception 'active must be true or false'; end if;
 if p_changes ? 'permissions' then
  if jsonb_typeof(p_changes->'permissions') is distinct from 'array' then raise exception 'Permissions must be an array'; end if;
  if exists(select 1 from jsonb_array_elements(p_changes->'permissions') value where jsonb_typeof(value)<>'string') then raise exception 'Permission codes must be strings'; end if;
  select coalesce(array_agg(distinct value),'{}'::text[]) into permissions from jsonb_array_elements_text(p_changes->'permissions');
  if exists(select 1 from unnest(permissions) as requested(code) where not exists(select 1 from public.permission_catalog c where c.code=requested.code)) then
   raise exception 'One or more permissions are invalid';
  end if;
 end if;
 if p_action='create' then
  if p_key in ('owner','admin','super_admin','system_admin') then raise exception 'That role key is reserved'; end if;
  role_name:=nullif(trim(p_changes->>'name'),'');
  if role_name is null then raise exception 'Role name is required'; end if;
  insert into public.roles(organization_id,key,name,description,is_system,active)
  values(p_organization_id,p_key,role_name,nullif(trim(p_changes->>'description'),''),false,true);
 else
  select * into target from public.roles where organization_id=p_organization_id and key=p_key for update;
  if not found then raise exception 'Role not found'; end if;
  role_name:=target.name;
  if p_action='delete' then
   if target.is_system then raise exception 'Built-in roles cannot be deleted'; end if;
   if exists(select 1 from public.users where organization_id=p_organization_id and role=p_key and archived_at is null) then
    raise exception 'Move staff out of this role before deleting it';
   end if;
   delete from public.role_permissions where organization_id=p_organization_id and role=p_key;
   delete from public.roles where id=target.id;
  else
   if permissions is not null and p_key in ('owner','admin','super_admin','system_admin') then
    raise exception 'Built-in administrators retain full permissions';
   end if;
   if target.is_system and p_changes->>'active'='false' then raise exception 'Built-in roles cannot be disabled'; end if;
   update public.roles set
    name=coalesce(nullif(trim(p_changes->>'name'),''),name),
    description=case when p_changes ? 'description' then nullif(trim(p_changes->>'description'),'') else description end,
    active=coalesce((p_changes->>'active')::boolean,active),updated_at=now()
   where id=target.id;
  end if;
 end if;
 if p_action<>'delete' and permissions is not null then
  delete from public.role_permissions where organization_id=p_organization_id and role=p_key;
  insert into public.role_permissions(organization_id,role,permission,allowed)
  select p_organization_id,p_key,code,true from unnest(permissions) code;
 end if;
 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(p_organization_id,actor.default_location_id,actor.id,'role_'||p_action,'role',p_key,
  'Role '||p_action||': '||role_name,p_changes);
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.server_manage_organization_role(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.server_manage_organization_role(uuid,uuid,text,text,jsonb) to service_role;
