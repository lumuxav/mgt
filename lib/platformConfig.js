export const PLATFORM_NAME = 'MGT Business Suite'
export const PLATFORM_SHORT_NAME = 'MGT'
export const PLATFORM_CONFIG_KEY = 'mgt-business-config'
export const PLATFORM_CONFIG_EVENT = 'mgt-business-config-change'

export const MODULE_CATALOG = [
  { id: 'dashboard', label: 'Dashboard', description: 'Business overview, KPIs and quick actions', core: true },
  { id: 'pos', label: 'Point of Sale', description: 'Fast retail checkout and receipts' },
  { id: 'inventory', label: 'Inventory', description: 'Products, stock, receiving, stocktake and transfers' },
  { id: 'sales', label: 'Sales & Invoicing', description: 'Sales, quotations, invoices, returns and credit' },
  { id: 'customers', label: 'Customers & CRM', description: 'Customers, balances, history and follow-ups' },
  { id: 'suppliers', label: 'Suppliers', description: 'Supplier records, balances and purchase history' },
  { id: 'purchasing', label: 'Purchasing', description: 'Purchase orders, receiving and supplier invoices' },
  { id: 'services', label: 'Services & Work Orders', description: 'Service jobs, labour, appointments and work orders' },
  { id: 'manufacturing', label: 'Manufacturing', description: 'BOMs, production, material use, output and wastage' },
  { id: 'finance', label: 'Cash & Finance', description: 'Cash book, expenses, banking and account balances', core: true },
  { id: 'reports', label: 'Reports & Analytics', description: 'Operational, financial and management reports', core: true },
  { id: 'documents', label: 'Business Documents', description: 'Quotations, invoices, receipts, orders, statements and printable records', core: true },
  { id: 'alerts', label: 'Alerts & Approvals', description: 'Exceptions, approvals and management attention', core: true },
  { id: 'hr', label: 'HR & Staff', description: 'Employees, attendance, leave, payroll and commissions' },
  { id: 'projects', label: 'Projects', description: 'Projects, tasks, budgets, milestones and timesheets' },
  { id: 'assets', label: 'Assets & Maintenance', description: 'Equipment, machines, vehicles and maintenance' },
  { id: 'fleet', label: 'Fleet & Delivery', description: 'Drivers, vehicles, dispatch and delivery tracking' },
  { id: 'ecommerce', label: 'E-commerce', description: 'Online catalog, orders and synchronized stock' },
  { id: 'payments', label: 'External Payments', description: 'MTN MoMo, Airtel Money, gateways and payment reconciliation' },
  { id: 'integrations', label: 'Integrations & Data Exchange', description: 'API access, webhooks, imports and exports for connected systems' },
  { id: 'insights', label: 'MGT Intelligence', description: 'Management insights, forecasts, risks and recommended actions', core: true },
]

const CORE = ['dashboard', 'finance', 'reports', 'documents', 'alerts', 'insights']

export const BUSINESS_TEMPLATES = {
  retail: {
    label: 'Retail',
    description: 'Shops, supermarkets, boutiques, pharmacies and counter sales',
    modules: [...CORE, 'pos', 'inventory', 'sales', 'customers', 'suppliers', 'purchasing', 'payments'],
  },
  wholesale: {
    label: 'Wholesale & Distribution',
    description: 'Bulk sales, price tiers, customer credit, suppliers and delivery operations',
    modules: [...CORE, 'inventory', 'sales', 'customers', 'suppliers', 'purchasing', 'fleet', 'payments'],
  },
  manufacturing: {
    label: 'Industrial / Manufacturing',
    description: 'Raw materials, production, finished goods, procurement and sales',
    modules: [...CORE, 'inventory', 'sales', 'customers', 'suppliers', 'purchasing', 'manufacturing', 'assets', 'payments'],
  },
  services: {
    label: 'Services',
    description: 'Professional services, workshops, salons, repair businesses and contractors',
    modules: [...CORE, 'sales', 'customers', 'services', 'suppliers', 'projects', 'payments'],
  },
  hybrid: {
    label: 'Hybrid / Custom',
    description: 'Mix retail, wholesale, manufacturing and services in one business',
    modules: [...CORE, 'pos', 'inventory', 'sales', 'customers', 'suppliers', 'purchasing', 'services', 'manufacturing', 'hr', 'projects', 'assets', 'fleet', 'ecommerce', 'payments', 'integrations'],
  },
}

export const LOCATION_TYPES = [
  { id: 'branch', label: 'Branch' },
  { id: 'store', label: 'Store / Shop' },
  { id: 'warehouse', label: 'Warehouse' },
  { id: 'factory', label: 'Factory' },
  { id: 'outlet', label: 'Outlet' },
  { id: 'office', label: 'Office' },
]

