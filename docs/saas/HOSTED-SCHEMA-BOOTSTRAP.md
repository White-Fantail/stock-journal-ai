# Railway hosted SaaS schema — guarded main pre-deploy
**Updated:** 2026-10-25. Operations reference; not proof that live production DB is configured correctly.

## Deployment policy
The Railway SaaS API service tracking `main` executes `python -m services.saas_api.schema_admin --deploy` in **pre-deploy**, not during HTTP server startup or Vercel build. For deployment, the source manifest `APPROVED_AUTO_MIGRATIONS` in `schema_admin.py` must exactly match the SQL filenames, and Railway identity variables must match the pinned expected production repo/project/service/environment/main branch. Both `SAAS_AUTO_MIGRATE=1` and `SAAS_MIGRATION_BACKUP_VERIFIED=1` must be intentionally set after verifying an actual restore strategy. The runner uses an advisory lock, sequential checksum checks, and a transaction; drift and unexpected nonempty databases fail closed.

## Version policy
Current versions:
- 001 identity/workspaces
- 002 broker links/account/sync metadata
- 003 manual trade event ledger
- 004 **historical discontinued CSV staging migration**, immutable even when feature removed
- 005 **approved guarded retirement** of empty CSV staging, refusing deletion when rows exist
- 006 tenant-authored append-only investment journal, nonce/replay prevention and rate-limit tables
- 007 least-privilege trade runtime LOGIN (password omitted from SQL and applied at deploy from private environment)

Never remove or edit migration 004 simply because the CSV product has been discontinued. The version ledger is operational DB history, **not customer CSV-upload functionality**. New reviewed forward migrations (006+) must include same-change manifest approval and CI on disposable PostgreSQL. Never automatically allow destructive/nontransactional SQL without a separate reviewed plan.

## Dedicated financial DB runtime role
For the reviewed 007 rollout, Railway API private `SAAS_TRADE_RUNTIME_PASSWORD` must be a randomly generated 64-hex-character secret. The pre-deploy runner configures the login password inside the guarded migration transaction; `SAAS_TRADE_DATABASE_URL` must connect as `saas_trade_app`, not the identity/owner/admin role. Never log or commit these secrets. Real A/B Google-user HTTP negative testing, distinct DB role verification and restore rehearsal precede setting `SAAS_S2_ENABLED=1`.

## Inspection
In the Railway **API container**, using the correct `SAAS_DATABASE_URL`:
```sh
python -m services.saas_api.schema_admin --status
```
Inspect target DB identity, applied versions/checksums and pending versions. Incorrect target, checksum drift, out-of-order history or unexpected tables require investigation, **not** forced registry rewrite.

For a one-time explicitly verified setup, the operator-only manual command is:
```sh
python -m services.saas_api.schema_admin --apply --approve-schema-change --backup-verified
```
Only after matching the intended DB and verifying recoverable backups. A successful `--deploy` migration does not enable broker sync, manual trades, AI or public customer registration. `SAAS_S2_ENABLED` remains unset until actual non-BYPASSRLS financial runtime roles, authenticated A/B HTTP access tests and restore drill pass.

## Deployment verification
- API `/healthz` is reachable and the Google flow provisions distinct private workspaces for two test Google identities.
- A cannot view B's data through URLs, actions, exports or backend jobs. Inspect RLS with a non-admin runtime DB role and pool connection reuse.
- Verify pre-deploy logs show applied versions without credentials/financial data, and no CSV staging tables remain if 005 applied.
- Vercel and Railway deploy independently; avoid assuming a frontend deploy is atomic with backend migrations.

## Security
No private holdings, legacy GitHub portfolio data or broker credentials are schema seed data. Keep signed service transport/TLS, minimal DB role permissions, no token logging, and regular tested backup/restore. For project privacy and Git history cleanup see [Operations](../OPERATIONS.md).
