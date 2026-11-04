-- Run only on the disposable CI database. Fixtures are rolled back.
begin;
create temporary table production_results(test text primary key);
create function pg_temp.check_true(label text, passed boolean) returns void language plpgsql as $$
begin
 if passed is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into production_results values(label);
end; $$;
create function pg_temp.reject(label text, command text, expected text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin execute command; exception when others then
  if position(expected in sqlerrm)=0 then raise exception '%: unexpected error %',label,sqlerrm; end if;
  rejected:=true;
 end;
 perform pg_temp.check_true(label,rejected);
end; $$;

do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); owner_id uuid:=gen_random_uuid();
 cashier uuid:=gen_random_uuid(); worker uuid:=gen_random_uuid(); driver uuid:=gen_random_uuid();
 loc uuid:=gen_random_uuid(); second_loc uuid:=gen_random_uuid(); foreign_loc uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); stock_customer uuid:=gen_random_uuid(); request_id uuid:=gen_random_uuid();
 result jsonb; retry jsonb; sale uuid; other_sale uuid; job uuid; line uuid; project uuid; project2 uuid; payroll uuid;
 vehicle uuid; delivery uuid; delivery2 uuid; pending_delivery uuid; qty numeric; n integer; r record; args text;
 supplier uuid:=gen_random_uuid(); purchase_a uuid:=gen_random_uuid(); purchase_b uuid:=gen_random_uuid(); approval uuid; task_id uuid;
 items jsonb; tender jsonb; count_before bigint;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email) values(owner_id,owner_id||'@audit.invalid'),(cashier,cashier||'@audit.invalid'),(worker,worker||'@audit.invalid'),(driver,driver||'@audit.invalid');
 insert into public.organizations(id,name) values(org,'Production regression fixtures'),(other_org,'Independent regression tenant');
 perform public.seed_default_roles(org);
 insert into public.organization_modules(organization_id,module_key,enabled)
 select org,key,true from unnest(array['dashboard','pos','inventory','sales','customers','suppliers','purchasing','services','manufacturing','finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','payments','integrations','insights']) key
 on conflict(organization_id,module_key) do update set enabled=true;
 insert into public.locations(id,organization_id,name) values(loc,org,'Branch A'),(second_loc,org,'Branch B'),(foreign_loc,other_org,'Other business');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values
 (owner_id,org,'Audit owner','owner',loc),(cashier,org,'Audit cashier','cashier',loc),
 (worker,org,'Audit project worker','project_worker',loc),(driver,org,'Audit driver','delivery_driver',loc);
 insert into public.products(id,organization_id,name,selling_price,cost_price) values(product,org,'Regression stock',10,4);
 insert into public.stock_balances(product_id,location_id,quantity) values(product,loc,100),(product,second_loc,100);
 insert into public.customers(id,organization_id,name,credit_limit)
 values(customer,org,'Regression buyer',10000),(stock_customer,org,'Stock lifecycle buyer',10000);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 items:=jsonb_build_array(jsonb_build_object('product_id',product,'quantity',2));
 tender:=jsonb_build_array(jsonb_build_object('method','bank','amount',20));
 result:=public.post_pos_sale_once(request_id,loc,null,items,tender);
 retry:=public.post_pos_sale_once(request_id,loc,null,items,tender);
 sale:=(result->>'sale_id')::uuid;
 perform pg_temp.check_true('Checkout retry returns original sale',result=retry);
 perform pg_temp.check_true('Checkout retry deducts stock once',(select quantity=98 from public.stock_balances where product_id=product and location_id=loc));
 perform pg_temp.check_true('Checkout retry records payment once',(select count(*)=1 from public.payments where sale_id=sale));
 result:=public.post_pos_sale(loc,stock_customer,items);
 sale:=(result->>'sale_id')::uuid;
 perform pg_temp.check_true('Unpaid dispatched POS sale holds stock without reducing on-hand',(select quantity=98 and reserved_quantity=2 from public.stock_balances where product_id=product and location_id=loc));
 result:=public.record_customer_payment(stock_customer,loc,1,'bank');
 perform pg_temp.check_true('Any confirmed partial payment consumes dispatched stock once',(select quantity=96 and reserved_quantity=0 from public.stock_balances where product_id=product and location_id=loc));
 result:=public.record_customer_payment(stock_customer,loc,1,'bank');
 perform pg_temp.check_true('Repeated partial payment does not consume stock twice',(select quantity=96 from public.stock_balances where product_id=product and location_id=loc));
 perform pg_temp.check_true('Partial-payment stock consumption has one movement',(select count(*)=1 from public.stock_movements where reference_type='sale' and reference_id=sale));
 select id into line from public.sale_items where sale_id=sale;
 perform public.process_sale_return(sale,jsonb_build_array(jsonb_build_object('sale_item_id',line,'quantity',1)),'bank');
 perform pg_temp.check_true('Return after consumption restores returned stock',(select quantity=97 from public.stock_balances where product_id=product and location_id=loc));
 result:=public.post_pos_sale(loc,stock_customer,items);
 sale:=(result->>'sale_id')::uuid;
 select id into line from public.sale_items where sale_id=sale;
 perform public.process_sale_return(sale,jsonb_build_array(jsonb_build_object('sale_item_id',line,'quantity',2)),'bank');
 perform pg_temp.check_true('Return before payment releases hold without inflating stock',(select quantity=97 and reserved_quantity=0 from public.stock_balances where product_id=product and location_id=loc));
 perform pg_temp.check_true('Returned unpaid hold is recorded as released',(select status='released' from public.sale_stock_holds where sale_id=sale and product_id=product));
 result:=public.post_pos_sale(loc,stock_customer,items,'[]'::jsonb,0,'ecommerce');
 sale:=(result->>'sale_id')::uuid;
 update public.sale_stock_holds set dispatched=false where sale_id=sale;
 insert into public.deliveries(organization_id,delivery_number,source_location_id,sale_id,destination)
 values(org,'AUDIT-OUT-001',loc,sale,'Audit destination') returning id into delivery;
 update public.sales set amount_paid=1,payment_status='partial' where id=sale;
 perform pg_temp.check_true('Online payment before dispatch keeps stock reserved',(select quantity=97 and reserved_quantity=2 from public.stock_balances where product_id=product and location_id=loc));
 update public.deliveries set status='dispatched' where id=delivery;
 perform pg_temp.check_true('Dispatch after payment consumes reserved stock',(select quantity=95 and reserved_quantity=0 from public.stock_balances where product_id=product and location_id=loc));
 result:=public.post_pos_sale(loc,stock_customer,items,'[]'::jsonb,0,'ecommerce');
 sale:=(result->>'sale_id')::uuid;
 update public.sale_stock_holds set dispatched=false where sale_id=sale;
 insert into public.deliveries(organization_id,delivery_number,source_location_id,sale_id,destination)
 values(org,'AUDIT-OUT-002',loc,sale,'Audit destination') returning id into delivery2;
 update public.deliveries set status='dispatched' where id=delivery2;
 perform pg_temp.check_true('Dispatch before payment keeps stock reserved',(select quantity=95 and reserved_quantity=2 from public.stock_balances where product_id=product and location_id=loc));
 update public.sales set amount_paid=1,payment_status='partial' where id=sale;
 perform pg_temp.check_true('Payment after dispatch consumes reserved stock',(select quantity=93 and reserved_quantity=0 from public.stock_balances where product_id=product and location_id=loc));
 update public.sales set amount_paid=2 where id=sale;
 perform pg_temp.check_true('Repeated online settlement remains idempotent',(select quantity=93 from public.stock_balances where product_id=product and location_id=loc));
 perform pg_temp.reject('Checkout key cannot be reused with another cart',format('select public.post_pos_sale_once(%L,%L,null,%L::jsonb,%L::jsonb)',request_id,loc,jsonb_build_array(jsonb_build_object('product_id',product,'quantity',1)),tender),'different sale details');
 perform pg_temp.check_true('Legacy immediate receiving is no longer public',not has_function_privilege('authenticated','public.receive_purchase(uuid,uuid,jsonb,numeric,text,text)','EXECUTE'));
 perform pg_temp.check_true('Anonymous checkout is forbidden',not has_function_privilege('anon','public.post_pos_sale_once(uuid,uuid,uuid,jsonb,jsonb,numeric,text,text,text)','EXECUTE'));
 perform pg_temp.check_true('Checkout ledger cannot be edited directly',not has_table_privilege('authenticated','public.sale_checkout_requests','UPDATE'));

 result:=public.post_pos_sale(second_loc,customer,items); other_sale:=(result->>'sale_id')::uuid;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cashier,'role','authenticated')::text,true);
 perform pg_temp.reject('Cashier cannot open another branch till',format('select public.open_till(%L)',second_loc),'outside your assigned work scope');
 perform pg_temp.reject('Cashier cannot sell from another branch',format('select public.post_pos_sale(%L,%L,%L::jsonb)',second_loc,customer,items),'outside your assigned work scope');
 result:=public.post_pos_sale(loc,customer,items); sale:=(result->>'sale_id')::uuid;
 perform pg_temp.check_true('Cashier can sell from assigned branch',sale is not null);
 result:=public.record_customer_payment(customer,loc,20,'bank');
 perform pg_temp.check_true('Collection leaves other branch debt unchanged',(select amount_paid=0 from public.sales where id=other_sale));
 perform pg_temp.check_true('Collection pays the accessible sale',(select amount_paid=20 from public.sales where id=sale));
 perform pg_temp.check_true('Balance summary hides other branch sales',(select balance_due=0 from public.get_customer_sales_balances() where customer_id=customer));
 perform pg_temp.check_true('Payment provider cannot target another branch',not public.mgt_payment_target_access('sale',other_sale));
 perform pg_temp.check_true('Payment provider accepts own branch target',public.mgt_payment_target_access('sale',sale));
 perform pg_temp.check_true('Scope helper rejects another tenant',not public.mgt_record_scope_allows(other_org,loc,cashier,true));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 perform pg_temp.reject('Foreign stock location remains denied',format('select public.post_pos_sale(%L,%L,%L::jsonb)',foreign_loc,customer,items),'Location not found');

 perform pg_temp.reject('Quotation discount cannot exceed its value',format('select public.create_quotation(%L,null,current_date,null,null,null,%L::jsonb)',loc,'[{"description":"Invalid discount","quantity":1,"unit_price":10,"discount_amount":11}]'),'discount cannot exceed');
 perform pg_temp.reject('Non-finite catalog prices are rejected',format('update public.products set selling_price=''NaN''::numeric where id=%L',product),'mgt_finite_numbers');
 perform pg_temp.reject('Non-finite stock quantities are rejected',format('update public.stock_balances set quantity=''NaN''::numeric where product_id=%L and location_id=%L',product,loc),'mgt_finite_numbers');

 insert into public.suppliers(id,organization_id,name,opening_balance) values(supplier,org,'Scoped supplier',50);
 insert into public.purchases(id,organization_id,location_id,supplier_id,purchase_number,total_amount,created_by,status)
 values(purchase_a,org,loc,supplier,'AUDIT-P-A',20,owner_id,'ordered'),(purchase_b,org,second_loc,supplier,'AUDIT-P-B',20,owner_id,'ordered');
 insert into public.purchases(organization_id,location_id,supplier_id,purchase_number,total_amount,created_by,status,approval_status)
 values(org,loc,supplier,'AUDIT-UNAPPROVED',500,owner_id,'pending_approval','pending');
 update public.user_work_scope set scope='location',location_id=loc where organization_id=org and user_id=owner_id;
 perform public.record_supplier_payment(supplier,loc,20,'bank');
 perform pg_temp.check_true('Supplier payment pays accessible purchase',(select amount_paid=20 from public.purchases where id=purchase_a));
 perform pg_temp.check_true('Supplier payment cannot pay other branch purchase',(select amount_paid=0 from public.purchases where id=purchase_b));
 perform pg_temp.check_true('Scoped supplier payment leaves organization opening balance alone',(select opening_balance_paid=0 from public.suppliers where id=supplier));
 perform pg_temp.check_true('Supplier payable excludes inaccessible and unapproved debt',(select balance_due=0 from public.get_supplier_payables() where supplier_id=supplier));
 perform pg_temp.reject('Supplier payment cannot bypass purchase approval',format('select public.record_supplier_payment(%L,%L,1,''bank'')',supplier,loc),'exceeds supplier outstanding balance');
 update public.user_work_scope set scope='organization',location_id=null where organization_id=org and user_id=owner_id;

 insert into public.approval_requests(organization_id,location_id,request_type,entity_type,entity_id,title,requested_by,metadata)
 values(org,loc,'stock_adjustment','product',product::text,'Reservation recheck',owner_id,jsonb_build_object('product_id',product,'quantity_delta',-2,'reason','adjustment')) returning id into approval;
 update public.stock_balances set reserved_quantity=quantity-1 where product_id=product and location_id=loc;
 perform pg_temp.reject('Approval rechecks stock reservations',format('select public.review_approval_request(%L,''approved'')',approval),'reserved stock');
 perform pg_temp.check_true('Failed approval stays pending',(select status='pending' from public.approval_requests where id=approval));
 update public.stock_balances set reserved_quantity=0 where product_id=product and location_id=loc;
 update public.organization_modules set enabled=false where organization_id=org and module_key='alerts';
 perform public.review_approval_request(approval,'approved');
 perform pg_temp.check_true('Inventory approval works without optional alerts module',(select status='approved' from public.approval_requests where id=approval));
 update public.organization_modules set enabled=true where organization_id=org and module_key='alerts';

 result:=public.create_service_work_order(loc,customer,'Cancellation stock regression'); job:=(result->>'work_order_id')::uuid;
 result:=public.add_work_order_line(job,'material',product,'Material',1,10,4); line:=(result->>'line_id')::uuid;
 perform pg_temp.reject('Job cancellation cannot strand issued materials',format('select public.set_work_order_status(%L,''cancelled'')',job),'Reverse job materials');
 perform public.remove_work_order_line(line);
 result:=public.set_work_order_status(job,'cancelled');
 perform pg_temp.check_true('Job cancels after material reversal',result->>'status'='cancelled');

 result:=public.create_project(loc,customer,'Time budget one'); project:=(result->>'project_id')::uuid;
 result:=public.create_project(loc,customer,'Time budget two'); project2:=(result->>'project_id')::uuid;
 perform public.assign_project_member(project,worker); perform public.assign_project_member(project2,worker);
 insert into public.project_tasks(organization_id,project_id,title,assigned_user_id) values(org,project2,'Outside branch task',worker) returning id into task_id;
 update public.projects set location_id=second_loc where id=project2;
 update public.user_work_scope set scope='location',location_id=loc where organization_id=org and user_id=worker;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform pg_temp.check_true('Work feed respects project branch scope',not exists(select 1 from jsonb_array_elements(public.mgt_my_work()->'tasks') t where t->>'id'=task_id::text));
 perform pg_temp.reject('Task update respects project branch scope',format('select public.update_project_task(%L,''in_progress'',10)',task_id),'outside your assigned work scope');
 update public.user_work_scope set scope='assigned',location_id=null where organization_id=org and user_id=worker;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform public.log_project_time(project,null,current_date,16,'Permitted work');
 perform pg_temp.reject('Daily time limit applies across projects',format('select public.log_project_time(%L,null,current_date,9,''Impossible extra hours'')',project2),'cannot exceed 24 hours');
 perform public.log_project_time(project2,null,current_date,8,'Remaining day');
 perform pg_temp.check_true('Exactly 24 hours can be recorded across projects',(select sum(hours)=24 from public.project_timesheets where user_id=worker and work_date=current_date));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 perform public.update_project_status(project,'completed');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',worker,'role','authenticated')::text,true);
 perform pg_temp.reject('Closed project rejects new time entries',format('select public.log_project_time(%L,null,current_date-1,1,''Late work'')',project),'Project is closed');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);

 insert into public.employee_profiles(organization_id,user_id,pay_frequency,base_salary) values(org,worker,'monthly',3000);
 result:=public.create_payroll_period('Two complete months','2026-01-01','2026-02-28'); payroll:=(result->>'payroll_period_id')::uuid;
 perform public.calculate_payroll_period(payroll);
 perform pg_temp.check_true('Monthly payroll prorates each calendar month correctly',(select base_pay=6000 from public.payroll_entries where payroll_period_id=payroll and user_id=worker));
 perform pg_temp.reject('Overlapping payroll periods are rejected', 'select public.create_payroll_period(''Overlap'',''2026-02-01'',''2026-02-28'')','overlaps');

 result:=public.create_vehicle(loc,'AUDIT-001','Test','Van',p_driver_user_id=>driver); vehicle:=(result->>'vehicle_id')::uuid;
 result:=public.create_delivery(loc,'First stop',p_vehicle_id=>vehicle,p_driver_user_id=>driver); delivery:=(result->>'delivery_id')::uuid;
 result:=public.create_delivery(loc,'Second stop',p_vehicle_id=>vehicle,p_driver_user_id=>driver); delivery2:=(result->>'delivery_id')::uuid;
 perform pg_temp.reject('Manager cannot skip dispatch',format('select public.update_delivery_status(%L,''delivered'',''Recipient'')',delivery),'Invalid delivery status transition');
 perform public.update_delivery_status(delivery,'dispatched'); perform public.update_delivery_status(delivery2,'dispatched');
 perform pg_temp.reject('Manager delivery proof is required',format('select public.update_delivery_status(%L,''delivered'')',delivery),'Recipient name');
 perform public.update_delivery_status(delivery,'delivered','First recipient');
 perform pg_temp.check_true('Vehicle remains busy for its other delivery',(select status='in_transit' from public.vehicles where id=vehicle));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',driver,'role','authenticated')::text,true);
 perform public.mgt_update_assigned_delivery(delivery2,'delivered','Second recipient');
 perform pg_temp.check_true('Vehicle becomes available after last delivery',(select status='available' from public.vehicles where id=vehicle));
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated')::text,true);
 result:=public.create_delivery(loc,'Maintenance test stop',p_vehicle_id=>vehicle,p_driver_user_id=>driver); pending_delivery:=(result->>'delivery_id')::uuid;
 perform public.update_delivery_status(pending_delivery,'dispatched');
 update public.vehicles set status='maintenance' where id=vehicle;
 perform public.update_delivery_status(pending_delivery,'delivered','Maintenance recipient');
 perform pg_temp.check_true('Delivery completion preserves vehicle maintenance status',(select status='maintenance' from public.vehicles where id=vehicle));

 -- Actually execute all gated workflows with disabled modules. No mutation is
 -- allowed to reach its old validation/transaction body.
 update public.organization_modules set enabled=false where organization_id=org;
 for r in select p.oid,p.proname,p.proargtypes from pg_proc p join pg_namespace ns on ns.oid=p.pronamespace
 where ns.nspname='public' and p.prokind='f' and p.proname<>'mgt_require_modules'
 and p.prosrc like '%perform public.mgt_require_modules(%'
 loop
  select string_agg('null::'||format_type(t,null),',' order by ord) into args from unnest(r.proargtypes::oid[]) with ordinality a(t,ord);
  perform pg_temp.reject('Disabled module blocks '||r.proname,format('select public.%I(%s)',r.proname,coalesce(args,'')),'Required business module is disabled');
 end loop;
 update public.organization_modules set enabled=true where organization_id=org;
 perform pg_temp.check_true('All journals remain balanced',not exists(select 1 from public.accounting_journals j join public.accounting_journal_lines l on l.journal_id=j.id where j.organization_id=org group by j.id having abs(sum(l.debit)-sum(l.credit))>0.009));

 -- Real authenticated-role RLS check, not just a postgres query with JWT claims.
 perform set_config('request.jwt.claims',jsonb_build_object('sub',cashier,'role','authenticated')::text,true);
 perform set_config('role','authenticated',true);
 select count(*) into n from public.stock_balances where product_id=product and location_id=second_loc;
 perform set_config('role','postgres',true);
 perform pg_temp.check_true('Authenticated RLS hides other branch stock',n=0);
end $$;
select * from production_results order by test;
select count(*) as production_regression_checks from production_results;
rollback;
