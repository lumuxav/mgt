# MGT modular role architecture — consolidated web pull request

This PR applies to `lumuxav/mgt` only, and leaves Maya untouched. No personal customer or business information is altered by migration; the migration is additive except deliberate replacement of role/record RLS policies described below.

## Operational changes

- Personal **My Work** workspace for any active MGT staff account. Assigned project tasks can be moved through authorized statuses via the existing atomic `update_project_task` RPC. Assigned service jobs allow work-in-progress/on-hold updates only; neither changing prices nor marking jobs complete is exposed to technicians.
- Owner-selected role templates, permissions preview, optional additive roles, and record scope. Extra roles cannot include owner, administrator, or platform-wide administration. Roles and scopes are saved with a validated service-only RPC and an audit log. Existing owner-customized grants are never reseeded.
- New worker accounts default to assigned-only for generic employee/technician/project worker and single-location where assigned for cashier/salesperson/storekeeper/branch manager. All other users retain organization-wide scope until the owner explicitly changes them.
- Record scopes are **enforced today for sales and service orders** using Postgres RLS. They are not yet an all-table branch firewall, and the owner UI explicitly says so. This must be expanded carefully, procedure by procedure, without breaking purchases, production, and accounting integrity.
- Grouped module configuration and ten industry presets **using only existing working modules**. Hotel bookings, restaurant kitchen table management, and farm crop-cycle management are not implemented by these presets; adding them needs independent schema and workflow coverage.
- Approvals retain existing purchase, stock, and production transaction logic. An authorized owner can optionally require different approvers; existing businesses default OFF to prevent unexpected deadlocks.

## Safe rollout

1. Complete CI (Next.js build and logic regression tests, parse SQL DDL).
2. Review database security: verify role combination and RLS with test identities. Product-grade cross-business and cross-branch isolation must be tested before users get real accounts.
3. Apply migration via Supabase migration tool only when web app is ready and a backup exists. Then merge **one** pull request, yielding **one** production Vercel deploy. The native releases are intentionally not regenerated in this web-first stage.
4. Test workers: owner, cashier, storekeeper, technician, project member, HR officer, accountant, manager; verify both permitted actions and denied actions, and reassess operational edge cases.
5. Deploy subsequent fully specified vertical extensions only after equivalent transaction-level tests, not merely enabling a template.

## Compatibility

Existing permission grants are preserved. Older clients continue using their primary roles; the web app reads extra grants from `current_permissions`. Unassigned accounts and old business owners retain previous data scope, pending deliberate owner configuration. Service-role administration remains restricted to the MGT Supabase project and validates organization IDs.
