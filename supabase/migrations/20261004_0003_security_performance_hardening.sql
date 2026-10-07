-- MGT Business Suite — Security and performance hardening

-- Explicitly remove anonymous execution from every privileged/helper function.
revoke execute on function public.current_organization_id() from anon;
revoke execute on function public.current_user_role() from anon;
revoke execute on function public.has_organization_access(uuid) from anon;
revoke execute on function public.has_permission(text) from anon;
revoke execute on function public.bootstrap_organization(text,text,text,text,text,text,text,text) from anon;
revoke execute on function public.adjust_stock(uuid,uuid,numeric,text,text) from anon;
revoke execute on function public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text) from anon;
revoke execute on function public.receive_purchase(uuid,uuid,jsonb,numeric,text,text) from anon;

-- Keep only the functions the signed-in client is intentionally allowed to call.
grant execute on function public.bootstrap_organization(text,text,text,text,text,text,text,text) to authenticated;
grant execute on function public.adjust_stock(uuid,uuid,numeric,text,text) to authenticated;
grant execute on function public.post_sale(uuid,uuid,jsonb,numeric,text,numeric,numeric,text,text) to authenticated;
grant execute on function public.receive_purchase(uuid,uuid,jsonb,numeric,text,text) to authenticated;
grant execute on function public.current_organization_id() to authenticated;
grant execute on function public.current_user_role() to authenticated;
grant execute on function public.has_organization_access(uuid) to authenticated;
grant execute on function public.has_permission(text) to authenticated;

-- Optimize users SELECT RLS init-plan behavior and remove overlapping SELECT policy evaluation.
drop policy if exists users_admin_write on public.users;
drop policy if exists users_org_select on public.users;

create policy users_org_select on public.users
for select to authenticated
using (
  public.has_organization_access(organization_id)
  or id = (select auth.uid())
);

create policy users_admin_insert on public.users
for insert to authenticated
with check (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
);

create policy users_admin_update on public.users
for update to authenticated
using (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
)
with check (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
);

create policy users_admin_delete on public.users
for delete to authenticated
using (
  public.has_organization_access(organization_id)
  and public.current_user_role() in ('owner','admin','super_admin','system_admin')
);

-- Cover foreign keys that will be used by joins, deletes, audit/history, and reporting.
create index if not exists audit_log_location_id_idx on public.audit_log(location_id);
create index if not exists audit_log_user_id_idx on public.audit_log(user_id);
create index if not exists bank_accounts_organization_id_idx on public.bank_accounts(organization_id);
create index if not exists banking_transactions_bank_account_id_idx on public.banking_transactions(bank_account_id);
create index if not exists banking_transactions_location_id_idx on public.banking_transactions(location_id);
create index if not exists banking_transactions_recorded_by_idx on public.banking_transactions(recorded_by);
create index if not exists bom_items_bom_id_idx on public.bom_items(bom_id);
create index if not exists bom_items_product_id_idx on public.bom_items(product_id);
create index if not exists boms_organization_id_idx on public.boms(organization_id);
create index if not exists boms_output_product_id_idx on public.boms(output_product_id);
create index if not exists expenses_recorded_by_idx on public.expenses(recorded_by);
create index if not exists payments_location_id_idx on public.payments(location_id);
create index if not exists payments_received_by_idx on public.payments(received_by);
create index if not exists production_orders_bom_id_idx on public.production_orders(bom_id);
create index if not exists production_orders_created_by_idx on public.production_orders(created_by);
create index if not exists production_orders_location_id_idx on public.production_orders(location_id);
create index if not exists production_orders_output_product_id_idx on public.production_orders(output_product_id);
create index if not exists purchases_created_by_idx on public.purchases(created_by);
create index if not exists purchases_location_id_idx on public.purchases(location_id);
create index if not exists sales_sold_by_idx on public.sales(sold_by);
create index if not exists stock_movements_recorded_by_idx on public.stock_movements(recorded_by);
create index if not exists work_orders_assigned_to_idx on public.work_orders(assigned_to);
create index if not exists work_orders_created_by_idx on public.work_orders(created_by);
create index if not exists work_orders_customer_id_idx on public.work_orders(customer_id);
create index if not exists work_orders_location_id_idx on public.work_orders(location_id);
