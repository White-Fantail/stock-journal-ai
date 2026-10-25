# SaaS data model and source-of-truth policy
**Version:** 3.0 · **2026-10-25**

## Source hierarchy
| Data | Primary authority | Meaning / conflict rule |
| --- | --- | --- |
| Broker executions, orders, transactions and current positions | Connected Tiger account (later: respective provider) within **verified API coverage** | Raw provider evidence is immutable; provider corrections add versions/events; unknown intervals remain unresolved |
| Manual trades | Explicit authenticated user confirmation | Mark `USER_ASSERTED`; reconcile against subsequent broker observations, never silently overwrite |
| Invested rationale, thesis, targets, lessons | Authenticated user | Versioned user-authored notes, never invented or replaced by AI/broker backfill |
| Holdings, cost basis and P/L | Deterministic projection over verified facts + documented method | Recomputable, versioned and flagged if fills/fees/corporate actions/FX missing |
| Public market prices/news | Time-stamped external provider | Not equivalent to account execution price or live broker stop order |

## Present schema (maintain migrations in place)
- `001_identity.sql`: `saas_users`, `saas_workspaces`, `saas_workspace_memberships`, workspace settings and initial journal support.
- `002_broker_links.sql`: `saas_broker_connections`, `saas_broker_accounts`, `saas_broker_sync_runs`, tenant FK/RLS and opaque credential references.
- `003_trade_events.sql`: `saas_trade_events`, `EXECUTION/VOID` immutable user assertions, idempotency and integrity checks.
- `004_csv_imports.sql`: **immutable historical migration**, not a current customer feature.
- `005_remove_csv_imports.sql`: guarded removal of empty CSV staging; does not remove the applied-migration version ledger.
- `006_journal_security.sql`: tenant-scoped immutable strategy/thesis/review/watchlist events plus shared HMAC nonce and rate-limit tables.
- `007_trade_runtime_login.sql`: dedicated least-privilege `saas_trade_app` database role; password set through guarded deployment secrets, not stored in Git.
- `008_tiger_oauth.sql` / `009_tiger_runtime_login.sql`: Tiger encrypted grants and restricted broker login.
- `010_broker_backfill_staging.sql`: durable backfill jobs, bounded windows, HMAC-keyed encrypted evidence (staging only, not ledger publication).

These migration names and checksums must remain stable on all deployed DBs. This is not a production-status assertion.

## Required next relational families (future forward migrations)
`saas_broker_source_events`, `saas_broker_executions`, `saas_broker_cash_events`, `saas_broker_corporate_actions`, `saas_sync_checkpoints`, `saas_reconciliation_issues`, `saas_projection_versions`, `saas_position_snapshots`, typed, versioned `saas_journal_records` (already implemented), `saas_ai_consents`, `saas_ai_analyses`, `saas_audit_events`, and retention/deletion state. Final table definitions follow reviewed migrations, not this proposal.

Every private table includes `workspace_id` and scope-aware primary/foreign keys. Money/quantities use `NUMERIC`/Decimal; timestamps store UTC and raw provider time/offset evidence; fees can be NULL. Credential vault secrets and plaintext brokerage account numbers are **not** table fields.

## Import and replay protocol
1. Verify caller/workspace/connection/account/grant server side. Record a tenant-scoped sync job with a bounded coverage interval (initial backfill split into safe windows).
2. Fetch paginated source events; carry provider source ID, order vs execution identity, provider timestamp/offset, payload/version hash and fetch metadata. If a source identity is weak, assign a collision-aware fingerprint and require reconciliation.
3. Stage records and mark paging/coverage as `COMPLETE`, `PARTIAL`, `UNSUPPORTED` or `FAILED`. Do not equate empty results with full historical coverage.
4. Normalize in adapter versioned format; reconcile fills/orders, multi-fill commissions (do not duplicate fees), splits, dividends, fees, FX, transfers and account-specific timezones. Unknown values stay unknown.
5. Publish verified source events transactionally with unique keys scoped by `workspace_id + broker_account_id + provider_fill_id + version`. Corrections are append-only with superseding references.
6. Project positions and P/L in a declared accounting method; compare to broker snapshots without using snapshots to manufacture past executions. Surface exception details to that user.
7. Keep user notes and derived AI work independently versioned so resync cannot erase original annotations. All exports/deletions are tenant-bounded and audited.

