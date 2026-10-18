begin;
create temporary table audit_results(test text primary key, result text default 'passed');
create function pg_temp.expect_error(label text, command text, expected text)
returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin execute command;
 exception when others then
  if position(expected in sqlerrm)=0 then raise exception '%: unexpected error %',label,sqlerrm; end if;
  rejected:=true;
 end;
 if not rejected then raise exception '%: action was incorrectly accepted',label; end if;
 insert into audit_results(test) values(label);
end; $$;
do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
 loc uuid:=gen_random_uuid(); other_loc uuid:=gen_random_uuid(); prod uuid:=gen_random_uuid(); service uuid:=gen_random_uuid();
 cust uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 sale uuid; item uuid; job uuid; shop uuid:=gen_random_uuid(); ord uuid:=gen_random_uuid(); connection uuid:=gen_random_uuid(); tx uuid:=gen_random_uuid();
 result jsonb; q numeric; total numeric; paid numeric; i integer;
 closing_customer uuid:=gen_random_uuid(); closing_sale uuid:=gen_random_uuid(); closing_job uuid:=gen_random_uuid(); original_journal uuid;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email) values(actor,actor::text||'@audit.invalid'),(member,member::text||'@audit.invalid');
 insert into public.organizations(id,name) values(org,'Universal transactional audit'),(other_org,'Universal isolation audit');
 insert into public.locations(id,organization_id,name) values(loc,org,'Audit location'),(other_loc,other_org,'Other location');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(actor,org,'Audit owner','owner',loc);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 insert into public.products(id,organization_id,name,selling_price,cost_price) values(prod,org,'Audit item',1,0.25);
 insert into public.products(id,organization_id,name,selling_price,cost_price,track_inventory,item_type) values(service,org,'Audit service',10,5,false,'service');
 insert into public.stock_balances(product_id,location_id,quantity,reserved_quantity) values(prod,loc,10,8);
 insert into public.customers(id,organization_id,name,credit_limit,opening_balance) values(cust,org,'Credit-limit audit',100,95),(customer,org,'Refund audit',1000,20);
 insert into public.suppliers(id,organization_id,name,opening_balance) values(supplier,org,'Opening payable audit',30);

 perform pg_temp.expect_error('POS protects reservations',format('select public.post_pos_sale(%L,%L,%L::jsonb)',loc,customer,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',3))),'Insufficient stock');
 if exists(select 1 from public.sales where organization_id=org) then raise exception 'Failed sale left financial rows'; end if;
 insert into audit_results(test) values('Rejected sale rolls back all writes');
 perform pg_temp.expect_error('Adjustments protect reservations',format('select public.adjust_stock(%L,%L,-3)',loc,prod),'reserved stock');
 perform pg_temp.expect_error('Stocktake protects reservations',format('select public.post_stocktake(%L,%L::jsonb)',loc,jsonb_build_array(jsonb_build_object('product_id',prod,'counted_quantity',7))),'reserved quantity');
 result:=public.post_pos_sale(loc,null,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',2)),jsonb_build_array(jsonb_build_object('method','bank','amount',2)));
 sale:=(result->>'sale_id')::uuid;
 select quantity into q from public.stock_balances where product_id=prod and location_id=loc;
 if q<>8 or (result->>'total_amount')::numeric<>2 then raise exception 'Valid reserved-stock sale failed'; end if;
 insert into audit_results(test) values('Valid POS sale posts stock and accounting');
 if not exists(select 1 from public.accounting_journals where organization_id=org and source_type='sale' and source_id=sale::text) then raise exception 'Sale journal missing'; end if;
 insert into audit_results(test) values('Sale journal is created after valid totals');
 update public.stock_balances set quantity=100,reserved_quantity=0 where product_id=prod and location_id=loc;
 perform pg_temp.expect_error('Opening debt counts against credit limit',format('select public.post_pos_sale(%L,%L,%L::jsonb)',loc,cust,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',10))),'credit limit would be exceeded');
 select balance_due into total from public.get_customer_sales_balances() where customer_id=cust;
 if total<>95 then raise exception 'Opening debt missing from aggregate'; end if;
 insert into audit_results(test) values('Customer balance includes opening debt');
 if not exists(select 1 from public.accounting_journals where organization_id=org and source_type='migration_supplier_opening' and source_id=supplier::text) then raise exception 'Opening supplier journal missing'; end if;
 insert into audit_results(test) values('Supplier creation posts opening payable');
 result:=public.record_customer_payment(cust,loc,5,'bank');
 if (result->>'remaining_balance')::numeric<>90 then raise exception 'Opening repayment incorrect'; end if;
 insert into audit_results(test) values('Opening customer debt can be repaid');

 perform pg_temp.expect_error('NULL sale items rejected',format('select public.post_pos_sale(%L,null,null)',loc),'At least one sale item');
 perform pg_temp.expect_error('Negative sale discount rejected',format('select public.post_pos_sale(%L,%L,%L::jsonb,%L::jsonb,-1)',loc,customer,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),'[]'),'cannot be negative');
 perform pg_temp.expect_error('Cash sale requires open till',format('select public.post_pos_sale(%L,null,%L::jsonb,%L::jsonb)',loc,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1)),jsonb_build_array(jsonb_build_object('method','cash','amount',1))),'Open a till');

 result:=public.post_pos_sale(loc,customer,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',3)),jsonb_build_array(jsonb_build_object('method','bank','amount',2)),1);
 sale:=(result->>'sale_id')::uuid;
 select id into item from public.sale_items where sale_id=sale;
 for i in 1..3 loop
  result:=public.process_sale_return(sale,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1)),'bank');
 end loop;
 select sum(total_amount) into total from public.sale_returns where sale_id=sale;
 if total<>2 then raise exception 'Split refunds do not equal discounted sale total: %',total; end if;
 insert into audit_results(test) values('Split refund rounds exactly to sale value');
 if not exists(select 1 from public.sales where id=sale and status='refunded' and refunded_amount=2) then raise exception 'Fully returned sale status incorrect'; end if;
 insert into audit_results(test) values('Returned quantities determine final status');
 if not exists(select 1 from public.accounting_journals where source_type='sale' and source_id=sale::text) then raise exception 'Return deleted original sale journal'; end if;
 insert into audit_results(test) values('Return preserves original accounting entry');
 perform pg_temp.expect_error('Repeated full refund rejected',format('select public.process_sale_return(%L,%L::jsonb)',sale,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1))),'fully refunded');

 update public.products set tax_rate=18 where id=prod;
 result:=public.post_pos_sale(loc,customer,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',3)),jsonb_build_array(jsonb_build_object('method','bank','amount',3.54)));
 sale:=(result->>'sale_id')::uuid;
 select id into item from public.sale_items where sale_id=sale;
 for i in 1..3 loop perform public.process_sale_return(sale,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1)),'bank'); end loop;
 select coalesce(sum(l.credit-l.debit),0) into total from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id join public.accounting_accounts a on a.id=l.account_id
 where a.code='2100' and j.organization_id=org and (j.source_type='sale' and j.source_id=sale::text or j.source_type='sale_return' and j.source_id in (select id::text from public.sale_returns where sale_id=sale));
 if total<>0 then raise exception 'VAT not reversed exactly: %',total; end if;
 insert into audit_results(test) values('Refund reverses VAT exactly');
 update public.products set tax_rate=0 where id=prod;

 result:=public.post_pos_sale(loc,null,jsonb_build_array(jsonb_build_object('product_id',service,'quantity',1)),jsonb_build_array(jsonb_build_object('method','bank','amount',10)));
 sale:=(result->>'sale_id')::uuid;
 if exists(select 1 from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id join public.accounting_accounts a on a.id=l.account_id where j.source_type='sale' and j.source_id=sale::text and a.code='1200') then raise exception 'Non-stock service reduced inventory ledger'; end if;
 insert into audit_results(test) values('Non-stock services leave inventory ledger alone');

 insert into public.work_orders(organization_id,location_id,customer_id,title,quoted_amount,final_amount) values(org,loc,customer,'Quoted audit job',100,0) returning id into job;
 result:=public.record_work_order_payment(job,20,'bank');
 if (result->>'balance')::numeric<>80 then raise exception 'Quoted job deposit failed'; end if;
 insert into audit_results(test) values('Quoted service job accepts deposit');

 insert into public.work_orders(organization_id,location_id,customer_id,title,quoted_amount,final_amount) values(org,loc,customer,'Material-cost audit',0,0) returning id into job;
 result:=public.add_work_order_line(job,'material',prod,'Audit material',2,1,0.25);
 item:=(result->>'line_id')::uuid;
 if not exists(select 1 from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id join public.accounting_accounts a on a.id=l.account_id where j.organization_id=org and j.source_type='stock_cost' and a.code='5100' and l.debit=0.5) then raise exception 'Job material cost was not posted'; end if;
 insert into audit_results(test) values('Job materials post inventory and service cost');
 perform public.remove_work_order_line(item);
 select coalesce(sum(l.debit-l.credit),0) into total from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id join public.accounting_accounts a on a.id=l.account_id where j.organization_id=org and j.source_type='stock_cost' and a.code='5100';
 if total<>0 then raise exception 'Material reversal did not reverse service cost'; end if;
 insert into audit_results(test) values('Removed job material reverses its cost');
 perform public.adjust_stock(loc,prod,-1);
 if not exists(select 1 from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id join public.accounting_accounts a on a.id=l.account_id where j.organization_id=org and j.source_type='stock_cost' and a.code='5300' and l.debit=0.25) then raise exception 'Adjustment did not update inventory ledger'; end if;
 insert into audit_results(test) values('Stock adjustment updates inventory ledger');
 if has_function_privilege('authenticated','public.adjust_stock(uuid,uuid,numeric,text,text)','EXECUTE') then raise exception 'Internal adjustment can bypass approvals'; end if;
 insert into audit_results(test) values('Stock adjustment approval cannot be bypassed');

 insert into public.storefronts(id,organization_id,location_id,name,slug) values(shop,org,loc,'Audit shop','audit-'||shop::text);
 insert into public.online_orders(id,organization_id,storefront_id,location_id,order_number,status,customer_name,customer_phone,subtotal,total_amount) values(ord,org,shop,loc,'AUDIT-WEB','ready','Online audit','256700000000',1,1);
 insert into public.online_order_items(organization_id,order_id,product_id,description,quantity,unit_price,unit_cost,line_total) values(org,ord,prod,'Audit item',1,1,0.25,1);
 update public.stock_balances set reserved_quantity=reserved_quantity+1 where product_id=prod and location_id=loc;
 result:=public.transition_online_order(ord,'completed');
 sale:=(result->>'sale_id')::uuid;
 insert into public.payment_provider_connections(id,organization_id,provider,name) values(connection,org,'mtn_momo','Audit provider');
 insert into public.external_payment_transactions(id,organization_id,connection_id,provider,target_type,target_id,location_id,amount,external_reference,status,initiated_by) values(tx,org,connection,'mtn_momo','online_order',ord,loc,1,tx::text,'succeeded',actor);
 result:=public.server_settle_external_payment(tx);
 select amount_paid into paid from public.sales where id=sale;
 if paid<>1 or not exists(select 1 from public.payments where sale_id=sale and amount=1) then raise exception 'Late online payment did not clear linked sale'; end if;
 insert into audit_results(test) values('Late online payment clears converted sale');
 perform public.server_settle_external_payment(tx);
 select count(*) into total from public.payments where sale_id=sale;
 if total<>1 then raise exception 'Repeated settlement duplicated payment'; end if;
 insert into audit_results(test) values('Settlement retry is idempotent');
 tx:=gen_random_uuid();
 insert into public.external_payment_transactions(id,organization_id,connection_id,provider,target_type,target_id,location_id,amount,external_reference,status,initiated_by) values(tx,org,connection,'mtn_momo','online_order',ord,loc,1,tx::text,'succeeded',actor);
 perform pg_temp.expect_error('Additional online collection requires reconciliation',format('select public.server_settle_external_payment(%L)',tx),'already paid');

 insert into public.roles(organization_id,key,name,active) values(org,'audit_disabled','Audit disabled role',false);
 insert into public.role_permissions(organization_id,role,permission,allowed) values(org,'audit_disabled','sales.create',true);
 insert into public.users(id,organization_id,full_name,role) values(member,org,'Audit member','audit_disabled');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 if public.has_permission('sales.create') then raise exception 'Disabled role retained privileges'; end if;
 insert into audit_results(test) values('Disabled role loses permissions');
 -- Staff status updates are service-only since the privilege escalation guard.
 -- This simulates the validated management endpoint rather than an unsafe browser write.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','service_role')::text,true);
 update public.users set archived_at=clock_timestamp() where id=member;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 if public.current_organization_id() is not null then raise exception 'Archived account retained organization access'; end if;
 insert into audit_results(test) values('Archived account loses organization access');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 perform pg_temp.expect_error('Foreign location cannot be used',format('select public.post_pos_sale(%L,%L,%L::jsonb)',other_loc,customer,jsonb_build_array(jsonb_build_object('product_id',prod,'quantity',1))),'Location not found');

 if has_table_privilege('authenticated','public.sales','UPDATE') or has_table_privilege('authenticated','public.payments','DELETE') or has_table_privilege('authenticated','public.sale_items','INSERT') then raise exception 'Direct financial write bypass still exposed'; end if;
 insert into audit_results(test) values('Financial rows require transaction functions');
 if has_function_privilege('authenticated','public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text)','EXECUTE') or has_function_privilege('authenticated','public.server_customer_sales_balance(uuid,uuid)','EXECUTE') then raise exception 'Unsafe internal RPC exposed'; end if;
 insert into audit_results(test) values('Legacy and server-only RPCs are restricted');
 if exists(select 1 from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id where j.organization_id=org group by j.id having abs(sum(l.debit)-sum(l.credit))>0.009) then raise exception 'Audit generated an unbalanced journal'; end if;
 insert into audit_results(test) values('All transaction journals balance');

 insert into public.customers(id,organization_id,name,credit_limit,opening_balance,created_at) values(closing_customer,org,'Closing audit customer',1000,10,current_date-1);
 insert into public.sales(id,organization_id,location_id,customer_id,sale_number,status,subtotal,total_amount,created_at,sold_by) values(closing_sale,org,loc,closing_customer,'AUDIT-CLOSED','completed',10,10,current_date-1,actor);
 insert into public.sale_items(sale_id,product_id,description,quantity,unit_price,unit_cost,line_total) values(closing_sale,service,'Audit service',1,10,0,10) returning id into item;
 insert into public.work_orders(id,organization_id,location_id,customer_id,title,status,quoted_amount,final_amount,completed_at,created_at,created_by) values(closing_job,org,loc,closing_customer,'Closing audit job','completed',100,100,current_date-1,current_date-1,actor);
 select id into original_journal from public.accounting_journals where source_type='sale' and source_id=closing_sale::text;
 insert into public.accounting_periods(organization_id,name,start_date,end_date,status) values(org,'Closed audit day',current_date-1,current_date-1,'closed');
 perform public.process_sale_return(closing_sale,jsonb_build_array(jsonb_build_object('sale_item_id',item,'quantity',1)),'bank');
 if not exists(select 1 from public.accounting_journals where id=original_journal and journal_date=current_date-1) then raise exception 'Return changed a closed-period source journal'; end if;
 insert into audit_results(test) values('Current return of a closed-period sale preserves its journal');
 result:=public.record_work_order_payment(closing_job,20,'bank');
 if (result->>'balance')::numeric<>80 then raise exception 'Closed-period completed job cannot receive repayment'; end if;
 insert into audit_results(test) values('Old completed service job can receive a current repayment');
 perform pg_temp.expect_error('Closed opening journal cannot be moved to an open date',format('select public.set_party_opening_balance(%L,%L,50,current_date)','customer',closing_customer),'closed accounting period');
end $$;
select * from audit_results order by test;
rollback;
