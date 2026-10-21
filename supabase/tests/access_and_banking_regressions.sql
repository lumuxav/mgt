-- Run as postgres against Universal MGT after the October 17 integrity migrations.
-- Every fixture and operation rolls back. No provider calls or real payments.
begin;
create temporary table integrity_results(test text primary key, result text default 'passed');
grant all on integrity_results to authenticated,service_role;
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Failed: %',label; end if;
 insert into integrity_results(test) values(label);
end; $$;
create function pg_temp.expect_rejection(label text,command text,expected text) returns void language plpgsql as $$
declare rejected boolean:=false;
begin
 begin execute command;
 exception when others then
  if position(expected in sqlerrm)=0 then raise exception '%: unexpected error %',label,sqlerrm; end if;
  rejected:=true;
 end;
 perform pg_temp.check_true(rejected,label);
end; $$;
create function pg_temp.check_expense(expense uuid,label text) returns void language plpgsql as $$
begin
 perform pg_temp.check_true(
  (select count(*)=1 from public.banking_transactions where source_expense_id=expense)
  and (select count(*)=1 from public.accounting_journals where source_type='expense' and source_id=expense::text)
  and not exists(select 1 from public.accounting_journals j join public.banking_transactions b on j.source_type='bank_transaction' and j.source_id=b.id::text where b.source_expense_id=expense),label);
end; $$;
create function pg_temp.check_ledger(source text,source_key uuid,account_code text,debit_amount numeric,credit_amount numeric,label text) returns void language plpgsql as $$
begin
 perform pg_temp.check_true(exists(
  select 1 from public.accounting_journal_lines l join public.accounting_journals j on j.id=l.journal_id
  join public.accounting_accounts a on a.id=l.account_id
  where j.source_type=source and j.source_id=source_key::text and a.code=account_code and l.debit=debit_amount and l.credit=credit_amount),label);
end; $$;

