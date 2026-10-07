-- MGT Business Suite — business document profile, quotations and document permissions

alter table public.organizations
 add column if not exists phone text,
 add column if not exists email text,
 add column if not exists address text,
 add column if not exists website text,
 add column if not exists tax_number text,
 add column if not exists registration_number text,
 add column if not exists logo_url text,
 add column if not exists document_footer text,
 add column if not exists document_terms text;

insert into public.permission_catalog(code,section,label,description,sort_order) values
 ('documents.view','Documents','View business documents','View quotations, invoices, receipts, statements and printable business records',170),
 ('documents.manage','Documents','Manage business documents','Create quotations and manage document workflow',171)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission) values
 ('manager','documents.view'),('manager','documents.manage'),
 ('accountant','documents.view'),('accountant','documents.manage'),
 ('cashier','documents.view'),('cashier','documents.manage'),
 ('storekeeper','documents.view')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true
from public.organizations o
cross join (values
 ('owner','documents.view'),('owner','documents.manage'),
 ('admin','documents.view'),('admin','documents.manage'),
 ('manager','documents.view'),('manager','documents.manage'),
 ('accountant','documents.view'),('accountant','documents.manage'),
 ('cashier','documents.view'),('cashier','documents.manage'),
 ('storekeeper','documents.view')
) x(role,permission)
on conflict(organization_id,role,permission) do update set allowed=true;

create table if not exists public.quotations(
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete cascade,
 location_id uuid references public.locations(id) on delete set null,
 customer_id uuid references public.customers(id) on delete set null,
 quotation_number text not null,
 status text not null default 'draft' check(status in ('draft','sent','accepted','rejected','expired','converted','cancelled')),
 issue_date date not null default current_date,
 valid_until date,
 subtotal numeric(18,2) not null default 0 check(subtotal>=0),
 discount_amount numeric(18,2) not null default 0 check(discount_amount>=0),
 tax_amount numeric(18,2) not null default 0 check(tax_amount>=0),
 total_amount numeric(18,2) not null default 0 check(total_amount>=0),
 notes text,
 terms text,
 created_by uuid references public.users(id) on delete set null,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(organization_id,quotation_number)
);
create index if not exists quotations_org_date_idx on public.quotations(organization_id,issue_date desc,created_at desc);
create index if not exists quotations_customer_idx on public.quotations(organization_id,customer_id,status);

create table if not exists public.quotation_items(
 id uuid primary key default gen_random_uuid(),
 quotation_id uuid not null references public.quotations(id) on delete cascade,
 product_id uuid references public.products(id) on delete set null,
 description text not null,
 quantity numeric(18,3) not null check(quantity>0),
 unit_price numeric(18,2) not null check(unit_price>=0),
 discount_amount numeric(18,2) not null default 0 check(discount_amount>=0),
 tax_amount numeric(18,2) not null default 0 check(tax_amount>=0),
 line_total numeric(18,2) not null check(line_total>=0),
 created_at timestamptz not null default now()
);
create index if not exists quotation_items_quote_idx on public.quotation_items(quotation_id);

alter table public.quotations enable row level security;
alter table public.quotation_items enable row level security;

drop policy if exists quotations_select on public.quotations;
create policy quotations_select on public.quotations for select to authenticated
using(public.has_organization_access(organization_id) and public.has_permission('documents.view'));

drop policy if exists quotation_items_select on public.quotation_items;
create policy quotation_items_select on public.quotation_items for select to authenticated
using(exists(
 select 1 from public.quotations q
 where q.id=quotation_id
 and public.has_organization_access(q.organization_id)
 and public.has_permission('documents.view')
));

grant select on public.quotations,public.quotation_items to authenticated;

create or replace function public.save_document_profile(
 p_phone text,p_email text,p_address text,p_website text,p_tax_number text,p_registration_number text,
 p_logo_url text,p_document_footer text,p_document_terms text
)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('settings.manage') then raise exception 'Permission denied: settings.manage'; end if;
 if p_logo_url is not null and length(p_logo_url)>350000 then raise exception 'Logo image is too large'; end if;
 update public.organizations set
  phone=nullif(trim(p_phone),''),
  email=nullif(trim(p_email),''),
  address=nullif(trim(p_address),''),
  website=nullif(trim(p_website),''),
  tax_number=nullif(trim(p_tax_number),''),
  registration_number=nullif(trim(p_registration_number),''),
  logo_url=nullif(p_logo_url,''),
  document_footer=nullif(trim(p_document_footer),''),
  document_terms=nullif(trim(p_document_terms),''),
  updated_at=now()
 where id=v_org;
 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary)
 values(v_org,auth.uid(),'document_profile_updated','organization',v_org::text,'Business document profile updated');
end;
$$;
revoke all on function public.save_document_profile(text,text,text,text,text,text,text,text,text) from public;
revoke execute on function public.save_document_profile(text,text,text,text,text,text,text,text,text) from anon;
grant execute on function public.save_document_profile(text,text,text,text,text,text,text,text,text) to authenticated;

