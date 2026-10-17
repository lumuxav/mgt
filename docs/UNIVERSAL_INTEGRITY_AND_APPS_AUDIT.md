# Universal MGT integrity and app audit — 17 October 2026

Scope: `lumuxav/mgt`, branch `universal-business-platform`, starting commit `51b56d6c655a4c59dee359d23a08c77ec2cc44e1`. Database changes apply only to Universal MGT (`mehuiivevjqmwvaapbgz`).

## Fixes

| Area | Verified defect | Correction |
| --- | --- | --- |
| Business isolation | Writable foreign keys could point to another business's category, location, staff member or other parent record. | Reference checks cover the directly writable business tables; existing rows were checked before the constraints were installed. |
| Financial integrity | Direct writes could bypass purchasing, expense, stock and banking transaction functions. Opening repayments could be edited directly. | Browser roles use supported transaction RPCs; contact and bank-account column grants protect financial history while allowing ordinary edits. |
| Numeric data | PostgreSQL accepted `NaN` amounts and prices. | Numeric business columns reject non-finite values; failed transactions roll back. |
| Access | A suspended organization could retain database/server API access. | Active organization and active staff/role checks are enforced in the database, server APIs, login, storefront and platform context. |
| Owner protection | Auth bans happened before the database could reject removal of the last owner. Concurrent owner changes were not serialized. | Profile changes must succeed before Auth mutations. The database serializes owner changes per organization. Auth synchronization failures are reported explicitly. |
| Roles | Metadata updates and permission replacement used separate transactions. Invalid permissions could leave partial changes. | A service-only RPC validates actor and permissions and atomically writes role, permissions and audit history. |
| Banking | Opening balances lacked journals. A recent same-amount expense could suppress an unrelated deposit. Linked project payments could be counted twice. | Bank openings post journals; explicit expense/payment references replace time/amount matching and prevent duplicate source linkage. |
| Financial accounts | Till transfers and other postings could use the bank ledger for a selected mobile-money account. Cash boxes were mapped to suspense. | The selected account determines its bank, digital-money or cash ledger. Linked payments are synchronized after the account reference exists. |
| Payment races | A late settlement error could overwrite an already settled transaction. | Failure updates are conditional on the current settlement state. |
| External stock API | The query filtered `stock_balances.organization_id`, which does not exist. | Tenant filtering uses the inner product relationship, with stable product/location ordering. Key revocation, module access, pagination and rate limits are checked. |
| Export | Large exports silently stopped at the server row cap; spreadsheet formula text was not escaped. | Exports read successive pages and protect CSV text cells. |
| Locations | Renaming a location created a different database record. Removing a saved location in setup did not persist. | Saved locations resolve by ID; deactivation is explicit and reversible. An inactive location cannot remain the selected setup default. |
| Apps | Duplicate manifests and SVG-only launcher icons weakened installation support. Offline navigation depended on the authenticated application. | One manifest, PNG/maskable/Apple icons, a public `/install` guide and an independent offline document support phones and desktop app windows. |
| App lifecycle | Waiting updates were never offered; cache cleanup deleted unrelated caches. Android Back could exit immediately. | Updates require a user action, cache cleanup is scoped to MGT, and Android exit requires a second Back press. Desktop resizing no longer looks like a mobile keyboard. |
| Camera | An outstanding detection could submit after the scanner was closed. | Cancellation is rechecked after detection; manual barcode input remains available. |
| Packaging | Native dependencies floated and Android versions stayed at the template default. | Locked Capacitor dependencies, increasing Android version codes, an isolated test application ID, cached test signing identity, and PR build validation. |

## Applied migrations

These filenames match the versions recorded by the Universal database:

1. `20261016233846_universal_integrity_and_access.sql`
2. `20261016233903_explicit_bank_accounting.sql`
3. `20261017073544_atomic_role_management.sql`
4. `20261017074227_financial_account_posting.sql`

All four are applied. The first two were applied on 16 October UTC; the remaining two on 17 October. No bank accounts existed before this change, so no historical opening-bank journals needed backfilling.

The roles API requires migration 3 before deploying the corresponding application code. Do not reapply these migrations to the live project. For another existing environment, compare its migration history and apply only missing migrations in order. Older repository migrations have historical version naming differences; do not reset a populated database or blindly push the entire history to resolve that difference.

Financial-history fields are deliberately immutable through direct browser writes. Use the transaction or Migration Center RPCs. Deactivate a financial account instead of deleting its history. Changing its type or opening balance requires an audited accounting correction.

## Verification

