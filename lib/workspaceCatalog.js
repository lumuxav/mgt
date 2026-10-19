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
  { key:'cashier',label:'Cashier',description:'Checkout, receipts, till activity and customers',permissions:['dashboard.view','catalog.view','inventory.view','sales.create','sales.view','customers.view','payments.request','payments.view','documents.view','attendance.use','leave.request'] },
  { key:'salesperson',label:'Salesperson / Seller',description:'POS checkout, stock availability, quotations and customer orders',permissions:['dashboard.view','catalog.view','inventory.view','sales.view','sales.create','customers.view','customers.manage','documents.view','payments.request','attendance.use','leave.request'] },
  { key:'storekeeper',label:'Storekeeper',description:'Receipts, stock counts, transfers and procurement',permissions:['dashboard.view','inventory.view','inventory.transfer','inventory.stocktake','purchasing.view','purchasing.receive','catalog.view','suppliers.view','attendance.use','leave.request'] },
  { key:'procurement_officer',label:'Procurement Officer',description:'Suppliers, purchase requests and receiving',permissions:['dashboard.view','suppliers.view','suppliers.manage','purchasing.view','purchasing.create','purchasing.receive','catalog.view','inventory.view','attendance.use'] },
  { key:'accountant',label:'Accountant',description:'Finance, accounting, collections and reporting',permissions:['dashboard.view','accounting.view','accounting.manage','finance.view','finance.manage','payments.view','purchasing.view','sales.view','reports.view','attendance.use'] },
  { key:'hr_officer',label:'HR Officer',description:'People records, attendance, leave and payroll',permissions:['dashboard.view','hr.view','hr.manage','attendance.use','attendance.manage','leave.request','leave.manage','payroll.view','payroll.manage'] },
  { key:'production_staff',label:'Production Worker',description:'Production progress and assigned manufacturing duties',permissions:['dashboard.view','manufacturing.view','manufacturing.production','inventory.view','catalog.view','assets.view','attendance.use'] },
  { key:'technician',label:'Technician / Service Worker',description:'Assigned service orders, job progress and personal time',permissions:['dashboard.view','services.assigned','projects.time','attendance.use','leave.request'] },
  { key:'delivery_driver',label:'Delivery Driver',description:'Assigned trips, progress, recipient evidence and delivery status',permissions:['dashboard.view','workspace.tasks','fleet.assigned','attendance.use','leave.request'] },
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

/**
 * Operational guidance only: the database's current_permissions, module checks,
 * RLS and transaction RPCs remain the sole authorization authorities.
 * An owner may deliberately customize a role; never auto-grant these rights.
 */
export const JOB_ROLE_KEYS = [
  'owner','admin','manager','branch_manager','cashier','salesperson',
  'storekeeper','procurement_officer','accountant','hr_officer',
  'production_staff','technician','delivery_driver','project_worker','employee',
]

const leadership = ['owner','admin','manager']
const supervisors = [...leadership,'branch_manager']
const counterStaff = [...supervisors,'cashier','salesperson']
const stockStaff = [...supervisors,'storekeeper','procurement_officer']
const peopleStaff = [...leadership,'hr_officer']
const operationsStaff = [...supervisors,'production_staff']
const financeStaff = [...leadership,'accountant']
const deliveryStaff = [...leadership,'delivery_driver']
const projectStaff = [...leadership,'project_worker','technician']
const allStaff = JOB_ROLE_KEYS