do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
 loc uuid:=gen_random_uuid(); foreign_loc uuid:=gen_random_uuid(); prod uuid:=gen_random_uuid(); cat uuid:=gen_random_uuid();
 cust uuid; supplier uuid; bank uuid; mobile uuid; cashbox uuid; overdraft uuid; zero_bank uuid; tx uuid; expense uuid; till uuid; payment uuid;
 project uuid; invoice uuid; project_expense uuid; asset uuid:=gen_random_uuid(); vehicle uuid:=gen_random_uuid(); maintenance uuid;
 period uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); result jsonb;
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email) values(actor,actor::text||'@audit.invalid'),(member,member::text||'@audit.invalid');
 insert into public.organizations(id,name) values(org,'Universal integrity regression'),(other_org,'Universal isolation fixture');
 insert into public.organization_modules(organization_id,module_key,enabled)
 select org,key,true from unnest(array['pos','sales','inventory','services','finance','purchasing','ecommerce','payments','alerts']) key
 on conflict(organization_id,module_key) do update set enabled=true;
 insert into public.locations(id,organization_id,name) values(loc,org,'Audit location'),(foreign_loc,other_org,'Other location');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(actor,org,'Audit owner','owner',loc);
 insert into public.categories(id,organization_id,name) values(cat,other_org,'Foreign category');
 insert into public.products(id,organization_id,name) values(prod,org,'Audit product');
 insert into public.assets(id,organization_id,location_id,asset_number,name) values(asset,org,loc,'AUDIT-ASSET','Audit asset');
 insert into public.vehicles(id,organization_id,location_id,asset_id,registration_number) values(vehicle,org,loc,asset,'AUDIT-VEHICLE');
 insert into public.payroll_periods(id,organization_id,name,start_date,end_date,status) values(period,org,'Audit payroll',current_date,current_date,'approved');
 insert into public.payroll_entries(id,organization_id,payroll_period_id,user_id,location_id,net_pay) values(entry,org,period,actor,loc,10);

 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 set local role authenticated;
 -- Exercise actual column grants and RLS, not just SECURITY DEFINER callers.
 insert into public.customers(organization_id,name,opening_balance) values(org,'Audit customer',20) returning id into cust;
 insert into public.suppliers(organization_id,name,opening_balance) values(org,'Audit supplier',20) returning id into supplier;
 insert into public.bank_accounts(organization_id,name,opening_balance) values(org,'Audit bank',100) returning id into bank;
 insert into public.bank_accounts(organization_id,name,account_type,opening_balance) values(org,'Audit mobile','mobile_money',100) returning id into mobile;
 insert into public.bank_accounts(organization_id,name,account_type,opening_balance) values(org,'Audit cash box','cashbox',100) returning id into cashbox;
 insert into public.bank_accounts(organization_id,name,opening_balance) values(org,'Audit overdraft',-100) returning id into overdraft;
 insert into public.bank_accounts(organization_id,name,opening_balance) values(org,'Zero opening',0) returning id into zero_bank;
 update public.customers set phone='audit' where id=cust;
 update public.suppliers set phone='audit' where id=supplier;
 update public.bank_accounts set name='Renamed audit bank' where id=bank;
 perform pg_temp.check_true((select phone='audit' from public.customers where id=cust),'Contact creation and permitted edits remain available');
 perform pg_temp.check_ledger('bank_opening',bank,'1010',100,0,'Bank opening posts bank ledger');
 perform pg_temp.check_ledger('bank_opening',mobile,'1020',100,0,'Mobile opening posts mobile ledger');
 perform pg_temp.check_ledger('bank_opening',cashbox,'1000',100,0,'Cash-box opening posts cash ledger');
 perform pg_temp.check_ledger('bank_opening',overdraft,'1010',0,100,'Overdraft opening posts credit');
 perform pg_temp.check_true(not exists(select 1 from public.accounting_journals where source_type='bank_opening' and source_id=zero_bank::text),'Zero bank opening creates no journal');
 perform pg_temp.expect_rejection('Foreign product category blocked',format('update public.products set category_id=%L where id=%L',cat,prod),'Business reference mismatch');
 perform pg_temp.expect_rejection('Foreign staff default location blocked',format('update public.users set default_location_id=%L where id=%L',foreign_loc,actor),'Business reference mismatch');
 perform pg_temp.expect_rejection('Direct customer repayment blocked',format('update public.customers set opening_balance_paid=10 where id=%L',cust),'permission denied');
 perform pg_temp.expect_rejection('Direct supplier repayment blocked',format('update public.suppliers set opening_balance_paid=10 where id=%L',supplier),'permission denied');
 perform pg_temp.expect_rejection('Bank opening edits blocked',format('update public.bank_accounts set opening_balance=200 where id=%L',bank),'permission denied');
 perform pg_temp.expect_rejection('Bank account type edits blocked',format('update public.bank_accounts set account_type=''other'' where id=%L',bank),'permission denied');
 perform pg_temp.expect_rejection('NaN product price blocked',format('update public.products set selling_price=''NaN'' where id=%L',prod),'finite_numbers');
 perform pg_temp.expect_rejection('NaN expense RPC blocked',format('select public.post_expense(%L,''Other'',''Invalid amount'',''NaN'',''bank'',%L)',loc,bank),'finite_numbers');
 perform pg_temp.expect_rejection('Direct stock movement blocked',format('insert into public.stock_movements(organization_id,location_id,product_id,movement_type,quantity) values(%L,%L,%L,''adjustment'',1)',org,loc,prod),'permission denied');
 perform pg_temp.expect_rejection('Direct expense bypass blocked',format('insert into public.expenses(organization_id,location_id,description,amount,payment_method) values(%L,%L,''Direct expense'',1,''cash'')',org,loc),'permission denied');
 perform pg_temp.expect_rejection('Direct purchase bypass blocked',format('insert into public.purchases(organization_id,location_id,total_amount) values(%L,%L,10)',org,loc),'permission denied');
 perform pg_temp.expect_rejection('Direct banking bypass blocked',format('insert into public.banking_transactions(organization_id,bank_account_id,transaction_type,amount) values(%L,%L,''deposit'',10)',org,bank),'permission denied');
 expense:=public.post_expense(loc,'Other','Bank expense',10,'bank',bank);
 perform pg_temp.check_expense(expense,'Expense links to exactly one bank transaction and journal');
 tx:=public.record_bank_transaction(bank,loc,'deposit',10);
 perform pg_temp.check_ledger('bank_transaction',tx,'1010',10,0,'Independent same-amount deposit is not suppressed');
 expense:=public.post_expense(loc,'Other','Mobile expense',10,'bank',mobile);
 perform pg_temp.check_ledger('expense',expense,'1020',0,10,'Selected mobile account controls expense ledger');
 tx:=public.record_bank_transaction(mobile,loc,'deposit',10);
 perform pg_temp.check_ledger('bank_transaction',tx,'1020',10,0,'Independent mobile deposit posts mobile ledger');
 till:=public.open_till(loc,100);
 result:=public.bank_cash_from_till(till,mobile,10);
 tx:=(result->>'banking_transaction_id')::uuid;
 select source_payment_id into payment from public.banking_transactions where id=tx;
 perform pg_temp.check_ledger('payment',payment,'1020',10,0,'Till transfer posts to selected mobile ledger');
 perform pg_temp.check_true(not exists(select 1 from public.accounting_journals where source_type='bank_transaction' and source_id=tx::text),'Till transfer avoids duplicate journal');

 result:=public.create_project(loc,cust,'Audit project'); project:=(result->>'project_id')::uuid;
 result:=public.post_project_expense(project,'Other','Paid project expense',10,'bank',bank);
 perform pg_temp.check_expense((result->>'finance_expense_id')::uuid,'Immediate project expense links once');
 result:=public.post_project_expense(project,'Other','Accrued project expense',10);
 project_expense:=(result->>'project_expense_id')::uuid;
 result:=public.pay_project_expense(project_expense,'bank',bank);
 perform pg_temp.check_expense((result->>'finance_expense_id')::uuid,'Accrued project expense links once when paid');
 result:=public.create_project_invoice(project,current_date,'[{"description":"Audit service","quantity":1,"unit_price":10}]');
 invoice:=(result->>'invoice_id')::uuid;
 perform public.record_project_invoice_payment(invoice,10,'bank',mobile);
 select id into payment from public.payments where project_invoice_id=invoice;
 perform pg_temp.check_ledger('payment',payment,'1020',10,0,'Project receipt posts selected account once');
 perform pg_temp.check_true((select count(*)=1 from public.banking_transactions where source_payment_id=payment)
  and not exists(select 1 from public.accounting_journals j join public.banking_transactions b on j.source_type='bank_transaction' and j.source_id=b.id::text where b.source_payment_id=payment),'Project receipt avoids duplicate bank journal');
 result:=public.record_fuel_log(vehicle,100,1,10,null,null,null,'bank',bank);
 perform pg_temp.check_expense((result->>'expense_id')::uuid,'Fuel expense links once');
 result:=public.schedule_asset_maintenance(asset,'service','normal',current_date,'Audit maintenance');
 maintenance:=(result->>'maintenance_id')::uuid;
 result:=public.complete_asset_maintenance(maintenance,10,0,null,null,null,'bank',bank);
 perform pg_temp.check_expense((result->>'expense_id')::uuid,'Maintenance expense links once');
 result:=public.record_payroll_payment(entry,'bank',bank);
 perform pg_temp.check_expense((result->>'expense_id')::uuid,'Payroll expense links once');
 perform pg_temp.expect_rejection('Browser cannot call service role manager',format('select public.server_manage_organization_role(%L,%L,''create'',''audit_role'',''{"name":"Audit"}'')',org,actor),'permission denied');
 reset role;

 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 set local role service_role;
 perform public.server_manage_organization_role(org,actor,'create','audit_role','{"name":"Audit role","permissions":["finance.view"]}');
 perform pg_temp.expect_rejection('Invalid role permissions rejected atomically',format('select public.server_manage_organization_role(%L,%L,''update'',''audit_role'',''{"name":"Wrong name","permissions":["invalid.permission"]}'')',org,actor),'permissions are invalid');
 perform pg_temp.check_true((select name='Audit role' from public.roles where organization_id=org and key='audit_role') and
  (select count(*)=1 from public.role_permissions where organization_id=org and role='audit_role' and permission='finance.view'),'Failed role update retains name and permissions');
 perform public.server_manage_organization_role(org,actor,'update','audit_role','{"permissions":["finance.view","finance.manage","finance.view"]}');
 perform pg_temp.check_true((select count(*)=2 from public.role_permissions where organization_id=org and role='audit_role'),'Role permission replacement is atomic and deduplicated');
 perform pg_temp.expect_rejection('Foreign role actor rejected',format('select public.server_manage_organization_role(%L,%L,''create'',''foreign_role'',''{"name":"Foreign"}'')',other_org,actor),'Active staff account required');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(member,org,'Audit member','audit_role',loc);
 perform pg_temp.expect_rejection('In-use custom role cannot be deleted',format('select public.server_manage_organization_role(%L,%L,''delete'',''audit_role'')',org,actor),'Move staff');
 perform public.server_manage_organization_role(org,actor,'update','audit_role','{"active":false}');
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 set local role authenticated;
 perform pg_temp.check_true(public.current_organization_id() is null and not public.has_permission('finance.manage'),'Disabled custom role cannot access business');
 reset role;
 update public.organizations set active=false where id=org;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 set local role authenticated;
 perform pg_temp.check_true(public.current_organization_id() is null and not public.has_permission('finance.manage'),'Suspended business denies owner access');
 reset role;
end; $$;
select * from integrity_results order by test;
rollback;
