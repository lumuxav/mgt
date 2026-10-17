create or replace function public.current_user_role()
returns text language sql stable security definer set search_path=public as $$
 select u.role from public.users u
 join public.organizations o on o.id=u.organization_id and o.active
 where u.id=(select auth.uid()) and u.active and u.archived_at is null
 and (u.role in ('owner','admin','super_admin','system_admin') or exists(
  select 1 from public.roles r where r.organization_id=u.organization_id and r.key=u.role and r.active
 )) limit 1
$$;

create or replace function public.current_organization_id()
returns uuid language sql stable security definer set search_path=public as $$
 select u.organization_id from public.users u
 where u.id=(select auth.uid()) and public.current_user_role() is not null limit 1
$$;
revoke all on function public.current_user_role(),public.current_organization_id() from public,anon;
grant execute on function public.current_user_role(),public.current_organization_id() to authenticated;

revoke insert,update,delete on public.purchases,public.purchase_items,public.stock_movements,
 public.expenses,public.banking_transactions from anon,authenticated;

revoke insert,update,delete on public.customers,public.suppliers,public.bank_accounts from authenticated;
grant insert(organization_id,name,phone,email,address,customer_group,credit_limit,opening_balance,active,notes),
 update(name,phone,email,address,customer_group,credit_limit,active,notes,updated_at) on public.customers to authenticated;
grant insert(organization_id,name,phone,email,address,opening_balance,active,notes),
 update(name,phone,email,address,active,notes,updated_at) on public.suppliers to authenticated;
grant insert(organization_id,name,account_type,provider,account_reference,opening_balance,active),
 update(name,provider,account_reference,active) on public.bank_accounts to authenticated;

do $$
declare r record;
begin
 for r in
  select c.table_name,string_agg(format('%I is null or %I::text not in (''NaN'',''Infinity'',''-Infinity'')',c.column_name,c.column_name),') and (' order by c.ordinal_position) as predicate
  from information_schema.columns c
  join information_schema.tables t on t.table_schema=c.table_schema and t.table_name=c.table_name and t.table_type='BASE TABLE'
  where c.table_schema='public' and c.data_type in ('numeric','real','double precision')
  group by c.table_name
 loop
  execute format('alter table public.%I add constraint %I check ((%s))',r.table_name,r.table_name||'_finite_numbers',r.predicate);
 end loop;
end; $$;

create or replace function public.enforce_business_reference_scope()
returns trigger language plpgsql security definer set search_path=pg_catalog,public as $$
declare
 row_data jsonb:=to_jsonb(new); org uuid; related_org uuid; related_id uuid; i integer;
begin
 if tg_table_name='bom_items' then
  select organization_id into org from public.boms where id=new.bom_id;
 elsif tg_table_name='stock_balances' then
  select organization_id into org from public.products where id=new.product_id;
 else
  org:=(row_data->>'organization_id')::uuid;
 end if;
 for i in 0..tg_nargs-1 by 2 loop
  related_id:=(row_data->>tg_argv[i])::uuid;
  if related_id is null then continue; end if;
  execute format('select organization_id from public.%I where id=$1',tg_argv[i+1]) into related_org using related_id;
  if org is null or related_org is distinct from org then
   raise exception 'Business reference mismatch: %.%',tg_table_name,tg_argv[i] using errcode='23514';
  end if;
 end loop;
 return new;
end; $$;
revoke all on function public.enforce_business_reference_scope() from public,anon,authenticated;