// Each entry corresponds to an existing screen and an actual permission check.
// These are work-entry instructions, not new grants, bypasses or new vertical modules.
// Worker action availability remains determined by current_permissions + module state,
// and the underlying RPC/RLS checks every mutation again.
export const JOB_WORKFLOWS = [
  {roleKeys:allStaff,label:'View my work',module:'dashboard',href:'/my-work',permissions:['workspace.tasks'],detail:'Your tasks, assigned jobs and work shortcuts'},
  {roleKeys:allStaff,label:'Clock in / request leave',module:'hr',href:'/hr',permissions:['attendance.use'],detail:'Attendance is available only when HR is enabled; leave requires leave.request'},
  {roleKeys:counterStaff,label:'Make a sale',module:'pos',href:'/pos',permissions:['sales.create','catalog.view'],detail:'Choose products, confirm quantities, take payment and issue a receipt; cash requires an open till'},
  {roleKeys:counterStaff,label:'Check stock availability',module:'inventory',href:'/inventory',permissions:['inventory.view'],detail:'Read stock balances without adjusting quantities'},
  {roleKeys:counterStaff,label:'Sales records and receipts',module:'sales',href:'/sales',permissions:['sales.view'],detail:'Sales and customer balances allowed by record scope'},
  {roleKeys:[...counterStaff,'storekeeper'],label:'View product catalog',module:'inventory',href:'/catalog',permissions:['catalog.view'],detail:'Product details without editing products'},
  {roleKeys:counterStaff,label:'Customer records',module:'customers',href:'/customers',permissions:['customers.view'],detail:'View customers; editing requires customers.manage'},
  {roleKeys:stockStaff,label:'Stocktaking',module:'inventory',href:'/inventory',permissions:['inventory.view','inventory.stocktake'],detail:'Count and record inventory according to branch controls'},
  {roleKeys:stockStaff,label:'Transfer stock',module:'inventory',href:'/inventory',permissions:['inventory.view','inventory.transfer'],detail:'Move stock with authorized inventory transactions'},
  {roleKeys:stockStaff,label:'Receive purchases',module:'purchasing',href:'/purchasing',permissions:['purchasing.view','purchasing.receive'],detail:'Receive purchased goods; supplier payment and approval are separate'},
  {roleKeys:[...stockStaff,'cashier'],label:'Request a purchase',module:'purchasing',href:'/purchasing',permissions:['purchasing.view','purchasing.create'],detail:'Create purchase orders; separate approval may be needed'},
  {roleKeys:stockStaff,label:'Supplier information',module:'suppliers',href:'/suppliers',permissions:['suppliers.view'],detail:'Supplier details; changes require suppliers.manage'},
  {roleKeys:financeStaff,label:'Cash and bank records',module:'finance',href:'/cashbook',permissions:['finance.view'],detail:'View authorized financial activity; posting requires finance.manage'},
  {roleKeys:financeStaff,label:'Journal and reconciliation',module:'finance',href:'/accounting',permissions:['accounting.view'],detail:'View accounts; changes require accounting.manage'},
  {roleKeys:financeStaff,label:'Manage accounting entries',module:'finance',href:'/accounting',permissions:['accounting.view','accounting.manage'],detail:'Post authorized entries; close and reversal rights remain separate'},
  {roleKeys:financeStaff,label:'Financial reports',module:'reports',href:'/sales-report',permissions:['reports.view'],detail:'View permitted business performance and sales summaries'},
  {roleKeys:peopleStaff,label:'Staff records',module:'hr',href:'/hr',permissions:['hr.view','hr.manage'],detail:'Maintain staff information and authorized HR activity'},
  {roleKeys:peopleStaff,label:'Attendance and leave management',module:'hr',href:'/hr',permissions:['attendance.manage','leave.manage'],detail:'Oversee shifts and leave; payroll is separately protected'},
  {roleKeys:peopleStaff,label:'Payroll records',module:'hr',href:'/hr',permissions:['payroll.view'],detail:'View payroll; changing and paying salaries require separate rights'},
  {roleKeys:operationsStaff,label:'Production orders',module:'manufacturing',href:'/production',permissions:['manufacturing.view','manufacturing.production'],detail:'Record material use and output through protected production transactions'},
  {roleKeys:operationsStaff,label:'Production stock',module:'inventory',href:'/inventory',permissions:['inventory.view'],detail:'Monitor raw materials and finished goods'},
  {roleKeys:[...operationsStaff,'technician'],label:'Equipment maintenance',module:'assets',href:'/assets',permissions:['assets.maintenance'],detail:'Perform authorized maintenance tasks'},
  {roleKeys:[...projectStaff,'employee'],label:'My project tasks and progress',module:'projects',href:'/my-work',permissions:['projects.time'],detail:'Update assigned tasks or submit work time; project finances remain restricted',requiresAssignment:true},
  {roleKeys:[...projectStaff,'employee','production_staff'],label:'My service jobs',module:'services',href:'/my-work',permissions:['services.assigned'],detail:'Progress and hold notes on assigned service orders only',requiresAssignment:true},
  {roleKeys:[...leadership,'technician'],label:'Service order management',module:'services',href:'/work-orders',permissions:['services.view'],detail:'Authorized service orders and customer records'},
  {roleKeys:deliveryStaff,label:'My assigned deliveries',module:'fleet',href:'/my-work',permissions:['fleet.assigned'],detail:'Status updates, recipient confirmation and failure evidence only for assigned trips',requiresAssignment:true},
  {roleKeys:supervisors,label:'Dispatch and fleet operations',module:'fleet',href:'/fleet',permissions:['fleet.dispatch'],detail:'Schedule or dispatch deliveries with manager-level rights'},
  {roleKeys:supervisors,label:'Operational approvals',module:'alerts',href:'/approvals',permissions:['approvals.view'],detail:'View requests; approving them requires approvals.manage'},
  {roleKeys:supervisors,label:'Branch performance',module:'reports',href:'/sales-report',permissions:['reports.view'],detail:'Review permitted sales and operations within your scope'},
  {roleKeys:leadership,label:'Configure modules and branches',module:'dashboard',href:'/setup',permissions:['settings.manage'],detail:'Choose business modules and locations; no staff can enable their own access'},
  {roleKeys:['owner','admin'],label:'Assign staff and roles',module:'dashboard',href:'/users',permissions:['users.manage'],detail:'Invite staff, assign roles and review access; only privileged users may edit job grants'},
]

