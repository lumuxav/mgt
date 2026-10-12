# Navigation performance — 12 October 2026

Most workspaces repeated a user lookup, then organization/location lookups, before requesting their own records. AppShell also restarted its access effect after setting the user ID. POS loaded the same stock/till twice, and the service worker fetched immutable scripts even on cache hits.

## Changes

- Reuse organization/location metadata for 30 seconds, scoped to the user, organization and default location. Concurrent readers share one request. Expired or failed requests reload, and older responses cannot replace a newer account's metadata.
- Keep profile lookups bounded to 30 seconds. Existing 15-second access checks, Realtime profile changes, per-page permission RPCs and database authorization remain active.
- Invalidate metadata on sign-out, account/location changes, business setup saves and Realtime business changes. Operational stock, balances, sales and payments are requested from the database.
- Run initial profile/permission reads together, keep one access effect, and start organization/location loading alongside business configuration.
- Remove Home's duplicate configuration/profile requests. Load POS stock/till alongside product/customer data and once per location change; ignore superseded location responses.
- Add a route-loading boundary, return cached immutable assets without refetching, defer invitation work outside the auth callback, and use one sign-out operation/redirect.

## Verification

The local production build was tested at 1440 px and 390 px, with a simulated 250 ms delay per mocked Supabase request. Across ten actual page switches between Inventory, Sales and POS:

| Measurement | Before | After |
| --- | ---: | ---: |
| Median time to the loaded workspace | 1,308 ms | 317 ms |
| Supabase requests | 104 | 66 |

The navigation suite also checked two initial loads and two same-page clicks. Document identity stayed intact during page switches. Timings are controlled local measurements, not a guarantee for a physical device or production network.

Twenty JavaScript regression cases, the production build (57 generated pages), and seven browser checks passed. Browser checks covered desktop/mobile checkout, cashier direct-URL denial, disabled POS, Home, invitation acceptance and sign-out. A read-only check against Universal's database confirmed the required profile/location columns and permission/configuration RPCs. No schema changes or real payment requests were made.

The cache/helpers and regression files pass targeted lint. Existing component/repository lint debt described in `UNIVERSAL_LOGIC_AUDIT.md` remains outside this change.
