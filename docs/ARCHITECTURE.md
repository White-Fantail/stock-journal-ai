# Current target architecture — Stock Journal AI SaaS
**Date:** 2026-10-25 · **Canonical design v3.0**

```text
Browser ── HTTPS ── Vercel Next.js
                   ├─ Auth.js Google OIDC, verified subject
                   ├─ server-side workspace membership + feature gates
                   ├─ journal/portfolio/analysis views
                   └─ signed internal API requests (no broker secrets)
                                    │
                                    ▼
                          Railway Python SaaS API
                   ├─ identity + tenant membership resolver
                   ├─ manual-trade event service (flagged)
                   └─ future broker-job authorization service
                                    │
                   ┌────────────────┴────────────────┐
                   ▼                                 ▼
         Railway Postgres                    Railway trusted workers
       ├─ tenant private data               ├─ tenant-bound sync jobs
       ├─ FORCE RLS + scoped roles           ├─ provider registry / adapters
       ├─ source and journal events          ├─ encrypted-credential access
       └─ projections/audit                  ├─ staging + reconciliation
                                             └─ market/opt-in AI research
                                                    │
                                      Tiger read-only first; others later
```

## Boundaries
- **Identity:** Google `sub` is immutable authority. Resolve active membership each time; email and client-supplied workspace IDs are NOT authorization. Independent owner workspace created transactionally on first legitimate login.
- **Private operations:** all endpoints require server verification; service-to-service HMAC is not a browser credential. Protect it against replay, use TLS, rotate secret, minimize privilege, rate-limit and audit. Financial API uses a distinct non-BYPASSRLS role; all queries run with scoped `SET LOCAL` tenant context under a transaction.
- **Provider connectivity:** adapters can only read. Trusted worker resolves `sync_job_id` -> workspace -> connection -> permitted account -> current consent/grant within the DB. Queue payload may contain only opaque job IDs. Raw account identifiers and tokens never go to browser/analytics or app DB. Encrypted secret store keeps credentials segregated by tenant.
- **Data:** separate immutable source observations from normalized executions, ledger/accounting events, user narratives and derived snapshots. Worker writes to staging first. Publish only validated, idempotent, reconciled facts. No broker response means `UNKNOWN/PARTIAL`, not success or a zero balance.
- **Research:** public market data isolated from private workspaces; AI requests only after consent, minimal payload, supported model/provider retention and budget settings. A model can propose commentary, never execute trades.
- **Operations:** main-only Vercel and Railway production deployments, reviewed automatic pre-deploy SaaS SQL migrations (no DDL during HTTP startup), observable logs with redaction, backup+restore rehearsals, service health and error handling.

## Existing code vs target
| Component | Currently in source | Missing for complete target |
| --- | --- | --- |
| `apps/web` | Google Auth.js, private pages, broker readiness, manual trade feature gate | polished portfolio, onboarding, reconciliations, full E2E |
| `services/saas_api` | internal identity and manual trade service, HMAC, schema admin | broker job API, distinct runtime permission hardening |
| `db/saas` | identity, broker-link and manual trade tables (001–005) | provider facts, projections, rationale, deletion/retention, market/AI schema |
| `services/broker_connectors` | strict provider registry, Tiger offline adapter and contract | approved hosted Tiger grant, worker, complete normalized data |
| `services/tiger_sync` | bounded order/fill/position parser and synthetic tests | refactor as provider-only reusable library; no legacy DB |
| `scripts/verify_saas_*` | synthetic isolation checks | production-equivalent connected two-user security suite |

## Decisions
Keep the SQL migrations 004 and 005 unchanged **as applied-version evidence**, despite the discontinued CSV feature. Do not reset a live database to remove this history. Do not resurrect deleted personal GitHub files. Preserve ability to add other broker adapters without changing tenant authorization or journal contracts.