| Check | Result |
| --- | --- |
| Existing database regression suite | 36 passed |
| New access/banking suite | 39 passed |
| JavaScript regression suite | 33 passed |
| Production Next.js build | Passed; 58 generated pages |
| Lint on changed JavaScript files | Passed |
| Full repository lint | 44 errors and 19 warnings remain, principally existing effect/purity rules; baseline was 47 errors and 20 warnings |
| Chromium installation page | 360, 390, 768 and 1440 px; no overflow or page errors |
| Browser assets | Manifest, all advertised PNG icons and Apple touch icon served successfully |
| Browser service worker | Offline deep-link fallback, reconnection and exclusion of business HTML/API responses from Cache Storage verified |
| Login navigation | Public install guide reachable without signing in |
| Android project | Generated and synchronized; 74 native icon/splash assets generated |
| GitHub web validation | Passed, [run 39015415316](https://github.com/lumuxav/mgt/actions/runs/39015415316) |
| Android APK compilation | Passed, [run 39015415335](https://github.com/lumuxav/mgt/actions/runs/39015415335); downloadable test APK artifact |
| iOS simulator compilation | Passed, [run 39015415340](https://github.com/lumuxav/mgt/actions/runs/39015415340) |

SQL fixtures run inside `BEGIN`/`ROLLBACK`. The new suite uses the actual `authenticated` and `service_role` database roles to check grants and RLS, and verifies permitted transaction paths as well as rejected writes. No test users, organizations or financial records remain. The browser checks use public pages and build-only placeholder credentials, not genuine customer sessions. No provider collection or invitation email was initiated.

Run the reproducible checks:

```bash
npm ci
npm test
npm run build
psql "$UNIVERSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/universal_logic_regressions.sql
psql "$UNIVERSAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/access_and_banking_regressions.sql
```

The build needs the Universal environment variables described in the README. Use a securely supplied database URL for the SQL suites; run them as the administrative database role because fixtures include temporary Auth users and role switching. These files roll back all fixtures.

## Remaining limits

- At the initial audit, desktop distribution used an installed browser app (PWA). This is superseded by [MGT 1.1.1](MGT_SIDEBAR_AND_RELEASES.md), which publishes Windows `.exe`, macOS `.dmg` and Linux AppImage packages alongside Android in the latest release.
- Android APK and unsigned iOS simulator compilation passed in GitHub Actions for code commit `00f7cc4`. Release builds require signing credentials; physical Android/Redmi/iPhone/iPad camera, keyboard and upgrade acceptance remains outstanding.
- Business operations require connectivity. The offline screen does not implement offline sales or queue payments. Check payment history before retrying after an interrupted response.
- Owner concurrency is serialized in SQL, but a multi-session race/load test was not performed. External payment/provider behavior still requires sandbox and real-device acceptance.
- Setup still saves organization, locations and modules through successive requests. A later failure is shown and a retry is supported; this flow is not a single database transaction.
- Supabase advisors report existing `pg_net` placement, 96 executable authenticated transaction RPCs, and disabled leaked-password protection. The RPC warnings require permission-aware review, not blanket removal of the business API. Performance advisors report 82 uncovered foreign keys, 19 RLS initialization warnings, 8 overlapping-policy warnings and 153 currently unused indexes. No broad index deletion or project-level Auth configuration changes were made.

Installation and signing details: [DOWNLOADS.md](../DOWNLOADS.md). Prior accounting/stock work: [UNIVERSAL_LOGIC_AUDIT.md](UNIVERSAL_LOGIC_AUDIT.md).

## Repository and deployment status

Code is published in [PR #1](https://github.com/lumuxav/mgt/pull/1). Its Android, iOS and web validation workflows passed on `00f7cc4`. The new test APK is available as the `MGT-Business-Suite-Test-APK` artifact on the Android run above (expires 16 November 2026); it was not published to the stable or latest-test release tags. At this initial review, the web deployment was still pending; the later production rollout is recorded below.

The automatic Vercel preview for `00f7cc4` failed: [deployment details](https://vercel.com/safe-heaven1/mgt/oBGsbYjsq7kAduvVPwTZ9PcpPF2f). The connected Vercel account was denied access to team `safe-heaven1` (HTTP 403), preventing inspection of its failure reason. This is separate from the successful local and GitHub production builds. At that initial review, the PR had not been merged and no production app deployment had been promoted. This was resolved by the later production rollout below.


## Branding and Intelligence follow-up

The [MGT release notes](MGT_INTELLIGENCE_AND_BRANDING.md) document the subsequent product branding, trained sales forecasting, quick answers, aggregate database RPC and additional validation. This earlier audit preserves its original verification and deployment timeline.

Production update: PR #1 is now merged and release `5864a13` deployed successfully on Vercel. See [the completed rollout](MGT_INTELLIGENCE_AND_BRANDING.md#production-rollout-completed) for current web and native build outcomes. The earlier blocked-preview notes above are historical.
