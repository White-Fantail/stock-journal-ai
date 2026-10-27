# Positionary — Release readiness audit, 27 October 2026

This document is **a point-in-time read-only configuration inventory and the
pre-release procedure**, not an authorization to deploy, modify live financial
data or claim a tested live login. Implementations remain on `dev` pending
explicit fast-forward approval. Do not add credentials, Google subjects,
Tiger account numbers or actual position data here.

## Verified directly from connected deployment control planes

| Check | Observed evidence | Status |
| --- | --- | --- |
| GitHub dev release candidate | SaaS PostgreSQL, Python, web/security suite run for dev; final commit and CI must be checked again before release | CI-supported, subject to latest commit |
| GitHub main vs dev | main is still behind dev; do not assert production has any Stage 1–7 UI | **Not deployed** |
| Vercel | Project `positionary`, Next.js; latest production deployment READY, Git ref `main`, SHA `fa3282e`, custom domain `positionary.vercel.app` | Platform deployment READY, no user flow verified |
| Vercel environment | Production variable **names** observed: Google Auth, `AUTH_SECRET`, internal API URL/HMAC, OpenRouter key/model/opt-in and legacy SAAS_S2_ENABLED | Names present; values and actual integration health **not proven** |
| Railway API | Project `stock-journal-ai`, service `positionary-api` from `main`; deployment SUCCESS; healthcheck path `/healthz`; pre-deploy `python -m services.saas_api.schema_admin --deploy` | Deployed old main; not a test of pending migration |
| Railway personal Tiger | `positionary-tiger-personal` from `main`, daily cron `0 17 * * *` UTC; service SUCCESS; RSA configuration variable **names** present | No latest source/entitlement/real-row coverage proof |
| Railway secrets | Configured variable **names** include restricted runtime/identity DB and owner bridge. Value inspection is intentionally omitted. | Presence only, validity unverified |
| Schema migrations through 025 | Approved in source manifest; disposable PostgreSQL CI applies it | **Production applied/pending count not confirmed** |
| Live owner-only isolation | Synthetic signed HTTP and RLS A/B tests, revocation, replay, deletion and checkin | CI proven only; real Google owner/non-owner browser tests pending |
| Personal Tiger finance probe | Not enabled in Railway environment; dev-only contract with artificial provider rows | **Real API probe pending** |
| Screen-size validation | Responsive source and accessibility regression tests for new plan self-review, performance report and AI coaching | Browser-rendered 320/375/430/768/1024px smoke tests pending |

**IMPORTANT:** Railway `checkSuites` for the two services was observed as
`false`; a successful Railway deployment does not itself mean GitHub CI
passed. Before fast-forwarding `main`, independently verify that *the exact
dev HEAD SHA* has passed the complete GitHub Action. Do not force/merge on a
failed, pending or canceled check.

## Newly remediated blockers in Stage 7

1. **Full owner data deletion.** The previous transactional account-delete
   function did not remove tenant checkins, staged reconciliation evidence,
   Tiger account sync health, AI request quotas and newly added tenant rows.
   It now deletes the complete referenced FK graph in reviewed child-first
   order, after owner verification and refusing still-linked broker credentials.
   An unexpected FK/permission failure rolls the transaction back. Existing
   private broker credential revocation remains a mandatory prerequisite.
2. **User export.** The JSON export now includes immutable self-assessment
   links, statuses and next actions; the web gateway refuses exports that
   claim completeness while omitting the self-review array. A fixed safe record
   cap remains and returns an explicit error rather than a partial export.
3. **Mobile/tablet:** Under 1100px, the primary navigation becomes the
   discoverable five-slot private menu instead of a clipped horizontal strip.
   New forms, reports and dropdowns have stronger touch/focus/overflow rules.
4. **CI regression safety:** Synthetic signed HTTP tests exercise independent
   Google-subject workspaces, create/replay/export/delete self assessments and
   remove orphan-prone broker sync-health data. An automatic table-inventory
   test requires every new schema table to have a reviewed deletion route or
   documented global/cascade exception.

## Release procedure — only after explicit request to merge

### BEFORE merge

