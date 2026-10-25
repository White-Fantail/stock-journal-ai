# Railway SaaS internal API

The Python service provides HMAC-protected internal identity provision/resolve and **feature-gated** tenant financial event endpoints plus per-user authored journal, export and explicit account deletion; Google session/OIDC is owned by Next.js/Auth.js. An approval-gated Tiger enterprise OAuth2 flow and encrypted credential vault are implemented in source; **no live Tiger authorization has been verified or enabled**. No customer CSV import or trading/order execution endpoint exists here.

- `server.py`: internal endpoints, `/healthz`, signed requests.
- `identity.py`: Google `sub`-based workspace provisioning/membership resolution.
- `tiger_oauth.py`: provider-approved-only OAuth2 user consent, state replay prevention, AES-256-GCM grant/account vault, authorized asset/position GET snapshots, local disconnect and best-effort RFC7009 revoke. Requires `SAAS_BROKER_DATABASE_URL` with non-BYPASSRLS role; never a customer SDK private key.
- `trades.py`: manually confirmed immutable `EXECUTION/VOID` events behind `SAAS_S2_ENABLED` and scoped runtime DB access.
- `schema_admin.py`: audited, main Railway pre-deploy migration gate. Never perform DDL during HTTP requests or app startup.

Production pre-deploy command:
```sh
python -m services.saas_api.schema_admin --deploy
```
Read-only inspection:
```sh
python -m services.saas_api.schema_admin --status
```
For guarded Tiger setup see [Tiger P3 runbook](../../docs/saas/TIGER-P3-OAUTH.md). Only snapshot coverage exists so far; no real OAuth/grant has been tested.

Full preconditions: [Hosted schema runbook](../../docs/saas/HOSTED-SCHEMA-BOOTSTRAP.md). Separate tenant privilege tests, backup/restore, redaction and rate limits are mandatory before public access. Applied SaaS SQL 001–009 is guarded. Version 007 provisions `saas_trade_app`, a passwordless login until Railway private `SAAS_TRADE_RUNTIME_PASSWORD` is provided at guarded `--deploy`. The runtime trade DSN must use this non-BYPASSRLS role. Version 009 creates a separate `saas_broker_app` login with password supplied privately through `SAAS_BROKER_RUNTIME_PASSWORD` at guarded deploy. Versions 004/005 are retained as immutable migration history, **not** a CSV upload product.

Local disposable testing only: `python db/saas/migrate.py --apply` with an isolated test DB and `SAAS_TEST_DB_ACK=YES_DISPOSABLE_SAAS_DB`. Do not point the local test runner at Railway production.
