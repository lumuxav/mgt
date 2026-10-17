# MGT branding and business intelligence — 17 October 2026

This release applies only to `lumuxav/mgt` and Supabase project `mehuiivevjqmwvaapbgz`. It includes the integrity corrections documented in [the earlier audit](UNIVERSAL_INTEGRITY_AND_APPS_AUDIT.md).

## Brand and installation

The product name is **MGT Business Suite**. A new MGT lettermark with a rising gold line is used for the app header, login, install page, favicon, PWA icons and native icon/splash generation. Custom business names remain unchanged. “Universal” page headings and the obsolete “Prototype foundation” setup message are replaced with business-facing copy. Connection failures remain visible with recovery instructions; external payment/provider setup statuses remain accurate.

PWA icons use new asset URLs and service-worker cache version `mgt-shell-v6`. Existing installed browser apps receive web changes from the production site and the app's update flow. Launcher icon refresh timing is controlled by the browser/OS; reinstalling the browser app can refresh a retained older icon. Native Android/iOS launcher assets require a new native package. The public install page offers browser installation; it does not present a debug APK as a production download. See [DOWNLOADS](../DOWNLOADS.md) for signing and distribution details.

## MGT Intelligence

`/insights` now loads a single `get_business_insights()` RPC snapshot, rather than downloading capped raw table lists. It returns 90 complete local-calendar days of sales/expenses, all-date outstanding sales balances, inventory reorder counts and authorized operational exceptions. Database aggregates include rows beyond PostgREST's row limit. Only the first 12 low-stock product names are returned; the total count includes all qualifying products.

The database derives organization identity from the authenticated session; there is no organization parameter. Active user/role/business checks, `insights.view`, the Intelligence module, each source permission and its enabled module are enforced in the RPC. Unauthorized metrics are `null`, not misleading zeros. The RPC returns no customer contacts or individual transaction records. It does not change business records or send data to another AI provider.

### Forecast model

`lib/businessIntelligence.js` trains an eight-coefficient ridge regression using time trend and weekday features. It compares this against recent weekday averages and a trailing daily average using a chronological 14-day validation period, chooses the lowest mean absolute error, then fits the selected method to the full available history for a 30-day outlook. Training and prediction run in the browser without paid APIs, API keys or added ML dependencies.

At least 56 complete days since the first recorded sale and 14 days with nonzero sales are required. Missing calendar dates, nonfinite or negative values are rejected. Zero-sale dates between recorded days remain in the series. Cold-start businesses see an honest history requirement instead of a fabricated prediction. The UI identifies the selected method and recent mean daily error; a simple average may outperform the learned model.

The holdout result is a model-selection diagnostic, not an independently calibrated prediction interval. One 14-day check and at most 90 days of data cannot establish annual seasonality or represent unseen promotions, closures or economic changes. References for maintainers: [ridge regression](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.Ridge.html) and [time-ordered model evaluation](https://scikit-learn.org/stable/modules/generated/sklearn.model_selection.TimeSeriesSplit.html). MGT implements the small numerical model in JavaScript; it does not ship scikit-learn.

### Metric and answer boundaries

- Net sales include tax and deduct recorded refunds from the original sale date. They exclude cancelled, void and draft sales. They are not accounting revenue or profit.
- Period totals and training exclude today's partial day and use the organization's timezone. Invalid stored timezone names fall back to UTC.
- Outstanding sales balances include old and current sales. Customer opening balances, service jobs and project invoices are separate and explicitly excluded.
- Expenses mean recorded expense entries, not all business costs. Stock availability deducts reservations. Closed/cancelled jobs and projects are excluded from active operational exceptions.
- “Ask MGT” answers supported questions about these metrics and priorities from the current snapshot. It uses topic matching and grounded templates, not a general-purpose language model. It cannot execute SQL, change records or answer unrelated questions. Refresh fetches a new snapshot; answers themselves require no further network request.
- The previous arbitrary health score and unsupported “healthy business” conclusion were removed.

## Database rollout and validation

`supabase/migrations/20261017133647_business_intelligence_snapshot.sql` is already applied to the dedicated MGT database. It adds the read-only aggregate RPC; no existing records or historical migrations are rewritten.

The new SQL regression suite passes 12 checks: actual authenticated permissions, disabled roles/modules, anonymous denial, cross-business isolation, more than 1,000 sales, refunds, old receivables, timezone boundaries and zero-stock products. Every fixture is rolled back. `npm test` passes 41 JavaScript checks, including eight forecast/answer tests and the earlier integrity/app tests. The new Intelligence page/model/brand components pass ESLint. Existing lint findings remain in older pages whose labels were edited; these are not represented as new clean implementations.

The production build passes. A stale local Turbopack cache initially failed to open; a fresh output directory resolved it without an application change. Live rollout and native workflow outcomes are recorded in the release notes after publishing.

Browser verification passed at 360/390/768/1440 px for installation, login, icon delivery, offline recovery and reconnection. Intelligence UI checks with synthetic authenticated network fixtures passed at 390/1440 px: answers and forecast render, quick answers make no further data request, access failures clear displayed metrics, and no horizontal overflow or JavaScript exceptions occurred. Actual database access was verified separately by the rollback SQL suite.
