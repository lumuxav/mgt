# MGT production integrity review — 21 October 2026

Scope: `lumuxav/mgt`, branch `universal-business-platform`, Supabase project `mehuiivevjqmwvaapbgz`. The implementation and tests are in PR #15. Its checks record the validation of the final revision.

## Corrections

| Area | Previous failure | Implemented behavior |
| --- | --- | --- |
| Checkout | A lost reply could produce a second sale on retry. | A caller/business/request key serializes checkout and returns the original committed result. The browser retains the key until confirmed success and prevents simultaneous clicks. |
| Workflow access | Many database functions checked permissions but ignored module activation and staff scope. | 69 existing transaction functions check module activation; location/assignment checks cover operational transaction entry points, parent records and project children. Existing permission checks remain. |
| Customer collections | Branch staff could allocate payment to another branch's sale. | Allocation and balance aggregation use the same sale scope; organization opening debt requires organization scope. |
| Supplier payments | Payments could cover another branch or an unapproved order; displayed totals came from truncated history. | Allocation and full-ledger totals exclude inaccessible, draft, pending, rejected and cancelled purchases. Supplier and purchasing screens use database totals. |
| Purchase receiving | A legacy immediate-receiving function bypassed the current approval/receiving/payment flow. | Authenticated access to the unused legacy function is revoked. |
| Stock approval | Reservation changes after submission could leave reserved stock greater than physical stock. | Approval rechecks reservations under the stock-row lock. It also checks the underlying business module. |
| Cash | Some payment flows could race a till close. | Payment and refund paths lock the selected open till before posting. |
| Delivery | Managers could skip dispatch or omit proof; one finished delivery freed a vehicle still carrying another. | Enforced state transitions, active dispatch assignments, recipient/failure evidence and shared-vehicle availability calculation. |
| Projects | Multiple entries could exceed 24 hours per person/day; closed projects accepted new time. | Per-user/day locking and aggregate validation; closed projects reject time. Personal task feeds respect project branch scope. |
| Payroll and leave | Concurrent requests could create overlapping periods. Multi-month salary proration used one month's length. | Transaction locks protect overlap checks; monthly salary is prorated by each actual calendar month. |
| Service cancellation | Cancellation could strand issued materials and received money. | Cancellation requires material reversal and payment reconciliation first. |
| Numeric integrity | PostgreSQL non-finite numeric values could evade ordinary comparisons. | Checks reject NaN and infinities on future numeric business-row inserts and updates. |
| Dependencies | Production audit identified vulnerable framework/transitive packages. | Next.js and its ESLint configuration are pinned to 16.3.8; Supabase JS to 2.116.0; the lockfile resolves patched transitive packages. |

## Verification

The disposable Supabase workflow replays the complete migration history and runs the existing transactional, access/banking, intelligence, workforce and 15-role matrix suites, followed by `production_workflow_integrity.sql`. These fixtures roll back. The browser workflow creates fictional accounts in localhost Supabase and destroys the database afterward.

The browser tests cover all 15 staff roles, assigned technician work, driver success/failure proof and a cashier checkout whose successful server reply is deliberately lost. The cashier retries and double-clicks; the test then verifies one sale, one receipt and one stock deduction. Separate API tests race identical checkouts, competing last-unit sales and overlapping payroll periods.

The web workflow checks project isolation, every migration's SQL grammar, JavaScript regressions and the optimized Next.js build. Production dependency security is checked with `npm audit --omit=dev`.

## Rollout and limits

Apply `20261021060424_production_workflow_integrity.sql` to the MGT database before deploying the frontend: checkout and supplier totals call new functions. The migration preserves existing records and permissions except the explicitly revoked legacy endpoint. New numeric checks are `NOT VALID` so deployment does not scan all historical rows; historical anomalies require a separate audit before validating those constraints.

This is not a guarantee of complete branch isolation throughout every reporting, HR and shared-directory screen. Existing organization-level reporting and grants remain; do not promise a universal branch data firewall based on these transaction checks.

Paid service-job cancellation still needs a designed refund/reconciliation workflow. The new guard prevents silent loss; it does not invent that financial process. Payment-provider sandbox/live settlement, actual device behavior, and a backup restore drill require their respective operational acceptance environments. Automated native builds do not substitute for testing a physical phone or desktop installation.

The live Supabase baseline had RLS on all 100 public tables and no anonymous access to SECURITY DEFINER functions. Advisors also reported disabled leaked-password protection and `pg_net` in the public schema. Auth configuration and extension placement need separate platform review; this change does not silently alter either.

## Research basis

- [OWASP business logic security](https://cheatsheetseries.owasp.org/cheatsheets/Business_Logic_Security_Cheat_Sheet.html): workflow transitions, repeated requests and concurrency boundaries.
- [PostgreSQL 17 explicit locking](https://www.postgresql.org/docs/17/explicit-locking.html): row locks and transaction-scoped advisory locks.
- [Supabase row-level security](https://supabase.com/docs/guides/database/postgres/row-level-security): caller authorization, policies and SECURITY DEFINER boundaries.
- [Next.js next/og advisory](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j) and [Next.js SSRF advisory](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4): patched framework versions.
- [Sharp advisory](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w): patched image-processing dependency.
