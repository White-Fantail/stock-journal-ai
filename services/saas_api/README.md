# Positionary — Railway internal SaaS API

Python service `services/saas_api/server.py` exposes `/healthz` and HMAC-signed **internal** endpoints for Google-subject resolution, tenant-authored financial journals/trades, review and risk data, broker consent/readiness metadata, limited owner-only Tiger observations, quota, bounded export and account deletion. There is **no public user trading API**.

## Active module map

| Module | Function |
| --- | --- |
| `identity.py` / `account.py` | Google subject provisioning, workspace membership, account deletion |
| `request_security.py` / `server.py` | Signed internal requests, nonce/replay/rate limits, defensive dispatch |
| `trades.py` / `trade_detail.py` | Append-only manual user-asserted trade/correction details |
| `journal.py` / `journal_plans.py` | User-authored journal and append-only plan revisions |
| `plan_checkins.py` / `action_followups.py` | Review and independently self-reported next-action status |
| `investor_principles.py` / `risk_factors.py` | Personal principles and overlapping risk-classification revisions |
| `weekly_process.py` / `monthly_process.py` | Habit/process reports, not verified monetary performance |
| `ai_quota.py` | Per-user/period AI quota only; **not** raw prompt/response persistence |
| `tiger_oauth.py` | Partner OAuth/vault; gated on explicit provider business approval |
| `backfill_worker.py`, `paged_backfill.py`, `sync_dispatcher.py` | Trusted, bounded source-staging/dispatch foundation; not public data authorization |
| `reconciliation_store.py`, `ledger_publication.py`, `ledger_read.py` | Separately attested source lineage/publication, fail-closed private historical data |
| `schema_admin.py` | Guarded main-only, pre-deploy PostgreSQL migration runner |

## Runtime policy

- Vercel Auth.js holds user sessions. Every signed request is subject-bound; the API resolves fresh membership. Never trust supplied workspace or client account selectors.
- `SAAS_DATABASE_URL` provides identity and DB administration; manual trading/journal uses `SAAS_TRADE_DATABASE_URL` with `saas_trade_app` and FORCE RLS; broker source and selected private reads use `SAAS_BROKER_DATABASE_URL` with `saas_broker_app`. Additional publication and dispatch logins have separately restricted privileges.
- The API protects HMAC, timestamps and one-time nonces. Do not log request bodies, provider tokens, original broker account numbers, private source payloads, user decisions or signing keys.
- **All 27** migrations are immutable reviewed history. The retired CSV migration sequence 004/005 must remain as SQL, not as an import feature.
- Signed internal endpoints for owner-only Tiger snapshots/observations require an exact configured Google subject. All other customers only see separately approved OAuth, or the approval-pending state.
- No historical fill/fee/FX/corporate-action gap may be auto-filled. Broker publication needs official read-only approval, independent attestation, release keys and the latest valid review. The code alone does not provide those.
- No trading/place/cancel/transfer endpoints, price-triggered alerts, polling of market quotes, or unconsented model inference.

## Deployment and checks

Guarded Railway **pre-deploy**, not runtime:

```sh
python -m services.saas_api.schema_admin --deploy
```

Read-only status in the correct production environment:

```sh
python -m services.saas_api.schema_admin --status
```

Local disposable PostgreSQL migrations require a dedicated test DB and explicit `SAAS_TEST_DB_ACK=YES_DISPOSABLE_SAAS_DB`. CI runs pinned Python, negative tenant/RLS/HMAC tests, and Chromium journeys against a local signed API; real provider and Google OAuth require separate operational verification.

See [Architecture](../../docs/ARCHITECTURE.md), [Data model](../../docs/DATA-MODEL.md), [Database runbook](../../docs/saas/HOSTED-SCHEMA-BOOTSTRAP.md) and [Tiger OAuth prerequisites](../../docs/saas/TIGER-P3-OAUTH.md).
