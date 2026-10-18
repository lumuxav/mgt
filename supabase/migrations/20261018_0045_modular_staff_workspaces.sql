-- MGT modular workspaces: additive, reversible access architecture.
-- Existing roles and customized owner grants are never overwritten.
insert into public.permission_catalog(code,section,label,description,sort_order) values
('services.assigned','Operations','Work on assigned service jobs','See and update only service jobs assigned to this user',93),
('workspace.tasks','Workspace','View own work dashboard','Personal tasks and attendance dashboard',11)
on conflict (code) do nothing;

-- Role combination permissions are additive; primary roles remain unchanged.
create table if not exists public.user_additional_roles (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 role text not null,
 granted_by uuid references public.users(id),
 created_at timestamptz not null default now(),
 primary key(organization_id,user_id,role),
 constraint no_privileged_extra_role check(role not in ('owner','admin','super_admin','system_admin'))
);
create index if not exists user_additional_roles_member_idx on public.user_additional_roles(user_id,organization_id);
alter table public.user_additional_roles enable row level security;
drop policy if exists additional_roles_read on public.user_additional_roles;
create policy additional_roles_read on public.user_additional_roles for select to authenticated
using(public.has_organization_access(organization_id) and
(user_id=auth.uid() or public.has_permission('users.manage')));
revoke all on public.user_additional_roles from anon,authenticated;
grant select on public.user_additional_roles to authenticated;

create table if not exists public.user_work_scope (
 organization_id uuid not null references public.organizations(id) on delete cascade,
 user_id uuid not null references public.users(id) on delete cascade,
 scope text not null default 'organization' check(scope in ('organization','location','assigned')),
 location_id uuid references public.locations(id),
 updated_by uuid references public.users(id),
 updated_at timestamptz not null default now(),
 primary key(organization_id,user_id),
 constraint scoped_location_required check(scope <> 'location' or location_id is not null)
);
alter table public.user_work_scope enable row level security;
drop policy if exists work_scope_read on public.user_work_scope;
create policy work_scope_read on public.user_work_scope for select to authenticated
using(public.has_organization_access(organization_id) and
(user_id=auth.uid() or public.has_permission('users.manage')));
revoke all on public.user_work_scope from anon,authenticated;
grant select on public.user_work_scope to authenticated;

create or replace function public.mgt_current_roles()
returns table(role text) language sql stable security definer set search_path=public as $$
 select public.current_user_role() where public.current_user_role() is not null
 union
 select ar.role from public.user_additional_roles ar join public.roles r
 on r.organization_id=ar.organization_id and r.key=ar.role and r.active
 where ar.organization_id=public.current_organization_id() and ar.user_id=auth.uid()
   and public.current_user_role() is not null
$$;
revoke all on function public.mgt_current_roles() from public,anon;
grant execute on function public.mgt_current_roles() to authenticated,service_role;

create or replace function public.current_permissions()
returns table(permission text) language sql stable security definer set search_path=public as $$
 select pc.code from public.permission_catalog pc
 where public.current_user_role() in ('owner','admin','super_admin','system_admin')
 union
 select rp.permission from public.role_permissions rp
 where rp.organization_id=public.current_organization_id() and rp.allowed
 and rp.role in (select role from public.mgt_current_roles())
 union
 select 'workspace.tasks'::text where public.current_user_role() is not null
$$;
create or replace function public.has_permission(permission_key text)
returns boolean language sql stable security definer set search_path=public as $$
 select permission_key in (select permission from public.current_permissions())
$$;

-- Personal work feed exposes only nonfinancial fields and only work allocated to the member.
create or replace function public.mgt_my_work()
returns jsonb language plpgsql stable security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id(); v_me uuid:=auth.uid();
 v_tasks jsonb:='[]'::jsonb; v_jobs jsonb:='[]'::jsonb;
 v_attendance jsonb:='{}'::jsonb; v_tz text;
begin
 if v_org is null or v_me is null then raise exception 'Active staff account required'; end if;
 if exists(select 1 from public.organization_modules where organization_id=v_org and module_key='projects' and enabled)
    and (public.has_permission('projects.time') or public.has_permission('projects.view')) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',t.id,'project_id',t.project_id,'title',t.title,'status',t.status,
      'priority',t.priority,'due_date',t.due_date,'progress',t.progress_percent
    ) order by t.due_date nulls last),'[]'::jsonb) into v_tasks
    from public.project_tasks t where t.organization_id=v_org and t.assigned_user_id=v_me
    and t.status not in ('cancelled','completed');
 end if;
 if exists(select 1 from public.organization_modules where organization_id=v_org and module_key='services' and enabled)
    and (public.has_permission('services.assigned') or public.has_permission('services.view') or public.has_permission('services.manage')) then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id',w.id,'number',w.job_number,'title',w.title,'status',w.status,'priority',w.priority,'due_at',w.due_at
    ) order by w.due_at nulls last),'[]'::jsonb) into v_jobs
    from public.work_orders w where w.organization_id=v_org
    and (w.assigned_to=v_me or exists(select 1 from public.work_order_assignments wa where wa.work_order_id=w.id and wa.user_id=v_me))
    and w.status not in ('cancelled','completed');
 end if;
 if public.has_permission('attendance.use') then
    select timezone into v_tz from public.organizations where id=v_org;
    select coalesce(jsonb_build_object('check_in',a.check_in,'check_out',a.check_out,'date',a.work_date),'{}'::jsonb)
    into v_attendance from public.attendance a where a.organization_id=v_org and a.user_id=v_me
      and a.work_date=(now() at time zone coalesce(v_tz,'UTC'))::date limit 1;
 end if;
 return jsonb_build_object('tasks',v_tasks,'jobs',v_jobs,'attendance',coalesce(v_attendance,'{}'::jsonb));
