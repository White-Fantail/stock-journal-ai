# Positionary — guarded Railway PostgreSQL schema deployment

**Current state:** applied versions `001`–`027`. Keep every historical migration exactly as committed, **including retired CSV feature migrations 004/005**.

## Production process

The `positionary-api` Railway service tracking `main` executes **before deployment**:

```sh
python -m services.saas_api.schema_admin --deploy
```

Startup and API/web requests must not apply DDL. The guarded runner:

1. Verifies `RAILWAY_GIT_BRANCH=main`, pinned repository/project/service/environment identifiers and explicit `SAAS_AUTO_MIGRATE=1` and `SAAS_MIGRATION_BACKUP_VERIFIED=1`.
2. Verifies migration filenames against `APPROVED_AUTO_MIGRATIONS` in `schema_admin.py`, current checksums and expected baseline. Drift, nonempty untracked database and unknown migrations fail closed.
3. Locks execution transactionally and applies reviewed new scripts in ascending sequence. Applied historical checksums stay immutable.
4. Sets restricted runtime DB role passwords privately, not in migration SQL. Do not rotate live runtime access without coordinated connection/backup preparation.

`SAAS_MIGRATION_BACKUP_VERIFIED` is an **operator attestation**, not proof supplied by code. Confirm recoverable backups and perform real restore rehearsals.

## Roles and environment

| Boundary | Expected account | Private configuration |
| --- | --- | --- |
| Identity/schema administration | Deploy-privileged only, not web runtime trade queries | `SAAS_DATABASE_URL` |
| Authored journals/manual trades | Non-owner `saas_trade_app`; FORCE RLS | `SAAS_TRADE_DATABASE_URL`, `SAAS_TRADE_RUNTIME_PASSWORD` |
| Tiger grants/source/ledger reads | Separate `saas_broker_app`, non-BYPASSRLS | `SAAS_BROKER_DATABASE_URL`, `SAAS_BROKER_RUNTIME_PASSWORD` |
| Optional future dispatcher | Restricted `saas_dispatch_app` | `SAAS_DISPATCH_RUNTIME_PASSWORD` (when configured) |
| Optional future publication | Restricted `saas_publication_app` | `SAAS_PUBLICATION_RUNTIME_PASSWORD`, plus independent signer/key and approval flags |

Never place passwords/DSNs in README, GitHub Actions output, client bundle, build artifact or source files. Roles must not own tenant tables or use `BYPASSRLS`. Independently prove cross-tenant read/write denial before enabling new operations.

## Inspection and testing

In the correct **API service environment**:

```sh
python -m services.saas_api.schema_admin --status
```

Expected live baseline as of 2026-10-27: 27 applied, 0 pending. This is a status snapshot, not an instruction to repair a live database. Only use manual `--apply` flags after checking `--help`, environment safeguards and an approved migration plan.

For **disposable** CI-only PostgreSQL 18: the SaaS workflow provisions isolated DBs and validates migration/role constraints. Never use the test `SAAS_TEST_DB_ACK=YES_DISPOSABLE_SAAS_DB` against production or bypass guards to make CI pass.

If schema deploy fails: stop release; inspect drift, pinned runtime identity and verified backup. Never reset migration tracking, delete applied SQL or re-run legacy CSV features. See [Operations](../OPERATIONS.md).
