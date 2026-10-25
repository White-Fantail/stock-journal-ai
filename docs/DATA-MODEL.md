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

## Privacy and deletion
Provider data exists in the user-specific private DB, never in Git, CI fixtures, S3 public buckets, error telemetry or model prompts without explicit scope. Document retention/backups/revocation and user export/delete. Deleting a Git file does not retroactively purge public Git commit history.
