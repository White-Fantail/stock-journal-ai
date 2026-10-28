# Positionary

**Positionary** is a Google-first, tenant-isolated investment journal for long-term decision quality—not a trading terminal. The public site is [positionary.vercel.app](https://positionary.vercel.app/). The code repository intentionally retains its historical name `stock-journal-ai`.

## What the application does today

- **Google sign-in and personal workspace:** Auth.js sessions, server-verified workspace membership, account export/deletion, HMAC-protected Railway API and PostgreSQL FORCE RLS.
- **Dashboard:** account observations (when authorized), authored investment notes, due plan reviews and unfinished self-reported follow-up actions.
- **Portfolio:** per-account Tiger observations with timestamps, per-currency guards, concentration and user-classified overlapping risk factors; historical signed-ledger figures **only when separately verified and released**.
- **Investment journal:** separate pages for new entries and append-only investment-plan revisions; rationale, assumptions/invalidation, horizon, target/stop *annotations*, user reviews and follow-up status.
- **Transactions:** manually confirmed transactions, Tiger order/partial-fill **observations**, and independently verified broker fills are **different sources**; missing fees/coverage are never inferred.
- **Review:** weekly/monthly process reports, risk calculator, review center and long-horizon performance-readiness checks. Unverified total returns and P/L are withheld.
- **Optional AI:** user-initiated, explicit consent, bounded/redacted excerpts to OpenRouter ZDR-only providers, evidence-linked reflection; no automatic trades or implicit background prompts.
- **Remote MCP (feature-gated):** OAuth 2 with the same Google subject and tenant-scoped investment read/append tools. See [MCP integration](docs/MCP.md). User-authored writes do not place broker orders.
- **Tiger integration:** a restricted **single-owner temporary read-only RSA bridge** can provide private observations to its designated Google account. The separate multi-user Tiger partner OAuth workflow exists in source but requires independent provider approval and read-only scope verification before public enablement.

The service intentionally has **no real-time or delayed-price target/stop alerts, quote polling loop, trade execution, price-triggered buy/sell signals, CSV importer, or GitHub-hosted personal portfolio**. Recorded targets are notes, not broker orders.

## Documentation

| Guide | Purpose |
| --- | --- |
| [Product](docs/PRODUCT.md) | User capabilities, limits and product rules |
| [Architecture](docs/ARCHITECTURE.md) | Runtime boundaries and security |
| [Data model](docs/DATA-MODEL.md) | Provenance, migrations, completeness and financial release gates |
| [Roadmap](docs/ROADMAP.md) | Outstanding engineering and operational work |
| [Operations](docs/OPERATIONS.md) | Tests, deployments, privacy and incident procedures |
| [Broker adapters](docs/saas/BROKER-ADAPTERS-V1.md) | Tiger-first read-only integration |
| [Database deployment](docs/saas/HOSTED-SCHEMA-BOOTSTRAP.md) | Restricted roles and guarded migrations |
| [Remote MCP](docs/MCP.md) | Same-account ChatGPT/MCP OAuth, tool capabilities, security and rollout |
| [Tiger partner OAuth](docs/saas/TIGER-P3-OAUTH.md) | Prerequisites for broad customer authorization |
| [Temporary personal Tiger bridge](temporary/tiger_personal/README.md) | Current owner-only integration |

Implementation rules: [AGENTS.md](AGENTS.md). Component guides: [SaaS API](services/saas_api/README.md), [normalizers](services/tiger_sync/README.md), [contracts](packages/contracts/README.md).

## Repository and release

`apps/web/` is the Next.js 16 web application on Vercel; `services/saas_api/` is the Python service on Railway; `db/saas/migrations/` contains 29 immutable incremental migrations; `services/broker_connectors/` contains shared provider contracts and reconciliation code; `temporary/tiger_personal/` contains the isolated owner-only runner.

Make changes on `dev`; verify before **fast-forward only** to `main`. Vercel and Railway production follow `main`. The SaaS CI runs TypeScript/Next build, Python and disposable PostgreSQL tenant security, plus synthetic Playwright Chromium journeys. **Green CI does not prove real Google OAuth, Tiger provider entitlements or real-device behavior.** Enforce required checks in GitHub branch rules; this remains an operational task until confirmed.

This public repository stores **code, synthetic tests and public documentation only**. Never commit API credentials, customer transactions, brokerage statements or private investment rationales. Active refs were rewritten in October 2026; separately hosted old GitHub objects, caches and external clones are not proven erased.
