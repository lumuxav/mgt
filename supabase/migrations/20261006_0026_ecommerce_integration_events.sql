-- MGT Business Suite — E-commerce integration events

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
 if v_org is null then return coalesce(new,old); end if;

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
   when 'online_orders' then 'online_order'
   else tg_table_name
 end;
 v_entity_id:=coalesce(v_row->>'id',v_row->>'project_id',v_row->>'product_id');
 v_event_type:=v_entity||'.'||case when tg_op='INSERT' then 'created' when tg_op='UPDATE' then 'updated' else 'deleted' end;

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

 if not exists(select 1 from public.integration_event_deliveries d where d.event_id=v_event_id) then
   update public.integration_events set status='ignored',processed_at=now() where id=v_event_id;
 end if;

 return coalesce(new,old);
exception when others then
 return coalesce(new,old);
end;
$$;

revoke all on function public.queue_integration_event() from public;
revoke execute on function public.queue_integration_event() from anon;
revoke execute on function public.queue_integration_event() from authenticated;

drop trigger if exists online_orders_integration_events on public.online_orders;
create trigger online_orders_integration_events after insert or update on public.online_orders
for each row execute function public.queue_integration_event();
