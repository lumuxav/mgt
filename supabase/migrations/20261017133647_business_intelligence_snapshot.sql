-- One aggregate response; business identity comes only from the session.
create or replace function public.get_business_insights()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare
 v_org uuid := public.current_organization_id();
 v_tz text; v_currency text; v_today date; v_since timestamptz; v_end timestamptz;
 v_modules text[]; v_sales boolean; v_finance boolean; v_inventory boolean;
 v_services boolean; v_projects boolean;
 v_daily jsonb; v_stock jsonb := null; v_first date; v_receivables numeric := null;
 v_jobs bigint := null; v_overruns bigint := null;
begin
 if v_org is null or not public.has_permission('insights.view') then
  raise exception 'You do not have access to MGT Intelligence' using errcode='42501';
 end if;
 select coalesce(array_agg(module_key),array[]::text[]) into v_modules
 from public.organization_modules where organization_id=v_org and enabled;
 if not ('insights'=any(v_modules)) then
  raise exception 'MGT Intelligence is disabled for this business' using errcode='42501';
 end if;
 select o.currency,case when exists(select 1 from pg_timezone_names z where z.name=o.timezone) then o.timezone else 'UTC' end
 into v_currency,v_tz from public.organizations o where o.id=v_org;
 v_today := (now() at time zone v_tz)::date;
 v_since := (v_today-90)::timestamp at time zone v_tz;
 v_end := v_today::timestamp at time zone v_tz;
 v_sales := public.has_permission('sales.view') and ('sales'=any(v_modules) or 'pos'=any(v_modules));
 v_finance := public.has_permission('finance.view') and 'finance'=any(v_modules);
 v_inventory := public.has_permission('inventory.view') and 'inventory'=any(v_modules);
 v_services := (public.has_permission('services.view') or public.has_permission('services.manage')) and 'services'=any(v_modules);
 v_projects := (public.has_permission('projects.view') or public.has_permission('projects.manage') or public.has_permission('projects.costs') or public.has_permission('projects.billing')) and 'projects'=any(v_modules);
 with days as (select v_today-n as day from generate_series(1,90) n),
 daily_sales as (
  select (s.created_at at time zone v_tz)::date as day,
   sum(greatest(s.total_amount-s.refunded_amount,0)) as sales,count(*) as sale_count
  from public.sales s
  where v_sales and s.organization_id=v_org and s.created_at>=v_since and s.created_at<v_end
   and s.status not in ('cancelled','void','draft')
  group by 1
 ),daily_expenses as (
  select (e.created_at at time zone v_tz)::date as day,sum(e.amount) as expenses
  from public.expenses e where v_finance and e.organization_id=v_org and e.created_at>=v_since and e.created_at<v_end
  group by 1
 )
 select jsonb_agg(jsonb_build_object('date',d.day,
  'sales',case when v_sales then coalesce(s.sales,0) else null end,
  'sale_count',case when v_sales then coalesce(s.sale_count,0) else null end,
  'expenses',case when v_finance then coalesce(e.expenses,0) else null end) order by d.day)
 into v_daily from days d left join daily_sales s using(day) left join daily_expenses e using(day);
 if v_sales then
  select (min(created_at) at time zone v_tz)::date,
   coalesce(sum(greatest(total_amount-refunded_amount-amount_paid,0)),0)
  into v_first,v_receivables from public.sales
  where organization_id=v_org and created_at<=now() and status not in ('cancelled','void','draft');
 end if;
 if v_inventory then
  with stock as (
   select p.id,p.name,p.reorder_level,coalesce(sum(greatest(b.quantity-b.reserved_quantity,0)),0) as available
   from public.products p left join public.stock_balances b on b.product_id=p.id
   where p.organization_id=v_org and p.active and p.track_inventory
   group by p.id,p.name,p.reorder_level
  ), low as (select * from stock where available<=reorder_level)
  select jsonb_build_object('tracked_count',(select count(*) from stock),'low_count',(select count(*) from low),
   'low_items',coalesce((select jsonb_agg(to_jsonb(x) order by x.available,x.name,x.id) from
    (select * from low order by available,name,id limit 12) x),'[]'::jsonb)) into v_stock;
 end if;
 if v_services then
  select count(*) into v_jobs from public.work_orders where organization_id=v_org
   and status not in ('completed','cancelled') and due_at<now();
 end if;
 if v_projects then
  select count(*) into v_overruns from public.projects where organization_id=v_org
   and status not in ('completed','cancelled') and budget_cost>0 and total_cost>budget_cost;
 end if;
 return jsonb_build_object('generated_at',now(),'currency',v_currency,'timezone',v_tz,
  'period_start',v_today-30,'period_end',v_today-1,'first_sale_date',v_first,
  'access',jsonb_build_object('sales',v_sales,'finance',v_finance,'inventory',v_inventory,'services',v_services,'projects',v_projects),
  'daily',v_daily,'sales_receivables',v_receivables,'inventory',v_stock,
  'operations',jsonb_build_object('overdue_jobs',v_jobs,'over_budget_projects',v_overruns));
end;
$$;
revoke all on function public.get_business_insights() from public,anon;
grant execute on function public.get_business_insights() to authenticated;
comment on function public.get_business_insights() is
 'MGT Intelligence: 90 complete local-calendar days, permission-scoped aggregates, no organization parameter or raw customer records.';
