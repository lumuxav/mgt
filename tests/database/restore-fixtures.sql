begin;
do $$ declare
 o uuid:='dddddddd-0000-4000-8000-000000000001';
 u uuid:='dddddddd-0000-4000-8000-000000000002';
 l uuid:='dddddddd-0000-4000-8000-000000000003';
 p uuid:='dddddddd-0000-4000-8000-000000000004';
 c uuid:='dddddddd-0000-4000-8000-000000000005';
 b uuid:='dddddddd-0000-4000-8000-000000000006';
 j uuid; r jsonb;
begin
 insert into auth.users(id,email) values(u,'restore-owner@fixture.invalid');
 insert into public.organizations(id,name,timezone) values(o,'Disposable restore drill','Africa/Kampala');
 perform public.seed_default_roles(o);
 insert into public.organization_modules(organization_id,module_key,enabled)
 select o,key,true from unnest(array['services','inventory','finance','documents','customers']) key
 on conflict(organization_id,module_key) do update set enabled=true;
 insert into public.locations(id,organization_id,name) values(l,o,'Restore branch');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(u,o,'Restore owner','owner',l);
 insert into public.customers(id,organization_id,name) values(c,o,'Restore customer');
 insert into public.products(id,organization_id,name,selling_price,cost_price,track_inventory) values(p,o,'Restore material',10,4,true);
 insert into public.stock_balances(product_id,location_id,quantity) values(p,l,10);
 insert into public.bank_accounts(id,organization_id,name,account_type,opening_balance) values(b,o,'Restore bank','bank',100);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
 r:=public.create_service_work_order(l,c,'Restored cancellation'); j:=(r->>'work_order_id')::uuid;
 perform public.add_work_order_line(j,'material',p,'Returned material',1,10,4);
 perform public.record_work_order_payment(j,10,'bank');
 perform public.cancel_service_work_order('dddddddd-0000-4000-8000-000000000007',j,'Restore fixture return',10,'bank',b,'RESTORE-REFUND',true);
end $$;
commit;