- Confirm `main` is an ancestor of `dev` with no reverse divergence;
  release via **fast-forward only**.
- Confirm the latest `dev` SHA has a successful *completed* full CI run;
  verify the checked-out commit includes migration 025 and its reviewed
  `APPROVED_AUTO_MIGRATIONS` manifest.
- Confirm a recoverable **actual** production backup and restore-test
  independently; environment variable `SAAS_MIGRATION_BACKUP_VERIFIED` alone
  is not evidence of a recovery exercise.
- Confirm the two Railway services continue to target `main`; Vercel
  production uses `main`; check pre-deploy migration identity guard.
- Confirm the operator has an immediate disable/rollback **application**
  procedure. Database schema is forward-only and application rollback
  does **not** reverse schema 024.

### AFTER merge and deployment

- Vercel deployment READY and commit SHA equals the approved `main` SHA.
- Both Railway services SUCCESS and running the same approved source commit.
  Verify `/healthz` and private API HMAC connectivity without exposing keys.
- Use approved read-only operator schema status: **applied=25, pending=0,
  checksums exact**; no manual force apply or schema repair while serving data.
- Test two newly created, disposable real Google users in the real browser:
  owner private workspace; nonowner approval wait and zero Tiger-data access;
  stale/revoked login; refresh persistence; logout. Never use actual trade
  records as disposable fixtures.
- Validate `/private`, `/private/portfolio`, `/private/trades`,
  `/private/journal`, self-assessment page, `/private/alerts`,
  `/private/reports/monthly`, `/private/performance`, AI coach,
  `/private/brokers` and `/private/settings` on iOS/Android browsers at
  320/375/430px, and at 768/1024px tablet widths. Verify zoom, 16px form
  controls, keyboard navigation and the mobile overflow menu.
- From a **disposable workspace only**, create a plan/checkin, export JSON,
  confirm structured self reviews and next actions, then delete the account,
  verify no remaining per-workspace data and isolation of the other workspace.
- Test connected Tiger account **read-only** access separately with explicit
  operator opt-in. An observed trade posting is not a proven fill; no returns
  until full funding/FX/fees/corporate-action evidence and reconciliation.
- Test actual ZDR model configuration through an individually consented,
  bounded synthetic-data AI request; verify no model fallback, no background
  calls and daily/monthly workspace quotas. Do not use real financial
  information as an AI test fixture.
- Observe post-release error rates and Railway cron success across at least
  one scheduled run. Failure to run is not proof of no broker activity.

## Unresolved constraints — do not mark green on code CI alone

- The public production service is still based on old `main`; no Stage 1–7
  release was performed in this audit.
- Production schema status, backup restore and actual Google login/nonowner
  approval were not verified with authorized live credentials.
- Tiger real fund-detail API entitlement/history and validated returns are
  not established. `POSITIONARY_PERSONAL_FUND_PROBE_ENABLED` remains absent.
- Multi-currency / cross-broker global assets and audited long-horizon
  performance remain unavailable. Never fabricate benchmark figures.
- Live mobile device screenshots and interactions require deployment and
  an authenticated human/browser session; static CSS/test checks do not
  replace them.


## Addendum — original P2/P3/P4 gaps implemented on dev (not released)

- Migration 025 adds immutable, owner-labeled overlapping stock risk factors.
  Account export/delete now covers this table. Categories reflect the user's
  own view, not provider sector/correlation facts. Overlapping factor totals
  **cannot be added** to estimate overall portfolio diversification.
- `/private/reports/weekly` reads complete NZ ISO-week journal/plan/review
  aggregates and prior authored actions through signed, tenant-scoped DB reads.
  It is on-demand and does not send reminders or collect stock quotations.
- Opt-in AI coaching cites explicit repeated PARTIAL/DEVIATED/UNCERTAIN marks
  on different dates; it only asks about possible emotional influences and
  never diagnoses fear, greed, FOMO or verifiable fill-level rule compliance.
- Before deploying, re-confirm exact HEAD CI, backup restore and production
  migration status **through version 025**, plus iOS/Android week/report and
  manual risk-factor create/export/delete flows for two isolated users.