end; $$;
revoke all on function public.mgt_my_work() from public,anon;
grant execute on function public.mgt_my_work() to authenticated,service_role;

-- Technician updates only assigned jobs and cannot complete, reopen, price or cancel jobs.
create or replace function public.mgt_update_assigned_job(p_work_order_id uuid,p_status text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_me uuid:=auth.uid();v_previous text;
begin
 if v_org is null or not(public.has_permission('services.assigned') or public.has_permission('services.manage'))
 then raise exception 'Permission denied: assigned service job'; end if;
 if not exists(select 1 from public.organization_modules where organization_id=v_org and module_key='services' and enabled)
 then raise exception 'Services module not enabled'; end if;
 if p_status not in ('in_progress','on_hold') then raise exception 'Unsupported job progress action'; end if;
 select w.status into v_previous from public.work_orders w where w.id=p_work_order_id and w.organization_id=v_org
 and (w.assigned_to=v_me or exists(select 1 from public.work_order_assignments wa where wa.work_order_id=w.id and wa.user_id=v_me)) for update;
 if not found then raise exception 'Job is not assigned to you'; end if;
 if v_previous not in ('open','scheduled','in_progress','on_hold') then raise exception 'This job cannot be updated'; end if;
 update public.work_orders set status=p_status,
 started_at=case when p_status='in_progress' then coalesce(started_at,now()) else started_at end,
 updated_at=now() where id=p_work_order_id;
 insert into public.work_order_events(organization_id,work_order_id,event_type,description,metadata,user_id)
 values(v_org,p_work_order_id,'staff_progress','Assigned technician updated job progress',
 jsonb_build_object('old',v_previous,'new',p_status),v_me);
 return jsonb_build_object('id',p_work_order_id,'status',p_status);
end; $$;
revoke all on function public.mgt_update_assigned_job(uuid,text) from public,anon;
grant execute on function public.mgt_update_assigned_job(uuid,text) to authenticated,service_role;

-- Do not overwrite role customizations. Add usable personal permission only.
insert into public.role_permissions(organization_id,role,permission,allowed)
select r.organization_id,r.key,'workspace.tasks',true from public.roles r
where r.active on conflict(organization_id,role,permission) do nothing;
insert into public.role_permissions(organization_id,role,permission,allowed)
select r.organization_id,r.key,'services.assigned',true from public.roles r
where r.key in ('employee','production_staff') and r.active
on conflict(organization_id,role,permission) do nothing;

-- Atomically save an employee's additional (nonadministrator) roles and
-- optional sales/service record scope; callers cannot modify themselves.
create or replace function public.server_set_staff_work_access(
 p_organization_id uuid,p_actor_id uuid,p_user_id uuid,
 p_roles text[],p_scope text,p_location_id uuid default null
) returns jsonb language plpgsql security definer set search_path=public as $$
declare v_actor public.users%rowtype;v_target public.users%rowtype;
begin
 if coalesce(auth.role(),'')<>'service_role' then raise exception 'Server access required'; end if;
 if p_actor_id=p_user_id then raise exception 'Cannot alter your own additional roles'; end if;
 select * into v_actor from public.users
  where id=p_actor_id and organization_id=p_organization_id and active and archived_at is null;
 if not found then raise exception 'Active business administrator required'; end if;
 if v_actor.role not in ('owner','admin','super_admin','system_admin')
  and not(
    exists(select 1 from public.role_permissions where organization_id=p_organization_id and role=v_actor.role and permission='users.manage' and allowed)
    and exists(select 1 from public.role_permissions where organization_id=p_organization_id and role=v_actor.role and permission='roles.manage' and allowed)
  ) then raise exception 'Insufficient staff administration permissions'; end if;
 select * into v_target from public.users
 where id=p_user_id and organization_id=p_organization_id and archived_at is null for update;
 if not found then raise exception 'Staff account not found'; end if;
 if v_target.role in ('owner','super_admin','system_admin') and v_actor.role not in ('owner','super_admin','system_admin')
 then raise exception 'Only business owner may manage another owner'; end if;
 if p_scope not in ('organization','location','assigned') then raise exception 'Invalid work scope'; end if;
 if p_scope='location' and not exists(
  select 1 from public.locations where organization_id=p_organization_id and id=p_location_id and active
 ) then raise exception 'Choose an active location in this business'; end if;
 if coalesce(array_length(p_roles,1),0)>10 then raise exception 'Too many additional roles'; end if;
 if exists(select 1 from unnest(coalesce(p_roles,array[]::text[])) role_key
 where role_key in ('owner','admin','super_admin','system_admin') or role_key=v_target.role
 or not exists(select 1 from public.roles r where r.organization_id=p_organization_id and r.key=role_key and r.active))
 then raise exception 'Invalid additional role'; end if;
 delete from public.user_additional_roles where organization_id=p_organization_id and user_id=p_user_id;
 insert into public.user_additional_roles(organization_id,user_id,role,granted_by)
 select p_organization_id,p_user_id,role_key,p_actor_id from
 (select distinct unnest(coalesce(p_roles,array[]::text[])) role_key) roles;
 insert into public.user_work_scope(organization_id,user_id,scope,location_id,updated_by,updated_at)
 values(p_organization_id,p_user_id,p_scope,case when p_scope='location' then p_location_id else null end,p_actor_id,now())
 on conflict(organization_id,user_id) do update set scope=excluded.scope,
 location_id=excluded.location_id,updated_by=excluded.updated_by,updated_at=now();
 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(p_organization_id,p_actor_id,'staff_work_access_changed','user',p_user_id::text,
 'Staff work roles and access scope updated',jsonb_build_object('roles',p_roles,'scope',p_scope,'location_id',p_location_id));
 return jsonb_build_object('ok',true);
end; $$;
revoke all on function public.server_set_staff_work_access(uuid,uuid,uuid,text[],text,uuid) from public,anon,authenticated;
grant execute on function public.server_set_staff_work_access(uuid,uuid,uuid,text[],text,uuid) to service_role;

-- Enforce location or assigned-only visibility for sales and service orders.
-- Existing workers have no scope row and retain their established access.
create or replace function public.mgt_record_scope_allows(
 p_org uuid,p_location uuid,p_owner uuid,p_secondary_assignment boolean default false
) returns boolean language sql stable security definer set search_path=public as $$
 select coalesce((
 select case s.scope
   when 'organization' then true
   when 'location' then s.location_id=p_location
   when 'assigned' then p_owner=auth.uid() or p_secondary_assignment
   else false end
 from public.user_work_scope s where s.organization_id=p_org and s.user_id=auth.uid()
 ),true)
$$;
revoke all on function public.mgt_record_scope_allows(uuid,uuid,uuid,boolean) from public,anon;
grant execute on function public.mgt_record_scope_allows(uuid,uuid,uuid,boolean) to authenticated,service_role;

drop policy if exists sales_org_select on public.sales;
create policy sales_org_select on public.sales for select to authenticated using(
 public.has_organization_access(organization_id) and public.has_permission('sales.view')
 and public.mgt_record_scope_allows(organization_id,location_id,sold_by,false)
);
drop policy if exists work_orders_select on public.work_orders;
create policy work_orders_select on public.work_orders for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
    public.has_permission('services.view')
    or public.has_permission('services.manage')
    or (public.has_permission('services.assigned') and (
      assigned_to=auth.uid() or exists(select 1 from public.work_order_assignments wa
      where wa.work_order_id=work_orders.id and wa.user_id=auth.uid())
    ))
 )
 and public.mgt_record_scope_allows(organization_id,location_id,assigned_to,
    exists(select 1 from public.work_order_assignments wa where wa.work_order_id=work_orders.id and wa.user_id=auth.uid()))
);

