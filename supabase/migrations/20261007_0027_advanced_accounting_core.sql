-- MGT Business Suite — Advanced Accounting core

insert into public.permission_catalog(code,section,label,description,sort_order) values
 ('accounting.view','Accounting','View accounting','View chart of accounts, journals, ledgers and financial statements',160),
 ('accounting.manage','Accounting','Manage accounting','Create accounts, mappings and manual journals',161),
 ('accounting.close','Accounting','Close accounting periods','Close or reopen accounting periods',162),
 ('accounting.tax','Accounting','Manage tax settings','Manage tax/VAT settings and tax codes',163)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission) values
 ('manager','accounting.view'),
 ('accountant','accounting.view'),('accountant','accounting.manage'),('accountant','accounting.close'),('accountant','accounting.tax')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true from public.organizations o cross join (values
 ('owner','accounting.view'),('owner','accounting.manage'),('owner','accounting.close'),('owner','accounting.tax'),
 ('admin','accounting.view'),('admin','accounting.manage'),('admin','accounting.close'),('admin','accounting.tax'),
 ('manager','accounting.view'),
 ('accountant','accounting.view'),('accountant','accounting.manage'),('accountant','accounting.close'),('accountant','accounting.tax')
) x(role,permission)
on conflict(organization_id,role,permission) do update set allowed=true;

create table if not exists public.accounting_accounts(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null,name text not null,
 account_type text not null check(account_type in ('asset','liability','equity','income','expense')),
 subtype text,normal_balance text not null check(normal_balance in ('debit','credit')),
 cash_flow_category text not null default 'operating' check(cash_flow_category in ('operating','investing','financing','noncash')),
 parent_id uuid references public.accounting_accounts(id) on delete set null,
 system_code text,allow_manual_entries boolean not null default true,active boolean not null default true,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,code)
);
create unique index if not exists accounting_accounts_org_system_idx on public.accounting_accounts(organization_id,system_code) where system_code is not null;
create index if not exists accounting_accounts_org_type_idx on public.accounting_accounts(organization_id,account_type,code);

create table if not exists public.accounting_periods(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 name text not null,start_date date not null,end_date date not null,
 status text not null default 'open' check(status in ('open','closed')),
 closed_by uuid references public.users(id) on delete set null,closed_at timestamptz,
 created_by uuid references public.users(id) on delete set null,created_at timestamptz not null default now(),
 check(end_date>=start_date),unique(organization_id,start_date,end_date)
);
create index if not exists accounting_periods_org_date_idx on public.accounting_periods(organization_id,start_date,end_date);

create table if not exists public.accounting_tax_codes(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 code text not null,name text not null,rate numeric(8,4) not null default 0 check(rate>=0),
 scope text not null default 'both' check(scope in ('sales','purchase','both')),
 output_account_id uuid references public.accounting_accounts(id) on delete restrict,
 input_account_id uuid references public.accounting_accounts(id) on delete restrict,
 active boolean not null default true,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(organization_id,code)
);

create table if not exists public.accounting_settings(
 organization_id uuid primary key references public.organizations(id) on delete cascade,
 accounting_basis text not null default 'accrual' check(accounting_basis in ('accrual','cash')),
 fiscal_year_start_month smallint not null default 1 check(fiscal_year_start_month between 1 and 12),
 tax_registered boolean not null default false,tax_number text,
 tax_filing_frequency text not null default 'monthly' check(tax_filing_frequency in ('monthly','quarterly','annual')),
 default_sales_tax_code_id uuid references public.accounting_tax_codes(id) on delete set null,
 default_purchase_tax_code_id uuid references public.accounting_tax_codes(id) on delete set null,
 updated_at timestamptz not null default now()
);

create table if not exists public.accounting_expense_mappings(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 category_key text not null,account_id uuid not null references public.accounting_accounts(id) on delete restrict,
 created_at timestamptz not null default now(),unique(organization_id,category_key)
);

create table if not exists public.accounting_journals(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 journal_number text not null,journal_date date not null,
 status text not null default 'posted' check(status in ('posted','reversed')),
 source_type text not null default 'manual',source_id text,description text not null,reference text,
 cash_flow_category text not null default 'operating' check(cash_flow_category in ('operating','investing','financing','noncash')),
 created_by uuid references public.users(id) on delete set null,posted_by uuid references public.users(id) on delete set null,
 posted_at timestamptz not null default now(),reversed_journal_id uuid references public.accounting_journals(id) on delete set null,
 created_at timestamptz not null default now(),unique(organization_id,journal_number)
);
create unique index if not exists accounting_journal_source_unique on public.accounting_journals(organization_id,source_type,source_id) where source_id is not null and status='posted';
create index if not exists accounting_journals_org_date_idx on public.accounting_journals(organization_id,journal_date desc,created_at desc);
create index if not exists accounting_journals_source_idx on public.accounting_journals(organization_id,source_type,source_id);