// Includes duties associated with the selected role(s), plus any fully authorized
// duty from an extra/custom role. Showing a link here never changes server access.
export function jobWorkflowReadiness(roleKeys, grantedPermissions, enabledModules) {
  const roles = new Set(roleKeys || [])
  const granted = new Set(grantedPermissions || [])
  const enabled = new Set(enabledModules || [])
  return JOB_WORKFLOWS.filter(flow =>
    flow.roleKeys.some(role => roles.has(role)) ||
    (flow.permissions.length && flow.permissions.every(permission => granted.has(permission)))
  ).map(flow => {
    const missingPermissions = flow.permissions.filter(permission => !granted.has(permission))
    const moduleEnabled = enabled.has(flow.module)
    return {
      ...flow,
      missingPermissions,
      missingModule: !moduleEnabled,
      ready: moduleEnabled && missingPermissions.length === 0,
    }
  })
}


// Universal, business-neutral work-module prerequisites.
// These are suggestions for an explicit OWNER action, never implicit grants.
// No business is forced to activate a module simply because a role exists.
export const ROLE_MODULE_REQUIREMENTS = {
  employee: [],
  cashier: ['pos','inventory'],
  salesperson: ['pos','inventory','sales'],
  storekeeper: ['inventory','purchasing'],
  procurement_officer: ['purchasing','suppliers','inventory'],
  accountant: ['finance','reports'],
  hr_officer: ['hr'],
  production_staff: ['manufacturing','inventory'],
  technician: ['services'],
  delivery_driver: ['fleet'],
  project_worker: ['projects'],
  branch_manager: ['sales','pos','inventory','purchasing'],
  manager: [],
  admin: [],
  owner: [],
}

// Custom roles are supported through their actual saved permission grants.
// These suggestions do not infer authorization and are never used by RLS.
const CUSTOM_ROLE_MODULE_HINTS = [
  ['sales.create','pos'],
  ['catalog.view','inventory'],
  ['inventory.view','inventory'],
  ['inventory.transfer','inventory'],
  ['purchasing.create','purchasing'],
  ['purchasing.receive','purchasing'],
  ['suppliers.view','suppliers'],
  ['accounting.view','finance'],
  ['finance.view','finance'],
  ['hr.view','hr'],
  ['payroll.view','hr'],
  ['manufacturing.production','manufacturing'],
  ['services.assigned','services'],
  ['projects.time','projects'],
  ['fleet.assigned','fleet'],
  ['ecommerce.orders','ecommerce'],
]

// Exact role names are suggestions only: changing these maps does not change
// saved organization role grants, users, transactions, or module configuration.
export function missingWorkModules(roleKeys, enabledModules = [], savedGrants = []) {
  const roleNames = [...new Set(roleKeys || [])]
  const isKnownRole = roleNames.some(role => Object.prototype.hasOwnProperty.call(ROLE_MODULE_REQUIREMENTS,role))
  const desired = new Set(roleNames.flatMap(role => ROLE_MODULE_REQUIREMENTS[role] || []))
  if (!isKnownRole && roleNames.length > 0) {
    const grants = new Set(savedGrants || [])
    for (const [permission,module] of CUSTOM_ROLE_MODULE_HINTS) {
      if (grants.has(permission)) desired.add(module)
    }
  }
  const enabled = new Set(enabledModules || [])
  return [...desired].filter(module => !enabled.has(module))
}
