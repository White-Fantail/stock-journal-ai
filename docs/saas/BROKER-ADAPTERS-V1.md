# Multi-broker read-only adapter design — Tiger first
**Version:** 2.1 · **Date:** 2026-10-26 · **Current provider:** TIGER (`REQUIRES_REVIEW`)

## Purpose and provider registry
A SaaS customer may link zero or more authorized brokers/accounts to their workspace. `services/broker_connectors/contracts.py` defines `BrokerAdapter`, `BrokerDescriptor`, `BrokerSyncRequest`, `BrokerSyncBatch`, `BrokerFill`, `BrokerPosition` and bounded `SyncWindow`; `registry.py` allowlists Tiger first. A second broker registers independently and cannot bypass authorization or replace Tiger normalization internals.

```text
Trusted tenant job -> Registry -> TIGER adapter -> Tiger approved read-only API
                             -> future IBKR adapter -> independently approved API
                  Each -> staged source facts -> validation -> dedupe
                       -> reconciliation -> immutable tenant ledger
                       -> holdings projection + private journal
```

**Hard rule:** An adapter is a read/query component, not a database writer or order-management API. No order place/cancel/modify, transfer or leveraged trading capability. Each consumer resolves workspace ID, connection ID and account ID from an authenticated session or tenant-scoped server job; opaque UUID values in a request are not evidence of authorization.

## Required provider responsibilities (future interface v2, additive)
- `descriptor`: provider code, auth modes, real verified per-account capabilities, sync interval limits, supported regions and known omissions.
- `connect / refresh / revoke`: performed by a trusted credential service **outside** the read-only adapter after official approval; tenant-bound state, callback, encrypted grant, expiry and denial handling.
- `discover_accounts`: only accounts explicitly consented by the provider; keyed HMAC fingerprints, not stored plain numbers.
- `read_executions / read_orders / read_positions`: bounded pagination, normalized amounts/time/source IDs, clear coverage.
- `read_cash_activity / read_dividends / read_corporate_actions`: each flagged `SUPPORTED/UNSUPPORTED/PARTIAL` and never treated as zero when unavailable.
- `shadow_read` remains current implemented read-only v1 fixture entry point. Do not break old tests until the new versioned interface/worker is shipped.
- Output includes tenant/account scoped source identity, ingest observed-time, normalized provider-time/zone confidence, native currency, commission/fee known-or-null, raw evidence hash/version, completeness and issue codes. Data precision uses `Decimal`, never binary floating money.

## Tiger-specific first release
The broker-neutral `TigerAdapter` remains fixture-only until a signed worker is qualified. Separately, `services/saas_api/tiger_oauth.py` and the Next.js Tiger connector implement a **provider-approval-gated** partner OAuth2 code flow and tenant-scoped, encrypted account/positions snapshots. These sources are not proof of production Tiger authorization: the connection UI is disabled without approved partner app configuration and a restricted broker DB role. End users must enter their Tiger account identifier after authorization; the backend verifies read entitlement against Tiger before encrypting it. Account auto-discovery, historical fills and durable sync jobs remain to be built.

