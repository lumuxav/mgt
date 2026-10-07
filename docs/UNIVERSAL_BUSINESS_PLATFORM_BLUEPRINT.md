# Universal MGT Business Platform Blueprint

## Goal

Build one configurable business-management platform whose terminology, modules, locations, permissions and workflows adapt to the organization using it.

## Design principles

- organization and location isolation
- configurable modules instead of duplicated industry-specific applications
- atomic transaction functions for stock and money movements
- auditable sensitive actions
- role and permission enforcement at the database/API boundary
- responsive web, PWA and native-shell delivery
- accounting and operational records kept consistent

## Business templates

MGT provides starting defaults for:

- Retail
- Wholesale / Distribution
- Manufacturing
- Services
- Hybrid / Custom

Templates only choose initial modules. Organizations can change module configuration later without losing data.

## Generic business model

Core entities include organizations, locations, staff, roles, customers, suppliers, products/services, inventory, sales, purchases, payments, finance, accounting, production, service jobs, HR/payroll, projects, assets, fleet, deliveries, e-commerce, notifications, integrations and audit history.

All transactional records belong to an organization. Location-aware operations also identify their location.

## Module architecture

Business modules are enabled centrally through `organization_modules`. Navigation, route access and selected server APIs read the same business configuration.

## Security

- Supabase Auth for identity
- RLS for organization isolation
- granular role permissions
- server-only provider/API secrets
- append-only audit posture for protected actions
- explicit module checks
- last-owner safeguards
- rate limits for public/sensitive operations

## Distribution

The same codebase supports:

- Vercel web deployment
- installable PWA
- Android Capacitor package
- iOS Capacitor package

Native applications use the same Universal MGT backend and permission model.
