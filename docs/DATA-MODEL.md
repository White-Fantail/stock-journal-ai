# Positionary — data model, provenance and publication rules

**Current schema:** immutable PostgreSQL migrations `001`–`027` in `db/saas/migrations/`, deployed by `schema_admin.py` with checksum validation. Never edit an applied migration, including discontinued CSV migrations 004/005; add a forward migration only.

## Source-of-truth hierarchy

1. **Tiger/provider records:** raw read-only observations and documented time/account coverage. An order may split into multiple executions. Unknown fee currency, partial response, absent pages and unverified time zones remain unknown.
2. **User records:** separate `USER_ASSERTED` immutable manual EXECUTION/VOID events; journal notes, thesis, independent plan rationale and versions, watchlist, user-selected risk classifications, plan check-ins, next-action confirmations and investor principles.
3. **Reconciliation/attested facts:** independently certified broker fill/source lineage, signed release, bounded private historical FIFO projection. No inference from a quote or a user-entered fill.
4. **AI output:** ephemeral evidence-based commentary; never source authority, journal revision, trade or proof of compliance.

A missing row/page is **not zero**, and a successful import is **not complete account coverage**. Date/currency/source/verification status must accompany all monetary displays. Never sum unrelated currencies or overlapping risk-factor percentages.

## Applied migration groups

| Versions | Persistent purpose |
| --- | --- |
| 001–003 | User/workspace/membership, broker link metadata, immutable manual trade events |
| 004–005 | Old CSV staging creation/retirement **only for immutable historical checksum continuity**; upload is not a feature |
| 006–009 | Journal and signed-request security, restricted trade login, Tiger OAuth vault and broker login |
| 010–013 | Source staging, bounded worker lease/paging, scheduled dispatch queue contracts |
| 014–015 | Reconciliation/audit, issues, immutable original source lineage and attestation dependencies |
| 016 | Immutable user plan rationale, targets and stop annotations |
| 017–018 | Publisher role, signed immutable broker-ledger releases, scoped fill-to-user-note associations |
| 019–022 | Restricted US market quote observations, Tiger order observation note links, AI quotas, personal sync health |
| 023–027 | User investment strategy and cadence, self-assessment check-ins, risk factors, principles, follow-up action outcomes |

Use SQL files—not this overview—as authority for column definitions and RLS grants. `services/saas_api/schema_admin.py` defines the approved migration manifest, exact environment guard and database role initialization.

## Financial publication safety

```text
read-only provider evidence (encrypted + scoped)
 -> bounded staging (deduplicated immutable provider source IDs)
 -> completeness check: orders/fills/fees/cash/FX/corporate actions
 -> independent source-linked reconciliation and signed attestation
 -> explicit restricted publisher + signed immutable release
 -> fresh latest-review/consent/lineage verification on every private read
 -> historical native-currency fills, positions and FIFO basis (bounded)
```

Publishing is **not** automatically enabled by migrations or clean CI. Flags, official provider read-only approval, source evidence, separate signing keys and issuer are required. Later BLOCKED review, revoked grant or changed source evidence prevents affected figures from being currently verified; historical release audit rows are not erased. Customer-authored execution events remain independent.

Ticker rationale and self-reviews are append-only. Changing a stop or target creates a new plan revision; it never creates or modifies a broker order. An action follow-up is user-confirmed `DONE`, `NOT_DONE`, `NOT_APPLICABLE` or `UNCERTAIN`, not automated compliance proof.

## Views and interpretation

- Owner-only Tiger live-ish snapshot and delayed quotes provide timestamped **observation estimates**, not independently verified cost basis.
- Private `ledger_read.py` offers signed, scoped historical proof **only** for released and still-valid accounts; the UI otherwise shows readiness/unknown state.
- Monthly process comparisons may be generated from user actions; financial performance percentages are intentionally withheld until authoritative NAV/FX/fees/cash-flow evidence is independently complete.
- Display-currency preferences do not authorize silent FX conversion. Use Decimal/fixed-point for money.
- Export is a bounded, complete workspace-authored JSON view or fails closed; deletion removes tenant-owned personal data through guarded flows. Do not log plaintext notes, keys, raw source IDs or full private payloads.

## Retention and privacy

Public GitHub is not a database or archive for client data. Only synthetic test fixtures belong in the tree. See [Operations](OPERATIONS.md) for active-history privacy limitation, secret handling, backup and verified restore tasks, and [Broker adapters](saas/BROKER-ADAPTERS-V1.md) for source paging/coverage.


## Optional risk-decision note (migration 028)

- `saas_journal_plan_revisions.risk_decision_note` is nullable, 1–1200 characters when present, append-only, tenant-owned and user-authorized. Legacy revision content/digests are preserved.
- Only user-approved hypothetical scenario assumptions and user judgment are persisted, never a quote feed, broker-verified balance, computed real trading profit or broker order. This narrative may become stale and is historical context, not a live risk grade.
- Complete read/write permissions continue under existing FORCE RLS scoped to the authenticated workspace/user.


## Manual indicators (migration 029)

- `saas_indicator_rule_revisions` stores immutable tenant-owned JSON definitions,
  stable rule IDs and idempotency hashes. Edits require the expected latest
  revision; serialized tenant writes prevent concurrent overwrites.
- `saas_indicator_records` stores exact user-entered decimal strings, the original
  timezone-qualified observation time, immutable server-resolved rule snapshots,
  comparison/self-assessment provenance and an optional composite tenant FK to
  one manual execution or journal entry. Ticker and manual execution direction
  must match. Numeric comparisons use Decimal; missing values stay unknown.
- Both tables use FORCE RLS and SELECT/INSERT-only trade runtime grants. Rule
  revision IDs and trade/journal links are resolved within fresh authenticated
  tenant scope. No provider observation or trading endpoint is added.
- Complete bounded exports include both tables; owner account deletion removes
  them before their journal/trade/membership parents. No existing SQL is changed.
