# Product specification — Positionary (formerly Stock Journal AI)
**Version:** 3.0 · **Date:** 2026-10-25 · **Status:** Approved product direction, not a claim of released features.

**User experience:** The public-facing service name is Positionary. The pre-approval UI must distinguish available actions from provider-approval-gated features; it must not simulate portfolio balances or imply that Tiger has approved the hosted OAuth integration.

## Mission
Give individual investors a trustworthy, low-friction account of **what actually happened**, why they made each trade, how their strategies are performing and what evidence should prompt a review. Replace GitHub-file-based private ledgers with a tenant-isolated SaaS. Brokerage-reported facts arrive from the connected broker; AI augments reflection rather than making trading decisions.

## Audience and user journey
A user signs in with Google, receives a private workspace, reviews broker support, grants read-only access to Tiger when supported, selects authorized accounts and requests an initial history sync. The system reports covered dates and unknown intervals, builds a reconciled journal/positions view, then lets the user annotate rationale, thesis, risk/exit plans and later lessons. Without a broker connection, manually confirmed trades remain available, labeled `USER_ASSERTED`, not broker-verified.

## MVP product requirements
1. Secure signup, independent private workspace, account export/deletion, consent and connection status.
2. Tiger-first broker authorization **only after official third-party capability approval**; secure grant lifecycle, reauthorization and disconnect.
3. Reproducible broker import from bounded execution/orders/positions windows, completeness diagnostics, duplicate/fee/FX/corporate-action review, no guesswork.
4. Trade timeline, holdings, cost basis by declared method, realized/unrealized performance (with clearly cited market price/time and FX provenance), reconciliation status and exceptions.
5. Per-execution notes, reason, thesis, strategy, target/stop **as journal annotations**, trade review, calendar/tags/search, export.
6. Transparent audit/source badges: broker-confirmed vs user-entered vs derived; display when data is missing or stale.
7. User-invoked AI analysis and optional digests only with explicit consent, configured data minimization, LLM cost controls and audit.

## Later scope
Additional adapters (e.g. IBKR), subscription plans, notifications, stock screening and sharing. Other brokers cannot use the Tiger SDK contract directly; every provider must implement a tested versioned adapter. Multi-user team sharing is deferred.

## Explicit exclusions
No trade/order execution, transfers, auto rebalancing, guaranteed recommendations, social publication of portfolios, GitHub-account prerequisite, GitHub as financial database, broker password/private-key collection, and **no customer CSV-upload importer**. Never infer that a broker API provides complete historical investment rationale.

## Success measures
A user can join without GitHub; unrelated users cannot observe each other's state across HTTP, DB, queues and exports; Tiger sync can accurately show covered/partial intervals and recover after reauth; every published fill has a verifiable source key; manual notes survive resync; support can investigate sync failures without inspecting secrets or other users' portfolios.

## Privacy
The public repository contains zero real customer financial records. Private tenant data lives in a protected service DB/secret store with backup/retention and self-service export/deletion. Broker data must never be shipped to a client other than its authorized workspace.

## Investment journal workspace — implemented in dev, gated
The private journal groups only a freshly authenticated workspace's own authored notes, target/stop revisions and recently **user-asserted** manual executions by ticker. The timeline preserves THESIS, STRATEGY, REVIEW, TRADE_NOTE, WATCHLIST and explicit plan-revision events. Target/stop are user intentions, never placed orders, contingent trades or validated prices. Missing values remain `unset`; each new plan revision is a complete snapshot, so deleting a target or stop is explicit and audit-preserving. An interactive ticker list uses client-side state without putting holdings/watchlist tickers in URLs or persistent browser storage. Neither Tiger historical importer nor AI analysis is implied. S2 remains disabled until production security gates are independently cleared.
