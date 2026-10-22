-- Disposable database only. Role switches exercise real RLS and column grants.
begin;
create temp table remaining_results(test text primary key);
grant all on remaining_results to authenticated;
create function pg_temp.verify(label text,passed boolean) returns void language plpgsql as $$
begin
 if passed is distinct from true then raise exception 'FAILED: %',label; end if;
 insert into remaining_results values(label);
end; $$;
create function pg_temp.denied(label text,command text,expected text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin execute command; exception when others then
  if position(expected in sqlerrm)=0 then raise exception '%: unexpected error %',label,sqlerrm; end if;
  rejected:=true;
 end;
 perform pg_temp.verify(label,rejected);
end; $$;

do $$
declare
 org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); employee_a uuid:=gen_random_uuid(); employee_b uuid:=gen_random_uuid();
 loc_a uuid:=gen_random_uuid(); loc_b uuid:=gen_random_uuid(); customer uuid:=gen_random_uuid(); supplier uuid:=gen_random_uuid();
 product uuid:=gen_random_uuid(); bank uuid:=gen_random_uuid(); job uuid; consumed_job uuid; cash_job uuid;
 private_notification uuid; local_project uuid; remote_project uuid; remote_job uuid; request_id uuid:=gen_random_uuid(); result jsonb; retry jsonb; statement jsonb; snapshot jsonb;
 statement_day date:=(now() at time zone 'Africa/Kampala')::date; payroll uuid; connection uuid; provider_tx uuid; quantity_before numeric; till uuid; role_row record;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email) values(actor,actor||'@remaining.invalid'),(employee_a,employee_a||'@remaining.invalid'),(employee_b,employee_b||'@remaining.invalid');
 insert into public.organizations(id,name,timezone) values(org,'Remaining gates fixtures','Africa/Kampala');
 perform public.seed_default_roles(org);
 insert into public.organization_modules(organization_id,module_key,enabled)
 select org,key,true from unnest(array['dashboard','pos','inventory','sales','customers','suppliers','purchasing','services','manufacturing','finance','reports','documents','alerts','hr','projects','assets','fleet','ecommerce','payments','integrations','insights']) key
 on conflict(organization_id,module_key) do update set enabled=true;
 insert into public.locations(id,organization_id,name) values(loc_a,org,'Scope A'),(loc_b,org,'Scope B');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(actor,org,'Scoped owner','owner',loc_a),(employee_a,org,'Employee A','employee',loc_a),(employee_b,org,'Employee B','employee',loc_b);
 insert into public.customers(id,organization_id,name,opening_balance) values(customer,org,'Shared contact',100);
 insert into public.suppliers(id,organization_id,name,opening_balance) values(supplier,org,'Shared supplier',200);
 insert into public.products(id,organization_id,name,selling_price,cost_price,track_inventory) values(product,org,'Refund material',10,4,true);
 insert into public.stock_balances(product_id,location_id,quantity) values(product,loc_a,100),(product,loc_b,9000);
 insert into public.bank_accounts(id,organization_id,name,account_type,opening_balance) values(bank,org,'Refund bank','bank',1000);
 insert into public.employee_profiles(organization_id,user_id,base_salary) values(org,employee_a,100),(org,employee_b,9000);
 insert into public.attendance(organization_id,user_id,location_id,work_date) values(org,employee_a,loc_a,current_date),(org,employee_b,loc_b,current_date);
 insert into public.sales(organization_id,location_id,customer_id,sale_number,total_amount,created_at,sold_by)
 values(org,loc_a,customer,'BRANCH-A',10,now()-interval '2 days',actor),(org,loc_b,customer,'BRANCH-B',9000,now()-interval '2 days',employee_b);
 insert into public.sales(organization_id,location_id,customer_id,sale_number,total_amount,created_at,sold_by)
 select org,loc_a,customer,'MANY-'||n,1,now()-interval '1 day',actor from generate_series(1,1001) n;
 insert into public.purchases(organization_id,location_id,supplier_id,purchase_number,total_amount,status,approval_status)
 values(org,loc_a,supplier,'GOOD',20,'ordered','not_required'),(org,loc_a,supplier,'UNAPPROVED',500,'pending_approval','pending'),(org,loc_b,supplier,'OTHER',9000,'ordered','not_required');
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 result:=public.create_payroll_period('Scoped wages','2026-04-01','2026-04-30'); payroll:=(result->>'payroll_period_id')::uuid;
 perform public.calculate_payroll_period(payroll);
 result:=public.create_service_work_order(loc_b,customer,'Private other branch job',p_quoted_amount=>30); remote_job:=(result->>'work_order_id')::uuid;
 perform public.record_work_order_payment(remote_job,30,'bank');
 insert into public.projects(organization_id,location_id,name,manager_user_id) values(org,loc_a,'Scoped project',actor) returning id into local_project;
 insert into public.projects(organization_id,location_id,name,manager_user_id) values(org,loc_b,'Private project',employee_b) returning id into remote_project;
 insert into public.project_members(organization_id,project_id,user_id) values(org,local_project,employee_a),(org,remote_project,employee_b);
 update public.user_work_scope set scope='location',location_id=loc_a where user_id=actor and organization_id=org;
 private_notification:=public.emit_notification(org,actor,null,'scope-private-fixture','operations','warning','Private other branch job','Private fixture details','/work-orders','Open job','work_order',remote_job::text,'fixture');
 insert into public.notification_deliveries(organization_id,notification_id,user_id,channel,recipient,status)
 values(org,private_notification,actor,'email','fixture@invalid.test','queued');
 perform pg_temp.verify('Email queue suppresses out-of-scope notification recipients',(select status='skipped' from public.notification_deliveries where notification_id=private_notification and user_id=actor));
 set local role authenticated;
 perform pg_temp.verify('In-app notifications hide other-branch details',not exists(select 1 from public.notifications where id=private_notification));
 perform pg_temp.verify('Project directory follows branch scope',(select count(*)=1 from public.projects where organization_id=org));
 perform pg_temp.verify('Project membership inherits parent scope without recursion',(select count(*)=1 from public.project_members where organization_id=org));
 perform pg_temp.verify('Staff directory follows branch scope',(select count(*)=2 from public.users where organization_id=org));
 perform pg_temp.verify('HR profiles hide other branches',(select count(*)=1 from public.employee_profiles where organization_id=org));
 perform pg_temp.verify('Attendance hides other branches',(select count(*)=1 from public.attendance where organization_id=org));
 perform pg_temp.verify('Payroll entries hide other branches',(select count(*)=1 from public.payroll_entries where organization_id=org));
 perform pg_temp.verify('Raw organization payroll totals are hidden',(select count(*)=0 from public.payroll_periods where organization_id=org));
 perform pg_temp.verify('Scoped payroll totals sum visible employees',(select total_net=100 from public.get_scoped_payroll_periods() where id=payroll));
 perform pg_temp.verify('Payment history hides other branches',(select count(*)=0 from public.payments where work_order_id=remote_job));
 perform pg_temp.verify('Accounting journal headers hide other branches',not exists(select 1 from public.accounting_journals where organization_id=org and location_id=loc_b));
 perform pg_temp.verify('Accounting lines inherit journal scope',not exists(select 1 from public.accounting_general_ledger_v where organization_id=org and location_id=loc_b));
 perform pg_temp.verify('Location picker hides inaccessible branches',(select count(*)=1 from public.locations where organization_id=org));
 perform pg_temp.verify('Customer contact remains usable',(select name='Shared contact' from public.customers where id=customer));
 perform pg_temp.denied('Raw customer opening amount denied','select opening_balance from public.customers','permission denied');
 perform pg_temp.denied('Raw supplier opening amount denied','select opening_balance from public.suppliers','permission denied');
 perform pg_temp.denied('Raw bank opening amount denied','select opening_balance from public.bank_accounts','permission denied');
 perform pg_temp.verify('Customer summary masks organization opening amount',(select opening_balance=0 from public.get_scoped_customers() where id=customer));
 perform pg_temp.verify('Bank summary masks whole-business balance',(select balance is null and not balance_visible from public.get_bank_account_summaries() where id=bank));
 snapshot:=public.get_business_insights();
 perform pg_temp.verify('Intelligence applies branch RLS',(select sum((d->>'sales')::numeric)=1011 from jsonb_array_elements(snapshot->'daily') d));
 statement:=public.get_party_statement('customer',customer,statement_day-10,statement_day);
 perform pg_temp.verify('Statement includes more than the REST row cap',jsonb_array_length(statement->'rows')=1002);
 perform pg_temp.verify('Statement excludes other-branch and organization opening amounts',(statement->>'closing')::numeric=1011 and (statement->>'opening')::numeric=0);
 statement:=public.get_party_statement('supplier',supplier,statement_day-10,statement_day);
 perform pg_temp.verify('Supplier statement excludes pending approvals and other branches',(statement->>'closing')::numeric=20);
 perform pg_temp.denied('HR mutations reject other-branch staff',format('select public.upsert_employee_hr_profile(%L)',employee_b),'outside your assigned work scope');
 perform pg_temp.denied('Wrong-branch cancellation rejected',format('select public.cancel_service_work_order(%L,%L,''Wrong branch'',30)',gen_random_uuid(),remote_job),'outside your assigned work scope');
 perform pg_temp.verify('Authenticated role cannot truncate business tables',not has_table_privilege('authenticated','public.sales','TRUNCATE'));
 reset role;
 update public.user_work_scope set scope='organization',location_id=null where user_id=actor and organization_id=org;
 set local role authenticated;
 perform pg_temp.verify('Organization owner sees opening amount via authorized RPC',(select opening_balance=100 from public.get_scoped_customers() where id=customer));
 perform pg_temp.verify('Organization bank balance uses full ledger',(select balance=1000 and balance_visible from public.get_bank_account_summaries() where id=bank));
 result:=public.create_service_work_order(loc_a,customer,'Refund and restore material'); job:=(result->>'work_order_id')::uuid;
 perform public.add_work_order_line(job,'material',product,'Material',2,10,4);
 perform public.record_work_order_payment(job,20,'bank');
 perform pg_temp.denied('Changed payment total requires renewed review',format('select public.cancel_service_work_order(%L,%L,''Return'',19,''bank'',%L,''REF-01'',true)',request_id,job,bank),'Payment total changed');
 perform pg_temp.denied('Noncash refund requires completed payment reference',format('select public.cancel_service_work_order(%L,%L,''Return'',20,''bank'',%L,null,true)',request_id,job,bank),'transaction reference');
 result:=public.cancel_service_work_order(request_id,job,'Customer returned all materials',20,'bank',bank,'REF-01',true);
 retry:=public.cancel_service_work_order(request_id,job,'Customer returned all materials',20,'bank',bank,'REF-01',true);
 perform pg_temp.verify('Cancellation retry returns the original result',result=retry);
 perform pg_temp.verify('Cancellation records the full refund',(result->>'refunded_amount')::numeric=20);
 perform pg_temp.verify('Cancelled job has no remaining debt',(select status='cancelled' and final_amount=0 and amount_paid=0 from public.work_orders where id=job));
 perform pg_temp.verify('Refund is written once',(select count(*)=1 from public.payments where work_order_id=job and direction='out'));
 perform pg_temp.verify('Bank refund has a linked withdrawal',(select count(*)=1 from public.banking_transactions where source_payment_id=(result->>'payment_id')::uuid and amount=20 and transaction_type='withdrawal'));
 perform pg_temp.verify('Materials restored once',(select quantity=100 from public.stock_balances where product_id=product and location_id=loc_a));
 perform pg_temp.verify('Historical service lines are preserved',(select count(*)=1 from public.work_order_lines where work_order_id=job));
 perform pg_temp.verify('Authoritative bank balance includes refund',(select balance=980 from public.get_bank_account_summaries() where id=bank));
 perform pg_temp.denied('Request key cannot change payload',format('select public.cancel_service_work_order(%L,%L,''Different reason'',20,''bank'',%L,''REF-01'',true)',request_id,job,bank),'different cancellation details');
 perform pg_temp.denied('A second request cannot refund cancelled job',format('select public.cancel_service_work_order(%L,%L,''Again'',0)',gen_random_uuid(),job),'already cancelled');
 result:=public.create_service_work_order(loc_a,customer,'Consumed materials'); consumed_job:=(result->>'work_order_id')::uuid;
 perform public.add_work_order_line(consumed_job,'material',product,'Used material',1,10,4);
 result:=public.cancel_service_work_order(gen_random_uuid(),consumed_job,'Material consumed during failed repair',0,p_restore_materials=>false);
 perform pg_temp.verify('Consumed materials are not falsely restocked',(select quantity=99 from public.stock_balances where product_id=product and location_id=loc_a));
 perform pg_temp.verify('Consumed materials remain an audited cost',(select final_cost=4 and gross_profit=-4 from public.work_orders where id=consumed_job));
 result:=public.create_service_work_order(loc_a,customer,'Cash refund',p_quoted_amount=>10);cash_job:=(result->>'work_order_id')::uuid;
 perform public.record_work_order_payment(cash_job,10,'bank');
 perform pg_temp.denied('Cash refund requires open till',format('select public.cancel_service_work_order(%L,%L,''Cash refund'',10)',gen_random_uuid(),cash_job),'Open your till');
 perform public.open_till(loc_a,0);
 perform pg_temp.denied('Cash refund checks cash availability',format('select public.cancel_service_work_order(%L,%L,''Cash refund'',10)',gen_random_uuid(),cash_job),'exceeds cash available');
 perform pg_temp.verify('Failed refund leaves job and payment intact',(select status<>'cancelled' and amount_paid=10 from public.work_orders where id=cash_job));
 reset role;
 insert into public.payment_provider_connections(organization_id,provider,name) values(org,'mtn_momo','Fixture connection') returning id into connection;
 insert into public.external_payment_transactions(organization_id,connection_id,provider,target_type,target_id,location_id,amount,external_reference,initiated_by)
 values(org,connection,'mtn_momo','work_order',cash_job,loc_a,1,'PENDING-REFUND-GUARD',actor) returning id into provider_tx;
 perform pg_temp.denied('Second unresolved collection is blocked before provider dispatch',format('insert into public.external_payment_transactions(organization_id,connection_id,provider,target_type,target_id,amount,external_reference) values(%L,%L,''mtn_momo'',''work_order'',%L,1,''DUPLICATE-COLLECTION'')',org,connection,cash_job),'mgt_one_pending_collection');
 set local role authenticated;
 perform pg_temp.denied('Pending provider collection blocks cancellation',format('select public.cancel_service_work_order(%L,%L,''Pending test'',10)',gen_random_uuid(),cash_job),'Resolve pending provider');
 reset role;
 perform pg_temp.denied('New provider request cannot target cancelled job',format('insert into public.external_payment_transactions(organization_id,connection_id,provider,target_type,target_id,amount,external_reference) values(%L,%L,''mtn_momo'',''work_order'',%L,1,''LATE-CANCELLED'')',org,connection,job),'cancelled service job');
 perform pg_temp.verify('Refund journals stay balanced',not exists(select 1 from public.accounting_journals j join public.accounting_journal_lines l on l.journal_id=j.id where j.organization_id=org group by j.id having abs(sum(l.debit)-sum(l.credit))>0.009));
 perform pg_temp.verify('Cancellation ledger has no client writes',not has_table_privilege('authenticated','public.service_cancellation_requests','INSERT'));
 perform pg_temp.verify('Anonymous cancellation is blocked',not has_function_privilege('anon','public.cancel_service_work_order(uuid,uuid,text,numeric,text,uuid,text,boolean)','EXECUTE'));
end; $$;
select * from remaining_results order by test;
select count(*) as scoped_reporting_and_refund_checks_passed from remaining_results;
rollback;
