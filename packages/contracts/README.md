# Positionary — internal API contracts

Versioned JSON schema in this directory documents **specific bounded internal/publicly named responses**, not a provider entitlement or trading capability.

`tiger-readiness.v1.schema.json` describes the inert private Tiger status surface `GET /api/private/tiger/status` as a **readiness/status contract**, not an OAuth token, live balance, grant or verified execution feed. The production Tiger UI additionally distinguishes the isolated owner-only personal read bridge from approval-gated partner OAuth. Never confuse those surfaces.

- All private routes require the verified Google session + active workspace membership.
- Sensitive responses are private/no-store, strictly scoped, bounded and omit raw external account IDs, user-authored private text, credentials and source hashes.
- Cross-language amounts use Decimal strings; timestamps are offset-aware; provenance and unknown/partial/disabled states are explicit.
- New capabilities or differently shaped responses require a **new versioned schema**, endpoint contract tests and A/B cross-tenant denial tests. Schema alone never authorizes an action.
- There is no order placement, transfers, browser-provided workspace authority or CSV import contract.

Read [Architecture](../../docs/ARCHITECTURE.md), [Data model](../../docs/DATA-MODEL.md) and [Broker adapters](../../docs/saas/BROKER-ADAPTERS-V1.md).
