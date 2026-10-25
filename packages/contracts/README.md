# Internal versioned provider-readiness API contracts

The `tiger-readiness.v1.schema.json` schema documents an **inert** `GET /api/private/tiger/status` response. It is not a Tiger login, OAuth callback, account-link operation, execution import, production position API or trading capability.

Access requires the current Google-authenticated user's **active workspace membership**, resolved server-side. The response must be private/no-store and cannot include raw account IDs, balances, trade records, tokens or private analysis. Anonymous requests must fail closed. Do not return legacy GitHub owner-only identity or confuse the contract with authorization.

When production Tiger read-only integration is approved, publish a **new versioned contract** containing consent/grant status, per-account capability, coverage and staleness/partial diagnostics, all tenant-bound. Never let a schema authorize the caller, place trades, transfer funds or write directly to the journal.

Cross-language data contracts use ISO-8601 offset-aware timestamps, Decimal numbers encoded as strings, explicit provenance, scoped provider source identity, and verifiable incomplete/unsupported states. See [Broker adapter design](../../docs/saas/BROKER-ADAPTERS-V1.md).
