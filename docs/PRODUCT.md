# Positionary — current product contract

**As of:** 2026-10-30. Implementation is available on `main`; feature eligibility still depends on authenticated account permissions, broker approval and verified evidence. A code path does not establish a live financial fact.

## Purpose and audience

Help individual investors record **why** they invested, check whether their assumptions still hold, understand concentration, and develop consistent review habits. Positionary does not recommend when to buy or sell and does not execute orders.

## User journey (implemented)

1. Sign in using Google. Only the verified numeric Google subject resolves the private workspace.
2. Optionally set investment principles: personal objective, horizon, display currency, review cadence, risk limits and note. This is not a mandatory onboarding gate.
3. Enter an investment plan on its **own page**: ticker, rationale, optional strategy/horizon, invalidation criteria, target and stop annotations, maximum allocation and review cadence. Plans are append-only revisions. The same plan form includes an optional **cash-funded additional-purchase scenario**. It uses compatible, bounded owner-only Tiger snapshots where available; otherwise same-currency user assumptions are required. When a compatible source exists, intended price and additional shares are the only new scenario inputs. It displays before/after concentration and before/after static -10/-20/-30% downside effects, remaining cash, and explicitly separate cash-limit and allocation-limit arithmetic share ceilings, not recommended share counts. Zero additional shares is the default baseline and quantity presets are only user-selected hypothetical comparisons. Technical strategies may additionally explore the drop from observed value to a user-entered price criterion, NOT acquisition-cost-based accounting loss. Users must explicitly opt in to store a narrative snapshot of assumptions and their decision with the immutable plan revision; otherwise scenario inputs/results are transient.
4. Use the dashboard to see dated account observations, due reviews and past follow-up tasks. Unavailable sources are labeled, not zeroed.
5. Open a ticker from the journal to see **current plan → decision history → self-assessment**. Record subsequent review and manually confirm the status of an authored next action.
6. Review portfolio concentration, overlapping self-classified risk factors, weekly/monthly process metrics and the limits of available performance evidence. The portfolio follow-up panel is below holdings and the optional concentration view. It shows the number of currently observed held tickers with a user-authored plan and user-assigned risk classification, then ranks up to five next steps (with all additional steps expandable): (a) compare an observed Tiger-only weight that exceeds a user-authored maximum, explicitly **not** a whole-portfolio compliance decision; (b) document a missing plan; (c) add an absent investment-thesis invalidation condition; (d) optionally classify shared risks and set a personal review cadence. For available comparable exposures, larger holdings come first within each priority. Missing stops or targets are **never** treated as unfinished plans. Only the latest authored plan revision is assessed; missing/incomplete source sets never become fabricated missing-plan or classification findings. The panel never writes a plan or changes a provider holding and never schedules a quote alert.
7. Use a single **AI 투자 복기** menu to choose stock decision review, cross-ticker habit analysis or longitudinal coaching after **fresh, explicit consent**. Each AI response includes a purpose-specific, evidence-cited focus and bounded source references; numeric targets/stops and locally detected review candidates are **never sent to the external model**. Conservative, explicit later note phrases about a strategy or thesis reversal are review candidates, not verified changes or trade instructions. Model output is never saved automatically. The owner may separately edit and explicitly approve a next action, which becomes an ordinary immutable plan check-in on the **current plan revision**, not an AI-authored plan revision.
8. Coaching may display up to eight recent user self-assessments and compare the latest four records against the preceding four records only when each group spans at least two distinct authored days. These are equal record-count samples, **not equal time periods**, independently verified action completion or investment performance. Previous next-action completion beyond the available latest per-ticker status is unknown.

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

The Tiger order history and investment journal display **one row per provider order**. Individual transaction observations are nested under their specific order only when a scoped parent-order reference matches; a different order with the same symbol, price and time is never merged. Each order carries its own user-authored decision note. Older fill-level notes remain visible in its detail; fills with no currently visible parent remain separately visible as unlinked, never discarded. Displayed sums are exact-decimal observation checks only, **not** audited execution completeness or broker-verified ledger publication. The original provider order and fill evidence remains immutable.

**Numeric display policy:** Monetary amounts and stock prices use two decimal places, share quantities use up to three, and percentages use up to two. The formatting uses exact decimal-string rounding and thousands separators; sub-cent or sub-millishare nonzero values are displayed as `<0.01` or `<0.001` (signed when negative), not as zero. This applies only to read-only UI figures. Original provider observations, typed form input, arithmetic intermediates, persisted strategy revisions and user-authored notes retain their original precision.

