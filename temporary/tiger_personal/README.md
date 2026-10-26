# Positionary owner-only temporary Tiger OpenAPI connector

This is a **temporary, isolated, single-owner credential mechanism** to bridge
Tiger third-party app approval. It is NOT an alternative public login method.
The core multi-tenant OAuth architecture, workspace IDs, user-authored investment
journal and brokerage ledger publication contract remain unchanged.

## Runtime security
- Main API: `POSITIONARY_PERSONAL_TIGER_ENABLED=1` and the exact verified
  `POSITIONARY_PERSONAL_GOOGLE_SUBJECT`. The API uses existing HMAC-signed
  internal routes, fresh Google-subject membership and FORCE RLS broker DB role.
- Credential runner: a separate one-shot Railway service. This is the **only**
  place where `POSITIONARY_PERSONAL_TIGER_ID`,
  `POSITIONARY_PERSONAL_ACCOUNT` and
  `POSITIONARY_PERSONAL_PRIVATE_KEY_B64` may exist.
  It has no public domain and never invokes Tiger order-placement,
  order-cancellation, transfer or order-modification methods.
- A separate long-lived `POSITIONARY_PERSONAL_BRIDGE_SECRET` authenticates
  the runner to the fixed Railway API HTTPS origin. Never paste this key or the
  original RSA key into GitHub, Vercel, the browser or user-facing logs.
- Server rejects all other Google subjects and disallows client-selected
  workspace IDs, external accounts, bridge URLs and arbitrary query methods.
  All other users see only the official third-party OAuth approval-pending UI.

## What works
- `history_sync` reads the user's actual Tiger balance/stock positions,
  then pages read-only Tiger STOCK orders in bounded 85-day UTC windows.
- The first historical bound is
  `POSITIONARY_PERSONAL_HISTORY_START_UTC` (currently 2024-01-01).
  This proves neither history before that date nor corporate actions, dividends,
  transfers or account funding. A 100-order page with no cursor is flagged
  incomplete; incomplete windows are never certified.
- Snapshots are HMAC-account-linked, AES-256-GCM encrypted in the **existing**
  `saas_tiger_source_snapshots` table. Order records use kind TRANSACTIONS,
  but carry explicit provenance PERSONAL_ORDER_OBSERVATION and PARTIAL and
  **are NOT independently verified individual execution fills**.
- The normal authenticated /private, /private/brokers, /private/tiger,
  /private/tiger/sync, /private/portfolio, /private/trades and /private/journal
  surfaces now read owner-only snapshots. The old isolated test page is deleted.
- Orders are keyed by Tiger provider order ID. Repeated sync does not add
  identical pages; an order with changing partial-fill state is shown by its
  newest observation. History is paginated in /private/trades.
- No personal observation may appear in broker-verified P4 publications or
  the accounting FIFO projection until independently attested complete
  execution/fee/corporate-action coverage is established.

## Automatic update
The isolated runner may be configured as a Railway daily cron job, once per
day. It runs once then exits. No stored token, no web-facing sync trigger.
It reuses the same bounded retrieval and idempotent storage.

## Cleanup at official OAuth approval
Confirm actual Tiger provider account identity through the official grant,
audit old and new fingerprints, then *transactionally rebind the same internal
account ID* to the approved OAuth connection. Preserve workspace ID, all
journal entries and every historical snapshot marked unverified. Revoke and
delete the personal RSA key and bridge secret, remove the isolated runner,
temporary/ directory, personal routes and owner-only branch, and restore the
standard API Dockerfile; no destructive migration or account deletion.

WARNING: The source RSA key was uploaded in a ChatGPT conversation in an
earlier step. Replace/revoke that Tiger developer key as soon as practical,
and update only the isolated Railway environment variable.
