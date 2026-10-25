# Delivery roadmap — SaaS-first, Tiger-first
**Rebaseline:** 2026-10-25 · Statuses describe evidence in repository only unless explicitly stated. No dates promised.

## P0 — Public code/data separation (**current cleanup**)
- [x] Remove tracked personal stock folders, executed-trade ledger, import audits, generated research/report directories and private legacy documents from the active source tree.
- [x] Retire GitHub ledger/import workflows and obsolete owner-only migration scripts; retain only synthetic provider fixtures.
- [x] Rebaseline product, architecture, data model, deployment rules and agent instructions; add active-tree privacy guard.
- [ ] Separately remediate public Git commit **history**, historical archive branch, fork/PR refs and provider caches; current-tree cleanup is insufficient (requires deliberate history rewrite and GitHub process).
- [ ] Confirm no private facts remain in Actions artifacts/logs, Releases, deployment artifacts or other external copies.

## P1 — Identity, tenant boundaries and secure hosting (**partially built**)
- [x] Google-first Auth.js source with fresh workspace provision/resolve and private pages.
- [x] Independent SaaS schema 001–005, staged DB RLS tests, guarded main Railway schema pre-deploy implementation.
- [ ] Validate deployed Google login/logout, session expiry and A/B user negative HTTP access across every private route/API.
- [ ] Separate least-privilege runtime DB roles, DB pool tenant reset tests, rate limits, audit and HMAC replay protection.
- [ ] Verify Railway production schema, main-only deployment settings, recurring backup/restore and secret rotations.

## P2 — Tenant journal MVP (**partially built**)
- [x] Feature-gated immutable manual execution/VOID log and synthetic tenant accounting tests.
- [ ] Complete trade detail, correction and export/deletion flow; protect concurrent replay/idempotency.
- [ ] Implement user thesis, reasons, strategy revisions, reviews and watchlists with authorship/provenance controls.
- [ ] Browser-based two-user negative tests and real DB privilege validation before `SAAS_S2_ENABLED=1`.
- **Exit:** a new Google user can safely keep a private manual journal without a linked broker.

## P3 — Tiger adapter: first production data source (**high-priority next build**)
- [x] Provider registry, broker-neutral read-only contract, Tiger offline fixture normalization and bounded-window collector.
- [ ] Obtain official Tiger approval for hosted third-party NZ customer authorization, app enrollment, exact consent scopes and eligible account types.
- [ ] Verify whether read-only query grants exclude all trading privileges. If not, **do not connect**.
- [ ] Design/implement per-tenant encrypted grant vault, OAuth callback/state/replay defense, SDK token-cache isolation, reauthorization and disconnect.
- [ ] Build signed tenant-bound Railway sync job orchestration, source event tables, checkpoints/pagination/backfill and retry boundaries.
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

## Sequencing and release guardrails
Priority order: **P0 public data cleanup → P1 secure tenant foundations → P2 private journal → P3 Tiger → P4 accounting → P5 AI → P6 commercial expansion**. P2 and Tiger adapter research may proceed in parallel, but live Tiger auth must not precede provider approval and tenant isolation. After a successful `dev` validation and explicit release request, promote by fast-forward to `main`. Non-breaking reviewed SQL goes with its automatic migration manifest; never reset or delete hosted customer data to make tests pass.