export const CURRENCIES = [
  { code: 'UGX', label: 'Ugandan Shilling (UGX)' },
  { code: 'KES', label: 'Kenyan Shilling (KES)' },
  { code: 'TZS', label: 'Tanzanian Shilling (TZS)' },
  { code: 'RWF', label: 'Rwandan Franc (RWF)' },
  { code: 'USD', label: 'US Dollar (USD)' },
  { code: 'EUR', label: 'Euro (EUR)' },
  { code: 'GBP', label: 'British Pound (GBP)' },
]

export const DEFAULT_BUSINESS_CONFIG = {
  setupComplete: false,
  businessName: 'My Business',
  shortName: 'MB',
  legalName: '',
  businessType: 'hybrid',
  country: 'Uganda',
  currency: 'UGX',
  timezone: 'Africa/Kampala',
  defaultLocationId: 'main',
  locations: [
    { id: 'main', name: 'Main Location', type: 'branch', active: true },
  ],
  enabledModules: BUSINESS_TEMPLATES.hybrid.modules,
  terminology: {
    customer: 'Customer',
    supplier: 'Supplier',
    product: 'Product',
    location: 'Location',
  },
}

const uniq = (values = []) => [...new Set(values)]

export function normalizeBusinessConfig(input = {}) {
  const merged = {
    ...DEFAULT_BUSINESS_CONFIG,
    ...input,
    locations: Array.isArray(input.locations) && input.locations.length
      ? input.locations
      : DEFAULT_BUSINESS_CONFIG.locations,
    terminology: {
      ...DEFAULT_BUSINESS_CONFIG.terminology,
      ...(input.terminology || {}),
    },
  }

  const template = BUSINESS_TEMPLATES[merged.businessType] || BUSINESS_TEMPLATES.hybrid
  merged.enabledModules = uniq([
    ...CORE,
    ...(Array.isArray(input.enabledModules) ? input.enabledModules : template.modules),
  ])
  return merged
}

export function getBusinessConfig() {
  if (typeof window === 'undefined') return normalizeBusinessConfig()
  try {
    const stored = JSON.parse(window.localStorage.getItem(PLATFORM_CONFIG_KEY) || '{}')
    return normalizeBusinessConfig(stored)
  } catch {
    return normalizeBusinessConfig()
  }
}

export function saveBusinessConfig(config) {
  if (typeof window === 'undefined') return normalizeBusinessConfig(config)
  const normalized = normalizeBusinessConfig(config)
  window.localStorage.setItem(PLATFORM_CONFIG_KEY, JSON.stringify(normalized))
  window.dispatchEvent(new CustomEvent(PLATFORM_CONFIG_EVENT, { detail: normalized }))
  return normalized
}

export function templateConfig(type, current = {}) {
  const template = BUSINESS_TEMPLATES[type] || BUSINESS_TEMPLATES.hybrid
  return normalizeBusinessConfig({
    ...current,
    businessType: type,
    enabledModules: template.modules,
  })
}

export function moduleEnabled(config, moduleId) {
  if (!moduleId) return true
  return (config?.enabledModules || []).includes(moduleId)
}

export function getDefaultLocation(config) {
  const locations = config?.locations || []
  return locations.find((item) => item.id === config?.defaultLocationId)
    || locations.find((item) => item.active !== false)
    || DEFAULT_BUSINESS_CONFIG.locations[0]
}


export const ROUTE_MODULES = [
  ['/statements/customers', 'documents'],
  ['/statements/suppliers', 'documents'],
  ['/quotations', 'documents'],
  ['/deliveries', 'fleet'],
  ['/settings/documents', 'documents'],
  ['/executive-dashboard', 'reports'],
  ['/sales-report', 'reports'],
  ['/notifications', 'alerts'],
  ['/approvals', 'alerts'],
  ['/alerts', 'alerts'],
  ['/documents', 'documents'],
  ['/accounting', 'finance'],
  ['/cashbook', 'finance'],
  ['/payments', 'payments'],
  ['/migration-center', 'integrations'],
  ['/integrations', 'integrations'],
  ['/insights', 'insights'],
  ['/ecommerce', 'ecommerce'],
  ['/fleet', 'fleet'],
  ['/assets', 'assets'],
  ['/projects', 'projects'],
  ['/hr', 'hr'],
  ['/production', 'manufacturing'],
  ['/work-orders', 'services'],
  ['/purchasing', 'purchasing'],
  ['/suppliers', 'suppliers'],
  ['/customers', 'customers'],
  ['/sales', 'sales'],
  ['/pos', 'pos'],
  ['/inventory', 'inventory'],
  ['/catalog', 'inventory'],
]

export function moduleForPath(pathname = '') {
  return ROUTE_MODULES.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix + '/'))?.[1] || null
}

