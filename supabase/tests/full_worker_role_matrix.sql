-- Full MGT role-matrix checks using disposable fictional accounts only.
BEGIN;
CREATE TEMP TABLE ci_roles(n integer PRIMARY KEY, role text UNIQUE, allow_codes text[],deny_codes text[]);
GRANT SELECT ON ci_roles TO authenticated,service_role;
CREATE TEMP TABLE ci_checks(label text PRIMARY KEY);
GRANT SELECT,INSERT ON ci_checks TO authenticated,service_role;
CREATE FUNCTION pg_temp.ok(valid boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF valid IS DISTINCT FROM true THEN RAISE EXCEPTION 'MGT role check failed: %',label; END IF;
 INSERT INTO ci_checks VALUES(label);
END $$;
CREATE FUNCTION pg_temp.reject(label text,statement text,contains text DEFAULT null)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE did_reject boolean:=false;
BEGIN
 BEGIN EXECUTE statement;
 EXCEPTION WHEN OTHERS THEN
  IF contains IS NOT NULL AND position(contains IN sqlerrm)=0 THEN
   RAISE EXCEPTION '% returned unexpected error: %',label,sqlerrm;
  END IF;
  did_reject:=true;
 END;
 PERFORM pg_temp.ok(did_reject,label);
END $$;
INSERT INTO ci_roles VALUES
(1,'owner',ARRAY['users.manage','roles.manage','settings.manage','sales.create','finance.manage','manufacturing.production','projects.time','fleet.dispatch'],ARRAY['system.admin']),
(2,'admin',ARRAY['users.manage','roles.manage','settings.manage','finance.manage','purchasing.approve'],ARRAY['system.admin']),
(3,'manager',ARRAY['sales.create','finance.view','services.manage','projects.manage'],ARRAY['users.manage','roles.manage','payroll.pay']),
(4,'branch_manager',ARRAY['sales.create','finance.view','purchasing.receive','inventory.view'],ARRAY['users.manage','roles.manage','finance.manage']),
(5,'cashier',ARRAY['sales.create','sales.view','payments.request'],ARRAY['finance.manage','users.manage','sales.refund']),
(6,'salesperson',ARRAY['sales.create','sales.view','customers.manage'],ARRAY['finance.manage','users.manage','sales.refund']),
(7,'storekeeper',ARRAY['inventory.view','inventory.transfer','inventory.stocktake','purchasing.receive'],ARRAY['finance.manage','users.manage','purchasing.approve']),
(8,'procurement_officer',ARRAY['purchasing.create','purchasing.receive','suppliers.manage'],ARRAY['finance.manage','users.manage','purchasing.approve']),
(9,'accountant',ARRAY['finance.manage','accounting.manage','payroll.pay','reports.view'],ARRAY['users.manage','roles.manage','purchasing.approve']),
(10,'hr_officer',ARRAY['hr.manage','attendance.manage','payroll.manage'],ARRAY['finance.manage','users.manage','roles.manage']),
(11,'production_staff',ARRAY['manufacturing.production','manufacturing.view','inventory.view'],ARRAY['finance.manage','roles.manage','users.manage']),
(12,'technician',ARRAY['services.assigned','workspace.tasks','attendance.use'],ARRAY['services.manage','finance.view','users.manage']),
(13,'project_worker',ARRAY['projects.time','workspace.tasks','attendance.use'],ARRAY['projects.manage','finance.view','users.manage']),
(14,'delivery_driver',ARRAY['fleet.assigned','fleet.view','attendance.use'],ARRAY['fleet.dispatch','finance.view','users.manage']),
(15,'employee',ARRAY['dashboard.view','workspace.tasks','leave.request'],ARRAY['finance.view','users.manage','roles.manage']);

INSERT INTO auth.users(id,email)
SELECT ('00000000-0000-0000-0000-'||lpad((8500+n)::text,12,'0'))::uuid,role||'@role-ci.invalid' FROM ci_roles;
INSERT INTO auth.users(id,email) VALUES('00000000-0000-0000-0000-000000008599','other-org@role-ci.invalid');
INSERT INTO public.organizations(id,name) VALUES
('00000000-0000-0000-0000-000000008001','MGT Acceptance Business'),
('00000000-0000-0000-0000-000000008002','MGT Other Business');
SELECT public.seed_default_roles('00000000-0000-0000-0000-000000008001');
SELECT public.seed_default_roles('00000000-0000-0000-0000-000000008002');
INSERT INTO public.locations(id,organization_id,name) VALUES
('00000000-0000-0000-0000-000000008101','00000000-0000-0000-0000-000000008001','Assigned branch'),
('00000000-0000-0000-0000-000000008102','00000000-0000-0000-0000-000000008001','Other branch'),
('00000000-0000-0000-0000-000000008103','00000000-0000-0000-0000-000000008002','Foreign branch');
INSERT INTO public.users(id,organization_id,default_location_id,full_name,role)
SELECT ('00000000-0000-0000-0000-'||lpad((8500+n)::text,12,'0'))::uuid,
 '00000000-0000-0000-0000-000000008001','00000000-0000-0000-0000-000000008101',role||' Test',role FROM ci_roles;
INSERT INTO public.users(id,organization_id,default_location_id,full_name,role)
VALUES('00000000-0000-0000-0000-000000008599','00000000-0000-0000-0000-000000008002',
 '00000000-0000-0000-0000-000000008103','Other owner','owner');
INSERT INTO public.organization_modules(organization_id,module_key,enabled)
SELECT '00000000-0000-0000-0000-000000008001',key,true
FROM (VALUES('sales'),('services'),('inventory'),('fleet'),('hr'),('projects')) v(key)
ON CONFLICT(organization_id,module_key) DO UPDATE SET enabled=true;
INSERT INTO public.sales(id,organization_id,location_id,sale_number,sold_by) VALUES
('00000000-0000-0000-0000-000000008301','00000000-0000-0000-0000-000000008001','00000000-0000-0000-0000-000000008101','CI-A-1','00000000-0000-0000-0000-000000008505'),
('00000000-0000-0000-0000-000000008302','00000000-0000-0000-0000-000000008001','00000000-0000-0000-0000-000000008102','CI-A-2','00000000-0000-0000-0000-000000008505'),
('00000000-0000-0000-0000-000000008303','00000000-0000-0000-0000-000000008002','00000000-0000-0000-0000-000000008103','CI-B-1','00000000-0000-0000-0000-000000008599');

SET LOCAL ROLE authenticated;
DO $$
DECLARE r record; code text; actor uuid; count_rights integer;
BEGIN
 FOR r IN SELECT * FROM ci_roles ORDER BY n LOOP
  actor:=('00000000-0000-0000-0000-'||lpad((8500+r.n)::text,12,'0'))::uuid;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  PERFORM set_config('request.jwt.claim.role','authenticated',true);
  PERFORM pg_temp.ok(public.current_user_role()=r.role,r.role||': recognizes primary role');
  PERFORM pg_temp.ok(public.current_organization_id()='00000000-0000-0000-0000-000000008001',r.role||': correct tenant');
  FOREACH code IN ARRAY r.allow_codes LOOP
   PERFORM pg_temp.ok(public.has_permission(code),r.role||': ALLOW '||code);
  END LOOP;
  FOREACH code IN ARRAY r.deny_codes LOOP
   PERFORM pg_temp.ok(NOT public.has_permission(code),r.role||': DENY '||code);
  END LOOP;
  PERFORM pg_temp.ok(public.has_permission('workspace.tasks'),r.role||': personal workspace enabled');
  SELECT count(*) INTO count_rights FROM public.current_permissions();
  PERFORM pg_temp.ok(count_rights>0,r.role||': at least one granted capability');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.sales WHERE organization_id='00000000-0000-0000-0000-000000008002')=0,r.role||': no other business sales');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.users WHERE organization_id='00000000-0000-0000-0000-000000008002')=0,r.role||': no other business users');
  RAISE NOTICE 'ROLE PASS: % (% permissions)',r.role,count_rights;
 END LOOP;
