# Positionary — operations and release runbook

**Updated:** 2026-10-27. Production website: `https://positionary.vercel.app/`. GitHub repo: `White-Fantail/stock-journal-ai`; production deploys from `main` only.

## Release workflow

1. Read [AGENTS](../AGENTS.md), [Architecture](ARCHITECTURE.md) and [Data model](DATA-MODEL.md). Change only `dev`; do not modify previously applied SQL or introduce personal data.
2. Validate on `dev`: `python scripts/check_public_repo.py`; under `apps/web/`, `npm ci --ignore-scripts --no-audit && npm run typecheck && npm run test:security && npm run build`. Run relevant `python -m unittest` suites and disposable PostgreSQL tests using the SaaS GitHub Actions workflow.
3. Require **both** GitHub SaaS workflow jobs: `saas-postgres-isolation` and `Synthetic browser user journeys (Chromium; no live OAuth)` (job ID `browser-journeys`). The browser job exercises local signed API, disposable PostgreSQL, synthetic A/B authentication and mobile viewports. It does **not** test real provider OAuth.
4. Verify `dev` only differs by reviewed changes; **fast-forward** `main` from the exact verified dev SHA (never squash/merge commit/force). Only `main` triggers Vercel and Railway production builds.
5. Confirm production Vercel READY and domain aliases; Railway API and Tiger personal runner SUCCESS on the **same SHA**; API `/healthz`; migration version/checksum status; web runtime error summary; then review `main` CI, including final deployed SHA.
6. If CI fails, **do not** describe the release as fully verified. Triage and fix on `dev`, re-run, and fast-forward again. Do not bypass financial approval gates. GitHub main protection/required-check enforcement is an outstanding operational configuration until confirmed.

## Database and credentials

- Railway API pre-deploy calls `python -m services.saas_api.schema_admin --deploy`, with approved manifest, pinned main/project/service/environment, `SAAS_AUTO_MIGRATE=1` and `SAAS_MIGRATION_BACKUP_VERIFIED=1` after actual backup assurance. Startup and web requests must **never** run DDL.
- Production source has **29** sequential migrations (including the manual-indicator forward migration). Guarded executor checks historical checksums and refuses drift; never change applied SQL (including retired CSV 004/005).
- Private Railway environment: `SAAS_DATABASE_URL` (identity), `SAAS_TRADE_DATABASE_URL` plus `SAAS_TRADE_RUNTIME_PASSWORD` (`saas_trade_app`), `SAAS_BROKER_DATABASE_URL` plus `SAAS_BROKER_RUNTIME_PASSWORD` (`saas_broker_app`) when needed; separated publisher/dispatch roles are approval gated.
- Vercel server-only: Auth.js/Google configuration, `SAAS_INTERNAL_API_URL`, `SAAS_INTERNAL_SECRET`, and optionally `OPENROUTER_API_KEY`/`OPENROUTER_MODEL`. Do not put secrets in `NEXT_PUBLIC_` or logs.
- Tiger personal RSA and account variables exist **only** on the isolated personal Railway runner; they must never be copied to GitHub, Vercel, or general customer OAuth service.
- Verify restricted roles are `NOSUPERUSER NOBYPASSRLS`, table FORCE RLS, cross-tenant denial, nonce replay rejection, real backup restore and permission-scoped audit. See [schema runbook](saas/HOSTED-SCHEMA-BOOTSTRAP.md).

## Broker status and incident checks

- Owner-only Tiger bridge may produce `PERSONAL_*_OBSERVATION` data, daily snapshots and partial financial probes. Investigate source/stale timestamps, covered windows, scope mismatch and unavailable fee currency before UI interpretation.
- Partner SaaS OAuth is **not** enabled by source code or a successful build. Require written provider approval, restricted read-only scopes and real-user consent/account coverage. Never call trading/order methods.
- Issuer/attestation/release gates are separate from snapshots. No financial release without validated coverage, signed review and explicit publisher approval.
- If identity API is unavailable or per-subject rate limit is hit, private routes fail closed. React request-local workspace deduplication reduces redundant membership requests; **never** replace it with cross-request cached authorization.
- If incidents involve secret leakage: revoke/rotate keys, isolate account/grants, inspect access, restore securely from verified backup, document impacted coverage and never disclose raw customer identifiers in public logs.

## Public Git history limitation

Active refs were previously moved to a clean source-only root. Do not restore deprecated `stocks/` or investor ledgers and do not merge old Git ancestors. This **does not prove** that older GitHub SHA URLs, hosted caches, Actions artifacts, forks or external clones are erased. Audit reachable artifacts and request supported GitHub sensitive-data cleanup where needed.

## Routine verification

Review account authorization, login expiry/relogin, mobile touch behavior, production domain and two-user A/B isolation independently from synthetic CI. Confirm customer privacy boundaries and export/delete without committing fixtures. Avoid price polling, quote-triggered alerts or surprise AI calls.

Related: [Product](PRODUCT.md) · [Roadmap](ROADMAP.md) · [Schema bootstrap](saas/HOSTED-SCHEMA-BOOTSTRAP.md) · [Personal bridge](../temporary/tiger_personal/README.md).
