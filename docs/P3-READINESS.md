# P3 Tiger adapter readiness gate — evidence and remaining obligations
**Date:** 2026-10-25 (NZDT) · **Scope:** P0 + P1 + P2 completion assessment

## Tested engineering foundation
- Three Git branch refs were rewritten onto a single **parentless** code-only root. Current tree contains no legacy investor trade CSV, personal stocks, reports or import snapshots.
- Auth.js Google `sub` sessions resolve a real, tenant-bound workspace using the Railway identity API. Separate tenant A/B PostgreSQL RLS integration tests and signed HTTP adversarial checks pass with synthetic users.
- Internal API signatures now bind a one-use nonce; PostgreSQL nonce/replay and route-subject rate tables are applied as migration 006.
- Tenant manual trade EXECUTION/VOID events, immutable typed investment notes, strategy revisions, reviews, watchlist events, scoped detail view, bounded complete JSON export and confirmed account-deletion flow are in source and tested in CI.
- Migration 007 adds a passwordless-by-default restricted `saas_trade_app` login, configured during guarded Railway pre-deploy with a private 64-hex secret; runtime DB URL must use the restricted role.
- A repository using synthetic, disposable PostgreSQL 18 in CI can bootstrap, apply guarded migrations, test A/B authorization and verify role permissions. CI backup/restore drills do not prove production backups.

## Incomplete release gates — do NOT classify P0–P2 operationally COMPLETE
1. **GitHub permanent object removal:** prior personal-data SHA objects still resolve after branch rewrites. Inspect Actions artifacts/logs, tags, unreachable cached commit objects and old deployments; request GitHub Support server garbage collection/cached-view removal as applicable. Public `forks_count` was 0 and no PRs returned at inspection, but clones cannot be revoked.
2. **Real sign-in E2E:** separately authenticate two actual Google test accounts in the deployed Vercel app, verify fresh membership checks, redirect/session/logout/expiry, forged URL IDs, trade/notes/exports, account deletion and revocation.
3. **Production runtime privilege:** verify `saas_trade_app` actually authenticates with the deployed restricted URL, is non-superuser and NOBYPASSRLS, lacks UPDATE/DELETE on financial records and cannot read another workspace. The investment journal has no runtime enable flag; access must fail closed unless these controls are satisfied.
4. **Production recovery:** verify continuous backups and perform an isolated production PostgreSQL snapshot/restore drill. A Railway environment variable asserting backup verification or a successful disposable CI restore is not evidence of live recoverability.
5. **Operational hardening:** validate rate limits under multi-instance load, service HMAC/Google secret rotation, failure logging/alerting, and data retention/deletion from backups. Preview builds and rollback revisions must not expose prior real financial artifacts.

## Tiger P3 engineering work allowed now
- Design the trusted tenant-bound sync-job state machine, source/provenance schema and capability-checking adapter version without touching real broker grants.
- Reuse fixture-only Tiger collector to exercise pagination, partial history/fee/FX confidence, idempotent source events and replay.
- Verify with Tiger **commercial third-party SaaS eligibility**, NZ account support, hosted customer OAuth, exact read-only permissions and grant expiry before enabling real connection.

## Blocking P3 live broker activation
Do not enable Tiger production connections until all financial tenant data safety gates are met **and** Tiger officially confirms permission to connect third-party customer accounts with non-trading scopes. If trade placement cannot be excluded by provider grant, the service remains disconnected. No broker passwords, private keys or existing personal GitHub statement files are accepted.

## Reviewer evidence
- `.github/workflows/saas.yml` runs PostgreSQL 18 integration, signed HTTP tests and backup/restore simulation.
- `docs/ROADMAP.md` is the authoritative checked/unchecked status list.
- `docs/saas/HOSTED-SCHEMA-BOOTSTRAP.md` documents production migration and role bootstrap.
- `docs/OPERATIONS.md` records remaining public-history remediation and runtime gates.

## Status UI and historical transaction schema probe (2026-10-26)
The source includes a private `/private/tiger/sync` progress/diagnostic screen backed by a signed, freshly authenticated, tenant RLS-scoped `/internal/v1/tiger/sync-status` endpoint. It returns job metadata but cannot create broker jobs. No history records or projections are shown as verified. An offline Tiger transaction inquiry probe follows the official endpoint's documented request limits, but the provider response mapping and complete historical pagination remain unverified. No live history imports are activated.