create table if not exists public.accounting_journal_lines(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 journal_id uuid not null references public.accounting_journals(id) on delete cascade,
 account_id uuid not null references public.accounting_accounts(id) on delete restrict,
 debit numeric(18,2) not null default 0 check(debit>=0),credit numeric(18,2) not null default 0 check(credit>=0),
 memo text,customer_id uuid references public.customers(id) on delete set null,
 supplier_id uuid references public.suppliers(id) on delete set null,product_id uuid references public.products(id) on delete set null,
 project_id uuid references public.projects(id) on delete set null,created_at timestamptz not null default now(),
 check((debit>0 and credit=0) or (credit>0 and debit=0))
);
create index if not exists accounting_lines_journal_idx on public.accounting_journal_lines(journal_id);
create index if not exists accounting_lines_account_idx on public.accounting_journal_lines(organization_id,account_id);

alter table public.accounting_accounts enable row level security;
alter table public.accounting_periods enable row level security;
alter table public.accounting_tax_codes enable row level security;
alter table public.accounting_settings enable row level security;
alter table public.accounting_expense_mappings enable row level security;
alter table public.accounting_journals enable row level security;
alter table public.accounting_journal_lines enable row level security;

drop policy if exists accounting_accounts_select on public.accounting_accounts;
create policy accounting_accounts_select on public.accounting_accounts for select to authenticated using(public.has_organization_access(organization_id) and (public.has_permission('accounting.view') or public.has_permission('accounting.manage')));
drop policy if exists accounting_periods_select on public.accounting_periods;
create policy accounting_periods_select on public.accounting_periods for select to authenticated using(public.has_organization_access(organization_id) and (public.has_permission('accounting.view') or public.has_permission('accounting.close')));
drop policy if exists accounting_tax_codes_select on public.accounting_tax_codes;
create policy accounting_tax_codes_select on public.accounting_tax_codes for select to authenticated using(public.has_organization_access(organization_id) and (public.has_permission('accounting.view') or public.has_permission('accounting.tax')));
drop policy if exists accounting_settings_select on public.accounting_settings;
create policy accounting_settings_select on public.accounting_settings for select to authenticated using(public.has_organization_access(organization_id) and (public.has_permission('accounting.view') or public.has_permission('accounting.tax')));
drop policy if exists accounting_expense_mappings_select on public.accounting_expense_mappings;
create policy accounting_expense_mappings_select on public.accounting_expense_mappings for select to authenticated using(public.has_organization_access(organization_id) and (public.has_permission('accounting.view') or public.has_permission('accounting.manage')));
drop policy if exists accounting_journals_select on public.accounting_journals;
create policy accounting_journals_select on public.accounting_journals for select to authenticated using(public.has_organization_access(organization_id) and public.has_permission('accounting.view'));
drop policy if exists accounting_journal_lines_select on public.accounting_journal_lines;
create policy accounting_journal_lines_select on public.accounting_journal_lines for select to authenticated using(public.has_organization_access(organization_id) and public.has_permission('accounting.view'));

grant select on public.accounting_accounts,public.accounting_periods,public.accounting_tax_codes,public.accounting_settings,public.accounting_expense_mappings,public.accounting_journals,public.accounting_journal_lines to authenticated;

