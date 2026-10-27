# Positionary — read-only broker adapter contract

**Tiger first.** `services/broker_connectors/contracts.py` and `registry.py` are the source contract. A provider declaration describes *possible* capabilities; it is not evidence of a currently approved user grant.

## Interfaces and permissions

- `BrokerDescriptor`: provider code, status (`NOT_ENABLED`, `REQUIRES_REVIEW`, `ENABLED`), auth modes and declared capabilities.
- `BrokerAdapter.shadow_read(BrokerSyncRequest)`: a **query-only** batch. It does not have an order-placement, cancellation, money-transfer or authenticated publication interface.
- `BrokerSyncRequest`: trusted internal tenant, connection, account UUIDs and a bounded, timezone-aware `SyncWindow`. These values must be obtained server-side from fresh consent + owner membership.
- `BrokerSyncBatch`: source provider, `COMPLETE/PARTIAL` observation label, fills, positions, order counts and validation issues; a COMPLETE provider page does **not** attest complete historical account activity.
- `BrokerFill`: separate order and fill IDs; native-currency Decimal price, quantity, optional fee, normalized execution time plus raw timestamp and confidence. `fee_total=None` means **unknown**, not zero.

Do not reuse another provider's token, scope, account selector, immutable IDs or error codes. Keep account-specific pagination and import idempotence. A missing page, absent fee currency, unknown corporate action, incomplete interval or incompatible timestamp blocks broker-verified projections.

## Pipeline and release

```text
fresh Google workspace authorization
 -> provider/account permission and query-only grant
 -> trusted bounded read (no browser-supplied identifiers)
 -> encrypted source staging, dedupe, coverage metadata
 -> reconcile orders/fills/fees/cash/FX/corporate actions
 -> independent account attestation + source lineage
 -> restricted signed immutable publication
 -> private latest-valid-review ledger/FIFO read
```

The backend implements **offline/staged infrastructure**: `backfill_worker.py`, `paged_backfill.py`, `sync_dispatcher.py`, `reconciliation_store.py`, `ledger_publication.py`, `ledger_read.py`. Having these modules and schema versions 010–018 does **not** enable automatic customer backfill, grant signing, trading or financial publication. The dispatcher requires explicit trusted runtime wiring and independent approval.

## Tiger delivery distinction

**Personal owner-only bridge:** `temporary/tiger_personal/` uses an isolated Railway RSA credential runner that supplies read-only observations to a specifically allowlisted Google subject. This is *not* an authorized SaaS grant for other accounts. It can observe holdings/orders/fees/quote context, with partial coverage and unverified financial classification. See [personal bridge](../../temporary/tiger_personal/README.md).

**Partner OAuth:** `services/saas_api/tiger_oauth.py` provides a conditional hosted grant implementation with encrypted vault, callback replay checks and scoped account reads. Public enablement requires Tiger written third-party SaaS consent, exact non-trading scopes, secure read-only SDK handling, supported countries, permission testing, and evidence of historical finance/API completeness. See [Tiger OAuth](TIGER-P3-OAUTH.md).

A second broker is future work. Register it independently in the neutral registry, validate scope/currency/time semantics, and repeat complete tenant A/B negative testing before enabling it.

## Invariants

No market-price events or quote polling, automatic target/stop actions, invented fills, fee defaults, automatic journal entries or silent cross-currency totals. Every UI projection must show date, coverage and user/observed/verified source distinction. Further safety detail: [Data model](../DATA-MODEL.md).
