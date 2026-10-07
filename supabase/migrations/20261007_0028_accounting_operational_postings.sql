-- MGT Business Suite — Advanced Accounting operational postings

create or replace function public.accounting_sync_sale(p_sale_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare s public.sales%rowtype;v_revenue numeric(18,2);v_cogs numeric(18,2);v_lines jsonb:='[]'::jsonb;
begin
 select * into s from public.sales where id=p_sale_id;
 if not found then return; end if;
 if s.status<>'completed' then perform public.accounting_remove_source_journal(s.organization_id,'sale',s.id::text);return;end if;
 v_revenue:=greatest(round(coalesce(s.total_amount,0)-coalesce(s.tax_amount,0),2),0);
 select coalesce(sum(greatest(quantity,0)*coalesce(unit_cost,0)),0) into v_cogs from public.sale_items where sale_id=s.id;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1100','debit',s.total_amount,'customer_id',s.customer_id,'memo','Sale receivable'));
 if v_revenue>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','4000','credit',v_revenue,'memo','Sales revenue'));end if;
 if coalesce(s.tax_amount,0)>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2100','credit',s.tax_amount,'memo','Output tax'));end if;
 if v_cogs>0 then
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5000','debit',v_cogs,'memo','Cost of goods sold'));
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1200','credit',v_cogs,'memo','Inventory issued'));
 end if;
 perform public.accounting_write_journal(s.organization_id,s.location_id,s.created_at::date,'sale',s.id::text,coalesce(s.sale_number,'Sale'),coalesce(s.sale_number,s.id::text),'operating',v_lines,s.sold_by);
end;$$;
revoke all on function public.accounting_sync_sale(uuid) from public;
revoke execute on function public.accounting_sync_sale(uuid) from anon,authenticated;

create or replace function public.accounting_sync_sale_return(p_return_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare r public.sale_returns%rowtype;v_cost numeric(18,2);v_lines jsonb:='[]'::jsonb;
begin
 select * into r from public.sale_returns where id=p_return_id;
 if not found or coalesce(r.total_amount,0)<=0 then return;end if;
 select coalesce(sum(ri.quantity*coalesce(si.unit_cost,0)),0) into v_cost
 from public.sale_return_items ri left join public.sale_items si on si.id=ri.sale_item_id where ri.return_id=r.id;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','4900','debit',r.total_amount,'customer_id',r.customer_id,'memo','Sales return'));
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1100','credit',r.total_amount,'customer_id',r.customer_id,'memo','Reduce receivable for return'));
 if v_cost>0 then
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1200','debit',v_cost,'memo','Returned inventory'));
  v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','5000','credit',v_cost,'memo','Reverse cost of goods sold'));
 end if;
 perform public.accounting_write_journal(r.organization_id,r.location_id,r.created_at::date,'sale_return',r.id::text,coalesce(r.return_number,'Sale return'),r.refund_reference,'operating',v_lines,r.processed_by);
end;$$;
revoke all on function public.accounting_sync_sale_return(uuid) from public;
revoke execute on function public.accounting_sync_sale_return(uuid) from anon,authenticated;

create or replace function public.accounting_sync_purchase(p_purchase_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare p public.purchases%rowtype;v_inventory numeric(18,2):=0;v_expense numeric(18,2):=0;v_tax numeric(18,2):=0;v_total numeric(18,2):=0;v_lines jsonb:='[]'::jsonb;
begin
 select * into p from public.purchases where id=p_purchase_id;
 if not found then return;end if;
 select
  coalesce(sum(case when coalesce(pr.track_inventory,true) then least(pi.received_quantity,pi.quantity)*pi.unit_cost else 0 end),0),
  coalesce(sum(case when not coalesce(pr.track_inventory,true) then least(pi.received_quantity,pi.quantity)*pi.unit_cost else 0 end),0),
  coalesce(sum(case when pi.quantity>0 then pi.tax_amount*(least(pi.received_quantity,pi.quantity)/pi.quantity) else 0 end),0)
 into v_inventory,v_expense,v_tax
 from public.purchase_items pi left join public.products pr on pr.id=pi.product_id where pi.purchase_id=p.id;
 v_inventory:=round(v_inventory,2);v_expense:=round(v_expense,2);v_tax:=round(v_tax,2);v_total:=v_inventory+v_expense+v_tax;
 if v_total<=0 then perform public.accounting_remove_source_journal(p.organization_id,'purchase_receipt',p.id::text);return;end if;
 if v_inventory>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1200','debit',v_inventory,'memo','Inventory received'));end if;
 if v_expense>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','6000','debit',v_expense,'memo','Non-stock purchase expense'));end if;
 if v_tax>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1150','debit',v_tax,'memo','Input tax'));end if;
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2000','credit',v_total,'supplier_id',p.supplier_id,'memo','Supplier payable'));
 perform public.accounting_write_journal(p.organization_id,p.location_id,coalesce(p.received_at::date,p.updated_at::date,p.created_at::date),'purchase_receipt',p.id::text,coalesce(p.purchase_number,'Purchase receipt'),p.supplier_invoice_number,'operating',v_lines,p.created_by);
end;$$;
revoke all on function public.accounting_sync_purchase(uuid) from public;
revoke execute on function public.accounting_sync_purchase(uuid) from anon,authenticated;

create or replace function public.accounting_sync_work_order(p_work_order_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare w public.work_orders%rowtype;v_lines jsonb:='[]'::jsonb;
begin
 select * into w from public.work_orders where id=p_work_order_id;
 if not found then return;end if;
 if w.status<>'completed' or coalesce(w.final_amount,0)<=0 then perform public.accounting_remove_source_journal(w.organization_id,'work_order',w.id::text);return;end if;
 v_lines:=jsonb_build_array(
  jsonb_build_object('code','1100','debit',w.final_amount,'customer_id',w.customer_id,'memo','Service receivable'),
  jsonb_build_object('code','4100','credit',w.final_amount,'memo','Service revenue')
 );
 perform public.accounting_write_journal(w.organization_id,w.location_id,coalesce(w.completed_at::date,w.updated_at::date,w.created_at::date),'work_order',w.id::text,coalesce(w.job_number,w.title),coalesce(w.job_number,w.id::text),'operating',v_lines,w.created_by);
end;$$;
revoke all on function public.accounting_sync_work_order(uuid) from public;
revoke execute on function public.accounting_sync_work_order(uuid) from anon,authenticated;

create or replace function public.accounting_sync_project_invoice(p_invoice_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare i public.project_invoices%rowtype;v_revenue numeric(18,2);v_lines jsonb:='[]'::jsonb;
begin
 select * into i from public.project_invoices where id=p_invoice_id;
 if not found then return;end if;
 if i.status='void' or coalesce(i.total_amount,0)<=0 then perform public.accounting_remove_source_journal(i.organization_id,'project_invoice',i.id::text);return;end if;
 v_revenue:=greatest(round(coalesce(i.total_amount,0)-coalesce(i.tax_amount,0),2),0);
 v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','1100','debit',i.total_amount,'customer_id',i.customer_id,'project_id',i.project_id,'memo','Project receivable'));
 if v_revenue>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','4200','credit',v_revenue,'project_id',i.project_id,'memo','Project revenue'));end if;
 if coalesce(i.tax_amount,0)>0 then v_lines:=v_lines||jsonb_build_array(jsonb_build_object('code','2100','credit',i.tax_amount,'project_id',i.project_id,'memo','Output tax'));end if;
 perform public.accounting_write_journal(i.organization_id,i.location_id,i.issue_date,'project_invoice',i.id::text,coalesce(i.invoice_number,'Project invoice'),coalesce(i.invoice_number,i.id::text),'operating',v_lines,i.created_by);
end;$$;
revoke all on function public.accounting_sync_project_invoice(uuid) from public;
revoke execute on function public.accounting_sync_project_invoice(uuid) from anon,authenticated;

create or replace function public.accounting_sync_payment(p_payment_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare p public.payments%rowtype;v_cash_code text;v_lines jsonb:='[]'::jsonb;
begin
 select * into p from public.payments where id=p_payment_id;
 if not found or coalesce(p.amount,0)<=0 then return;end if;
 if p.payment_type='expense' or p.employee_user_id is not null then perform public.accounting_remove_source_journal(p.organization_id,'payment',p.id::text);return;end if;
 if p.payment_type='bank_deposit' then
  v_lines:=jsonb_build_array(jsonb_build_object('code','1010','debit',p.amount,'memo','Cash deposited to bank'),jsonb_build_object('code','1000','credit',p.amount,'memo','Cash removed from till'));
 elsif p.supplier_id is not null or p.payment_type='supplier_payment' then
  v_cash_code:=public.accounting_payment_account_code(p.method);
  v_lines:=jsonb_build_array(jsonb_build_object('code','2000','debit',p.amount,'supplier_id',p.supplier_id,'memo','Supplier payment'),jsonb_build_object('code',v_cash_code,'credit',p.amount,'memo','Payment out'));
 elsif p.direction='in' then
  v_cash_code:=public.accounting_payment_account_code(p.method);
  v_lines:=jsonb_build_array(jsonb_build_object('code',v_cash_code,'debit',p.amount,'memo','Customer receipt'),jsonb_build_object('code','1100','credit',p.amount,'customer_id',p.customer_id,'project_id',p.project_id,'memo','Reduce receivable'));
 else
  v_cash_code:=public.accounting_payment_account_code(p.method);
  v_lines:=jsonb_build_array(jsonb_build_object('code','1100','debit',p.amount,'customer_id',p.customer_id,'project_id',p.project_id,'memo','Refund / receivable adjustment'),jsonb_build_object('code',v_cash_code,'credit',p.amount,'memo','Refund paid'));
 end if;
 perform public.accounting_write_journal(p.organization_id,p.location_id,p.created_at::date,'payment',p.id::text,initcap(replace(coalesce(p.payment_type,'payment'),'_',' ')),p.reference,'operating',v_lines,p.received_by);
end;$$;
revoke all on function public.accounting_sync_payment(uuid) from public;
revoke execute on function public.accounting_sync_payment(uuid) from anon,authenticated;

create or replace function public.accounting_sync_expense(p_expense_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare e public.expenses%rowtype;v_expense_code text:='6000';v_cash_code text;v_mapped uuid;v_lines jsonb:='[]'::jsonb;
begin
 select * into e from public.expenses where id=p_expense_id;
 if not found or coalesce(e.amount,0)<=0 then return;end if;
 select account_id into v_mapped from public.accounting_expense_mappings where organization_id=e.organization_id and category_key=lower(trim(e.category)) limit 1;
 v_cash_code:=public.accounting_payment_account_code(e.payment_method);
 if v_mapped is not null then
  v_lines:=jsonb_build_array(jsonb_build_object('account_id',v_mapped,'debit',e.amount,'project_id',e.project_id,'memo',e.description),jsonb_build_object('code',v_cash_code,'credit',e.amount,'memo','Expense payment'));
 else
  if lower(coalesce(e.category,'')) ~ '(payroll|salary|wage)' then v_expense_code:='6100';
  elsif lower(coalesce(e.category,'')) ~ '(fuel|maintenance|vehicle|fleet|repair)' then v_expense_code:='6300';
  elsif e.project_id is not null then v_expense_code:='5200';end if;
  v_lines:=jsonb_build_array(jsonb_build_object('code',v_expense_code,'debit',e.amount,'project_id',e.project_id,'memo',e.description),jsonb_build_object('code',v_cash_code,'credit',e.amount,'memo','Expense payment'));
 end if;
 perform public.accounting_write_journal(e.organization_id,e.location_id,e.created_at::date,'expense',e.id::text,e.description,e.reference,'operating',v_lines,e.recorded_by);
end;$$;
revoke all on function public.accounting_sync_expense(uuid) from public;
revoke execute on function public.accounting_sync_expense(uuid) from anon,authenticated;

create or replace function public.accounting_sync_bank_transaction(p_tx_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare b public.banking_transactions%rowtype;v_lines jsonb:='[]'::jsonb;v_related boolean:=false;
begin
 select * into b from public.banking_transactions where id=p_tx_id;
 if not found or b.status<>'confirmed' or coalesce(b.amount,0)<=0 then return;end if;
 select exists(select 1 from public.expenses e where e.organization_id=b.organization_id and e.bank_account_id=b.bank_account_id and e.recorded_by is not distinct from b.recorded_by and abs(e.amount-b.amount)<0.01 and abs(extract(epoch from(e.created_at-b.created_at)))<=15)
 or exists(select 1 from public.payments p where p.organization_id=b.organization_id and p.payment_type='bank_deposit' and abs(p.amount-b.amount)<0.01 and p.location_id is not distinct from b.location_id and abs(extract(epoch from(p.created_at-b.created_at)))<=15) into v_related;
 if v_related then perform public.accounting_remove_source_journal(b.organization_id,'bank_transaction',b.id::text);return;end if;
 if b.transaction_type='deposit' then
  v_lines:=jsonb_build_array(jsonb_build_object('code','1010','debit',b.amount,'memo','Bank deposit / adjustment'),jsonb_build_object('code','3900','credit',b.amount,'memo','Unclassified funding / clearing'));
 else
  v_lines:=jsonb_build_array(jsonb_build_object('code','3900','debit',b.amount,'memo','Unclassified withdrawal / clearing'),jsonb_build_object('code','1010','credit',b.amount,'memo','Bank withdrawal / adjustment'));
 end if;
 perform public.accounting_write_journal(b.organization_id,b.location_id,b.created_at::date,'bank_transaction',b.id::text,initcap(b.transaction_type)||' · bank',b.reference,'financing',v_lines,b.recorded_by);
end;$$;
revoke all on function public.accounting_sync_bank_transaction(uuid) from public;
revoke execute on function public.accounting_sync_bank_transaction(uuid) from anon,authenticated;

create or replace function public.accounting_sale_trigger()returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;begin if tg_table_name='sales' then v_id:=coalesce(new.id,old.id);else v_id:=coalesce(new.sale_id,old.sale_id);end if;perform public.accounting_sync_sale(v_id);return coalesce(new,old);end;$$;
revoke all on function public.accounting_sale_trigger() from public;revoke execute on function public.accounting_sale_trigger() from anon,authenticated;
drop trigger if exists sales_accounting_sync on public.sales;
create trigger sales_accounting_sync after insert or update of status,total_amount,tax_amount,subtotal,discount_amount on public.sales for each row execute function public.accounting_sale_trigger();
drop trigger if exists sale_items_accounting_sync on public.sale_items;
create trigger sale_items_accounting_sync after insert or update or delete on public.sale_items for each row execute function public.accounting_sale_trigger();

create or replace function public.accounting_return_trigger()returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;begin if tg_table_name='sale_returns' then v_id:=coalesce(new.id,old.id);else v_id:=coalesce(new.return_id,old.return_id);end if;perform public.accounting_sync_sale_return(v_id);return coalesce(new,old);end;$$;
revoke all on function public.accounting_return_trigger() from public;revoke execute on function public.accounting_return_trigger() from anon,authenticated;
drop trigger if exists sale_returns_accounting_sync on public.sale_returns;
create trigger sale_returns_accounting_sync after insert or update on public.sale_returns for each row execute function public.accounting_return_trigger();
drop trigger if exists sale_return_items_accounting_sync on public.sale_return_items;
create trigger sale_return_items_accounting_sync after insert or update or delete on public.sale_return_items for each row execute function public.accounting_return_trigger();

create or replace function public.accounting_purchase_trigger()returns trigger language plpgsql security definer set search_path=public as $$
declare v_id uuid;begin if tg_table_name='purchases' then v_id:=coalesce(new.id,old.id);else v_id:=coalesce(new.purchase_id,old.purchase_id);end if;perform public.accounting_sync_purchase(v_id);return coalesce(new,old);end;$$;
revoke all on function public.accounting_purchase_trigger() from public;revoke execute on function public.accounting_purchase_trigger() from anon,authenticated;
drop trigger if exists purchases_accounting_sync on public.purchases;
create trigger purchases_accounting_sync after insert or update of status,total_amount,tax_amount,received_at on public.purchases for each row execute function public.accounting_purchase_trigger();
drop trigger if exists purchase_items_accounting_sync on public.purchase_items;
create trigger purchase_items_accounting_sync after insert or update of received_quantity,unit_cost,tax_amount or delete on public.purchase_items for each row execute function public.accounting_purchase_trigger();

create or replace function public.accounting_work_order_trigger()returns trigger language plpgsql security definer set search_path=public as $$begin perform public.accounting_sync_work_order(coalesce(new.id,old.id));return coalesce(new,old);end;$$;
revoke all on function public.accounting_work_order_trigger() from public;revoke execute on function public.accounting_work_order_trigger() from anon,authenticated;
drop trigger if exists work_orders_accounting_sync on public.work_orders;
create trigger work_orders_accounting_sync after insert or update of status,final_amount,completed_at on public.work_orders for each row execute function public.accounting_work_order_trigger();

create or replace function public.accounting_project_invoice_trigger()returns trigger language plpgsql security definer set search_path=public as $$begin perform public.accounting_sync_project_invoice(coalesce(new.id,old.id));return coalesce(new,old);end;$$;
revoke all on function public.accounting_project_invoice_trigger() from public;revoke execute on function public.accounting_project_invoice_trigger() from anon,authenticated;
drop trigger if exists project_invoices_accounting_sync on public.project_invoices;
create trigger project_invoices_accounting_sync after insert or update of status,total_amount,tax_amount,issue_date on public.project_invoices for each row execute function public.accounting_project_invoice_trigger();

create or replace function public.accounting_payment_trigger()returns trigger language plpgsql security definer set search_path=public as $$begin perform public.accounting_sync_payment(new.id);return new;end;$$;
revoke all on function public.accounting_payment_trigger() from public;revoke execute on function public.accounting_payment_trigger() from anon,authenticated;
drop trigger if exists payments_accounting_sync on public.payments;
create trigger payments_accounting_sync after insert on public.payments for each row execute function public.accounting_payment_trigger();

create or replace function public.accounting_expense_trigger()returns trigger language plpgsql security definer set search_path=public as $$begin perform public.accounting_sync_expense(coalesce(new.id,old.id));return coalesce(new,old);end;$$;
revoke all on function public.accounting_expense_trigger() from public;revoke execute on function public.accounting_expense_trigger() from anon,authenticated;
drop trigger if exists expenses_accounting_sync on public.expenses;
create trigger expenses_accounting_sync after insert or update of amount,category,payment_method,project_id on public.expenses for each row execute function public.accounting_expense_trigger();

create or replace function public.accounting_bank_trigger()returns trigger language plpgsql security definer set search_path=public as $$begin perform public.accounting_sync_bank_transaction(coalesce(new.id,old.id));return coalesce(new,old);end;$$;
revoke all on function public.accounting_bank_trigger() from public;revoke execute on function public.accounting_bank_trigger() from anon,authenticated;
drop trigger if exists banking_transactions_accounting_sync on public.banking_transactions;
create trigger banking_transactions_accounting_sync after insert or update of amount,transaction_type,status on public.banking_transactions for each row execute function public.accounting_bank_trigger();

do $$
declare r record;
begin
 for r in select id from public.sales loop perform public.accounting_sync_sale(r.id);end loop;
 for r in select id from public.sale_returns loop perform public.accounting_sync_sale_return(r.id);end loop;
 for r in select id from public.purchases loop perform public.accounting_sync_purchase(r.id);end loop;
 for r in select id from public.work_orders loop perform public.accounting_sync_work_order(r.id);end loop;
 for r in select id from public.project_invoices loop perform public.accounting_sync_project_invoice(r.id);end loop;
 for r in select id from public.payments loop perform public.accounting_sync_payment(r.id);end loop;
 for r in select id from public.expenses loop perform public.accounting_sync_expense(r.id);end loop;
 for r in select id from public.banking_transactions loop perform public.accounting_sync_bank_transaction(r.id);end loop;
end $$;