create or replace function public.seed_default_chart_of_accounts(p_org uuid)
returns void language plpgsql security definer set search_path=public as $$
begin
 insert into public.accounting_accounts(organization_id,code,name,account_type,subtype,normal_balance,cash_flow_category,system_code,allow_manual_entries) values
 (p_org,'1000','Cash on Hand','asset','cash','debit','operating','cash',false),
 (p_org,'1010','Bank Accounts','asset','bank','debit','operating','bank',false),
 (p_org,'1020','Mobile Money & Card Clearing','asset','digital_cash','debit','operating','digital_cash',false),
 (p_org,'1090','Undeposited Funds / Payment Clearing','asset','clearing','debit','operating','payment_clearing',true),
 (p_org,'1100','Accounts Receivable','asset','receivable','debit','operating','accounts_receivable',false),
 (p_org,'1150','Input VAT / Tax Recoverable','asset','tax_receivable','debit','operating','input_tax',false),
 (p_org,'1200','Inventory','asset','inventory','debit','operating','inventory',false),
 (p_org,'1300','Other Current Assets','asset','other_current_asset','debit','operating','other_current_asset',true),
 (p_org,'1500','Property, Plant & Equipment','asset','fixed_asset','debit','investing','fixed_assets',true),
 (p_org,'1590','Accumulated Depreciation','asset','contra_asset','credit','noncash','accumulated_depreciation',true),
 (p_org,'2000','Accounts Payable','liability','payable','credit','operating','accounts_payable',false),
 (p_org,'2100','Output VAT / Tax Payable','liability','tax_payable','credit','operating','output_tax',false),
 (p_org,'2200','Payroll & Staff Payables','liability','payroll_payable','credit','operating','payroll_payable',true),
 (p_org,'2300','Other Current Liabilities','liability','other_current_liability','credit','operating','other_current_liability',true),
 (p_org,'3000','Owner''s Equity','equity','owner_equity','credit','financing','owner_equity',true),
 (p_org,'3100','Retained Earnings','equity','retained_earnings','credit','financing','retained_earnings',false),
 (p_org,'3900','Suspense / Clearing','equity','clearing','credit','financing','suspense',true),
 (p_org,'4000','Product Sales Revenue','income','sales','credit','operating','sales_revenue',true),
 (p_org,'4100','Service Revenue','income','service','credit','operating','service_revenue',true),
 (p_org,'4200','Project Revenue','income','project','credit','operating','project_revenue',true),
 (p_org,'4300','Delivery & Other Revenue','income','other_revenue','credit','operating','delivery_revenue',true),
 (p_org,'4900','Sales Returns & Allowances','income','contra_income','debit','operating','sales_returns',true),
 (p_org,'5000','Cost of Goods Sold','expense','cogs','debit','operating','cogs',true),
 (p_org,'5100','Service / Job Cost','expense','service_cost','debit','operating','service_cost',true),
 (p_org,'5200','Project Direct Cost','expense','project_cost','debit','operating','project_cost',true),
 (p_org,'6000','Operating Expenses','expense','operating_expense','debit','operating','operating_expense',true),
 (p_org,'6100','Payroll Expense','expense','payroll_expense','debit','operating','payroll_expense',true),
 (p_org,'6200','Depreciation Expense','expense','depreciation','debit','noncash','depreciation_expense',true),
 (p_org,'6300','Maintenance, Fuel & Fleet Expense','expense','maintenance_fleet','debit','operating','maintenance_fleet_expense',true)
 on conflict(organization_id,code) do nothing;
 insert into public.accounting_settings(organization_id) values(p_org) on conflict(organization_id) do nothing;
end; $$;
revoke all on function public.seed_default_chart_of_accounts(uuid) from public;
revoke execute on function public.seed_default_chart_of_accounts(uuid) from anon,authenticated;

do $$ declare r record; begin for r in select id from public.organizations loop perform public.seed_default_chart_of_accounts(r.id); end loop; end $$;

create or replace function public.accounting_seed_new_organization() returns trigger language plpgsql security definer set search_path=public as $$
begin perform public.seed_default_chart_of_accounts(new.id); return new; end; $$;
revoke all on function public.accounting_seed_new_organization() from public;
revoke execute on function public.accounting_seed_new_organization() from anon,authenticated;
drop trigger if exists organizations_accounting_seed on public.organizations;
create trigger organizations_accounting_seed after insert on public.organizations for each row execute function public.accounting_seed_new_organization();

create or replace function public.accounting_account_id(p_org uuid,p_code text)
returns uuid language sql stable security definer set search_path=public as $$
 select id from public.accounting_accounts where organization_id=p_org and code=p_code and active=true limit 1
$$;
revoke all on function public.accounting_account_id(uuid,text) from public;
revoke execute on function public.accounting_account_id(uuid,text) from anon,authenticated;

create or replace function public.accounting_payment_account_code(p_method text)
returns text language sql immutable set search_path=public as $$
 select case lower(coalesce(p_method,'')) when 'cash' then '1000' when 'bank' then '1010' when 'bank_transfer' then '1010'
 when 'mobile_money' then '1020' when 'mtn_momo' then '1020' when 'airtel_money' then '1020' when 'card' then '1020' else '1090' end
$$;
revoke all on function public.accounting_payment_account_code(text) from public;
revoke execute on function public.accounting_payment_account_code(text) from anon,authenticated;