do $$
declare r record; args text; scope_expression text; invalid_count bigint;
begin
 for r in
  select c.relname as table_name,a.attname as column_name,pc.relname as parent_table
  from pg_constraint f
  join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_class pc on pc.oid=f.confrelid join pg_namespace pn on pn.oid=pc.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum=f.conkey[1]
  where f.contype='f' and n.nspname='public' and pn.nspname='public'
   and c.relname in ('users','products','boms','bom_items','departments','employee_pay_components',
    'employee_shift_assignments','storefronts','storefront_products','vehicles','assets','stock_balances')
   and a.attname<>'organization_id'
  order by c.relname,a.attname
 loop
  scope_expression:=case r.table_name
   when 'bom_items' then '(select organization_id from public.boms where id=child.bom_id)'
   when 'stock_balances' then '(select organization_id from public.products where id=child.product_id)'
   else 'child.organization_id' end;
  execute format('select count(*) from public.%I child join public.%I parent on parent.id=child.%I where parent.organization_id is distinct from %s',
   r.table_name,r.parent_table,r.column_name,scope_expression) into invalid_count;
  if invalid_count>0 then raise exception 'Existing business reference mismatch: %.% (% rows)',r.table_name,r.column_name,invalid_count; end if;
 end loop;
 for r in
  select c.relname as table_name,string_agg(format('%L,%L',a.attname,pc.relname),',' order by a.attname) as arguments
  from pg_constraint f
  join pg_class c on c.oid=f.conrelid join pg_namespace n on n.oid=c.relnamespace
  join pg_class pc on pc.oid=f.confrelid join pg_namespace pn on pn.oid=pc.relnamespace
  join pg_attribute a on a.attrelid=c.oid and a.attnum=f.conkey[1]
  where f.contype='f' and n.nspname='public' and pn.nspname='public'
   and c.relname in ('users','products','boms','bom_items','departments','employee_pay_components',
    'employee_shift_assignments','storefronts','storefront_products','vehicles','assets','stock_balances')
   and a.attname<>'organization_id'
  group by c.relname
 loop
  execute format('create trigger business_reference_scope before insert or update on public.%I for each row execute function public.enforce_business_reference_scope(%s)',r.table_name,r.arguments);
 end loop;
end; $$;

create index if not exists accounting_journal_lines_account_id_idx on public.accounting_journal_lines(account_id);
create index if not exists purchases_supplier_id_idx on public.purchases(supplier_id);
create index if not exists banking_transactions_bank_account_id_idx on public.banking_transactions(bank_account_id);

CREATE OR REPLACE FUNCTION public.enforce_user_account_protection()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_actor_role text:=public.current_user_role();
  v_jwt_role text:=coalesce(auth.role(),'');
  v_other_active_owners integer:=0;
begin
  perform 1 from public.organizations where id=old.organization_id for update;
  if tg_op='DELETE' then
    if old.role='owner' then
      select count(*) into v_other_active_owners
      from public.users
      where organization_id=old.organization_id
        and id<>old.id
        and role='owner'
        and active=true
        and archived_at is null;

      if v_other_active_owners=0 then
        raise exception 'The last active Owner cannot be removed';
      end if;

      if v_jwt_role<>'service_role' and v_actor_role not in ('owner','super_admin','system_admin') then
        raise exception 'Only an Owner can remove another Owner';
      end if;

      if auth.uid()=old.id then
        raise exception 'You cannot remove your own Owner account';
      end if;
    end if;
    return old;
  end if;

  if old.organization_id is distinct from new.organization_id
     and old.organization_id is not null
     and v_jwt_role<>'service_role' then
    raise exception 'A staff account cannot be moved to another organization directly';
  end if;

  if auth.uid()=old.id and (
    new.role is distinct from old.role
    or new.active is distinct from old.active
    or new.archived_at is distinct from old.archived_at
    or new.organization_id is distinct from old.organization_id
  ) then
    raise exception 'You cannot change your own role, organization or account status';
  end if;

  if old.role='owner' and (
    new.role is distinct from old.role
    or new.active=false
    or new.archived_at is not null
  ) then
    select count(*) into v_other_active_owners
    from public.users
    where organization_id=old.organization_id
      and id<>old.id
      and role='owner'
      and active=true
      and archived_at is null;

    if v_other_active_owners=0 then
      raise exception 'The last active Owner cannot be disabled, archived or demoted';
    end if;

    if v_jwt_role<>'service_role' and v_actor_role not in ('owner','super_admin','system_admin') then
      raise exception 'Only an Owner can modify another Owner';
    end if;
  end if;

  if new.role='owner' and old.role is distinct from 'owner'
     and v_jwt_role<>'service_role'
     and v_actor_role not in ('owner','super_admin','system_admin') then
    raise exception 'Only an Owner can assign the Owner role';
  end if;

  return new;
end;
$function$
;
