-- All fixture data and settings roll back. Run after business_intelligence_snapshot.
begin;
create temporary table intelligence_results(test text primary key,result text default 'passed');
grant all on intelligence_results to authenticated;
create function pg_temp.intelligence_check(ok boolean,label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'Failed: %',label; end if;
 insert into intelligence_results(test) values(label);
end; $$;
do $$
declare
 org uuid:=gen_random_uuid(); other_org uuid:=gen_random_uuid(); actor uuid:=gen_random_uuid(); member uuid:=gen_random_uuid();
 loc uuid:=gen_random_uuid(); other_loc uuid:=gen_random_uuid(); today date:=(now() at time zone 'Africa/Kampala')::date;
 snapshot jsonb; total numeric; denied boolean; product uuid:=gen_random_uuid();
begin
 perform set_config('request.jwt.claims','{"role":"service_role"}',true);
 insert into auth.users(id,email) values(actor,actor::text||'@audit.invalid'),(member,member::text||'@audit.invalid');
 insert into public.organizations(id,name,timezone) values(org,'MGT intelligence regression','Africa/Kampala'),(other_org,'MGT isolation fixture','UTC');
 insert into public.locations(id,organization_id,name) values(loc,org,'First'),(other_loc,other_org,'Other');
 insert into public.users(id,organization_id,full_name,role,default_location_id) values(actor,org,'Owner','owner',loc),(member,org,'Analyst','insights_only',loc);
 insert into public.roles(organization_id,key,name,active) values(org,'insights_only','Insights only',true);
 insert into public.role_permissions(organization_id,role,permission,allowed) values(org,'insights_only','insights.view',true);
 insert into public.organization_modules(organization_id,module_key,enabled)
 select org,x,true from unnest(array['insights','sales','pos','finance','inventory','services','projects']) x
 on conflict(organization_id,module_key) do update set enabled=true;
 insert into public.products(id,organization_id,name,track_inventory,reorder_level) values(product,org,'Low stock item',true,3);
 insert into public.sales(organization_id,location_id,sale_number,total_amount,refunded_amount,amount_paid,created_at)
 values(org,loc,'REFUND',100,20,50,((today-1)::timestamp+interval '30 minutes') at time zone 'Africa/Kampala'),
 (org,loc,'OLD',50,0,0,((today-150)::timestamp) at time zone 'Africa/Kampala'),
 (org,loc,'TODAY',200,0,0,now()),
 (other_org,other_loc,'OTHER',9999,0,0,now()-interval '2 days');
 insert into public.sales(organization_id,location_id,sale_number,status,total_amount,created_at)
 values(org,loc,'CANCELLED','cancelled',9000,now()-interval '2 days');
 insert into public.sales(organization_id,location_id,sale_number,total_amount,created_at)
 select org,loc,'BULK-'||n,1,((today-2)::timestamp+interval '12 hours') at time zone 'Africa/Kampala' from generate_series(1,1001) n;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 set local role authenticated;
 snapshot:=public.get_business_insights();
 perform pg_temp.intelligence_check(jsonb_array_length(snapshot->'daily')=90,'Returns 90 complete calendar days');
 select sum((d->>'sales')::numeric) into total from jsonb_array_elements(snapshot->'daily') d;
 perform pg_temp.intelligence_check(total=1081,'Aggregates over 1000 sales with refunds and excludes other business, cancelled sales and partial today');
 perform pg_temp.intelligence_check(snapshot->'daily'->89->>'date'=(today-1)::text and (snapshot->'daily'->89->>'sales')::numeric=80,'Uses business timezone at midnight boundary');
 perform pg_temp.intelligence_check((snapshot->>'sales_receivables')::numeric=1281,'Outstanding balances include old sales and today without double-counting refunds');
 perform pg_temp.intelligence_check(snapshot->>'first_sale_date'=(today-150)::text,'Does not fabricate history start');
 perform pg_temp.intelligence_check((snapshot->'inventory'->>'low_count')::int=1,'Includes tracked products with no stock rows');
 perform pg_temp.intelligence_check(not has_function_privilege('anon','public.get_business_insights()','execute'),'Anonymous execution denied');
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',member,'role','authenticated')::text,true);
 set local role authenticated;
 snapshot:=public.get_business_insights();
 perform pg_temp.intelligence_check(snapshot->'access'->>'sales'='false' and snapshot->'sales_receivables'='null'::jsonb,'Insights permission does not grant sales access');
 perform pg_temp.intelligence_check(snapshot->'inventory'='null'::jsonb and snapshot->'daily'->0->'expenses'='null'::jsonb,'Unauthorized inventory and finance data are absent');
 reset role;
 update public.roles set active=false where organization_id=org and key='insights_only';
 set local role authenticated;
 denied:=false;
 begin perform public.get_business_insights(); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.intelligence_check(denied,'Disabled role cannot use Intelligence');
 reset role;
 perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
 update public.organization_modules set enabled=false where organization_id=org and module_key in ('sales','pos');
 set local role authenticated;
 snapshot:=public.get_business_insights();
 perform pg_temp.intelligence_check(snapshot->'access'->>'sales'='false','Disabled sales modules suppress sales even for an owner');
 reset role;
 update public.organization_modules set enabled=false where organization_id=org and module_key='insights';
 set local role authenticated;
 denied:=false;
 begin perform public.get_business_insights(); exception when insufficient_privilege then denied:=true; end;
 perform pg_temp.intelligence_check(denied,'Disabled Intelligence module is enforced in the database');
 reset role;
end; $$;
select * from intelligence_results order by test;
rollback;
