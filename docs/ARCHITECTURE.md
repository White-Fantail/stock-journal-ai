# Positionary — deployed architecture and trust boundaries

**Reviewed:** 2026-10-27. This describes code deployed from `main`, not future permission to enable gated features.

```text
Browser (Google Auth.js JWT; no Tiger secret)
  -> Vercel / apps/web (Next.js 16, server components/actions)
      -> per-request currentWorkspace() [session + signed resolve]
      -> private financial UI, journal forms, optional AI action
      -> HMAC + timestamp + one-use nonce internal requests
          -> Railway services/saas_api/server.py (Python)
              -> identity DB: users, memberships, nonces, rate limits
              -> restricted saas_trade_app: journals, manual trades, reviews
              -> restricted saas_broker_app: Tiger grant/evidence/ledger reads
              -> reserved separate dispatch/publication roles for gated flows
          -> PostgreSQL: private tenant tables, FORCE RLS
Separate Railway owner-only Tiger runner (RSA key never on Vercel)
  -> read-only Tiger observations -> signed bridge API -> encrypted snapshots
Future: approved Tiger partner OAuth -> tenant worker -> staging
  -> reconciliation + independent attestation -> gated publication
```

## Authentication and isolation

- Auth.js Google verified numeric `sub` identifies a user; email/display name never authorizes a workspace.
- `apps/web/lib/require-workspace.ts` checks current membership against Railway. React's request-local `cache()` avoids duplicate lookup *within the same render*, **never across HTTP requests, users or workspaces**.
- Private layout and server actions are protected; forms derive subject from server session, never client workspace/account IDs.
- Railway `services/saas_api/request_security.py` validates signed HMAC requests, timestamp, nonce replay and per-route/per-subject rate limits. Invalid or exhausted requests fail closed; they should not silently create accounts.
- Non-superuser runtime logins and transaction-local tenant scope must not bypass FORCE RLS. Identity, trade, broker, dispatch and publication privileges are distinct.
- Browser navigation uses plain `<a>` in the global authenticated menu to prevent stalled Next.js RSC transitions; mobile menu and 320–1024 px journeys have synthetic Chromium tests.

## Source and processing boundaries

- **User-authored:** investment principles, watch entries, plan revisions, annotated target/stop, manual trades, plan check-ins and next-action resolutions.
- **Provider observed:** owner-only personal Tiger account holdings, order history, partial transactions, itemized fee probes, read-only delayed quotes and sync health. These are never automatically certified fills/cost basis.
- **Verified/released:** guarded encrypted staging, account coverage verification, source-linked reconciliation, independent attestation, publication signature, immutable released ledger and historical FIFO reads. Source code/tests exist; publication requires separate official approval and evidence. An unavailable grant or superseding BLOCKED review fails closed.
- **AI:** only user-submitted requests; selects bounded source excerpts and coarse evidence, strips common sensitive data and requires consent + quota + ZDR parameter checks. Output is structured and evidence-linked, not saved as an authenticated journal entry.
- **Performance:** require validated complete financial coverage (including fees, cash activity, corporate actions and FX) before claiming returns. Unverified periods remain unpriced.

## Components

| Directory | Responsibility |
| --- | --- |
| `apps/web/` | Frontend, Auth.js, Google session, private views and server actions |
| `services/saas_api/` | Signed internal API, tenant/ledger/journal endpoints, schema deploy |
| `services/broker_connectors/` | Read-only adapter contracts, pagination, FIFO and source evidence |
| `services/tiger_sync/` | Offline normalization helpers |
| `temporary/tiger_personal/` | Isolated, allowlisted single-owner Tiger RSA runner |
| `db/saas/` | Forward SQL migrations and scoped privileges |
| `packages/contracts/` | Versioned private API shape contracts |

## Deployment

`dev` is the implementation branch. Only `main` deploys (Vercel `apps/web/vercel.json` and Railway service configurations). SaaS schema changes are applied by guarded Railway **pre-deploy**; never during a web request. CI validates code and synthetic A/B tenant isolation, not real Google/provider operations. Refer to [Operations](OPERATIONS.md) and [Schema runbook](saas/HOSTED-SCHEMA-BOOTSTRAP.md).