-- New staff receive a conservative, job-shaped scope from day one.
-- Existing members with no record retain their previous organization scope.
create or replace function public.mgt_initialize_staff_scope()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_scope text:='organization';v_location uuid:=null;
begin
 if new.organization_id is null then return new; end if;
 if new.role in ('employee','technician','project_worker') then
    v_scope:='assigned';
 elsif new.role in ('cashier','salesperson','storekeeper','branch_manager')
    and new.default_location_id is not null then
    v_scope:='location';
    v_location:=new.default_location_id;
 end if;
 insert into public.user_work_scope(organization_id,user_id,scope,location_id)
 values(new.organization_id,new.id,v_scope,v_location)
 on conflict(organization_id,user_id) do nothing;
 return new;
end; $$;
drop trigger if exists mgt_initialize_staff_scope_on_create on public.users;
create trigger mgt_initialize_staff_scope_on_create
after insert on public.users for each row execute function public.mgt_initialize_staff_scope();
revoke all on function public.mgt_initialize_staff_scope() from public,anon,authenticated;

-- Initial default role templates for new businesses. Role grants remain
-- customizable and existing company-specific grants are never overwritten.
insert into public.default_role_permission_templates(role,permission) values
('employee','workspace.tasks'),
('employee','services.assigned'),
('production_staff','workspace.tasks'),
('technician','workspace.tasks'),
('technician','services.assigned'),
('technician','attendance.use'),
('project_worker','workspace.tasks'),
('project_worker','projects.time'),
('project_worker','attendance.use')
on conflict do nothing;
