-- MGT Business Suite — Integration outbox and module hardening

insert into public.organization_modules(organization_id,module_key,enabled)
select id,'integrations',true
from public.organizations
on conflict(organization_id,module_key) do update set enabled=true;

create or replace function public.queue_integration_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
 v_row jsonb;
 v_org uuid;
 v_entity_id text;
 v_entity text;
 v_event_type text;
 v_event_id uuid;
begin
 v_row:=case when tg_op='DELETE' then to_jsonb(old) else to_jsonb(new) end;
 v_org:=nullif(v_row->>'organization_id','')::uuid;
 if v_org is null then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;

 v_entity:=case tg_table_name
   when 'products' then 'product'
   when 'customers' then 'customer'
   when 'suppliers' then 'supplier'
   when 'sales' then 'sale'
   when 'payments' then 'payment'
   when 'purchases' then 'purchase'
   when 'work_orders' then 'work_order'
   when 'projects' then 'project'
   when 'project_invoices' then 'project_invoice'
   when 'deliveries' then 'delivery'
   when 'stock_movements' then 'stock_movement'
   else tg_table_name
 end;
 v_entity_id:=coalesce(v_row->>'id',v_row->>'project_id',v_row->>'product_id');
 v_event_type:=v_entity||'.'||case when tg_op='INSERT' then 'created' when tg_op='UPDATE' then 'updated' else 'deleted' end;

 if not exists(
   select 1 from public.webhook_endpoints w
   where w.organization_id=v_org
     and w.active=true
     and w.deleted_at is null
     and ('*'=any(w.events) or v_event_type=any(w.events))
 ) then
   if tg_op='DELETE' then return old; else return new; end if;
 end if;

 insert into public.integration_events(organization_id,event_type,entity_type,entity_id,payload)
 values(v_org,v_event_type,v_entity,v_entity_id,v_row)
 returning id into v_event_id;

 insert into public.integration_event_deliveries(
   organization_id,event_id,endpoint_id,endpoint_url,status,next_attempt_at
 )
 select v_org,v_event_id,w.id,w.url,'queued',now()
 from public.webhook_endpoints w
 where w.organization_id=v_org
   and w.active=true
   and w.deleted_at is null
   and ('*'=any(w.events) or v_event_type=any(w.events));

 if tg_op='DELETE' then return old; else return new; end if;
exception when others then
 -- A broken integration queue must never abort the underlying business transaction.
 if tg_op='DELETE' then return old; else return new; end if;
end;
$$;
