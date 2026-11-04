# Logic Fix Backlog

Record of confirmed logic defects and their acceptance criteria. The changes below are implemented in the current working tree; database replay and live workflow verification remain pending.

## Desired stock behavior

Deduct tracked stock only after both payment is confirmed and the goods are dispatched. Any confirmed positive partial payment qualifies. POS checkout is treated as immediate handover; online pickup is handed over when completed, and delivery is dispatched when the online order or delivery workflow records dispatch. Zero-total sales are treated as paid once dispatched.

Unpaid dispatched goods remain reserved, not available. Returns release unconsumed holds without adding stock a second time; returns after consumption restore stock through the existing return transaction.

## Batch repair status

- POS and ecommerce use transactional, idempotent payment-plus-dispatch stock settlement; later customer payments and external payment settlement are covered by sale/payment triggers.
- Production start reserves aggregated material requirements; completion consumes actual quantities and releases unused reservation. Duplicate BOM components are rejected for new BOMs and aggregated for existing ones.
- Inventory and Business Alerts include missing balances as zero and refresh while open. Alert source reads are paginated; customer balance alerts use the permission-gated, opening-inclusive balance RPC.
- Supplier payment eligibility now follows `purchasePayable`; notification sync applies the same approval/status rules and includes zero-balance tracked products and scoped customer opening debt in per-user credit alerts.
- Notification inbox and badge paginate the active set and surface refresh errors. Asset reactivation restores the active flag while disposed assets remain non-reactivatable.
- The notification dispatcher is factored into a runtime-neutral handler module, so its tests no longer depend on Node's optional TypeScript stripping support.
- SQL regression coverage now exercises unpaid/partial-paid POS, idempotent settlement, returns before/after consumption, and payment/dispatch in either order. These tests are not executed here.
- Migration is not applied or replay-tested: no local PostgreSQL server is available. The migration fails explicitly if guarded function-body patches do not match. Run it against a disposable database and execute the acceptance workflows before deployment.
- Validation: 102/102 JavaScript tests pass. ESLint could not run because npm and local ESLint are unavailable in this environment.

## Confirmed issues

### High — POS reduces stock before payment is confirmed (implemented; database verification pending)

- `supabase/migrations/20261006_0008_universal_pos_sales_engine.sql`: `post_pos_sale` subtracts stock while creating any tracked sale, regardless of whether it is paid, partial, or on credit.
- Payment collection and external-provider settlement update the sale's paid amount and status in separate flows; they do not perform a corresponding stock deduction. For example, `server_settle_external_payment` in `supabase/migrations/20261007_0033_external_payments.sql` updates the sale payment state.
- Change needed: make the chosen confirmed-payment event the single inventory deduction point, with exactly-once protection and stock availability checks. Cover cash/card, split/partial payment, later debt collection, external settlement, and refund paths. Preserve transaction rollback if payment or stock posting fails.
- Acceptance tests: unpaid/credit sale does not deduct; confirmed payment deducts exactly once; repeated confirmation does not double-deduct; partial payments follow the agreed rule; returns reverse the correct quantity.

### High — Inventory page can keep showing old stock (implemented; UI verification pending)

- `app/inventory/page.js`: initial load fetches balances once; the page has no realtime subscription or focus refresh. It reloads after its own adjustments, transfers, or stocktakes, but not after POS, work-order, or production activity elsewhere.
- Change needed: refresh balances when they change or when the page becomes active, so stock displayed in inventory matches the committed database balance.
- Acceptance test: keep Inventory open, complete a stock-consuming transaction in another workflow, and verify the displayed available and on-hand quantities update without a manual page reload.

### Medium — Products without a balance row disappear from inventory and low-stock alerts (implemented; database verification pending)

- `app/inventory/page.js` and `app/alerts/page.js` build their stock lists from `stock_balances`. A tracked active product with no balance row is omitted rather than represented as zero.
- Change needed: include tracked products for active locations with a zero default balance, or create balance rows reliably when products/locations are created.
- Acceptance test: a never-stocked tracked product appears at zero and triggers an out-of-stock alert when its reorder level is positive.

### Medium — Supplier payment alerts include non-payable purchases (implemented; database verification pending)

- `app/alerts/page.js` flags overdue purchases using due date, payment status, and amount, but does not check `approval_status` or excluded purchase statuses.
- `supabase/migrations/20261007_0031_notifications.sql` repeats the overdue check in `sync_my_notifications`.
- `lib/balances.js` `purchasePayable` defines the actual exclusions: drafts, pending approval, rejected, cancelled, and purchases whose approval status is neither `not_required` nor `approved`.
- Change needed: use the same payable eligibility rules in both the Business Alerts page and Notification Center sync.
- Acceptance test: draft, pending, rejected, cancelled, and unapproved purchases never raise overdue-payment alerts; approved unpaid overdue purchases do.

### Medium — Customer credit alerts omit opening balances (implemented; database verification pending)

- `app/alerts/page.js` computes customer debt only from outstanding sales. It does not include `customers.opening_balance - opening_balance_paid`.
- `supabase/migrations/20261007_0031_notifications.sql` `sync_my_notifications` also calculates credit warnings from sales only.
- The authoritative `get_customer_sales_balances` function includes opening debt in `supabase/migrations/20261021060424_production_workflow_integrity.sql`.
- Change needed: use the same scoped customer balance source as the credit and payment workflows, rather than a separate sales-only calculation.
- Acceptance test: opening debt alone, or opening debt plus sales, triggers the same threshold and balance in both alert surfaces as the customer balance screen.

