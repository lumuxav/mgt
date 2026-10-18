-- Disposable local-only authorization acceptance test. No production identifiers.
-- psql -v ON_ERROR_STOP=1; all fixture records are rolled back.
BEGIN;
CREATE TEMP TABLE mgt_ci_results(label text primary key);
GRANT SELECT, INSERT ON mgt_ci_results TO authenticated;
CREATE FUNCTION pg_temp.ok(condition boolean, label text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN RAISE EXCEPTION 'MGT local permission test failed: %', label; END IF;
  INSERT INTO mgt_ci_results(label) VALUES (label);
END $$;

-- Fixtures are created with Postgres authority, as a service-role transaction.
INSERT INTO auth.users(id,email) VALUES
 ('00000000-0000-0000-0000-000000000201','mgt-owner@ci.invalid'),
 ('00000000-0000-0000-0000-000000000202','mgt-tech@ci.invalid'),
 ('00000000-0000-0000-0000-000000000203','mgt-driver@ci.invalid'),
 ('00000000-0000-0000-0000-000000000204','mgt-other@ci.invalid');

INSERT INTO public.organizations(id,name) VALUES
 ('00000000-0000-0000-0000-000000000101','CI Business A'),
 ('00000000-0000-0000-0000-000000000102','CI Business B');
-- Existing MGT business bootstrap installs the original role templates
-- after company creation; direct test-only org inserts must do the same.
SELECT public.seed_default_roles('00000000-0000-0000-0000-000000000101');
SELECT public.seed_default_roles('00000000-0000-0000-0000-000000000102');
INSERT INTO public.locations(id,organization_id,name) VALUES
 ('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000101','Business A Warehouse'),
 ('00000000-0000-0000-0000-000000000302','00000000-0000-0000-0000-000000000101','Business A Other Branch'),
 ('00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000102','Business B Branch');
INSERT INTO public.users(id,organization_id,default_location_id,full_name,role) VALUES
 ('00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301','CI Owner','owner'),
 ('00000000-0000-0000-0000-000000000202','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301','CI Technician','technician'),
 ('00000000-0000-0000-0000-000000000203','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301','CI Driver','delivery_driver'),
 ('00000000-0000-0000-0000-000000000204','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000303','Other Business Owner','owner');
INSERT INTO public.organization_modules(organization_id,module_key,enabled)
VALUES
 ('00000000-0000-0000-0000-000000000101','services',true),
 ('00000000-0000-0000-0000-000000000101','inventory',true),
 ('00000000-0000-0000-0000-000000000101','fleet',true)
ON CONFLICT(organization_id,module_key) DO UPDATE SET enabled=true;
INSERT INTO public.user_additional_roles(organization_id,user_id,role,granted_by)
VALUES('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000202','storekeeper','00000000-0000-0000-0000-000000000201');

INSERT INTO public.work_orders(id,organization_id,location_id,title,assigned_to,quoted_amount)
VALUES
 ('00000000-0000-0000-0000-000000000401','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000301','Assigned local service job','00000000-0000-0000-0000-000000000202',50000),
 ('00000000-0000-0000-0000-000000000402','00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000302','Assigned other-branch service job','00000000-0000-0000-0000-000000000202',60000),
 ('00000000-0000-0000-0000-000000000403','00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000303','Foreign business job','00000000-0000-0000-0000-000000000204',80000);

INSERT INTO public.deliveries(id,organization_id,delivery_number,source_location_id,driver_user_id,status,destination)
VALUES
 ('00000000-0000-0000-0000-000000000501','00000000-0000-0000-0000-000000000101','CI-DLV-001','00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000203','dispatched','Local warehouse pickup'),
 ('00000000-0000-0000-0000-000000000502','00000000-0000-0000-0000-000000000102','CI-DLV-OTHER','00000000-0000-0000-0000-000000000303','00000000-0000-0000-0000-000000000204','dispatched','Other business delivery');

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
SELECT set_config('request.jwt.claim.role','authenticated',true);
DO $$
DECLARE work jsonb; rejected boolean;
BEGIN
  PERFORM pg_temp.ok(public.has_permission('services.assigned'),'technician has assigned-service work permission');
  PERFORM pg_temp.ok(public.has_permission('inventory.view'),'active secondary storekeeper role provides inventory viewing');
  PERFORM pg_temp.ok(NOT public.has_permission('users.manage'),'employee cannot administrate staff accounts');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.work_orders)=2,'technician can only read own business assigned work orders');
  work:=public.mgt_my_work();
  PERFORM pg_temp.ok(jsonb_array_length(work->'jobs')=2,'assigned service work feed includes only two own jobs');
  PERFORM pg_temp.ok(position('quoted_amount' in work::text)=0,'assigned work feed excludes confidential pricing');
  PERFORM pg_temp.ok(position('Foreign business job' in work::text)=0,'other business details never enter work feed');
  PERFORM public.mgt_update_assigned_job('00000000-0000-0000-0000-000000000401','in_progress');
  rejected:=false;
  BEGIN
    PERFORM public.mgt_update_assigned_job('00000000-0000-0000-0000-000000000403','on_hold');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'technician cannot update a foreign business job');
  rejected:=false;
  BEGIN
    PERFORM public.mgt_update_assigned_job('00000000-0000-0000-0000-000000000401','completed');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'technician cannot complete job through progress-only API');
  rejected:=false;
  BEGIN
    PERFORM public.server_set_staff_work_access('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000201','00000000-0000-0000-0000-000000000203',ARRAY['storekeeper'],'organization',null);
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'staff cannot directly invoke service-only role administration');
END $$;

