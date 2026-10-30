# Positionary — temporary single-owner Tiger RSA read-only bridge

**Current deployment:** an isolated Railway personal Tiger runner and a separately scoped main SaaS API read surface. This is available **only** to the one configured Google subject, not other customers. It is not the public Tiger partner OAuth flow. Retain this folder while the personal bridge is active.

## Trust model

- SaaS API checks `POSITIONARY_PERSONAL_TIGER_ENABLED=1` and the exact `POSITIONARY_PERSONAL_GOOGLE_SUBJECT`. Tenant membership and broker table FORCE RLS still apply.
- Only the **separate, private Railway runner** may have `POSITIONARY_PERSONAL_TIGER_ID`, `POSITIONARY_PERSONAL_ACCOUNT`, `POSITIONARY_PERSONAL_PRIVATE_KEY_B64` and optional account license. Never upload them to GitHub, Vercel, browser, chat logs or the public API.
- Runner submits to a pinned HTTPS API origin with `POSITIONARY_PERSONAL_BRIDGE_SECRET` and signed HMAC requests. No arbitrary browser account selection or bridge URL.
- Only read/query Tiger SDK operations are permitted. No broker order placement/cancellation/modification, transfer or automated trading, even if the RSA grant could technically do so.

## User-visible observations

- Account assets and positions from a dated owner-only snapshot. Broker-provided average cost is not independently validated historical basis.
- Stock orders scanned over bounded UTC windows starting from configured `POSITIONARY_PERSONAL_HISTORY_START_UTC`; pagination/conflicts/unknown older history produce partial/unverified status. Orders and partial fills must not be treated as certified executions.
- Small, bounded recent individual-transaction and `get_order(show_charges=True)` itemized-fee shape probes. An order charge is not a per-fill fee; missing currency/time semantics remain UNKNOWN. Users see opaque references and aggregated diagnostics, not original confidential order IDs.
- Optional USD/US-ticker permitted market quote observations, preferably delayed `get_stock_delay_briefs`; any entitled real-time observation is contextual only, not a real-time subscription or trigger. Quotes carry source timestamp; stale/incompatible data is not used. No cross-currency aggregation, quote polling or quote-triggered alerts.
- Owner-only read surfaces include `/private`, `/private/portfolio`, `/private/trades`, `/private/journal`, `/private/tiger` and `/private/tiger/diagnostics`. Other users see approval-pending partner access, never this personal account.

## Processing and diagnostics

The isolated Railway worker runs continuously **without a cron setting or public domain**. Its private internal endpoint `positionary-tiger-personal.railway.internal:8081` accepts only HMAC-signed requests from the membership-checking SaaS API. The owner-only trade-history page can request a manual recent-order refresh (5-minute cooldown, single-flight execution). Background polling at approximately 09:30–15:30 America/New_York on weekdays queries the latest 30 days once per hour; exchange holidays are not independently detected. A separate daily run after 22:00 UTC performs the original historical scan, positions and bounded transaction probes. Re-running the worker is not a source of verified executions; all observations remain partial/unverified when coverage is incomplete.

The SaaS API and the worker already share `POSITIONARY_PERSONAL_BRIDGE_SECRET`; the personal worker alone retains the RSA key. The service's Railway configuration must remove its prior `0 17 * * *` cron, use restart `ALWAYS`, set the private network name `positionary-tiger-personal` and a health check of `/healthz`. The web server must not call Tiger or the private worker directly. On an unavailable worker, the UI reports failure without erasing observations. After a service restart the process-local last-request status may reset; durable encrypted trade observations and daily health records remain intact.

Evidence is encrypted and written to existing tenant-scoped snapshot tables; repeated identical source payloads are idempotent and update observed order state only under the source contract. Daily success/coverage is visible as a health observation, **not verification of all fills, fees or account returns**.

An operator-only `python -m temporary.tiger_personal.fund_probe_worker` is available for separately approved diagnostics; it requires `POSITIONARY_PERSONAL_FUND_PROBE_ENABLED=1`, queries the fixed configured account and bounded read-only windows, logs **aggregate categories only**, and neither saves financial postings as verified evidence nor joins the scheduled daily flow. Financial filter `TRADE` denotes a cash posting, **not** broker fill certification. Never turn a synthetic successful probe into production read permission.

## Provider approval and eventual retirement

When Tiger grants hosted third-party read-only OAuth, first reconcile real grant/account identity, external-to-internal source links and all archived uncertain observations. Preserve user's workspace, notes, immutable snapshots and provenance. After independently verifying handoff: revoke/rotate the RSA key, remove personal Railway secrets and runner, and retire isolated routes/code in a **separate reviewed change**. Do not delete this working bridge prematurely and do not reset/migrate away users' journal data.

The personal RSA credential was previously shared outside the isolated runtime. Rotate/revoke it with the provider as soon as safely practical; never republish the key.

See [Broker adapters](../../docs/saas/BROKER-ADAPTERS-V1.md), [Product](../../docs/PRODUCT.md) and [Tiger partner OAuth](../../docs/saas/TIGER-P3-OAUTH.md).