Official developer references: [Tiger authentication](https://docs-en.itigerup.com/docs/authentication), [Python preparation](https://docs-en.itigerup.com/docs/prepare) and [Tiger enterprise OAuth2](https://enterprise-docs.itigerup.com/reference/oauth-2). Provider documentation is not approval for commercial third-party use.

Before any real Tiger connectivity, verify directly with Tiger:
1. NZ third-party SaaS eligibility, hosted app registration/production redirect URIs, terms and customer ownership.
2. Exactly which scopes are granted for inquiry-only `orders/transactions/positions`; prove the grant **cannot place trades**. If read-only cannot be ensured, no hosted connection.
3. The actual account types, historical start date, max request window, cursor behavior, rate limits, fills/fees/cash/FX/corporate-action coverage and official event identifiers.
4. Retail OAuth2 validity/reauthorization and refresh behavior, callback replay/state/PKCE design, account selection and revoke semantics. Previously documented 15-day consent validity must be reverified for the relevant grant.
5. Tiger SDK default local on-disk token persistence: disable or securely isolate per tenant, never allow shared session cache or copy user-issued RSA private keys.

## Trusted pipeline and errors
`session -> verified membership -> connection grant -> worker job ID -> account entitlement -> bounded query -> stage -> versioned normalize -> dedupe -> reconcile -> publish -> project`.

For retries, transient timeouts/rate limits get bounded exponential backoff with checkpoints; auth errors prompt reauthorization, permission errors are explicit unsupported capabilities. Ambiguous pages or missing records produce `PARTIAL` and a coverage gap. Broker position snapshots are comparison data, **not proof of historical fills**. Duplicates resolve through account-scoped provider IDs and version checks, never by symbol/date alone.

## Acceptance tests
- Two users with different Tiger grants can never read or modify the other's connections/jobs/evidence/accounting, including forged IDs and async queue reuse.
- All auth grants confirmed read-only; rejected/trading-capable, expired, revoked or mismatched grants fail closed. Secret exfiltration probes and callback replay tests pass.
- A multi-fill order is idempotent and never double-charges order-level fees; unknown fee stays null; timestamp and currency confidence exposed.
- Restarts and repeated historical range syncs produce identical verified executions and projection; partial historical windows do not erase old data.
- Per-provider versioned contract/fixture tests and tenant-db integration tests pass before registering another broker.

## Delivery order
Finish tenant isolation and manual ledger gate -> obtain Tiger eligibility and scope confirmation -> secure OAuth/vault -> bounded source-event model and job worker -> Tiger read-only real-account staging -> reconciliation and portfolio views -> add later brokers. No CSV uploader, no import of historical personal GitHub files, no brokerage trade operations.


## Offline durable staging status
The tenant-bound single-window worker in `services/saas_api/backfill_worker.py` now handles authenticated queue creation, unique jobs, lease fencing, expired-lease retry, source HMAC and AEAD staging with transactional job-state rollup. It consumes only injected normalized adapter callbacks, is not exposed by any public or internal HTTP route, has no production scheduler and never grants complete historical coverage. Live Tiger job dispatch, per-page cursors and verified publication require independent future approval and tests.

## Order capability expansion — separate future service, not part of P3
The read-only adapter and its encryption/RLS permissions must remain query-only. If ordering is added later, use a separately authorized **trade-capable** Tiger connection with independently granted scopes, a dedicated high-trust execution service and a disjoint runtime principal. Require a per-order human confirmation of ticker, direction, quantity, type, limit/stop prices, account, fees and risk; immutable intent IDs and idempotency; preflight balances/market eligibility; broker reconciliation of order status/partial fills; rate limits, audit, emergency shutoff and revocation. Never silently upgrade an existing read-only grant to a trading grant, place orders as a side effect of analysis/sync, or infer broker execution from an HTTP timeout. The external provider and regulatory approval for order operations will be assessed independently.

## P3 incremental page resume (offline only)
The source-only `services/broker_connectors/paged_contract.py` and `services/saas_api/paged_backfill.py` add bounded 100-fill page contracts and explicit `run_page` / `run_bounded` calls. A worker saves HMAC-encrypted fill evidence and an AES-GCM-encrypted cursor atomically in one RLS transaction under the current lease token. Migration 012 adds a capped durable 50-page counter. Cursor loops, unproven terminal pages and over-limit reads fail closed. `PARTIAL` remains the only possible coverage classification before Tiger-specific historical entitlement and cursor semantics are verified. There is **no live Tiger paging reader or scheduler**.

## P3 sync status and Tiger response probe (source-only)
The hosted `/internal/v1/tiger/sync-status` service route is HMAC-signed by the Next.js server, resolves Google subject membership afresh and executes tenant-scoped queries using the restricted broker login. The user-facing `/private/tiger/sync` page reports only account alias, window/page processing, retry/reauth hints and sanitized issue codes. It does not expose provider payloads, cursors, grant details or performance. The `historyVerified` field remains false independent of window completion.

Tiger's published [Get Order Transactions](https://enterprise-docs.itigerup.com/reference/get-transactions) documentation confirms a GET endpoint, required `accountId`, optional `orderId`, `limit` up to 100, bearer authorization and `X-TIGR-UID` for the documented context. `tiger_history_probe.py` validates only that documented inquiry and a narrow successful response envelope using synthetic fixtures. The source **does not assume** pagination cursors, date-range support, fill field mappings, global history completeness, account-type eligibility or a valid NZ read-only user scope. Production normalization remains disabled pending real formally approved redacted provider evidence.
