# Tiger P3 — hosted OAuth2 operator configuration (2026-10-26)

## Product and API distinction
Tiger **retail** OpenAPI OAuth2 (Python SDK >=3.8.0) is designed around an SDK-managed local authorization session/token cache. This project does **not** use that shared local session or request customers' signature keys. The implementation targets the separately documented **enterprise/agency partner OAuth2 authorization-code flow**, which requires Tiger's third-party SaaS app registration and permission grant. A retail Tiger ID/configuration file does not constitute partner app credentials.

## Operator-owned approval before enabling
1. Obtain written Tiger authorization for NZ retail third-party SaaS hosting; register exact HTTPS redirect URL \`https://<host>/api/private/tiger/callback\`, client_id/client_secret, audience and named query-only scopes.
2. Independently verify that the *entire grant* cannot place/cancel/modify orders, transfer funds or acquire such privileges without a distinct authorization flow. Do not set approval flags if these are not proved. Broad \`api.trade\`/order scopes are explicitly refused.
3. On Railway, deploy migration 008 (encrypted grants, attempts, snapshots) and 009 (broker limited LOGIN with NULL password) using the main-only pre-deploy. Configure independent \`SAAS_BROKER_RUNTIME_PASSWORD\` 64 lower-case hex so pre-deploy sets password. Set \`SAAS_BROKER_DATABASE_URL\` to dedicated \`saas_broker_app\` Postgres LOGIN, separate from identity and journal DB users. This role must not own tables or have BYPASSRLS.
4. Supply 32 bytes of CSPRNG key as Base64 \`TIGER_VAULT_KEY_B64\` to Railway only, plus \`TIGER_CLIENT_ID\`, \`TIGER_CLIENT_SECRET\`, \`TIGER_REDIRECT_URI\`, \`TIGER_APPROVED_READ_SCOPES\`, \`TIGER_AUDIENCE=openapi\`, \`TIGER_PARTNER_OAUTH_APPROVED=1\`, \`TIGER_READ_ONLY_GRANT_VERIFIED=1\`. **Do not rotate the AES key without re-encrypting existing records**. No Tiger secret goes into Vercel, GitHub or NEXT_PUBLIC variables.
5. Verify A/B browser user isolation on real Google sessions, callback replay, expired consent, logout, account bind denial and provider rate limits before opening to customers. Scope the rollout to approved accounts/regions only.

## Browser and Railway workflow
- User selects Tiger in \`/private/brokers\` and posts \`/api/private/tiger/start\`. Next.js signs internal HMAC request using Google subject, Railway creates a 10-minute single-use auth state, and redirects to Tiger's **official** authorize endpoint.
- Tiger calls back to same host after user consent. Auth.js session must still exist. Railway checks verified Google membership + one-use hashed state + exact requested scopes before exchanging auth code.
- Token+refresh token live AES-256-GCM encrypted in Railway DB, scoped with tenant+connection authenticated associated data. No SDK token files and no client-side tokens.
- User enters an account ID from Tiger Developer Center, and server tests actual asset **GET** under that user's token before storing only a keyed fingerprint, masked alias and encrypted identifier. \`GET\` asset and position snapshots are encrypted with evidence SHA-256; historical fills/fees are **not** claimed from snapshots.
- Disconnect deletes local tokens and encrypted account IDs, but this version requires provider-side grant revocation in the Tiger Developer Center too. Remote revocation and refresh/expiry must be validated against the enrolled provider before production rollout.
- All JSON endpoints are signed, nonce-protected and rate-limited; any broker API error fails closed. No order POST/PUT/DELETE route in the read-only provider module.

## Remaining explicit P3 validation
No real Tiger partner app, read-only scope names, callback test, remote revoke confirmation, production broker RLS identity or end-to-end test account has been supplied/verified. Sync now stores real point-in-time assets and positions **only if Tiger account access is separately authorized**. Historical transactions/backfill/pagination + idempotent fill staging and bounded worker scheduling remain necessary for P3 full exit.

Official docs: https://enterprise-docs.itigerup.com/reference/user-authorization ; https://enterprise-docs.itigerup.com/reference/post-v1-token ; https://docs-en.itigerup.com/docs/authentication
