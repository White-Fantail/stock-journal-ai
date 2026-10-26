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

## Read-only individual transaction discovery (Step 1, dev)
The isolated daily worker also makes a **bounded 30-day diagnostic** call to the documented Prime/Paper-only `TradeClient.get_transactions(account=..., order_id=..., limit=40, page_token="")` for at most six recently filled STOCK orders. It never sends an order, modifies an order, or makes transfers. An unsupported SDK/account, ambiguous fractional scale, mismatched transaction owner/order/symbol, or incomplete page is labelled unavailable/partial/different rather than treated as a fill ledger.

New owner-only HMAC endpoint `/internal/v1/tiger/personal-transactions-import` stores the bounded original normalized response as encrypted `PERSONAL_TRANSACTION_OBSERVATION` in the existing tenant-RLS snapshots table, always with `PARTIAL` completeness. No new DB or migration. The private trades screen separates these **observed** individual transactions from `PERSONAL_ORDER_OBSERVATION` and independently certified P4 broker executions. Order `commission` is **not** allocated to its component fills. Missing `commission_currency` and ambiguous source `transacted_at` timezone are shown as unknown rather than substituted.

After main deployment, verify actual SDK support and the safely aggregated diagnostic counters before widening coverage. Do not claim live Prime access or exact individual fee coverage based on the synthetic tests.

### Phase 2: Itemized actual order charges and cursor-first history (dev)

The isolated RSA runner now queries `TradeClient.get_order(account=..., id=..., show_charges=True)` **read-only** for the same bounded sample as `get_transactions`. It compares each returned `Charge.total` to the sum of its `ChargeDetail.after_discount_amount` values and compares the total to the separately observed order commission. A missing `commission_currency` does NOT inherit `contract.currency`, and a `Charge` is an order fee, never the commission for an individual fill. Unavailable, conflicting, or currency-unknown evidence is explicitly distinguished, and cannot enter P4 verified accounting.

The signed ingress accepts the optional `feeReview` envelope so existing snapshots continue to load. The private trades page displays aggregated counts and a limited itemized order-fee table using opaque order references; original external account and order identifiers are not rendered.

The historical `get_orders` collector requests `page_token=""` from the initial page and rejects duplicate order IDs with conflicting observations. Legacy 100-item pages without continuation still receive `complete=False`. This tightens *collection coverage* evidence but does not prove corporate actions, funding/FX, history older than the configured start, nor full executed transaction coverage.

Operational verification requires observing the next scheduled production runner execution; **GitHub Actions and a successful Railway deployment do not prove real Tiger `get_transactions` or `show_charges` access**. Do not deploy or enable a broker-verified ledger from these observations.

## US market quotation pilot — priority 3 (source only)

The same isolated Tiger RSA runner fetches market prices only for US-type ticker symbols present in its owner-only USD holdings. It first requests documented `get_stock_delay_briefs` (US stocks; no real-time subscription; about 15 minutes delayed); an active real-time entitlement may upgrade this observation using `get_stock_briefs` only if the second quote has an equal or later provider timestamp. Missing permission and unsupported symbols are never imputed. No market access token/private key is sent to Vercel.

A separate signed `/internal/v1/tiger/personal-quotes-import` HMAC endpoint stores restricted, encrypted `PERSONAL_QUOTE_OBSERVATION` evidence under the existing Tiger table's new `QUOTES` kind (forward migration 019). The owner-only read view joins these USD prices to the owner's *currently held* Tiger snapshot symbols, never to another user's data, and never to non-USD positions. The immutable trade and P4 FIFO ledgers are not affected.

When the Tiger snapshot and price are sufficiently recent, the server calculates **reference-only** value and unrealized P/L from `position_qty`, the broker-observed `average_cost`, and the source quote price using Python Decimal. These are not externally attested cost basis or real account returns; fees, opening stock transfers, FX, past executions, distributions, shorts, and corporate actions may invalidate the snapshot average cost. Each field carries quote timestamp, real-time-permissioned vs US-delayed source and a staleness flag. If cost/price is missing, old, or currencies do not match, leave the estimate unknown. Different currencies are never aggregated.

The Railway cron remains daily. Neither the future quote feed latency, a paid real-time entitlement, nor a full brokerage valuation is implied. Before enabling the `dev` feature in production, validate Postgres migration 019, main branch deployments and genuine US delayed/real-time API responses. Official SaaS/OAuth quotation redisplay and any market-data license/redistribution requirements must be approved independently.
