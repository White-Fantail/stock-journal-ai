# Positionary — current delivery roadmap

**Rebaselined:** 2026-10-27 after main branch stabilization. This is a concise list of **remaining work**, not a chronological patch log. Check the implementation/CI to confirm status before changing this document.

## Shipping now (source and deployment verified)

- Google-first SaaS workspace; signed Railway API, nonce/rate controls and tenant RLS.
- Tenant-owned manual trades, journal, revisioned strategy/targets/stops, investor principles, risk factors, check-ins, action follow-ups, JSON export and account deletion.
- User-focused navigation/onboarding, dashboard tasks, portfolio risk/concentration, weekly/monthly review and conservative performance-readiness views.
- Owner-only Tiger RSA observations: positions, account/order history, fee/fill/fund shape probes, allowed US quote context and sync diagnostics. **Personal access is not multi-user OAuth approval or complete transaction verification.**
- Opt-in OpenRouter ZDR-mode source-grounded AI review/coaching with limits and best-effort text minimization.
- CI for Next build, Python, isolated disposable PostgreSQL and synthetic Chromium A/B workflows; production Vercel and both Railway services deploy `main`. The synthetic browser regression covers navigation, authored flow, export/deletion and 320–1024 px viewport checks.

## Priority 0 — operational release safeguards

- [ ] Configure/verify **required GitHub status checks** on `main` and restrict direct pushes so broken CI cannot release automatically. Keep required `saas-postgres-isolation` and `browser-journeys` checks synchronized with workflow job names.
- [ ] Verify real **two-Google-account production** sign-in, privacy isolation, logout/re-login, expiry, account deletion, recovery and unauthorized API export denial. Synthetic CI is not a substitute.
- [ ] Verify on physical iOS/Android devices: navigation, landscape/portrait, keyboard, long ticker names, tables, dynamic forms, accessibility and on-page errors.
- [ ] Confirm production backup recovery with a real **restore drill**, scoped DB role grants and a documented incident/key-rotation plan.

## Priority 1 — data quality and responsible use

- [ ] Audit and close Tiger owner-only order/fill **coverage**, itemized fees/currencies, time-zone semantics, cash activity, corporate actions and missing periods; preserve partial/unknown outcomes. Only independent signed verification may publish financial facts.
- [ ] Verify latest-account sync health, partial-window and read permissions on real Tiger responses. Do not confuse source-staging success with accounting completion.
- [ ] Validate AI note redaction against more user-entered private formats; consider a readable before-send preview and stricter minimization. Do not promise free-form text is perfectly anonymous.
- [ ] Review recurring dashboard follow-up presentation under missing history, old check-ins and inaccessible endpoints. Avoid repeated prompts or incorrect completion claims.

## Priority 2 — approved broker SaaS and long-horizon results

- [ ] Obtain written Tiger NZ third-party **partner OAuth** approval, named read-only scopes, hosted callback approval, legal redisplay/market-data rights and live tenant-specific API coverage.
- [ ] Independently attest official broker fills and complete financial history; activate staging/dispatch/publication only after strict environment/role/issuer/key reviews. All read/write permissions must remain trade-free.
- [ ] Add verified cash flows, fees, NAV, corporate actions, FX and reconciliation audit before **any** genuine return or total portfolio-performance percentage.
- [ ] Evaluate a second read-only broker only after adapter isolation and customer consent are proven; do not generalize private Tiger RSA credentials.

## Explicitly not on the roadmap

Order placement/cancellation, options execution, auto-trading, price target/stop push alerts, quote event subscriptions, background price polling, day-trading signals, user-uploaded private RSA keys, and return to GitHub/CSV personal ledgers.

## Definition of done

Documentation must describe **currently enabled** behavior separately from implemented-but-gated source. A release requires verified dev checks, fast-forward promotion to `main`, main CI confirmation, Vercel/Railway deployment checks and user-critical browser QA. DB financial publication is a distinct consent/evidence/security decision and never inferred from green web CI. See [Operations](OPERATIONS.md).
