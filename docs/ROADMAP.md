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
- [x] Rebuild investment-journal frontend into responsive per-symbol workspace with latest thesis and review, typed chronological updates, watchlist changes, selective user-entered trade linkage and target/stop plan revision timeline; no unverified real-world balances shown.
- [x] Add tenant-scoped, immutable user-authored target/stop plan revisions (migration 016) with full reset semantics, normalized positive Decimal input, idempotency, bounded history, JSON export and account deletion; exercise HTTP and PostgreSQL A/B isolation in CI.
- [ ] Real Google browser A/B negative suite + production runtime-role audit + verified restore before wider customer onboarding. User-authored journal/trades no longer depend on an environment feature toggle; authentication and restricted RLS DB access always apply.
- **Exit:** a new Google user can safely keep a private manual journal without a linked broker.

## P3 — Tiger adapter: first production data source (**high-priority next build**)
- [x] Provider registry, broker-neutral read-only contract, Tiger offline fixture normalization and bounded-window collector.
- [ ] Obtain official Tiger approval for hosted third-party NZ customer authorization, app enrollment, exact consent scopes and eligible account types.
- [ ] Verify whether read-only query grants exclude all trading privileges. If not, **do not connect**.
- [x] Implement provider-approval-gated enterprise OAuth2 code flow, tenant-bound AES-GCM grants, one-time state/replay defence, static provider hosts, SDK cache exclusion, refresh and local disconnect (offline code; live behavior not yet verified).
- [x] Add signed Vercel-to-Railway Tiger endpoints, tenant RLS account binding, encrypted asset/position source snapshots and explicit SNAPSHOT_ONLY coverage.
- [x] Implement bounded backfill planning, durable tenant-scoped staging schema/checkpoints and synthetic A/B RLS regression coverage (offline foundation; no worker execution).
- [x] Implement offline-injected, owner/member-resolved one-window worker: locked lease claims, fencing tokens, resumable bounded windows, encrypted HMAC-keyed idempotent staging, bounded retries and A/B PostgreSQL tests. Source always staged PARTIAL until independent provider coverage verification.
- [x] Implement offline provider-neutral paginated read contract and an explicitly invoked, bounded page runner with encrypted continuation cursors, transactional checkpoint/staging, duplicate-page idempotency, page-count and lease fencing (does not certify complete history).
- [x] Build dispatch-only database role, opaque tenant job queue, SKIP LOCKED claim with token fencing, fresh-owner authorization and bounded scheduler ticks (offline/injected reader only).
- [ ] Activate a separately deployed background runner only after Tiger read-only historical endpoint, cursor rules, consent scopes, tenant auditing and operational monitoring are independently verified. Publication/reconciliation remains outstanding.
- [x] Implement a signed, tenant-scoped sync-health read endpoint and private Tiger status UI for window/page progress, known issues, retry/reauth flags, and explicit UNVERIFIED historical coverage. Verify A/B negative queries and session revocation on disposable PG.
- [x] Add an offline official-doc-based enterprise transaction inquiry probe with strictly documented request parameters, rejected malformed provider envelopes and absolutely no undocumented fill mapping or false full-history claims.
- [ ] Test real read-only Tiger account in non-production with explicit authorization, isolated account identity and redacted fixtures; establish limits on order/fill/fee/cash/FX/corporate-action/history coverage.
- **Exit:** a consented Tiger workspace can show repeatable imported facts with source evidence, accurate coverage/partial-status and no ability to trade.

