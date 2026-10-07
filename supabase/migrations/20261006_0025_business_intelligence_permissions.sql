-- MGT Business Suite — Business intelligence permissions

insert into public.permission_catalog(code,section,label,description,sort_order)
values
 ('insights.view','Business Intelligence','View business intelligence','View management insights, forecasts, risks and recommended actions',150)
on conflict(code) do nothing;

insert into public.default_role_permission_templates(role,permission)
values
 ('manager','insights.view'),
 ('accountant','insights.view')
on conflict(role,permission) do nothing;

insert into public.role_permissions(organization_id,role,permission,allowed)
select o.id,x.role,x.permission,true
from public.organizations o
cross join (values
 ('owner','insights.view'),
 ('admin','insights.view'),
 ('manager','insights.view'),
 ('accountant','insights.view')
) as x(role,permission)
on conflict(organization_id,role,permission) do update set allowed=true;
