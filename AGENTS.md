# Positionary — agent development rules

**Current product:** Google-first, multi-tenant, **long-horizon investment journal** running on Next.js/Vercel, Python/Railway and PostgreSQL with Tiger Brokers as the first read-only provider. The repository remains `White-Fantail/stock-journal-ai`, public and **source-only**. All customer data stays in private tenant-scoped storage.

## Read before changes

- [Product](docs/PRODUCT.md): current user experience and explicit exclusions.
- [Architecture](docs/ARCHITECTURE.md): runtime and trust boundaries.
- [Data model](docs/DATA-MODEL.md): provenance, release and applied migrations.
- [Roadmap](docs/ROADMAP.md): current **remaining** work; historical development bundles are retired.
- [Operations](docs/OPERATIONS.md): safe release workflow.
- [Broker adapters](docs/saas/BROKER-ADAPTERS-V1.md): provider limitations.

Treat those documents as descriptions of the active product, **not authorization** to enable gated financial integrations.

## Mandatory engineering and release constraints

1. Make all changes on `dev`; verify then fast-forward `main` only. No squash/merge commits or forced promotion; only `main` triggers Vercel/Railway production deploy.
2. Run `python scripts/check_public_repo.py`, relevant Python/Next tests and both SaaS GitHub CI jobs. Inspect failures rather than suppressing tests. After a main promotion confirm main CI, Vercel READY, Railway health and identical source SHA. CI green does **not** certify real Google OAuth or provider APIs.
3. Never add private financial records, brokerage statements, screenshots, RSA keys, emails identifying clients, secrets, legacy `stocks/`, `portfolio/`, `reports/` or customer CSV importer data. Prior GitHub personal-ledger model is retired; active tree cleanup does not erase historical GitHub caches.
4. Existing `db/saas/migrations/001–027` are applied historical SQL; **never edit/delete/reorder** them or their checksums. New migrations must be forward-only, reviewed, in the guarded manifest, tested on disposable Postgres and applied via Railway **pre-deploy** only. No DDL in request handling.
5. All server routes/actions derive Google subject, membership and internal workspace/account from **fresh session-side authorization**, never browser-supplied workspace identifiers. `currentWorkspace()` may memoize only **within a single React server request**; never cross-request cache rights.
6. Require HMAC signed internal requests, one-use nonce, scope/rate guards and non-BYPASSRLS restricted FORCE RLS roles. Test A/B tenant isolation, deletion/export and negative authorization boundaries. Missing data must fail closed, not turn into fabricated zeros.
7. Keep **read-only Tiger contract**. No place/modify/cancel orders, fund transfer, SDK private keys in browser or customer-uploaded RSA keys. Owner-only temporary RSA observations apply to **one configured Google account**, not the multi-user partner approval.
8. Official Tiger partner OAuth must remain disabled until written authorization, query-only scope audit, per-user grant consent, dedicated vault/role and real account/coverage verification. A successful test or present DB schema never grants trading/market-data redistribution rights.
9. Distinguish order, partial execution, actual fill, fee and currency. Preserve UTC/original timestamps, provider provenance and partial history. No account returns, realized/unrealized profits, cost basis or verified holdings without the corresponding audited source and independent publishing gates.
10. Financial release, once eligible, requires immutable source lineage, independently signed attestation, exact review version and fresh latest-review check. A revoked grant or newly BLOCKED review suppresses present verified status without erasing immutable history.
11. Manual trades, targets, stops, theses, investment strategy revisions, self-assessments and action statuses are **user-authored**. Never turn AI output, user assumptions, broker observations or price movements into broker orders or verified execution facts.
12. **No price alerts** (live or delayed), quote-triggered trade signals, auto-trading, background quote polling, price-driven push notifications or day-trading UX. Conservative bounded observed quotes are passive context only; periodic review follows the user's own cadence and data-health conditions.
13. List pages browse/search/navigate; **create/edit/correct in dedicated pages**, never inline forms. Build responsive/mobile-first views, particularly 320–1024 px, avoid horizontal overflow and do not reintroduce fragile client-side private navigation.
14. AI is **user-triggered** with fresh explicit consent, bounded data, provider ZDR/data_collection denial, quota, source references and output validation. Remove structured secrets/financial quantities; prose redaction is best-effort and must be disclosed. Never auto-store AI output as user-authored decisions.
15. Never claim a feature is production-verified solely from source or synthetic CI. Real account/device/provider/backup verification is a separately recorded operator activity. GitHub status checks on `main` must be enforced by repository administration; don't assume protection from a green one-time build.

## Runtime references

- `apps/web/app/private/` — active UI pages and dedicated authoring routes.
- `apps/web/lib/require-workspace.ts` — request-scoped membership, no cross-tenant caching.
- `services/saas_api/` — signed internal API + schema administrator.
- `temporary/tiger_personal/` — isolated personal read-only runner (remove only after safe OAuth handoff).
- `services/broker_connectors/` — neutral read-only contracts, offline reconciliation.
- `db/saas/migrations/` — immutable reviewed schema history.

Do not resurrect old P0–P6 delivery-status narratives as live source of truth. Update the concise canonical docs when behavior actually changes.
