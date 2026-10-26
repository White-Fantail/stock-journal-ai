# Positionary

> **Brand:** Positionary is the public product name. The technical repository and deployment identifiers may remain `stock-journal-ai` until a separately reviewed rename.

> **P0–P3 source baseline (2026-10-26):** The active Git branches have been rewritten onto a parentless clean root with no historical customer finance files. GitHub retains old SHA objects/caches pending upstream cleanup. P1/P2 Google identity, HMAC nonce/rate protection, tenant journal, export, account removal and dedicated runtime DB login have CI coverage. **Production P2 activation remains off pending real two-user Google sign-in, production DB-role and backup/restore evidence.** See [P3 readiness gates](docs/P3-READINESS.md).

> **Current direction (2026-10-25):** A multi-user, Google-first, privacy-first investment journal and analysis SaaS. **Tiger Trade / Tiger Brokers is the first broker adapter.** The broker is authoritative for broker-provided facts; each authenticated workspace owns its own derived journals, annotations and projections. This public GitHub repository is **source code and documentation only**, never a customer portfolio datastore.

## Product
- A customer signs in with Google and receives a private workspace; no GitHub login or account is required.
- First broker: **Tiger**, with a guarded per-user enterprise OAuth2 authorization-code flow, encrypted grant vault and tenant-scoped asset/position snapshots in the `dev` source. Real authorization stays disabled until commercial approval, exact read-only scopes and dedicated runtime DB are verified. Adapters for other brokers are planned.
- On approved connection, bounded, replay-safe imports will discover authorized accounts, fetch executions, positions and supported account activity, verify coverage, reconcile differences, and construct a normalized portfolio and journal in a tenant-isolated database.
- Manually confirmed trades and authored investment notes remain possible independently; they are **clearly distinct** from broker-confirmed facts. The retired customer CSV importer will not be reintroduced.
- AI-assisted trade reviews, research, strategy tracking and alerts will be opt-in. This is **not** an automated order execution, custody or investment-advice service.

## Verified source-code status — not a production acceptance certificate
| Area | Repository state | Remaining gate |
| --- | --- | --- |
| Google/Workspace | Auth.js Google flow, backend provision/resolve and membership checks exist | Verify live signed-in two-user isolation, backend roles and operational safeguards |
| Multi-tenant SaaS DB | Versioned schema 001–009, FORCE RLS and hostile A/B vault tests exist | Verify actual hosted schema, least-privilege runtime roles, backup/restore |
| Manual trade log | Tenant event and compensating-VOID code, feature-gated UI | Enable only after negative HTTP isolation and deployment tests |
| Tiger | Provider picker, guarded OAuth2 callback, AES-GCM grant vault, refresh/revocation, manual account binding after authorized Tiger GET, encrypted asset/position snapshots; CI-tested in `dev` | Obtain Tiger NZ third-party app approval, prove query-only scopes, configure secrets/dedicated RLS DB, test live account and add durable transaction backfill worker |
| Portfolio, review and AI | Versioned private P4 staging and independently signed **disabled** broker-ledger release gate; user-authored journal UI exists | Verify live Tiger source/coverage, add independent issuer and customer-visible broker ledger/portfolio, then opt-in AI |
| CSV ingestion | Retired | Keep historic migration 004/005 for checksum continuity, **no uploads** |

The existing Vercel and Railway service configuration is not evidence that every flow is operational. Tiger live authorization, transaction backfill, reconciliation, payments and public launch are **not** certified by this README. The P3 connection UI is not a functioning production login until official Tiger partner authorization is approved.

## Repository layout
- `apps/web/` — Next.js authenticated web application
- `services/saas_api/` — Python internal HMAC API and guarded hosted schema runner
- `services/broker_connectors/` — provider-neutral read-only contract, registry and initial Tiger adapter
- `services/tiger_sync/` — reusable **offline-only** bounded Tiger normalization/collection utilities
- `services/saas_api/tiger_oauth.py` — separate enterprise OAuth2 grant service (currently fail-closed without third-party approval)
- `db/saas/migrations/` — immutable SaaS schema chain (001–009; 004/005 retained solely for history)
- `tests/`, `scripts/verify_saas_*.py` — synthetic data and isolation tests
- `docs/` — current product, design, operating and milestone documents

**Tiger P3 deployment controls:** [Partner OAuth and vault runbook](docs/saas/TIGER-P3-OAUTH.md). Source-code tests on `dev` do not grant Tiger production approval.

**P4 release gate:** [Private broker-ledger publication contract](docs/saas/P4-PUBLICATION.md). The dedicated publisher login has no password by default; the release flag is off and no production publication endpoint exists.

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
