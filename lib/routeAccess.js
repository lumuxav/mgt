const ROUTE_PERMISSIONS = [
  ['/settings/documents', 'settings.manage'],
  ['/statements/customers', ['customers.view', 'finance.view', 'documents.view']],
  ['/statements/suppliers', ['suppliers.view', 'finance.view', 'documents.view']],
  ['/quotations', 'documents.view'],
  ['/deliveries', ['fleet.view', 'fleet.manage', 'fleet.dispatch']],
  ['/users', 'users.manage'],
  ['/system-control', ['system.admin']],
  ['/locations', 'locations.manage'],
  ['/catalog', 'catalog.view'],
  ['/inventory', 'inventory.view'],
  ['/pos', 'sales.create'],
  ['/sales', 'sales.view'],
  ['/customers', 'customers.view'],
  ['/suppliers', 'suppliers.view'],
  ['/purchasing', 'purchasing.view'],
  ['/work-orders', ['services.view', 'services.manage']],
  ['/production', 'manufacturing.view'],
  ['/cashbook', 'finance.view'],
  ['/accounting', 'accounting.view'],
  ['/hr', ['attendance.use', 'hr.view', 'hr.manage', 'payroll.view', 'payroll.manage', 'payroll.pay']],
  ['/projects', ['projects.time', 'projects.view', 'projects.manage', 'projects.costs', 'projects.billing']],
  ['/assets', ['assets.view', 'assets.manage', 'assets.maintenance']],
  ['/fleet', ['fleet.view', 'fleet.manage', 'fleet.dispatch']],
  ['/ecommerce', ['ecommerce.view', 'ecommerce.manage', 'ecommerce.orders', 'ecommerce.fulfill']],
  ['/approvals', 'approvals.view'],
  ['/alerts', 'dashboard.view'],
  ['/executive-dashboard', 'reports.view'],
  ['/sales-report', 'reports.view'],
  ['/documents', 'documents.view'],
  ['/payments', ['payments.view', 'payments.request', 'payments.manage']],
  ['/migration-center', 'migration.view'],
  ['/integrations', 'integrations.view'],
  ['/insights', 'insights.view'],
]

export function hasRoutePermission(pathname, permissions, role) {
  if (pathname === '/system-control') return ['super_admin', 'system_admin'].includes(role)
  const required = ROUTE_PERMISSIONS.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'))?.[1]
  if (!required) return true
  return (Array.isArray(required) ? required : [required]).some(permission => permissions.includes(permission))
}
