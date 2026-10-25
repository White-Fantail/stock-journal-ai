# Stock Journal AI

> **Current direction (2026-10-25):** A multi-user, Google-first, privacy-first investment journal and analysis SaaS. **Tiger Trade / Tiger Brokers is the first broker adapter.** The broker is authoritative for broker-provided facts; each authenticated workspace owns its own derived journals, annotations and projections. This public GitHub repository is **source code and documentation only**, never a customer portfolio datastore.

## Product
- A customer signs in with Google and receives a private workspace; no GitHub login or account is required.
- The first broker connector will be **Tiger**, read-only and per-user authorized after commercial/permission/API validation. Adapters for other brokers are planned.
- On approved connection, bounded, replay-safe imports will discover authorized accounts, fetch executions, positions and supported account activity, verify coverage, reconcile differences, and construct a normalized portfolio and journal in a tenant-isolated database.
- Manually confirmed trades and authored investment notes remain possible independently; they are **clearly distinct** from broker-confirmed facts. The retired customer CSV importer will not be reintroduced.
- AI-assisted trade reviews, research, strategy tracking and alerts will be opt-in. This is **not** an automated order execution, custody or investment-advice service.

## Verified source-code status — not a production acceptance certificate
| Area | Repository state | Remaining gate |
| --- | --- | --- |
| Google/Workspace | Auth.js Google flow, backend provision/resolve and membership checks exist | Verify live signed-in two-user isolation, backend roles and operational safeguards |
| Multi-tenant SaaS DB | Versioned schema 001–005, FORCE RLS and contract tests exist | Verify actual hosted schema, least-privilege runtime role, backup/restore |
| Manual trade log | Tenant event and compensating-VOID code, feature-gated UI | Enable only after negative HTTP isolation and deployment tests |
| Tiger | Closed registry, typed read-only offline fixture adapter | Verify third-party consent/auth permissions and implement a real secured worker |
| Portfolio, review and AI | Architecture/planning | Build projections, reconciliation, insight UI and opt-in AI |
| CSV ingestion | Retired | Keep historic migration 004/005 for checksum continuity, **no uploads** |

The existing Vercel and Railway service configuration is not evidence that every flow is operational. Broker login, backfill, reconciliation, payments and public launch are **not** certified by this README.

## Repository layout
- `apps/web/` — Next.js authenticated web application
- `services/saas_api/` — Python internal HMAC API and guarded hosted schema runner
- `services/broker_connectors/` — provider-neutral read-only contract, registry and initial Tiger adapter
- `services/tiger_sync/` — reusable **offline-only** bounded Tiger normalization/collection utilities
- `db/saas/migrations/` — immutable applied-migration chain (including historical 004/005)
- `tests/`, `scripts/verify_saas_*.py` — synthetic data and isolation tests
- `docs/` — current product, design, operating and milestone documents

**Canonical documents:** [Product](docs/PRODUCT.md) · [Architecture](docs/ARCHITECTURE.md) · [Data model](docs/DATA-MODEL.md) · [Tiger / adapter contract](docs/saas/BROKER-ADAPTERS-V1.md) · [Delivery roadmap](docs/ROADMAP.md) · [Operations and privacy](docs/OPERATIONS.md).

## Development and deployment
Implement on `dev`, test, then promote to `main` by fast-forward. Only `main` should be deployed to production. The Railway API pre-deploy schema hook supports **previously reviewed** forward migrations with main/service identity pinning, checksum checking, transaction and backup-policy attestation; it does **not** authorize enabling S2 or real broker use.

```sh
python scripts/check_public_repo.py
python -m unittest discover -s tests -p 'test_saas_*.py' -v
python -m unittest discover -s tests -p 'test_broker_connectors.py' -v
cd apps/web && npm ci && npm run typecheck
```

## Public-history privacy limitation
The historical personal trade files and investment narratives have been removed from the **current** branch tree. Git commit history, old branch references, forks, pull-request diffs and caches can retain copies; a normal deletion commit cannot erase them. See [privacy remediation](docs/OPERATIONS.md#public-git-history-remediation) for the separate history-purge process. Do not treat source-tree deletion as an irreversible deletion of all previously published GitHub copies.
