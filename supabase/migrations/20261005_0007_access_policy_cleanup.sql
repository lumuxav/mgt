-- MGT Business Suite — Access policy performance cleanup

create index if not exists staff_invitations_default_location_id_idx on public.staff_invitations(default_location_id);
create index if not exists staff_invitations_invited_by_idx on public.staff_invitations(invited_by);

drop policy if exists organization_modules_org_write on public.organization_modules;
create policy organization_modules_org_insert on public.organization_modules
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('settings.manage'));
create policy organization_modules_org_update on public.organization_modules
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('settings.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('settings.manage'));
create policy organization_modules_org_delete on public.organization_modules
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('settings.manage'));

drop policy if exists categories_org_write on public.categories;
create policy categories_org_insert on public.categories
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));
create policy categories_org_update on public.categories
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));
create policy categories_org_delete on public.categories
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));

drop policy if exists products_org_write on public.products;
create policy products_org_insert on public.products
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));
create policy products_org_update on public.products
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));
create policy products_org_delete on public.products
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('catalog.manage'));

drop policy if exists customers_org_write on public.customers;
create policy customers_org_insert on public.customers
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('customers.manage'));
create policy customers_org_update on public.customers
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('customers.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('customers.manage'));
create policy customers_org_delete on public.customers
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('customers.manage'));

drop policy if exists suppliers_org_write on public.suppliers;
create policy suppliers_org_insert on public.suppliers
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('suppliers.manage'));
create policy suppliers_org_update on public.suppliers
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('suppliers.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('suppliers.manage'));
create policy suppliers_org_delete on public.suppliers
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('suppliers.manage'));

drop policy if exists payments_org_write on public.payments;
create policy payments_org_insert on public.payments
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy payments_org_update on public.payments
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy payments_org_delete on public.payments
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));

drop policy if exists expenses_org_write on public.expenses;
create policy expenses_org_insert on public.expenses
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy expenses_org_update on public.expenses
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy expenses_org_delete on public.expenses
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));

drop policy if exists bank_accounts_org_write on public.bank_accounts;
create policy bank_accounts_org_insert on public.bank_accounts
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy bank_accounts_org_update on public.bank_accounts
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy bank_accounts_org_delete on public.bank_accounts
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));

drop policy if exists banking_transactions_org_write on public.banking_transactions;
create policy banking_transactions_org_insert on public.banking_transactions
for insert to authenticated with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy banking_transactions_org_update on public.banking_transactions
for update to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'))
with check (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
create policy banking_transactions_org_delete on public.banking_transactions
for delete to authenticated using (public.has_organization_access(organization_id) and public.has_permission('finance.manage'));
