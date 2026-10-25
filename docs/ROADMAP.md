# Delivery roadmap — SaaS-first, Tiger-first
**Rebaseline:** 2026-10-25 · Statuses describe evidence in repository only unless explicitly stated. No dates promised.

## P0 — Public code/data separation (**current cleanup**)
- [x] Remove tracked personal stock folders, executed-trade ledger, import audits, generated research/report directories and private legacy documents from the active source tree.
- [x] Retire GitHub ledger/import workflows and obsolete owner-only migration scripts; retain only synthetic provider fixtures.
- [x] Rebaseline product, architecture, data model, deployment rules and agent instructions; add active-tree privacy guard.
- [x] Rewrite `main`, `dev` and the archive branch to a verified **parentless** clean root. No personal stock files are present in branch trees.
- [ ] GitHub still serves previous SHA objects directly; request GitHub-hosted cache/object garbage collection and verify remaining external references. `forks_count=0` and repository PR list was empty at inspection, but external clones and cached copies cannot be ruled out.
- [ ] Audit/delete historical Actions artifacts and request logs/deployment cache cleanup where relevant; production deploy alone does not erase prior builds. No Releases appeared in inspected repository response.

## P1 — Identity, tenant boundaries and secure hosting (**partially built**)
- [x] Google-first Auth.js source with fresh workspace provision/resolve and private pages.
- [x] Independent SaaS schema 001–005, staged DB RLS tests, guarded main Railway schema pre-deploy implementation.
- [ ] Validate deployed Google login/logout, session expiry and A/B user negative HTTP access across every private route/API.
- [x] Add nonce-bound signed internal API calls, atomic DB replay prevention and per-subject route rate limits; verify through HTTP/PG CI.
- [x] Add dedicated `saas_trade_app` least-privilege login migration with private deploy-time password; verify role restrictions in PostgreSQL 18 CI.
- [ ] Verify the *production* restricted DB login and connection reuse; review operational audit/rate limits and perform browser-level A/B Google OAuth E2E.
- [x] Verify Railway tracks `main` with guarded pre-deploy; production migration 006 confirmed via deployment logs.
- [ ] Confirm production 007 application, live dedicated login, ongoing recoverable backup and **real** restore drill; CI disposable PostgreSQL backup/restore is not proof of production backup.

## P2 — Tenant journal MVP (**partially built**)
- [x] Feature-gated immutable manual execution/VOID log and synthetic tenant accounting tests.
- [x] Build immutable trade detail and correction routes, typed journal and JSON export (bounded complete-result requirement), guarded explicit account deletion, idempotency and HTTP replay checks in source.
- [x] Implement append-only, tenant RLS `THESIS`, `STRATEGY`, `REVIEW`, `TRADE_NOTE` and watchlist ADD/REMOVE events with provenance.
- [x] Synthetic two-identity signed HTTP A/B negative tests with real PostgreSQL limited login, revocation, forgery and export access.
- [ ] Real Google browser A/B negative suite + production runtime-role audit + verified restore before enabling `SAAS_S2_ENABLED=1` (currently intentionally disabled).
- **Exit:** a new Google user can safely keep a private manual journal without a linked broker.

## P3 — Tiger adapter: first production data source (**high-priority next build**)
- [x] Provider registry, broker-neutral read-only contract, Tiger offline fixture normalization and bounded-window collector.
- [ ] Obtain official Tiger approval for hosted third-party NZ customer authorization, app enrollment, exact consent scopes and eligible account types.
- [ ] Verify whether read-only query grants exclude all trading privileges. If not, **do not connect**.
- [x] Implement provider-approval-gated enterprise OAuth2 code flow, tenant-bound AES-GCM grants, one-time state/replay defence, static provider hosts, SDK cache exclusion, refresh and local disconnect (offline code; live behavior not yet verified).
- [x] Add signed Vercel-to-Railway Tiger endpoints, tenant RLS account binding, encrypted asset/position source snapshots and explicit SNAPSHOT_ONLY coverage.
- [ ] Build durable worker job orchestration, transactional fills/orders pagination/backfill, idempotent checkpoints and retry limits.
- [ ] Test real read-only Tiger account in non-production with explicit authorization, isolated account identity and redacted fixtures; establish limits on order/fill/fee/cash/FX/corporate-action/history coverage.
- **Exit:** a consented Tiger workspace can show repeatable imported facts with source evidence, accurate coverage/partial-status and no ability to trade.

## P4 — Reconciliation, holdings and performance (**planned**)
- [ ] Deduplicate and normalize broker facts, map split fills and fees, detect gaps, handle corporate actions/cash activity.
- [ ] Versioned holdings and cost-basis projections, realized/unrealized returns, FX/timezone provenance, broker snapshot checks.
- [ ] Reconciliation exception UI, sync-health indicators, filters, per-account and consolidated portfolios.
- **Exit:** portfolio math is deterministic and traceable, with unknown/partial cases explicitly flagged.

## P5 — AI analysis and notifications (**planned**)
- [ ] Opt-in consent, token/prompt minimization, ZDR/provider terms verification, per-workspace quotas and observability.
- [ ] Trade critiques, thesis/strategy checks, post-trade reviews and optional scheduled insights with citations and source timestamps.
- [ ] Not investment orders or guaranteed recommendations. Separate public research from personal account facts.
- **Exit:** useful explainable analysis without cross-tenant or third-party data leakage.

## P6 — Product hardening and expansion (**planned**)
- [ ] UX/mobile, accessibility, support tooling, backups, monitoring, full E2E threat tests, retention/export/delete and incident playbooks.
- [ ] Additional broker adapters independently qualified (IBKR considered only after Tiger workflow proves out).
- [ ] Subscription/billing/privacy terms and platform costs; only activate payments following authorization/replay tests.
- [ ] Staged user onboarding and rollout decision.

## Pre-P3 release gate
**P3 offline implementation may be started** using the tested contract, but P0–P2 public/operational release gates are **not all cleared**: old Git SHA objects still resolve, live two-Google-account browser tests and production backups are unverified, and S2 is not activated. See [P3 readiness](P3-READINESS.md). Never mark these complete based only on CI.

## Sequencing and release guardrails
Priority order: **P0 public data cleanup → P1 secure tenant foundations → P2 private journal → P3 Tiger → P4 accounting → P5 AI → P6 commercial expansion**. P2 and Tiger adapter research may proceed in parallel, but live Tiger auth must not precede provider approval and tenant isolation. After a successful `dev` validation and explicit release request, promote by fast-forward to `main`. Non-breaking reviewed SQL goes with its automatic migration manifest; never reset or delete hosted customer data to make tests pass.