END $$;
DO $$
DECLARE name text; actor uuid; visible_sales integer;
BEGIN
 FOREACH name IN ARRAY ARRAY['cashier','salesperson','branch_manager','accountant','owner'] LOOP
  SELECT ('00000000-0000-0000-0000-'||lpad((8500+n)::text,12,'0'))::uuid INTO actor FROM ci_roles WHERE role=name;
  PERFORM set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  PERFORM set_config('request.jwt.claim.sub',actor::text,true);
  SELECT count(*) INTO visible_sales FROM public.sales;
  PERFORM pg_temp.ok(visible_sales=CASE WHEN name IN('cashier','salesperson','branch_manager') THEN 1 ELSE 2 END,
     name||': correct branch sales visibility');
 END LOOP;
END $$;
RESET ROLE;

-- Apply a role assignment via the same service-only SQL RPC used by the web endpoint.
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claims','{"role":"service_role"}',true);
SELECT set_config('request.jwt.claim.role','service_role',true);
SELECT public.server_set_staff_work_access(
 '00000000-0000-0000-0000-000000008001',
 '00000000-0000-0000-0000-000000008501',
 '00000000-0000-0000-0000-000000008515',
 ARRAY['storekeeper'],'location','00000000-0000-0000-0000-000000008101');
SELECT pg_temp.ok((SELECT count(*)=1 FROM public.user_additional_roles WHERE user_id='00000000-0000-0000-0000-000000008515'),'owner saved secondary storekeeper role');
SELECT pg_temp.ok((SELECT scope='location' FROM public.user_work_scope WHERE user_id='00000000-0000-0000-0000-000000008515'),'owner saved employee branch');
SELECT pg_temp.reject('admin role cannot be added to employee',
 'select public.server_set_staff_work_access(''00000000-0000-0000-0000-000000008001''::uuid,''00000000-0000-0000-0000-000000008501''::uuid,''00000000-0000-0000-0000-000000008515''::uuid,ARRAY[''admin'']::text[],''organization'',null)','Invalid additional role');