RESET ROLE;
UPDATE public.user_work_scope
SET scope='location',location_id='00000000-0000-0000-0000-000000000301'
WHERE organization_id='00000000-0000-0000-0000-000000000101'
  AND user_id='00000000-0000-0000-0000-000000000202';

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000202","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',true);
DO $$
DECLARE work jsonb; rejected boolean;
BEGIN
  work:=public.mgt_my_work();
  PERFORM pg_temp.ok(jsonb_array_length(work->'jobs')=1,'branch restriction limits technician to assigned branch');
  PERFORM pg_temp.ok((SELECT count(*) FROM public.work_orders)=1,'work-order RLS respects location scope');
  rejected:=false;
  BEGIN
    PERFORM public.mgt_update_assigned_job('00000000-0000-0000-0000-000000000402','in_progress');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'branch restriction blocks RPC update outside assigned location');
END $$;

SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-0000-0000-000000000203","role":"authenticated"}',true);
SELECT set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000203',true);
DO $$
DECLARE work jsonb; rejected boolean;
BEGIN
  PERFORM pg_temp.ok(public.has_permission('fleet.assigned'),'driver has personal delivery permission');
  PERFORM pg_temp.ok(NOT public.has_permission('fleet.dispatch'),'driver is not a dispatch administrator');
  work:=public.mgt_my_work();
  PERFORM pg_temp.ok(jsonb_array_length(work->'deliveries')=1,'driver sees own delivery only');
  rejected:=false;
  BEGIN
    PERFORM public.mgt_update_assigned_delivery('00000000-0000-0000-0000-000000000501','delivered');
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'delivery proof must contain a recipient name');
  PERFORM public.mgt_update_assigned_delivery('00000000-0000-0000-0000-000000000501','in_transit');
  PERFORM public.mgt_update_assigned_delivery('00000000-0000-0000-0000-000000000501','delivered','Signed recipient','Test proof',null);
  rejected:=false;
  BEGIN
    PERFORM public.mgt_update_assigned_delivery('00000000-0000-0000-0000-000000000502','delivered','Unrelated',null,null);
  EXCEPTION WHEN OTHERS THEN rejected:=true;
  END;
  PERFORM pg_temp.ok(rejected,'driver cannot complete another business delivery');
END $$;

RESET ROLE;
SELECT count(*) as verified_security_cases FROM mgt_ci_results;
ROLLBACK;
