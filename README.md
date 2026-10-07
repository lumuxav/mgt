# MGT Business Suite

MGT Business Suite is a configurable business-management platform for retail, wholesale, distribution, services, manufacturing and hybrid businesses.

The active development branch is `universal-business-platform`, which is also the repository default branch.

## Architecture

```text
Web / PWA / Android / iOS
          ↓
       Next.js
          ↓
        Vercel
          ↓
 Supabase Auth + PostgreSQL
          ↓
Organization + Location isolation
```

MGT uses dedicated application infrastructure:

- Supabase project: Universal MGT
- Vercel project: MGT
- Android package: `com.mgt.businesssuite`
- Independent PWA/native identity
- Independent application secrets and release credentials

## Core capabilities

- configurable business identity, currency, timezone and locations
- database-backed module configuration
- staff invitations, roles and granular permissions
- products and services catalog
- barcode/SKU lookup and camera scanning
- inventory by location, adjustments, transfers and stocktakes
- POS, cash/credit sales, partial payments and returns
- customer credit and statements
- suppliers, purchase orders, receiving and payables
- cashbook, expenses, bank accounts and banking transactions
- double-entry accounting, General Ledger, Trial Balance, P&L and Balance Sheet
- AR/AP ageing, tax/VAT settings and accounting periods
- approvals and alerts
- BOMs and production orders
- service/work orders and job costing
- HR, attendance, leave, commissions and payroll
- assets, maintenance, fleet and deliveries
- project costing, tasks, timesheets, materials and invoicing
- business documents and quotations
- public e-commerce storefronts
- external payments and reconciliation
- notifications and email-delivery queue
- integrations, API keys and signed webhooks
- Migration Center with opening stock/balance tools
- executive dashboard, advanced reports and MGT Intelligence
- installable PWA and Android/iOS native packaging workflows

## Business modules

Organizations can enable only the modules they need:

- Dashboard
- POS
- Inventory
- Sales
- Customers
- Suppliers
- Purchasing
- Services / Work Orders
- Manufacturing
- Finance
- Reports
- Documents
- Alerts / Approvals
- HR
- Projects
- Assets
- Fleet
- E-commerce
- External Payments
- Integrations
- MGT Intelligence

Navigation and protected routes require both the module to be enabled and the signed-in staff member to have appropriate permission.

## Business setup

`/onboarding` creates the first business owner.

`/setup` configures:

1. business identity and type
2. country, currency and timezone
3. business locations
4. enabled modules
5. default workspace

Configuration is stored centrally in Supabase and follows the business across devices.

## Universal database

Every business transaction is scoped by `organization_id`, and location-aware records use `location_id`.

Primary entities include:

- organizations
- locations
- users
- organization_modules
- roles / role_permissions
- categories / products
- stock_balances / stock_movements / stocktakes
- customers / suppliers
- sales / sale_items / payments
- purchases / purchase_items
- expenses / bank_accounts / banking_transactions
- accounting_accounts / accounting_journals / accounting_journal_lines
- boms / bom_items / production_orders
- work_orders
- employee HR/payroll tables
- assets / vehicles / deliveries
- projects / project tasks / project invoices
- storefronts / online_orders
- payment_provider_connections / external_payment_transactions
- notifications / delivery queue
- integration_api_keys / webhooks
- data_migration_jobs
- audit_log

RLS, server APIs and permission-aware transaction functions enforce organization isolation and sensitive-operation controls.

## Transaction integrity

Stock, customer debt, supplier debt, finance and accounting changes use transactional database functions where dependent writes must succeed or fail together.

Examples include:

- POS sales and returns
- customer and supplier payments
- stock adjustments, transfers and stocktakes
- purchase receiving
- expenses and banking
- production completion
- service-job material usage and payments
- payroll payments
- asset maintenance costs
- project materials, expenses and invoices
- online-order conversion
- external-payment settlement
- opening stock and opening balances

## Security posture

- dedicated Supabase project guard
- RLS on public business tables
- service-role key server-side only
- no anonymous privileged database writes
- restricted SECURITY DEFINER execution
- last-active-Owner protection
- audited administration changes
- rate limiting on public/sensitive endpoints
- provider credentials stored in Supabase Vault
- CSP, HSTS, clickjacking and MIME-sniffing protection
- disabled modules blocked at navigation, route and selected API layers

## Migration Center

`/migration-center` supports validated CSV/JSON onboarding for:

- products/services
- customers
- suppliers
- staff
- opening stock
- customer opening balances
- supplier opening balances

Migration jobs record inserted, updated, skipped and failed rows with row-level errors and audit history.

## Mobile and native

MGT supports:

- responsive desktop/mobile UI
- installable PWA
- offline-state detection
- online-only protection for financial/stock writes
- camera barcode scanning
- Android direct-install APK builds
- optional signed Android APK/AAB
- iPhone/iPad simulator validation
- native safe areas, keyboard handling and back navigation

The current native application ID is:

```text
com.mgt.businesssuite
```

## Local development

```bash
git clone https://github.com/lumuxav/mgt.git
cd mgt
git checkout universal-business-platform
npm install
npm run dev
```

Create `.env.local` with credentials for the dedicated Universal MGT project:

```env
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

Never commit secret values.

## Health checks

```text
GET /api/health
GET /api/health/supabase
```

The protected Supabase health endpoint requires `HEALTHCHECK_SECRET`.

## Release gates

Before a production release:

1. complete full desktop/mobile/native regression testing
2. close all critical security, stock, payment and accounting defects
3. verify backup and restore procedures
4. configure production payment-provider credentials where required
5. configure Android signing for stable APK/AAB distribution
6. configure Apple signing before physical iOS/App Store distribution
7. complete final cross-device acceptance testing