create or replace function public.create_quotation(
 p_location_id uuid,p_customer_id uuid,p_issue_date date,p_valid_until date,p_notes text,p_terms text,p_lines jsonb
)
returns uuid language plpgsql security definer set search_path=public as $$
declare
 v_org uuid:=public.current_organization_id();v_id uuid;v_number text;v_line jsonb;
 v_subtotal numeric(18,2):=0;v_discount numeric(18,2):=0;v_tax numeric(18,2):=0;v_total numeric(18,2):=0;
 v_qty numeric(18,3);v_price numeric(18,2);v_disc numeric(18,2);v_line_tax numeric(18,2);v_line_total numeric(18,2);
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('documents.manage') then raise exception 'Permission denied: documents.manage'; end if;
 if p_location_id is not null and not exists(select 1 from public.locations where id=p_location_id and organization_id=v_org) then raise exception 'Location not found'; end if;
 if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id and organization_id=v_org) then raise exception 'Customer not found'; end if;
 if jsonb_typeof(coalesce(p_lines,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_lines,'[]'::jsonb))=0 then raise exception 'Add at least one quotation line'; end if;
 if p_valid_until is not null and p_valid_until<coalesce(p_issue_date,current_date) then raise exception 'Valid-until date cannot be before issue date'; end if;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=coalesce(nullif(v_line->>'quantity','')::numeric,0);
  v_price:=coalesce(nullif(v_line->>'unit_price','')::numeric,0);
  v_disc:=coalesce(nullif(v_line->>'discount_amount','')::numeric,0);
  v_line_tax:=coalesce(nullif(v_line->>'tax_amount','')::numeric,0);
  if v_qty<=0 or v_price<0 or v_disc<0 or v_line_tax<0 or coalesce(trim(v_line->>'description'),'')='' then raise exception 'Invalid quotation line'; end if;
  v_line_total:=round(greatest(v_qty*v_price-v_disc+v_line_tax,0),2);
  v_subtotal:=v_subtotal+round(v_qty*v_price,2);
  v_discount:=v_discount+v_disc;
  v_tax:=v_tax+v_line_tax;
  v_total:=v_total+v_line_total;
 end loop;

 v_number:='QTN-'||to_char(coalesce(p_issue_date,current_date),'YYYYMMDD')||'-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,5));
 insert into public.quotations(
  organization_id,location_id,customer_id,quotation_number,status,issue_date,valid_until,
  subtotal,discount_amount,tax_amount,total_amount,notes,terms,created_by
 )
 values(
  v_org,p_location_id,p_customer_id,v_number,'draft',coalesce(p_issue_date,current_date),p_valid_until,
  round(v_subtotal,2),round(v_discount,2),round(v_tax,2),round(v_total,2),nullif(trim(p_notes),''),nullif(trim(p_terms),''),auth.uid()
 ) returning id into v_id;

 for v_line in select value from jsonb_array_elements(p_lines) loop
  v_qty:=coalesce(nullif(v_line->>'quantity','')::numeric,0);
  v_price:=coalesce(nullif(v_line->>'unit_price','')::numeric,0);
  v_disc:=coalesce(nullif(v_line->>'discount_amount','')::numeric,0);
  v_line_tax:=coalesce(nullif(v_line->>'tax_amount','')::numeric,0);
  v_line_total:=round(greatest(v_qty*v_price-v_disc+v_line_tax,0),2);
  insert into public.quotation_items(quotation_id,product_id,description,quantity,unit_price,discount_amount,tax_amount,line_total)
  values(v_id,nullif(v_line->>'product_id','')::uuid,trim(v_line->>'description'),v_qty,v_price,v_disc,v_line_tax,v_line_total);
 end loop;

 insert into public.audit_log(organization_id,location_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,p_location_id,auth.uid(),'quotation_created','quotation',v_id::text,'Quotation created: '||v_number,jsonb_build_object('total_amount',v_total,'customer_id',p_customer_id));
 return v_id;
end;
$$;
revoke all on function public.create_quotation(uuid,uuid,date,date,text,text,jsonb) from public;
revoke execute on function public.create_quotation(uuid,uuid,date,date,text,text,jsonb) from anon;
grant execute on function public.create_quotation(uuid,uuid,date,date,text,text,jsonb) to authenticated;

create or replace function public.update_quotation_status(p_quotation_id uuid,p_status text)
returns void language plpgsql security definer set search_path=public as $$
declare v_org uuid:=public.current_organization_id();v_number text;
begin
 if v_org is null then raise exception 'Active organization required'; end if;
 if not public.has_permission('documents.manage') then raise exception 'Permission denied: documents.manage'; end if;
 if p_status not in ('draft','sent','accepted','rejected','expired','converted','cancelled') then raise exception 'Invalid quotation status'; end if;
 update public.quotations set status=p_status,updated_at=now()
 where id=p_quotation_id and organization_id=v_org
 returning quotation_number into v_number;
 if v_number is null then raise exception 'Quotation not found'; end if;
 insert into public.audit_log(organization_id,user_id,action,entity_type,entity_id,summary,metadata)
 values(v_org,auth.uid(),'quotation_status_updated','quotation',p_quotation_id::text,'Quotation status updated: '||v_number,jsonb_build_object('status',p_status));
end;
$$;
revoke all on function public.update_quotation_status(uuid,text) from public;
revoke execute on function public.update_quotation_status(uuid,text) from anon;
grant execute on function public.update_quotation_status(uuid,text) to authenticated;


create or replace function public.validate_quotation_item_scope()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare v_org uuid;
begin
 select organization_id into v_org
 from public.quotations
 where id=new.quotation_id;

 if v_org is null then
  raise exception 'Quotation not found';
 end if;

 if new.product_id is not null and not exists(
  select 1 from public.products
  where id=new.product_id and organization_id=v_org
 ) then
  raise exception 'Quotation product is outside the active organization';
 end if;

 return new;
end;
$$;

revoke all on function public.validate_quotation_item_scope() from public;
revoke execute on function public.validate_quotation_item_scope() from anon;
revoke execute on function public.validate_quotation_item_scope() from authenticated;

drop trigger if exists quotation_items_scope_guard on public.quotation_items;
create trigger quotation_items_scope_guard
before insert or update of quotation_id,product_id on public.quotation_items
for each row execute function public.validate_quotation_item_scope();