### Medium — Business Alerts do not refresh while open (implemented; UI verification pending)

- `app/alerts/page.js` loads source records once on mount and has no realtime, focus, or periodic refresh.
- The Notification Center's notification sync does refresh periodically in `app/components/AppShell.js`, but that does not refresh the separate computed Business Alerts list.
- Change needed: refresh the alert inputs on focus and after relevant database updates, with a bounded refresh strategy.
- Acceptance test: an alert appears or clears after the underlying condition changes while the page remains open.

### Medium — Starting production does not reserve its materials (implemented; database verification pending)

- `supabase/migrations/20261006_0012_approvals_manufacturing_engine.sql` `start_production_order` checks available stock and marks the order in progress, but neither reserves nor consumes it.
- Materials are deducted later by `complete_production_order` in `supabase/migrations/20261012074240_stock_credit_integrity.sql`.
- Other sales or work orders can consume the same stock after production starts, leaving an in-progress order unable to complete.
- Change needed: reserve required material atomically at start and release/adjust the reservation on completion or cancellation, or explicitly redesign production to consume at start.
- Acceptance test: started production prevents another workflow from consuming its reserved quantity; completion and cancellation leave the correct available quantity.

### Medium — Duplicate BOM materials are not aggregated (implemented; database verification pending)

- `supabase/migrations/20261006_0012_approvals_manufacturing_engine.sql` `create_bom` accepts repeated `product_id` entries, and `bom_items` has no uniqueness constraint for `(bom_id, product_id)`.
- `start_production_order` checks each component row against the full available balance independently instead of checking the summed requirement. A BOM with two rows requiring 4 units each can start with only 4 units available.
- `complete_production_order` looks up one submitted consumption value by product for each BOM row. The UI also keys actual usage by `product_id`, so repeated rows share a value rather than representing one aggregated material requirement.
- Result: the order can pass its start check but fail during completion, or material use can be misrepresented.
- Change needed: either reject duplicate component products when creating a BOM or normalize/aggregate them consistently in the UI, availability checks, and completion transaction.
- Acceptance test: duplicate material entries are rejected or correctly summed; start and completion agree on the required and consumed total.

### Low — Notification badge and inbox use a fixed, capped subset (implemented; UI verification pending)

- `lib/notifications.js` applies a caller-supplied limit to the active notification query. `app/components/AppShell.js` requests 250 rows and `app/notifications/page.js` requests 300 rows.
- The app-shell badge derives its unread count from only those fetched rows. Above the cap, older active notifications are omitted and unread notifications beyond the first 250 are not counted.
- Change needed: either establish and enforce a per-user active-notification retention cap, or paginate the inbox and calculate the unread total across the full active set.
- Acceptance test: with more than 250 active notifications including older unread rows, the badge and inbox follow the chosen complete-count/retention rule.

### Medium — Retired assets can be reactivated only in display status (implemented; database verification pending)

- `app/assets/page.js` offers an **Active** action for retired assets.
- `supabase/migrations/20261006_0017_asset_fleet_operations_hardening.sql` `set_asset_status` sets `active=false` for retired/disposed assets but does not restore `active=true` when status is changed back to active.
- The asset then looks active by status but is excluded from active-asset totals and cannot be scheduled for maintenance.
- Change needed: restore the active flag when a valid reactivation occurs, or disallow reactivation and provide a deliberate restore flow.
- Acceptance test: after reactivation, the asset appears in active lists and can be scheduled for maintenance.

## Coverage risks to verify

- `app/alerts/page.js` selects all sales, purchases, and other source rows without explicit pagination. Supabase/PostgREST row limits may truncate these inputs for larger businesses. Verify the deployed API row cap and use paginated reads or database-side aggregates so alert totals are complete.
- `lib/notifications.js` limits the notification inbox query to the caller-supplied count (200 by default); `app/components/AppShell.js` requests 250 and `app/notifications/page.js` requests 300. If an account has more active notifications than the selected limit, older notifications are omitted and the app-shell unread count is only for the fetched subset. Verify whether this volume is supported; otherwise paginate and calculate the total unread count independently.
- `app/components/AppShell.js` silently catches notification refresh and sync errors. A failed sync can leave the notification badge stale without reporting that the refresh failed. Decide whether to surface a non-disruptive warning or record the failure through the app's standard diagnostics.
- The review so far is targeted, not a complete audit of every project workflow. Add newly verified issues here with evidence and acceptance tests; do not treat unreviewed areas as verified.

## Additional review completed

- Reviewed inventory, POS, production, service material usage/cancellation, Business Alerts, notification sync/inbox, and the relevant stock, payment, manufacturing, and alert SQL paths.
- Confirmed that POS, production completion, service work-order material lines, project materials, and ecommerce fulfillment each have stock update paths. Their trigger points differ; align the intended payment/dispatch policy before changing them.
- Confirmed the production BOM duplicate-component issue above by tracing BOM creation, production start checks, completion consumption, and the UI's product-keyed actual-consumption form.
- JavaScript regression suite: 102/102 tests passed locally after making the notification-dispatch handler directly importable by Node and Deno without runtime TypeScript stripping.
- Database regression suites and live transaction workflows were not run in this environment. This remains a code-path review, not a claim that every business workflow was exhaustively audited.
