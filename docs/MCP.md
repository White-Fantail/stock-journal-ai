# Positionary MCP — same Google workspace

**Status:** implemented on main, feature-gated; real account/connector permissions still require end-to-end verification.

## Endpoint and OAuth discovery

- Streamable HTTP: https://positionary.vercel.app/api/mcp (stateless JSON-RPC POST)
- Authorization metadata: /.well-known/oauth-authorization-server
- Protected resource metadata: /.well-known/oauth-protected-resource/api/mcp
- Dynamic OAuth public client registration: /api/mcp/oauth/register
- User consent: /mcp/authorize ; token endpoint: /api/mcp/oauth/token

An MCP client registers an HTTPS callback and uses authorization code with mandatory PKCE S256. User signs in with exactly the same Google account as Positionary web, and explicitly consents to:

- positionary:read: available Tiger connection/account observations, manual trading records, plan revision history, journal, indicators, principles, risk factors, reviews.
- positionary:read positionary:write: in addition append and revise only user-authored records through existing signed Railway APIs, each with user confirmation and stable UUID idempotency key.

Membership is always resolved from verified Google numeric subject (never email or caller-provided workspace). The existing private Tiger RSA runner remains owner-only; all other accounts need the separate officially approved Tiger OAuth flow.

## Available MCP functions

Read: Tiger connection status, owner account snapshots, paginated order/fill/fee observations, verified-only ledger, manual trades, journal, plans, investor principles, risk groups, manual indicators, check-ins/actions, weekly and monthly reviews.

Owner-only RSA refresh: `request_tiger_order_refresh` queues a bounded recent-order read through the existing authenticated Railway API into the isolated personal worker; `get_tiger_order_refresh_status` reports `RUNNING`, `COMPLETED`, `FAILED` or `COOLDOWN`. This does **not** place orders, cancel orders, or verify any execution. Once `COMPLETED`, call `get_tiger_order_observations(page=0)` and identify the exact order using the observation's `sourceRef` alongside ticker, side, order type (`STP`/`STP_LMT` etc.), stop trigger `auxPrice`, order quantity, and status. `SUBMITTED` with 0 filled shares is pending; do not call it a sale. Older observations may lack type and trigger and must be treated as unknown until re-collected.

Write: append journal notes, add immutable investment plan revisions (target, stop, strategy), save investor principles, record or void manually entered user-asserted executions, revise manual indicator rules, add manual indicator snapshots, revise user-assigned risk factors, create a plan check-in, mark a prior follow-up outcome. Same database and tenant RLS as web. Existing history is not overwritten.

`add_tiger_order_note` attaches a user-approved, append-only trade rationale to the **exact** observed Tiger order by its 64-character `sourceRef` and page. It uses the existing `/internal/v1/journal/observation-note/create` tenant- and owner-validated route. Write scope, explicit `confirm:true`, a stable idempotency UUID and an unambiguous saved order are required. If a fresh refresh is still running, fails, is rate-limited, or multiple orders match the user's conversational description, return the status/candidates and request clarification rather than attaching to an arbitrary same-ticker record. ChatGPT cannot infer a real execution from the user's statement or a submitted stop order.

**Not offered:** Tiger order placement/cancellation/amendment, funds transfer, automatic trading, quote polling/price alerts, or broker account impersonation. MCP tool confirmation must be paired with the MCP client's own user confirmation UI.

## Security and rollout

- Vercel server-only environment flag POSITIONARY_MCP_ENABLED defaults OFF; set to 1 for an approved rollout only.
- Existing AUTH_SECRET (32+ chars), SAAS_INTERNAL_SECRET and SAAS_INTERNAL_API_URL are required. Never use NEXT_PUBLIC_ for these. No MCP password or Tiger RSA key is issued.
- Access grants last 15 minutes, refresh grants up to 7 days, one-use authorization codes 2 minutes. Signed values are purpose-isolated. Fresh workspace membership is resolved for every tool request.
- Railway signed internal endpoint /internal/v1/mcp/consume verifies membership and burns SHA-256 grant nonces until their actual expiration in the already-existing durable replay table. Refresh replay does not become possible after two-minute request-nonce cleanup.
- Google web logout does not automatically revoke OAuth bearer tokens. Emergency disable: POSITIONARY_MCP_ENABLED=0. AUTH_SECRET rotation invalidates tickets and web sessions. Per-client grant revocation UI is not yet implemented; keep as a controlled pilot until operationally accepted or addressed.
- Never equate SNAPSHOT_ONLY / UNVERIFIED / partial / truncated observations with complete, audited portfolio profit or cost basis.

## Production verification checklist

1. Confirm dev typecheck, Next build, web security tests, Python replay tests and both SaaS CI jobs.
2. Execute real OAuth login/consent, PKCE exchange, refresh and rejected tampered client, callback, scope, code/refresh replay, deactivated account and missing bearer tests.
3. Verify two real Google users; ensure other account cannot see owner Tiger observations and approved MCP writes appear in the web UI for only the same tenant.
4. Resolve public-tenant grant revocation UX before opening access widely.
5. Enable server-only feature flag on Vercel production and deploy from main after reviewed fast-forward; independently check deployment health and user flows.
