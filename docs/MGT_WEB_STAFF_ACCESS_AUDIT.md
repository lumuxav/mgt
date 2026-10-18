# MGT web-first per-business access improvements — 18 October 2026

The existing MGT Supabase schema already has nine built-in business roles, 77 granular permission codes, custom business roles and invitations. Changes in this phase correct gaps rather than creating a second identity system.

- Every configured business owns its roles, staff, permissions and location records.
- Standalone Business Setup now verifies an authenticated user and, for existing organizations, settings.manage and locations.manage before rendering or saving. Newly authenticated founders without a business can still bootstrap one. Setup no longer uses a previous user's cached business information as an authority.
- Home now waits for current_permissions before loading role-sensitive metrics and only renders authorized cards, links and quick actions. Users with users.manage get an explicit Staff & Access shortcut.
- The server's staff invitation/update routes reject business-assigned super_admin/system_admin and refuse reusing an account already bound to a business.
- The companion SQL migration prevents direct authenticated profile edits from changing organization_id, role, active or archived_at and blocks reserved platform role keys.
- No native installers rebuilt; no Maya resources touched. Acceptance tests with separate real staff accounts still required. Default location is not an enforceable branch-level permission restriction, and module-specific operation controls should be tested by user roles.