## P4 — Reconciliation, holdings and performance (**planned**)
- [x] Build an offline deterministic P4 reconciliation gate for duplicate/replayed source IDs, conflicting versions, suspected economic duplicates, certified contiguous window coverage, fee/currency/time validation, same-as-of broker snapshot quantity matching and independent cash/order/corporate-action checks; never publish uncertain data.
- [ ] Integrate verified Tiger order/fill/fee/cash/corporate-action source adapters with durable review/publish ledger; real provider evidence is not yet certified.
- [x] Build an offline, account-scoped Decimal FIFO native-currency cost-basis/realized-P&L core with adversarial tests (strict verified-history/corporate-action prerequisite; no production data input).
- [ ] Version and persist authorized projections; reconcile position snapshots at matching as-of time, add verified FX/unrealized returns, user-facing portfolio views and audit provenance.
- [x] Add account-scoped portfolio readiness UI using freshly authenticated Tiger connection and sync metadata. Unknown cost basis, holdings and performance display as unverified, never zero/dummy values.
- [x] Implement append-only tenant reconciliation decisions and issue codes (migration 014), versioned *private staging* of execution identities/Decimal FIFO positions only behind independent attestation. Retry idempotency and repaired-input versions verified on disposable PostgreSQL; never publish these as account holdings.
- [x] Add signed owner-scoped reconciliation review status API and portfolio screen showing latest version/issue codes without raw broker IDs or money.
- [x] Add immutable P4 source-lineage links (migration 015) to tenant-scoped encrypted staged provider evidence, typed issue categories and strict missing/conflicting source rejection. Attestation signatures now bind both the accounting input and the exact original staged source version; raw evidence is never returned to the browser.
- [ ] Build independently verified Tiger attestation issuer (provider approval required), expand complete source evidence for cash/FX/corporate-action validation, customer-visible publication gates and source-linked audited correction workflows.
- **Exit:** portfolio math is deterministic and traceable, with unknown/partial cases explicitly flagged.

### P4 private broker-ledger release foundation (2026-10-26)
- [x] Implement a **separately signed**, append-only P4 internal review-to-broker-ledger release gate (migration 017). It binds the latest STAGED reconciliation, original encrypted source fingerprints, execution identities, Decimal positions and account to one immutable digest; rejects stale/missing/conflicting raw evidence, cross-tenant access and duplicate release. A new `SAAS_P4_PUBLICATION_ENABLED` switch defaults **off**, with an independent `SAAS_P4_PUBLICATION_KEY`; there is no signing issuer, HTTP publishing endpoint, real Tiger attestation, customer-visible broker ledger or holdings release yet.
- [ ] Validate this gate with actual official Tiger read-only coverage proofs, fully mapped historical fills/orders/fees/cash/corporate actions and independent signer separation; only then surface tenant-scoped read-only broker ledger and linked investment journal. The current staged input does **not** confer user-visible verified balances.

### P4 signed private read model / per-ticker journal (2026-10-26)
- [x] Implement an HMAC-authenticated, RLS-scoped `ledger-read` endpoint which revalidates the latest released review, original source evidence, current read-only grant and signed publication before returning bounded Decimal-string fills and position facts. Default off; no Tiger live data/publication is claimed.
- [x] Add typed Next.js gateway and per-symbol **Tiger 검증 체결** panel in the private journal without overwriting user-authored notes or blending USER_ASSERTED and BROKER_VERIFIED. Partial/conflicted data returns no broker facts.
- [ ] Confirm read API, TypeScript build and PostgreSQL A/B workflow are green; perform real two-Google-account browser checks and independent Tiger attestation before live activation.
- [x] Add a **separate, immutable** owner-authored per-fill TRADE_NOTE association (migration 018), signed/tenant-scoped backend guard and inline investor memo form. Every link pins the historical signed P4 publication and verified fill + ticker through composite FKs; user-authored text never becomes broker data.
- [x] Preserve note history and export after a broker review becomes BLOCKED; do not show a link as currently verified unless the independently released source, account and revision still match.
- [ ] Run actual PostgreSQL 18 A/B integration and Next.js TypeScript/build tests, then verify with two real Google accounts; Tiger live eligibility and independent source certifier remain required before enabling broker read.

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


## Future execution track — gated independently from P3–P6
A later optional Tiger order flow needs **separate customer trading authorization and Tiger provider/regulatory clearance**, a disjoint trade-capable credential vault/service/DB principal, explicit human preview and confirmation, broker-native idempotency/order reconciliation, audit, rate limits and a stop switch. Existing read-only grants cannot be upgraded implicitly. No order placement/cancel route or trade-capable token is present in P3.


### Verified historical portfolio projection (2026-10-26)
- [x] Verified Tiger release read model is wired into the account-scoped private portfolio UI. Only independently signed, **currently** approved and connected account releases reveal native-currency FIFO remaining cost basis and realized P/L for each ticker; missing or blocked accounts keep **미확인**.
- [x] Display reference date/version, per-account proof boundary, truncation warning, direct link to the ticker journal and no cross-currency aggregation.
- [x] Keep current market value, unrealized P/L and total return explicitly **미확인** until a separately scoped, verified market-data/FX calculation exists. Neither a Tiger snapshot nor a manual trade assertion can be used as a live price.
- [x] Include actual Next.js production build in synthetic-only GitHub Actions CI in addition to TypeScript, security contracts, and disposable PostgreSQL 18 A/B checks.
- [ ] Test future production Tiger OAuth/API with officially approved **read-only** grants and independent source attestation before activating financial views.