SELECT pg_temp.reject('cannot assign roles across organizations',
 'select public.server_set_staff_work_access(''00000000-0000-0000-0000-000000008001''::uuid,''00000000-0000-0000-0000-000000008501''::uuid,''00000000-0000-0000-0000-000000008599''::uuid,ARRAY[''storekeeper'']::text[],''organization'',null)','Staff account not found');
SELECT pg_temp.reject('employee cannot assign extra roles to self',
 'select public.server_set_staff_work_access(''00000000-0000-0000-0000-000000008001''::uuid,''00000000-0000-0000-0000-000000008515''::uuid,''00000000-0000-0000-0000-000000008515''::uuid,ARRAY[''storekeeper'']::text[],''organization'',null)','Cannot alter your own additional roles');
RESET ROLE;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000008515","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008515',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
SELECT pg_temp.ok(public.has_permission('inventory.view'),'additional role immediately adds inventory access');
SELECT pg_temp.ok(NOT public.has_permission('users.manage'),'extra role never grants staff administration');
SELECT pg_temp.ok(NOT public.has_permission('finance.view'),'extra role never grants finance');
SELECT pg_temp.ok((SELECT count(*) FROM public.sales)=0,'employee without sales grant cannot read sales');
RESET ROLE;
UPDATE public.roles SET active=false WHERE organization_id='00000000-0000-0000-0000-000000008001' AND key='storekeeper';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000008515","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008515',true);
SELECT pg_temp.ok(NOT public.has_permission('inventory.view'),'disabled secondary role immediately loses inventory access');
RESET ROLE;
UPDATE public.roles SET active=true WHERE organization_id='00000000-0000-0000-0000-000000008001' AND key='storekeeper';
UPDATE public.users SET archived_at=now() WHERE id='00000000-0000-0000-0000-000000008515';
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000008515","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000008515',true);
SELECT pg_temp.ok(public.current_organization_id() IS NULL,'archived worker has no business access');
SELECT pg_temp.ok(NOT public.has_permission('inventory.view'),'archived worker has no inventory access');
RESET ROLE;
SELECT count(*) AS role_acceptance_checks FROM ci_checks;
ROLLBACK;
