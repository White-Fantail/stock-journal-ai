# Positionary — current product contract

**As of:** 2026-10-27. Implementation is available on `main`; feature eligibility still depends on authenticated account permissions, broker approval and verified evidence. A code path does not establish a live financial fact.

## Purpose and audience

Help individual investors record **why** they invested, check whether their assumptions still hold, understand concentration, and develop consistent review habits. Positionary does not recommend when to buy or sell and does not execute orders.

## User journey (implemented)

1. Sign in using Google. Only the verified numeric Google subject resolves the private workspace.
2. Optionally set investment principles: personal objective, horizon, display currency, review cadence, risk limits and note. This is not a mandatory onboarding gate.
3. Enter an investment plan on its **own page**: ticker, rationale, optional strategy/horizon, invalidation criteria, target and stop annotations, maximum allocation and review cadence. Plans are append-only revisions. The same plan form includes an optional **cash-funded additional-purchase scenario**. It uses compatible, bounded owner-only Tiger snapshots where available; otherwise same-currency user assumptions are required. When a compatible source exists, intended price and additional shares are the only new scenario inputs. It displays before/after concentration and before/after static -10/-20/-30% downside effects, remaining cash, and explicitly separate cash-limit and allocation-limit arithmetic share ceilings, not recommended share counts. Zero additional shares is the default baseline and quantity presets are only user-selected hypothetical comparisons. Technical strategies may additionally explore the drop from observed value to a user-entered price criterion, NOT acquisition-cost-based accounting loss. Users must explicitly opt in to store a narrative snapshot of assumptions and their decision with the immutable plan revision; otherwise scenario inputs/results are transient.
4. Use the dashboard to see dated account observations, due reviews and past follow-up tasks. Unavailable sources are labeled, not zeroed.
5. Open a ticker from the journal to see **current plan → decision history → self-assessment**. Record subsequent review and manually confirm the status of an authored next action.
6. Review portfolio concentration, overlapping self-classified risk factors, weekly/monthly process metrics and the limits of available performance evidence.
7. Optionally request AI stock review, habit analysis or coaching after **fresh, explicit consent**; the result cites bounded input evidence and is not persisted automatically.

The former standalone risk calculator route redirects to the investment-plan authoring flow; all portfolio and menu links lead to that flow. Tiger holdings used for sizing remain unverified observations, even when their currency, basis and observation time are present. Manual fallback requires a user-authored portfolio NAV, cash, existing market value, existing quantity, intended entry and addition quantity in the same currency; an explicit zero is not inferred from failure. Average acquisition cost is not a proxy for current market downside. Stop price is neither executed nor monitored. Neither calculation nor stop annotations place an order.

Primary navigation: **Home, Portfolio, Investment journal, Review**, with other tools in **More**. Private navigation uses ordinary full-document anchors to avoid stalled client-side route transitions. Browse/list pages do not embed create/edit forms; use dedicated routes.

## Financial meaning and display requirements

| Source | User-facing meaning |
| --- | --- |
| Tiger owner-only RSA bridge | Observed account snapshots, order/transaction/fee/quote/health observations; partial/unknown coverage is explicitly possible |
| Authorized partner OAuth (future launch) | Customer-bound Tiger accounts **only after** commercial grant and scope verification |
| Manual execution entry | `USER_ASSERTED`; neither broker verified nor an instruction to trade |
| Independently attested released broker ledger | Separate, signed, scoped read model for validated historical fills/FIFO; can disappear from *current verified* display when latest review is BLOCKED |
| User plan/note/check-in/follow-up | User-authored and versioned; plan target/stop does **not** place an actual order |
| AI explanation | Generated commentary based on selected evidence; never broker verification or investment advice |

Historical totals, net returns, cross-currency totals, costs, fees and current valuation must **not** be guessed from incomplete provider history. The long-horizon performance page is an evidence-readiness view; it does not publish an unverified return percentage. Daily Tiger delayed-price observations, when permitted, are non-triggering contextual estimates—not live portfolio accounting.

## Privacy and AI

All private routes require a fresh workspace check. Railway stores tenant financial records behind FORCE RLS and restricted runtime roles. Signed API traffic includes replay/rate protections; secrets remain outside browser and repository. User-owned journal data supports bounded export and account deletion.

OpenRouter AI is **per-invocation opt-in** and constrained to ZDR/data-collection-denied provider parameters; the model receives bounded/filtered notes, not structured account IDs, balances, fee amounts or raw order payloads. Redaction of prose is best-effort: a user can still include sensitive details in free text. Do not claim guaranteed anonymization. AI daily/monthly quota and evidence-reference validation are enforced server-side.

## Deliberate exclusions

No trading, order cancel/replace, transfers, customer RSA-key upload, CSV-import product, real-time quote subscriptions, quote-triggered alerts or notifications, background quote polling, unsupervised investment advice, or reconstruction of old GitHub portfolio records.

## Scope and release status

The interactive journal/review/dashboard, OAuth login and tenant API are deployed. Tiger **personal** access is only for one configured owner. Public Tiger partner authorization is distinct and remains approval-gated. Real two-account Google production testing, actual provider account coverage, mobile physical-device acceptance, and financial publication require separate operational evidence. See [Roadmap](ROADMAP.md) and [Operations](OPERATIONS.md).