### Step 1 · Tiger personal execution and fee source probe (2026-10-26)
- [x] Add owner-only bounded read-only `get_transactions` observations for up to six recent STOCK orders over the last 30 days; require SDK cursor pages, broker order/account identity, exact fractional scale, and summed filled quantity comparison. The query is **Prime/Paper-dependent**; unavailable/unsupported replies remain UNAVAILABLE, never inferred from `get_orders`.
- [x] Store transaction samples independently from order observations as encrypted `PERSONAL_TRANSACTION_OBSERVATION` under existing RLS with an owner-only HMAC bridge. New samples are always `PARTIAL`, cannot enter reconciled P4 ledgers, and do not certify any wider historical range.
- [x] Distinguish order commission and its potentially missing commission currency from individual fill fees. A fill has no certified fee allocation or certified timezone.
- [ ] Deploy the worker/API through the approved main-only release, inspect safe status counters on the actual Tiger account, and verify Prime eligibility, cursor support and fee field availability; this source-only change **has not exercised a live credential**.
- [ ] Extend covered-range executions, provider-verified fees, funding/corporate actions and audit before step 2 FIFO portfolio publication.

- [x] **Deployment wiring:** Railway `positionary-tiger-personal` source was unpinned from historical `a83424d8` and now follows `main`. Railway runner/API accepted deployed commit `06d798c` successfully. The *next runtime cron execution* and real Tiger transaction/fee outcomes are still unverified; do not confuse deployment success with ingestion success.

### Step 1 · Phase 2 itemized fees + complete order paging (2026-10-26)
- [x] Use Tiger's documented `get_order(account,id,show_charges=True)` alongside `get_transactions` on the same bounded order sample. Normalize category/type/after-discount amounts and independently verify category totals, order commission, transaction identity and source currency, with explicit UNAVAILABLE/DIFFERENCE/CURRENCY_UNKNOWN states. No allocation to fills, no inferred currency.
- [x] Store fee evidence in existing owner-only encrypted P3 snapshot payloads (optional for backward compatibility); validate all totals and details at the signed ingress. Provide limited masked per-order charge detail on the owner-only trades screen.
- [x] Fix historic `get_orders` to explicitly request pagination from its first call with `page_token=""` and reject conflicting order pages rather than overwriting observations.
- [ ] Real-world Tiger read-only fee/transaction access, history completeness, source time zones, and actual charges must be verified in the next cron. P4 trusted ledger publication still blocked until fully independently reconciled.

### Roadmap priority 3 · Tiger market-price integration (2026-10-26, source implementation)
- [x] Add an owner-only isolated Tiger QuoteClient collector for US stock symbols present in the owner's real USD position snapshot. Require an actual US-only `get_stock_delay_briefs` response as the listing/currency eligibility proof; prefer newer `get_stock_briefs` prices only when independently allowed, and fail back to free 15-minute delayed US quotes. Other currencies/markets remain unsupported, never silently converted.
- [x] Add reviewed migration 019 extending existing encrypted tenant-RLS Tiger snapshot evidence with a separate `QUOTES` kind; no trade facts or historical balances rewritten, no public market-data endpoint.
- [x] Validate signed owner-only quote ingest and strictly bounded stock/price/timestamp; expose market quote observed price/source/time with precise Decimal position valuation, **only as unverified reference metrics based on a recent observed average cost, not authenticated FIFO cost basis**.
- [x] Show provenance, quote delay/staleness, same-currency reference value/P&L/return in the personal portfolio, plus reference value in dashboard. Keep original Tiger portfolio snapshots intact, suppress calculations for stale/missing holdings or missing average cost, and never calculate a multi-currency account-wide return.
- [ ] Verify deployed quote entitlements using the private Railway runner and its next safe log counters; historic complete fill/fee/cash/FX reconciliation and verified per-account FIFO basis remain prerequisites to **audited** unrealized P&L/total returns.
- [ ] Official Tiger SaaS OAuth quote entitlements, licensing for redistribution, validated cross-market quote currencies, proper FX conversion and verified account/ledger valuations remain for later phases.


