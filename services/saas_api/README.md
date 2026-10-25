# Railway SaaS internal API

The Python service provides HMAC-protected internal identity provision/resolve and **feature-gated** tenant financial event endpoints; Google session/OIDC is owned by Next.js/Auth.js. No Tiger live connection, broker credentials, customer CSV import or trading/order execution endpoint exists here.

- `server.py`: internal endpoints, `/healthz`, signed requests.
- `identity.py`: Google `sub`-based workspace provisioning/membership resolution.
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
Full preconditions: [Hosted schema runbook](../../docs/saas/HOSTED-SCHEMA-BOOTSTRAP.md). Separate tenant privilege tests, backup/restore, redaction and rate limits are mandatory before public access. Applied SaaS SQL 004/005 is retained as immutable migration history, **not** a CSV upload product.

Local disposable testing only: `python db/saas/migrate.py --apply` with an isolated test DB and `SAAS_TEST_DB_ACK=YES_DISPOSABLE_SAAS_DB`. Do not point the local test runner at Railway production.
