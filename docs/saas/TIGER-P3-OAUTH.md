# Tiger Brokers — public partner OAuth readiness

**Status:** application-side hosted partner OAuth path is implemented **but not approved for general customers**. This guide is for a future, explicitly approved, **read-only** production rollout; it is not instructions to turn it on merely because the source exists.

## Separate credential models

- **Temporary personal RSA bridge**: one operator Google subject, one isolated Railway Tiger OpenAPI credential runner, per-account encrypted observations. Not available to any other user. See [personal bridge](../../temporary/tiger_personal/README.md).
- **Partner OAuth**: third-party application authorization-code consent per Google workspace. Requires Tiger authorization for service geography and desired read-only operations; a retail RSA OpenAPI key is not a partner client credential.

## Preconditions — all must be confirmed

1. Tiger provides written permission for **NZ third-party SaaS hosted OAuth**, exact redirect URI (`https://positionary.vercel.app/api/private/tiger/callback` unless separately approved), permitted account locations and data redisplay/market-data rights.
2. Review the **entire** application grant for named query-only scopes and prove that order placement, modification, cancellation, transfers and trading scopes cannot be reached. Reject ambiguous broad `api.trade` grants.
3. Confirm production database schema 008/009 and dedicated `saas_broker_app` with restricted `SAAS_BROKER_DATABASE_URL`, private `SAAS_BROKER_RUNTIME_PASSWORD`, no table ownership/BYPASSRLS, tenant A/B denial.
4. Secure Railway-only `TIGER_VAULT_KEY_B64` (32 cryptographically random bytes in Base64), `TIGER_CLIENT_ID`, `TIGER_CLIENT_SECRET`, `TIGER_REDIRECT_URI`, `TIGER_APPROVED_READ_SCOPES`, `TIGER_AUDIENCE`, and flags `TIGER_PARTNER_OAUTH_APPROVED` and `TIGER_READ_ONLY_GRANT_VERIFIED` **only after approval**. Do not put these into Vercel, GitHub, `NEXT_PUBLIC_` or logs.
5. Run **real** two-account Google sign-in/consent tests: scope tampering, callback state expiry/replay, account-binding denial, revoked consent, token expiration, retry/rate, cross-tenant leaks and logout.
6. Verify actual provider account identity, historical coverage, order-to-fill/fee semantics and time zones. Financial publication remains a **different** audited gate even after an OAuth grant works.

Never rotate `TIGER_VAULT_KEY_B64` blindly: older vault ciphertext needs a controlled re-encryption strategy. Independently managed `SAAS_SOURCE_HMAC_KEY` identifies source evidence for future backfill and cannot change without a dedupe migration strategy.

## Runtime contract

User selects Tiger in `/private/brokers`, begins server-authorized consent from `/private/tiger`, returns via validated callback, binds only their authorized provider accounts and can disconnect. Disabled/not approved state must remain explicit to other users; never show the personal bridge as their connection.

Future history worker and per-account dispatch are source/staging implementations only. They require an independently verified read-only provider capability, durable cursor/coverage, dedicated roles and reviewed startup job configuration. Do not enable on an unverified provider grant.

Official enablement requires operator evidence and an explicit release decision documented in [Roadmap](../ROADMAP.md), not just CI green.