### Roadmap priority 4 · Tiger investment journal linking (2026-10-27, dev implementation)
- [x] Existing author-created ticker thesis and immutable target/stop plan revisions are reused: no inline form in the order list, and no automatic broker order or stop/limit order is created.
- [x] Add a standalone authenticated observed order/fill review creation page reached from each user's private Tiger trade list and journal observations. Client-supplied refs are opaque, exact symbol and kind; server resolves the Google subject, workspace OWNER privilege, non-BYPASSRLS broker role, and actual encrypted account-scoped order/fill evidence **before** writing a note. No client account/workspace can be chosen.
- [x] Add forward-only 020 journal observation association table, append-only writer role, composite author+symbol FK and account+workspace FK, FORCE RLS, immutable explicit `OBSERVED_NOT_VERIFIED`. No new fake broker execution, verified ledger publication or manual trade assertion.
- [x] Notes in the existing authored journal history and export include a separate `observationRef`; journal workspace shows Tiger observed trades with author notes alongside the independent plan/thesis timeline. Existing P4 `brokerRef` links continue to require independently verified releases.
- [x] Preserve old notes, source separation, idempotency conflict behavior, strict input bounds and origin. Never infer a user's trade reason from the broker order.
- [ ] Validate real owner Tiger observations and complete origin coverage in production; no claimed accounting-grade fill provenance until reconciliation. The new 020 migration and journal linkage are **dev only** pending explicit fast-forward merge and controlled deployment.


### Roadmap priority 5 · User-invoked AI journal analysis (2026-10-27, dev implementation)
- [x] Dedicated private AI reflection page: stock-specific thesis/plan/observed orders versus history-wide habit review; each run requires fresh checked consent. No automatic jobs, personal data uploads from browser, or AI-generated trading actions.
- [x] OpenRouter chat completions integration runs only on the trusted Next.js server with `POSITIONARY_AI_ENABLED=1`, server-only `OPENROUTER_API_KEY`, and explicitly chosen `OPENROUTER_MODEL`. Provider routing enforces `zdr=true`, `data_collection=deny` and structured JSON support; no lower-privacy fallback.
- [x] Minimal evidence: maximum 18 user-authored note excerpts, 10 plan rationale excerpts with target/stop *presence* only, 12 manually asserted trade rationales without monetary values, and 12 Tiger *order* direction/status/date observations without accounts, IDs, quantities or prices. Bound total data size, no private brokerage key and no personal identity to model.
- [x] Validate model insights using original evidence references, refuse invented source IDs, display provenance and limitations; never claim source attestations, cost basis, realized profit, performance or actionable trade advice. Responses are ephemeral and are not stored in PostgreSQL or browser storage.
- [x] Forward-only 021 workspace-specific AI quota table with FORCE RLS; freshly resolved Google subject plus scoped trade role atomically claims a maximum of 4 per UTC day and 60 per UTC month; requests consume quota even on provider failure. No prompts/outputs in quota DB. Billing spend caps must also be configured on the OpenRouter API key.
- [ ] Production activation requires installing and privacy-reviewing `OPENROUTER_MODEL`, `OPENROUTER_API_KEY`, key spending limit and explicitly turning `POSITIONARY_AI_ENABLED=1` in Vercel server environment. Do not treat CI as provider activation or proof that the model supports ZDR.
- [ ] Historical cost-basis, broker reconciliation and independent source proof remain prerequisites for using confirmed outcome metrics in AI, and must not be inferred from personal Tiger order observations.


