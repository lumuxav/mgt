# MGT remaining production gates

Scope: `lumuxav/mgt`, branch `universal-business-platform`, Supabase `mehuiivevjqmwvaapbgz`, and `https://mgt-lake.vercel.app`. No other system is included.

## Changes in PR #16

- Report, HR, project and financial reads respect organization, branch or assigned-work scope. Shared contact details remain usable; organization opening amounts are returned only through authorized, scoped functions. Payroll periods show scoped totals and employees can still read their own payslip period.
- Bank summaries calculate the full confirmed ledger. Customer/supplier statements return a complete scoped ledger snapshot and use business-local dates. Report screens page their sources and stop with an explicit error rather than presenting partial totals.
- Unfinished service jobs can be cancelled with a full refund. The operator identifies the completed refund, records its account/reference, and explicitly decides whether all issued materials returned to stock or were consumed. One transaction locks the job and funding source, reconciles payment/stock/accounting records, retains history, and deduplicates retries. Completed jobs remain protected from cancellation; this is not a credit-note feature.
- Provider collection references are saved before sending. Ambiguous network/server responses remain pending; a second unresolved collection against the same document/account is blocked. MTN PUT and POST callbacks recheck provider status. Provider origins match the selected environment and custom gateways require the operator-controlled `MGT_PAYMENT_GATEWAY_HOSTS` allowlist.
- Notification visibility and email eligibility respect the recipient's current scope. Email workers claim each queued attempt atomically and observe the database's eligibility decision.
- CI includes a real encrypted fixture-data restore drill. Desktop release builds support configured Windows signing and Apple Developer ID/notarization, reject partial configuration, verify signatures, and publish the actual signing status.

## Verification

The final commit must pass the web build, logic tests, migration replay, SQL role/business regressions, real-browser journeys, simultaneous-transaction tests, desktop packages, and encrypted fixture restore. The PR records the exact final commit and run URLs. Checks on an earlier commit do not certify a later code change.

The restore drill deliberately clears **only** the disposable GitHub Supabase container. It compares every public/auth table's row count and content checksum before and after decrypting/restoring, then verifies refund idempotency, stock, bank balance, statements and journal balance. It proves fixture-data recovery on the rebuilt application schema; it does not certify restoration of a production backup.

## Encrypted production backup

The manual **Encrypted MGT Database Backup** workflow requires:

| GitHub Actions secret | Value |
| --- | --- |
| `MGT_BACKUP_DATABASE_URL` | MGT's direct PostgreSQL URL or its session pooler URL on port 5432 |
| `MGT_BACKUP_AGE_RECIPIENT` | An age public encryption recipient; keep the corresponding private key outside GitHub |

It pins the MGT project, uses one PostgreSQL snapshot, streams the custom archive directly into age encryption, publishes an encrypted artifact plus SHA-256 manifest, and removes its runner copy. Artifacts expire after 14 days: download them to the business's durable backup store before expiry. It is manual, not a scheduled backup service.

A production restore must use a separate approved recovery target, never the live MGT database. Verify the encrypted checksum, decrypt using the offline recovery identity, rebuild a compatible Supabase schema/roles, review the archive's managed-schema entries, and restore according to Supabase's recovery guidance. Record source backup time, target, duration, counts and business checks, then confirm application login, permissions, balances and linked documents. Retain both the evidence and a second recoverable backup before declaring disaster recovery complete.

Database archives do not contain Storage object bytes, external secrets, hosting configuration or cluster roles. Export those separately when used. The last read-only inspection found zero MGT Storage objects. This does not guarantee the count stays zero.

References: [Supabase backups](https://supabase.com/docs/guides/platform/backups), [CLI backup/restore guidance](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore), [PostgreSQL pg_dump](https://www.postgresql.org/docs/17/app-pgdump.html).

## External acceptance still required

| Gate | Required evidence |
| --- | --- |
| Production restore | A real MGT backup restored into an isolated approved target, with recovery evidence and retained backup |
| Production signing | Existing Android keystore, Windows certificate and Apple Developer ID/notarization credentials; verified signed release manifests |
| Payment provider | Configured sandbox/production merchant connection and operator-approved acceptance transactions |
| Physical devices | Named tester, device/OS, release/source, result and evidence for install, upgrade, login, scrolling/keyboard, scan, print/share, reconnect and permissions |

The last MGT inspection found **no payment-provider connections**. Mock contract tests validate our request/error handling; they do not validate a merchant account, real mobile-money transfer or provider refund. Provider acceptance should cover success, rejection, expiry, lost callback with status refresh, duplicate callback, interrupted request, reconciliation, and a completed external refund. Use provider sandbox fixtures first. Real-money transactions require a designated test wallet, amount and operator authorization.

MTN documents asynchronous acceptance, both PUT/POST callback listeners, and status polling because callbacks are sent once: [official callback guide](https://momodeveloper.mtn.com/api-documentation/callback). Custom gateways must accept the client transaction reference and expose a compatible status endpoint; their contract needs separate acceptance. Airtel configuration must be checked against the merchant's provisioned API version before activation.

See [DOWNLOADS.md](../DOWNLOADS.md) for signing secret names and verified release manifests. No successful test is a substitute for unavailable signing credentials or physical-device acceptance.

## Rollout order

1. Pass CI on the final code commit and review production preflight metadata, including unresolved provider rows and schema/function compatibility.
2. Deploy the updated notification dispatcher, whose atomic claim handling is compatible with the existing schema. This makes workers observe scope exclusions as soon as the database guard is installed.
3. Apply `20261021190548_scoped_reporting_service_refunds.sql` to MGT before deploying callers of its new functions.
4. Merge/deploy the tested web and release changes; verify the exact source/deployment and public route/API smoke checks.
5. Record deployment versions, advisor results, remaining external gates and any failed checks. Do not describe unsigned packages or an untested production restore as production-ready.

After database deployment, avoid rolling the web back to a version that directly selects protected opening-balance columns. Use a reviewed forward fix for compatibility; do not restore broad client grants to make an old build work.