Historical totals, net returns, cross-currency totals, costs, fees and current valuation must **not** be guessed from incomplete provider history. The long-horizon performance page is an evidence-readiness view; it does not publish an unverified return percentage. Daily Tiger delayed-price observations, when permitted, are non-triggering contextual estimates—not live portfolio accounting.

## Privacy and AI

All private routes require a fresh workspace check. Railway stores tenant financial records behind FORCE RLS and restricted runtime roles. Signed API traffic includes replay/rate protections; secrets remain outside browser and repository. User-owned journal data supports bounded export and account deletion.

OpenRouter AI is **per-invocation opt-in** and constrained to ZDR/data-collection-denied provider parameters; the model receives bounded/filtered notes, not structured account IDs, balances, fee amounts or raw order payloads. Redaction of prose is best-effort: a user can still include sensitive details in free text. Do not claim guaranteed anonymization. AI daily/monthly quota and evidence-reference validation are enforced server-side.

## Deliberate exclusions

No trading, order cancel/replace, transfers, customer RSA-key upload, CSV-import product, real-time quote subscriptions, quote-triggered alerts or notifications, background quote polling, unsupervised investment advice, or reconstruction of old GitHub portfolio records.

## Scope and release status

The interactive journal/review/dashboard, OAuth login and tenant API are deployed. Tiger **personal** access is only for one configured owner. Public Tiger partner authorization is distinct and remains approval-gated. Real two-account Google production testing, actual provider account coverage, mobile physical-device acceptance, and financial publication require separate operational evidence. See [Roadmap](ROADMAP.md) and [Operations](OPERATIONS.md).


## Manual indicator criteria and trade observations

`More → My indicators` (`/private/indicators`) lets the user register up to 100
indicator definitions. Each definition names a parameter setting, timeframe,
buy/sell direction, context/timing purpose and either an inclusive numeric
threshold/range or a manually judged text condition. There are no recommended
thresholds, market-data requests, price alerts or automatic trading signals.

Dedicated pages register/edit criteria and record up to 20 selected indicators
with a timezone-qualified observation timestamp, optional exact values and a
judgment note. Numeric criteria compare only the entered value; missing values
remain unknown. Crossings and other text conditions are explicitly self-assessed.
Manual execution and journal/observed-order note forms can continue to this
optional step after the primary record has saved. Existing manual trades also
link from their detail page; observations can be standalone ticker decisions.

Edits append rule revisions; disabling a rule preserves history. Each observation
copies the selected revision on the server, so later rule edits cannot change
historical criteria or assessments. The criteria shown when opening the form are
the ones recorded, even if another tab subsequently changes them. These are
user-authored records, not broker-verified indicators. Trade detail and ticker
journal views show historical observations. Full JSON export and account deletion
include both criteria history and indicator records. List history is bounded to
200 entries and explicitly indicates more records.

## 거래 이유와 투자일지의 단일 원본 (2026-10-31)

- **거래 기록** (`/private/trades`)은 특정 Tiger 주문·부분체결과 그 매매 이유의 기본 화면이다. 각 목록에서 메모 유무/요약을 보여주고 `/private/trades/tiger/[sourceRef]`에서 원본 주문 조건, 체결 관측, 기존 이유 전체를 확인한다. 새 이유는 독립된 `.../note` 페이지에서만 작성한다. 미체결 스탑 주문에는 '주문 목적'이라고 표시하며 확정 체결로 다루지 않는다.
- **투자일지** (`/private/journal`)는 종목의 투자 논리·전략·목표/손절·판단 변화 중심이다. 거래에 연결된 `TRADE_NOTE`의 전문을 다시 표시하지 않으며 최근 거래 요약과 거래 상세 링크만 제공한다. 미연결 과거 메모는 삭제하거나 거래에 임의 귀속하지 않는다.
- 기존 `saas_journal_records`와 `saas_journal_tiger_observation_links`가 그대로 단일 저장 원본이다. 데이터 이동·복제·스키마 변경 없이, 조회와 작성의 진입점만 변경한다. 지우지 않는 추가형 이력·멱등성·실제 주인 소유 증거 확인이 그대로 적용된다.
- 기존 `/private/journal/new?mode=observed` 주소는 거래 기록의 작성 화면으로 이동한다. 채팅 MCP에서 특정 거래의 이유 기록 요청은 `request_tiger_order_refresh` → `get_tiger_order_refresh_status` → `get_tiger_order_observations` → `add_tiger_order_note` 순서로 처리하며, 동일 종목의 다른 주문을 임의 선택하지 않는다.
- AI 종목 투자 논리 비교에서는 거래-linked 메모를 별도 독립 투자전략 변경으로 취급하지 않는다. 거래 이유는 원본 한 건으로 보존하고, Tiger 주문 관측은 체결의 증거가 아닌 보조 사실로만 사용한다.
