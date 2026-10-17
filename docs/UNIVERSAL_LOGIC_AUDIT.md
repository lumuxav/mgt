# Universal MGT logic audit

For the latest integrity, banking, access and app-installation work, see [the 17 October 2026 audit](UNIVERSAL_INTEGRITY_AND_APPS_AUDIT.md). The findings and verification counts below describe the earlier review.

Review date: 12 October 2026. Source: `lumuxav/mgt`, `universal-business-platform`, starting at `35856d8`.

## Corrected behaviour

| Area | Defect | Result |
| --- | --- | --- |
| POS and accounting | Accounting tried to post the empty sale before its totals existed. | Valid sales post balanced journals; intermediate empty records do not block checkout. |
| Returns | Returning a sale removed its original journal, refund rounding could exceed the sale value, and VAT was not reversed separately. | Original entries remain; split refunds sum to the exact sale total; VAT and returned inventory costs reverse correctly. |
| Reservations | POS, adjustments, stocktakes and production could consume reserved inventory. | Available quantities are enforced, with a database invariant protecting reservations. |
| Stocktake | The screen displayed available stock as the physical count baseline. | The baseline uses on-hand quantity. |
| Credit | Opening debt was omitted from credit limits and debtor/payment screens; history limits could understate debt. | Credit checks include opening debt; the three screens use full database balance aggregation. |
| Opening balances | Adding a supplier with an opening balance created no accounting entry; statements deducted opening repayments twice. | Opening balances post journals, and supplier statements apply each repayment once. |
| Job and project costs | Stock materials and manual inventory changes were absent from the accounting ledger. | Material usage, reversals and adjustments post balanced inventory/cost entries. |
| Service payments | A zero final amount prevented a deposit against a valid quote. | The quote is used until a nonzero final amount exists. |
| Online payments | A payment received after order conversion did not clear the linked sale; an additional collection could be marked settled without allocation. | Linked sales are paid, retries remain idempotent, and additional collections require reconciliation. |
| Provider state | A delayed response could downgrade an already successful or settled payment. | Conditional writes preserve successful/settled status. |
| Payment requests | Closed invoices, foreign customer IDs and currency mismatches could pass early validation. | Target organization, invoice state and provider currency are checked before sending a request. |
| Access | Hidden pages could render through direct URLs; disabled roles/archived accounts retained some access; old profile requests could corrupt a newer account cache. | Route permissions, role/account checks and cache generations enforce the current account. |
| Live updates | Overlapping effects reused an already subscribed Realtime channel. | Each effect has a separate channel and stops when unmounted. |
| Profitability | Returned stock costs and future refunds distorted historical sales reports; product-level revenue omitted sale discounts. | Sale-cohort reports reverse returned costs, respect their end date and allocate sale discounts. |
| Closed periods | Old returns/payments could try to rewrite original journals; an existing closed journal could be replaced using an open date. | Current settlements preserve original journals, and closed entries cannot be moved/replaced. |
| Transaction controls | Direct financial table writes, the older sale RPC and the internal adjustment RPC bypassed transaction/approval checks. | Browser roles use the supported transaction and approval functions. |

## Verification

- 36 database regression cases passed against the dedicated Universal MGT project.
- 12 JavaScript regression cases passed with `npm test`; these now run in the web validation workflow.
- Production build passed for all 57 generated pages.
- Four browser checks passed: desktop POS, mobile POS at 390 px, cashier direct-URL denial, and disabled-POS denial. These browser checks used mocked authentication/data responses; database transaction behaviour was verified separately against the actual database.
- Database test fixtures ran inside transactions and were rolled back. No test organizations, transactions or users remain.
- Isolation checks retain the single Universal Supabase reference and exclude retired legacy routes.

Applied migrations: `universal_logic_regressions`, `stock_credit_integrity`, `payment_access_integrity`, `inventory_cost_and_approval_integrity`, and `closed_period_return_integrity`.

## Verification limits

Existing full-repository lint debt remains: 48 errors and 23 warnings, largely React effect/purity rules. The production build and regression tests pass; this is not a claim that lint passes.

Physical Android/iOS devices, camera scanning, genuine staff sessions, and real MTN/Airtel/gateway transactions still need acceptance testing. No real provider collection was initiated during this audit. The audit fixes verified defects; it is not a certification of every business process or every concurrency scenario.