create or replace function public.accounting_write_journal(
 p_org uuid,p_location uuid,p_date date,p_source_type text,p_source_id text,p_description text,p_reference text,
 p_cash_flow_category text,p_lines jsonb,p_actor uuid default null
) returns uuid language plpgsql security definer set search_path=public as $$
declare v_journal_id uuid;v_existing uuid;v_number text;v_line jsonb;v_account uuid;v_debit numeric(18,2);v_credit numeric(18,2);v_total_debit numeric(18,2):=0;v_total_credit numeric(18,2):=0;
begin
 if p_org is null or p_date is null or coalesce(trim(p_description),'')='' then raise exception 'Organization, date and description are required'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))<2 then raise exception 'A balanced journal requires at least two lines'; end if;
 if p_source_type<>'period_close' and exists(select 1 from public.accounting_periods where organization_id=p_org and status='closed' and p_date between start_date and end_date) then raise exception 'Accounting period is closed for %',p_date; end if;
 select id into v_existing from public.accounting_journals where organization_id=p_org and source_type=p_source_type and source_id=p_source_id and status='posted' limit 1 for update;
 if v_existing is not null then delete from public.accounting_journals where id=v_existing; end if;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_debit:=round(coalesce(nullif(v_line->>'debit','')::numeric,0),2);v_credit:=round(coalesce(nullif(v_line->>'credit','')::numeric,0),2);
  if v_debit<0 or v_credit<0 or (v_debit>0 and v_credit>0) or (v_debit=0 and v_credit=0) then raise exception 'Each journal line must contain one positive debit or credit'; end if;
  v_total_debit:=v_total_debit+v_debit;v_total_credit:=v_total_credit+v_credit;
 end loop;
 if abs(v_total_debit-v_total_credit)>0.009 or v_total_debit<=0 then raise exception 'Journal is not balanced'; end if;
 v_number:='JRN-'||to_char(clock_timestamp(),'YYYYMMDD-HH24MISS-MS')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,4));
 insert into public.accounting_journals(organization_id,location_id,journal_number,journal_date,status,source_type,source_id,description,reference,cash_flow_category,created_by,posted_by)
 values(p_org,p_location,v_number,p_date,'posted',coalesce(nullif(trim(p_source_type),''),'manual'),p_source_id,trim(p_description),nullif(trim(p_reference),''),coalesce(nullif(trim(p_cash_flow_category),''),'operating'),p_actor,p_actor)
 returning id into v_journal_id;
 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_account:=case when coalesce(v_line->>'account_id','')<>'' then (v_line->>'account_id')::uuid else public.accounting_account_id(p_org,v_line->>'code') end;
  if not exists(select 1 from public.accounting_accounts where id=v_account and organization_id=p_org and active=true) then raise exception 'Journal account not found'; end if;
  insert into public.accounting_journal_lines(organization_id,journal_id,account_id,debit,credit,memo,customer_id,supplier_id,product_id,project_id)
  values(p_org,v_journal_id,v_account,round(coalesce(nullif(v_line->>'debit','')::numeric,0),2),round(coalesce(nullif(v_line->>'credit','')::numeric,0),2),nullif(v_line->>'memo',''),
  nullif(v_line->>'customer_id','')::uuid,nullif(v_line->>'supplier_id','')::uuid,nullif(v_line->>'product_id','')::uuid,nullif(v_line->>'project_id','')::uuid);
 end loop;
 return v_journal_id;
end; $$;
revoke all on function public.accounting_write_journal(uuid,uuid,date,text,text,text,text,text,jsonb,uuid) from public;
revoke execute on function public.accounting_write_journal(uuid,uuid,date,text,text,text,text,text,jsonb,uuid) from anon,authenticated;

create or replace function public.accounting_remove_source_journal(p_org uuid,p_source_type text,p_source_id text)
returns void language plpgsql security definer set search_path=public as $$
declare v_id uuid;v_date date;
begin
 select id,journal_date into v_id,v_date from public.accounting_journals where organization_id=p_org and source_type=p_source_type and source_id=p_source_id and status='posted' limit 1;
 if v_id is null then return; end if;
 if exists(select 1 from public.accounting_periods where organization_id=p_org and status='closed' and v_date between start_date and end_date) then raise exception 'Cannot change accounting journal in a closed period'; end if;
 delete from public.accounting_journals where id=v_id;
end; $$;
revoke all on function public.accounting_remove_source_journal(uuid,text,text) from public;
revoke execute on function public.accounting_remove_source_journal(uuid,text,text) from anon,authenticated;
