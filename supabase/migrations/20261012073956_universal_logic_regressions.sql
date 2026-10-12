create or replace function public.accounting_sync_sale(p_sale_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.sales%rowtype; v_revenue numeric(18,2); v_cogs numeric(18,2); v_lines jsonb:='[]';
begin
 select * into s from public.sales where id=p_sale_id;
 if not found then return; end if;
 if s.status not in ('completed','partially_refunded','refunded') then
  perform public.accounting_remove_source_journal(s.organization_id,'sale',s.id::text); return;
 end if;
 v_revenue:=greatest(round(s.total_amount-s.tax_amount,2),0);
 select coalesce(sum(si.quantity*coalesce(si.unit_cost,0)),0) into v_cogs
 from public.sale_items si join public.products p on p.id=si.product_id
 where si.sale_id=s.id and p.track_inventory;
 if s.total_amount>0 then
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1100','debit',s.total_amount,'customer_id',s.customer_id,'memo','Sale receivable'));
 end if;
 if v_revenue>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','4000','credit',v_revenue,'memo','Sales revenue')); end if;
 if s.tax_amount>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2100','credit',s.tax_amount,'memo','Output tax')); end if;
 if v_cogs>0 then
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5000','debit',v_cogs,'memo','Cost of goods sold'),jsonb_build_object('code','1200','credit',v_cogs,'memo','Inventory issued'));
 end if;
 if jsonb_array_length(v_lines)=0 then
  perform public.accounting_remove_source_journal(s.organization_id,'sale',s.id::text); return;
 end if;
 perform public.accounting_write_journal(s.organization_id,s.location_id,s.created_at::date,'sale',s.id::text,coalesce(s.sale_number,'Sale'),coalesce(s.sale_number,s.id::text),'operating',v_lines,s.sold_by);
end; $$;
revoke all on function public.accounting_sync_sale(uuid) from public,anon,authenticated;

create or replace function public.accounting_sync_sale_return(p_return_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.sale_returns%rowtype; s public.sales%rowtype; v_cost numeric(18,2); v_tax numeric(18,2):=0; v_previous numeric(18,2); v_lines jsonb:='[]';
begin
 select * into r from public.sale_returns where id=p_return_id;
 if not found then return; end if;
 select * into s from public.sales where id=r.sale_id;
 select coalesce(sum(ri.quantity*coalesce(si.unit_cost,0)),0) into v_cost
 from public.sale_return_items ri join public.sale_items si on si.id=ri.sale_item_id
 join public.products p on p.id=si.product_id where ri.return_id=r.id and p.track_inventory;
 if s.total_amount>0 and s.tax_amount>0 and r.total_amount>0 then
  select coalesce(sum(total_amount),0) into v_previous from public.sale_returns
  where sale_id=s.id and (created_at,id)<(r.created_at,r.id);
  v_tax:=round((v_previous+r.total_amount)*s.tax_amount/s.total_amount,2)-round(v_previous*s.tax_amount/s.total_amount,2);
 end if;
 if r.total_amount-v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','4900','debit',r.total_amount-v_tax,'customer_id',r.customer_id,'memo','Sales return')); end if;
 if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2100','debit',v_tax,'memo','Reverse output tax')); end if;
 if r.total_amount>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1100','credit',r.total_amount,'customer_id',r.customer_id,'memo','Reduce receivable for return')); end if;
 if v_cost>0 then
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1200','debit',v_cost,'memo','Returned inventory'),jsonb_build_object('code','5000','credit',v_cost,'memo','Reverse cost of goods sold'));
 end if;
 if jsonb_array_length(v_lines)=0 then return; end if;
 perform public.accounting_write_journal(r.organization_id,r.location_id,r.created_at::date,'sale_return',r.id::text,coalesce(r.return_number,'Sale return'),r.refund_reference,'operating',v_lines,r.processed_by);
end; $$;
revoke all on function public.accounting_sync_sale_return(uuid) from public,anon,authenticated;

create or replace function public.accounting_party_opening_insert()
returns trigger language plpgsql security definer set search_path=public as $$
begin
 if new.opening_balance>0 then
  perform public.accounting_write_journal(new.organization_id,null,new.created_at::date,
   case when tg_table_name='customers' then 'migration_customer_opening' else 'migration_supplier_opening' end,
   new.id::text,'Opening balance - '||new.name,'Opening balance','noncash',
   case when tg_table_name='customers' then
    jsonb_build_array(jsonb_build_object('code','1100','debit',new.opening_balance,'customer_id',new.id),jsonb_build_object('code','3990','credit',new.opening_balance))
   else
    jsonb_build_array(jsonb_build_object('code','3990','debit',new.opening_balance),jsonb_build_object('code','2000','credit',new.opening_balance,'supplier_id',new.id))
   end,auth.uid());
 end if;
 return new;
end; $$;
revoke all on function public.accounting_party_opening_insert() from public,anon,authenticated;
create trigger customers_opening_accounting after insert on public.customers for each row execute function public.accounting_party_opening_insert();
create trigger suppliers_opening_accounting after insert on public.suppliers for each row execute function public.accounting_party_opening_insert();

revoke insert,update,delete on public.sales,public.sale_items,public.payments from anon,authenticated;
revoke execute on function public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text) from public,anon,authenticated;
