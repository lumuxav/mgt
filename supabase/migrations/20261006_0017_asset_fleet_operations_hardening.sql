-- MGT Business Suite — Asset/Fleet operational hardening

create or replace function public.start_asset_maintenance(p_maintenance_id uuid)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_m public.asset_maintenance%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.maintenance') then raise exception 'Permission denied: assets.maintenance'; end if;

 select * into v_m from public.asset_maintenance
 where id=p_maintenance_id and organization_id=v_org and status='scheduled' for update;
 if not found then raise exception 'Scheduled maintenance record not found'; end if;

 update public.asset_maintenance set status='in_progress',started_at=now(),updated_at=now() where id=v_m.id;
 update public.assets set status='maintenance',updated_at=now() where id=v_m.asset_id and organization_id=v_org;
 update public.vehicles set status='maintenance',updated_at=now()
 where asset_id=v_m.asset_id and organization_id=v_org and active=true;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,v_m.location_id,auth.uid(),'maintenance_started','asset_maintenance',v_m.id::text,v_m.maintenance_number);

 return jsonb_build_object('maintenance_id',v_m.id,'status','in_progress');
end; $$;
revoke all on function public.start_asset_maintenance(uuid) from public;
revoke execute on function public.start_asset_maintenance(uuid) from anon;
grant execute on function public.start_asset_maintenance(uuid) to authenticated;

create or replace function public.set_asset_status(p_asset_id uuid,p_status text,p_notes text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();
 v_asset public.assets%rowtype;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('assets.manage') then raise exception 'Permission denied: assets.manage'; end if;
 if p_status not in ('active','maintenance','out_of_service','retired','disposed') then raise exception 'Invalid asset status'; end if;

 select * into v_asset from public.assets where id=p_asset_id and organization_id=v_org for update;
 if not found then raise exception 'Asset not found'; end if;

 update public.assets
 set status=p_status,active=case when p_status in ('retired','disposed') then false else active end,
     notes=coalesce(p_notes,notes),updated_at=now()
 where id=v_asset.id;

 update public.vehicles
 set status=case
   when p_status='maintenance' then 'maintenance'
   when p_status='out_of_service' then 'out_of_service'
   when p_status in ('retired','disposed') then 'retired'
   when p_status='active' and status in ('maintenance','out_of_service') then 'available'
   else status end,
     active=case when p_status in ('retired','disposed') then false else active end,
     updated_at=now()
 where asset_id=v_asset.id and organization_id=v_org;

 return jsonb_build_object('asset_id',v_asset.id,'status',p_status);
end; $$;
revoke all on function public.set_asset_status(uuid,text,text) from public;
revoke execute on function public.set_asset_status(uuid,text,text) from anon;
grant execute on function public.set_asset_status(uuid,text,text) to authenticated;
