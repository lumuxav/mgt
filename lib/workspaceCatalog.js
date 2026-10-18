// Shared, dependency-free MGT module taxonomy and business role suggestions.
// Role templates are optional defaults; saved owner-customized grants always win.
export const MODULE_CATEGORIES = [
  { id:'administration', name:'Business Administration', modules:['dashboard','alerts'] },
  { id:'sales', name:'Sales & Customers', modules:['pos','sales','customers','documents'] },
  { id:'stock', name:'Inventory & Procurement', modules:['inventory','suppliers','purchasing'] },
  { id:'finance', name:'Finance & Accounting', modules:['finance','payments','reports','insights'] },
  { id:'people', name:'People & HR', modules:['hr'] },
  { id:'operations', name:'Production & Operations', modules:['manufacturing','assets'] },
  { id:'projects', name:'Services & Projects', modules:['services','projects'] },
  { id:'logistics', name:'Logistics & Delivery', modules:['fleet'] },
  { id:'commerce', name:'Commerce & Integrations', modules:['ecommerce','integrations'] },
]

export const INDUSTRY_PRESETS = [
  { id:'retail',label:'Retail and supermarkets', type:'retail',modules:['pos','inventory','sales','customers','suppliers','purchasing','payments'] },
  { id:'wholesale',label:'Wholesale and distribution',type:'wholesale',modules:['inventory','sales','customers','suppliers','purchasing','fleet','payments'] },
  { id:'manufacturing',label:'Manufacturing',type:'manufacturing',modules:['inventory','manufacturing','purchasing','suppliers','assets','hr','sales','payments'] },
  { id:'services',label:'Repairs and field services',type:'services',modules:['services','projects','inventory','customers','sales','hr','payments'] },
  { id:'construction',label:'Construction and projects',type:'hybrid',modules:['projects','purchasing','inventory','assets','hr','services','fleet','payments'] },
  { id:'restaurant',label:'Restaurants and cafés',type:'retail',modules:['pos','inventory','sales','purchasing','hr','customers','payments'] },
  { id:'hotel',label:'Hotels and accommodation',type:'services',modules:['services','projects','customers','assets','hr','payments','sales'] },
  { id:'logistics',label:'Transport and delivery',type:'hybrid',modules:['fleet','assets','services','projects','hr','sales','payments'] },
  { id:'agriculture',label:'Agriculture and farm operations',type:'manufacturing',modules:['manufacturing','inventory','purchasing','assets','hr','sales'] },
  { id:'consulting',label:'Professional services',type:'services',modules:['services','projects','customers','sales','hr','payments'] },
]
export const ROLE_TEMPLATES = [
  { key:'employee',label:'General Employee',description:'Personal work, attendance, leave and assigned tasks',permissions:['dashboard.view','attendance.use','leave.request','projects.time','services.assigned'] },
  { key:'cashier',label:'Cashier',description:'Checkout, receipts, till activity and customers',permissions:['dashboard.view','catalog.view','sales.create','sales.view','customers.view','payments.request','payments.view','documents.view','attendance.use','leave.request'] },
  { key:'salesperson',label:'Salesperson',description:'Quotations, customer management and orders',permissions:['dashboard.view','catalog.view','sales.view','sales.create','customers.view','customers.manage','documents.view','payments.request','attendance.use','leave.request'] },
  { key:'storekeeper',label:'Storekeeper',description:'Receipts, stock counts, transfers and procurement',permissions:['dashboard.view','inventory.view','inventory.transfer','inventory.stocktake','purchasing.view','purchasing.receive','catalog.view','suppliers.view','attendance.use','leave.request'] },
  { key:'procurement_officer',label:'Procurement Officer',description:'Suppliers, purchase requests and receiving',permissions:['dashboard.view','suppliers.view','suppliers.manage','purchasing.view','purchasing.create','purchasing.receive','catalog.view','inventory.view','attendance.use'] },
  { key:'accountant',label:'Accountant',description:'Finance, accounting, collections and reporting',permissions:['dashboard.view','accounting.view','accounting.manage','finance.view','finance.manage','payments.view','purchasing.view','sales.view','reports.view','attendance.use'] },
  { key:'hr_officer',label:'HR Officer',description:'People records, attendance, leave and payroll',permissions:['dashboard.view','hr.view','hr.manage','attendance.use','attendance.manage','leave.request','leave.manage','payroll.view','payroll.manage'] },
  { key:'production_staff',label:'Production Worker',description:'Production progress and assigned manufacturing duties',permissions:['dashboard.view','manufacturing.view','manufacturing.production','inventory.view','catalog.view','assets.view','attendance.use'] },
  { key:'technician',label:'Technician / Service Worker',description:'Assigned service orders, job progress and personal time',permissions:['dashboard.view','services.assigned','projects.time','attendance.use','leave.request'] },
  { key:'delivery_driver',label:'Delivery Driver',description:'Assigned dispatch work and delivery status',permissions:['dashboard.view','fleet.assigned','attendance.use','leave.request'] },
  { key:'project_worker',label:'Project Worker',description:'Assigned tasks, progress and timesheets',permissions:['dashboard.view','projects.time','attendance.use','leave.request'] },
  { key:'branch_manager',label:'Branch Manager',description:'Operational oversight of an assigned branch',permissions:['dashboard.view','sales.view','sales.create','catalog.view','inventory.view','purchasing.view','purchasing.receive','customers.view','customers.manage','suppliers.view','reports.view','finance.view','attendance.manage','approvals.view','services.view'] },
]
export const modulePermissionMap = {
  dashboard:['dashboard.view'],
  pos:['sales.create'], sales:['sales.view','sales.create'],inventory:['inventory.view','inventory.adjust','inventory.transfer','inventory.stocktake','catalog.view','catalog.manage'],
  customers:['customers.view','customers.manage'],suppliers:['suppliers.view','suppliers.manage'],purchasing:['purchasing.view','purchasing.create','purchasing.receive','purchasing.approve'],
  finance:['finance.view','finance.manage','accounting.view','accounting.manage'],reports:['reports.view'],documents:['documents.view','documents.manage'],alerts:['approvals.view','dashboard.view'],
  hr:['attendance.use','hr.view','leave.request','payroll.view'],projects:['projects.view','projects.time'],services:['services.view','services.manage','services.assigned'],
  manufacturing:['manufacturing.view','manufacturing.production'],assets:['assets.view','assets.maintenance'],fleet:['fleet.view','fleet.dispatch','fleet.assigned'],
  ecommerce:['ecommerce.view','ecommerce.orders'],payments:['payments.view','payments.request'],integrations:['integrations.view'],insights:['insights.view'],
}
export function visibleModulesForRole(enabledModules, grants) {
  const granted=new Set(grants||[])
  return (enabledModules||[]).filter(key=>(modulePermissionMap[key]||[]).some(p=>granted.has(p)))
}
export function suggestedModuleWarnings(enabledModules, roleGrants) {
  const active=new Set(enabledModules||[])
  const allowed=new Set(roleGrants||[])
  return ROLE_TEMPLATES.filter(t=>t.permissions.some(p=>allowed.has(p))).flatMap(t=>
    t.permissions.filter(p=>allowed.has(p)&&Object.entries(modulePermissionMap).some(([key,codes])=>codes.includes(p)&&!active.has(key)))
  )
}