### Roadmap priority 6 · Daily Tiger sync health and in-app alert center (2026-10-27, dev implementation)
- [x] Preserve the already configured Railway production **daily cron** (`0 17 * * *` UTC, local daylight saving changes shift Christchurch time). A run attempts independent assets, 85-day-window order history and bounded Prime fill diagnostic stages; one failed stage cannot silently mark the job fully successful.
- [x] POST a one-time signed HMAC owner-only, account-bound source health receipt, even if a stage fails. Record only allowlisted stage statuses (no account number, credentials, raw exception strings, fills or balances) in reviewed forward-only migration 022. Non-BYPASSRLS broker login has SELECT/INSERT only on append-only per-run health, with a unique run UUID. If bridge is unavailable the Railway cron must exit non-zero, never report success.
- [x] Distinguish most recent run and most recent successful *account-scoped* asset snapshot; expose owner-only signed HMAC view, no other user's state.
- [x] Initial in-app alert center for owner-only cron/freshness. **Superseded on 2026-10-27:** market-price/target/stop comparisons removed from source by the long-horizon review track; no price-triggered buy/sell alerts.
- [x] Review center now derives only account-sync, history coverage and investment plan-completeness suggestions from existing owner-scoped evidence on page read.
- [ ] Verify actual Railway daily runtime ingestion and full stage health using real owner account without exposing its identifier. CI exercises only synthetic contract/migrations.
- [ ] Broker-authorized multi-user sync and optional low-frequency review reminders would need separate deployment/consent controls. Price/threshold push or email alerts and frequent market-session scheduling are **out of scope**. Once-per-day read-only cron is for accounting and data health.
- [ ] Full independent source reconciliation (historical transactions, fees, FX, transfers, corporate actions) remains blocked even with healthy automated sync. No real-money orders/stop-losses are created.



### Personal long-horizon investment review track (2026-10-27)
- [x] Remove observed-quote target/stop trigger logic from private review notifications. Keep authored plan target/stop values as annotations only, and retain Tiger sync/coverage alerts.
- [x] Convert alert navigation to an investor review center: failed/stale sync, partial order history, and missing plans for recently observed held symbols. Suppress missing-plan suggestions if journal retrieval failed.
- [x] Add a pure fixed-point long-position risk-budget calculator in a separate private route. It is illustrative only, cash capped, has no quotes, no storage, and places no orders.
- [x] Add snapshot-only, per-account/per-currency invested-equity concentration proportions on portfolio page. Avoid cross-account/FX aggregation and decline unknown or stale position values. These are not audited returns or total NAV exposure.
- [x] Extend immutable per-ticker investment plans with strategy type, planned horizon, thesis invalidation, personal maximum allocation and review cadence in forward-only migration 023. Build ticker-locked separate edit flow with prefilled prior values and complete revision history. Runtime PG/HTTP and Next build remain for CI/production acceptance.
- [x] Compare each user-authored maximum allocation percentage with the same Tiger account snapshot using exact account-NAV denominators **only when** account NAV, position market values, timestamps and currencies are coherent. Present an account-only reference, never full multi-account portfolio compliance, investment advice, or a sell trigger. No quote requests or new DB writes.
- [x] Add an on-demand NZ-calendar monthly *decision-process* report for journal entries, reflection records, plan revisions, and explicitly user-asserted trades. Do not fabricate audited total performance. Fail closed when fetching source records fails or bounded list counts indicate truncation.
- [x] Show an on-demand, calendar-aware periodic review checklist derived from the latest user-authored cadence and REVIEW events, with a direct link to write a new REVIEW entry. No timers, notifications, quote requests or DB state added.
- [x] Extend existing explicitly consented, ZDR-gated AI critique with strategy type/horizon, invalidation thesis and review cadence metadata; numerical personal allocation limits remain excluded from the AI evidence envelope.
- [ ] Later: close-the-loop historical plan compliance metrics based on verified evidence and comparison to past review suggestions; do not invent realized performance or sell recommendations.
- [x] Add an explicit owner-scoped evidence-readiness panel in monthly investment reports. Published broker execution/position rows are distinguished from just a verified account header; no return numbers are generated without complete cash flows, corporate actions, FX, historical NAV and full-account history proof.
- [x] Repair hosted disposable PostgreSQL CI assertion for reviewed migration 023. Derive versions from the approved migration manifest instead of maintaining a stale duplicate version list; include an offline regression test and cancel superseded dev CI runs.
- [ ] Introduce audited monthly contribution-adjusted long-term returns only after complete executed fills, fees, cash flows, corporate actions and FX integrity are evidenced. Do not claim live or guaranteed investment performance.
- [ ] Verify GitHub CI (Next build, web tests) and authenticated production two-user separation before promoting the new features to main.
- **Cost policy:** No real-time or delayed-price trade alerts, no background quote polling, no per-tick price database. Reuse existing account snapshots; recompute ephemeral review metrics at read time.
