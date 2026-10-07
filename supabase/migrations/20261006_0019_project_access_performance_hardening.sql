-- MGT Business Suite — Project access and performance hardening

create index if not exists projects_org_idx on public.projects(organization_id);
create index if not exists projects_location_idx on public.projects(location_id);
create index if not exists projects_created_by_idx on public.projects(created_by);

create index if not exists project_members_added_by_idx on public.project_members(added_by);

create index if not exists project_milestones_org_idx on public.project_milestones(organization_id);
create index if not exists project_milestones_created_by_idx on public.project_milestones(created_by);

create index if not exists project_tasks_org_idx on public.project_tasks(organization_id);
create index if not exists project_tasks_created_by_idx on public.project_tasks(created_by);

create index if not exists project_timesheets_org_idx on public.project_timesheets(organization_id);
create index if not exists project_timesheets_reviewed_by_idx on public.project_timesheets(reviewed_by);

create index if not exists project_materials_org_idx on public.project_materials(organization_id);
create index if not exists project_materials_issued_by_idx on public.project_materials(issued_by);
create index if not exists project_materials_reversed_by_idx on public.project_materials(reversed_by);

create index if not exists project_expenses_org_idx on public.project_expenses(organization_id);
create index if not exists project_expenses_location_idx on public.project_expenses(location_id);
create index if not exists project_expenses_recorded_by_idx on public.project_expenses(recorded_by);

create index if not exists project_invoices_org_idx on public.project_invoices(organization_id);
create index if not exists project_invoices_location_idx on public.project_invoices(location_id);
create index if not exists project_invoices_created_by_idx on public.project_invoices(created_by);

create index if not exists project_invoice_lines_org_idx on public.project_invoice_lines(organization_id);

create index if not exists project_events_org_idx on public.project_events(organization_id);

drop policy if exists bank_accounts_org_select on public.bank_accounts;
create policy bank_accounts_org_select on public.bank_accounts
for select to authenticated using(
 public.has_organization_access(organization_id)
 and (
   public.has_permission('finance.view')
   or public.has_permission('payroll.pay')
   or public.has_permission('assets.maintenance')
   or public.has_permission('fleet.manage')
   or public.has_permission('projects.costs')
   or public.has_permission('projects.billing')
 )
);