## Offline FIFO accounting foundation (P4 source-only)
`services/broker_connectors/fifo_projection.py` accepts only caller-certified time-, currency-, history- and corporate-action-complete synthetic-style verified executions. It uses Decimal FIFO in native currency, prohibits short selling and ambiguous same-time fills, treats missing acquisition/disposal fees as UNKNOWN (not zero), and never converts a point-in-time snapshot into missing execution history. FX, dividends, tax, unrealized P&L and broker-statement reconciliation are not yet available; the result is not a verified customer portfolio or a persisted projection.

## Offline P4 reconciliation gate
`services/broker_connectors/reconciliation.py` accepts explicitly certified account/window/execution evidence and a broker position snapshot at the exact declared as-of instant. It checks every requested window for gaps/overlaps, independent provider coverage, order/cash/corporate-action reconciliation, idempotent same-ID replay versus version conflicts, suspicious same-economics distinct-ID duplicates, finite positive Decimal quantities/prices, known fee and fee currency, verified execution timestamps, and exact per-symbol native-currency quantity equality. Only if every gate succeeds may the source-only function return native-currency FIFO positions; every other result returns `BLOCKED` with no balances or P/L. Certification is not derived from P3 pages, and no production caller can assert the provider proof yet. All tests use synthetic facts.

The private `/private/portfolio` screen reads actual authenticated Tiger connection/sync *metadata*, shows readiness and unresolved issues without creating transactions or revealing encrypted source evidence. It intentionally shows all financial values as `미확인` until independent source verification, a safe projection publisher and account-scoped durable versioning exist.

## P4 append-only issue journal and attested staging (migration 014)
`saas_reconciliation_versions` is immutable per-account decision history (`BLOCKED` or `STAGED`). `saas_reconciliation_issues` stores sanitized issue codes keyed to that version. Repeated identical evidence and attestation outcome are idempotent; changed facts or newly valid provider proof create a higher version without mutating old decisions. Version fingerprints and source identities are HMACs, not plaintext remote fill IDs. `saas_verified_execution_stage` and `saas_projection_position_stage` contain only fully reconciled, native-currency amounts in private tenant-RLS staging. Every table grants only SELECT/INSERT to the limited broker role; no update/delete or customer-facing financial publication path exists.

`reconciliation_store.record_reconciliation` remains internal-only and off by default via `SAAS_P4_RECORDING_ENABLED`. A mathematically valid input still creates only a BLOCKED review unless a *separately issued* HMAC attestation matches the entire canonical tenant/account evidence and both Tiger official partner/strict read-only approval settings are active. `SAAS_P4_ATTESTATION_KEY` (private 64-char hex) is not an issuer; no live attestation issuer is implemented. CI uses synthetic signed fixtures. The signed customer `review-status` route returns latest decision/version/issue codes only; it never returns staged positions, source IDs or cost basis.

## Backfill worker (P3 staged, not live)
`011_backfill_worker_fencing.sql` adds a fresh UUID lease token for each claimed window. `services/saas_api/backfill_worker.py` checks authenticated ownership and Tiger grant/account status before each claim and commit, scopes a limited broker DB transaction, uses a 90-second lease with SKIP LOCKED and caps retries at five. It stages normalized fill evidence with keyed HMAC IDs and authenticated encryption, without publishing to positions or customer journals. Repeated source versions are idempotent; conflicting source versions remain independently staged for later reconciliation. No customer HTTP endpoint, scheduler, credential-backed Tiger reader, cursor-resume integration or independent history certification is provided yet. The current worker marks source coverage PARTIAL by design.

## P3 paginated recovery (offline)
Version 012 adds a 50-page window counter. Encrypted continuation cursors use window+tenant+account-bound AEAD and commit transactionally with encrypted staged fills. Dedupe keys are per-account HMACs; successful pages reset consecutive-failure attempts and release the fencing token for another explicit bounded invocation. A terminal page remains partial until provider history, fee and timezone semantics are independently verified. No live Tiger SDK, autonomous dispatcher or portfolio publication is enabled.

## P3 dispatch queue (migration 013)
The metadata-only `saas_broker_dispatch_queue` has composite workspace/job FK, due timestamp and a short fenced claim. `saas_dispatch_app` inherits only `saas_broker_dispatch_runtime`, cannot read grant ciphertext, account secrets, staged evidence or trade events; the broker runtime writes queue entries under FORCE RLS. Each dispatched job is checked again against ACTIVE workspace owner and current read-only grant before an offline-injected page reader is invoked. No production polling service exists and the queue cannot itself authorize an account.

## Privacy and deletion
Provider data exists in the user-specific private DB, never in Git, CI fixtures, S3 public buckets, error telemetry or model prompts without explicit scope. Document retention/backups/revocation and user export/delete. Deleting a Git file does not retroactively purge public Git commit history.
