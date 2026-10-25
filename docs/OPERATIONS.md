# Operations, security and privacy playbook
**Updated:** 2026-10-25. All financial records live in the private SaaS datastore, **not GitHub**.

## Branches / deployments
- Develop and test on `dev`. Promotion is a fast-forward `main` update after validation. Keep repository public, deploy only `main` to Vercel/Railway production.
- Railway identity API can use `python -m services.saas_api.schema_admin --deploy` as **pre-deploy**, never startup. It verifies exact main/service/environment identity, `SAAS_AUTO_MIGRATE=1`, `SAAS_MIGRATION_BACKUP_VERIFIED=1`, approved immutable migration names, current checksums and atomic lock/transaction.
- Applied migration versions 001–007 are retained even though CSV upload was retired. Never squash/rewrite that SQL chain to erase a historical feature; add new reviewed forward SQL. Do not drop populated broker/customer tables.
- `SAAS_S2_ENABLED` stays disabled until least-privilege trade DB role + real Google signed-in A/B tests prove isolation. `007_trade_runtime_login.sql` provisions a no-password login and guarded Railway `--deploy` assigns its password from private `SAAS_TRADE_RUNTIME_PASSWORD`; only the restricted `SAAS_TRADE_DATABASE_URL` may be used by the trade service.
- Secure hosted `SAAS_DATABASE_URL`, `SAAS_TRADE_DATABASE_URL`, `SAAS_INTERNAL_SECRET`, Auth.js/Google OAuth vars and any future Tiger credential vault settings in platform secrets, never in files or output. Rotate leaked secrets.

## Developer checks
```sh
python scripts/check_public_repo.py
python -m unittest discover -s tests -p 'test_saas_*.py' -v
python -m unittest discover -s tests -p 'test_broker_connectors.py' -v
python scripts/verify_saas_identity.py  # only with explicitly disposable isolated DB
python scripts/verify_saas_trade_isolation.py # only with disposable DB
python scripts/verify_saas_broker_isolation.py # only with disposable DB
cd apps/web && npm ci && npm run typecheck && npm run test:security
```
Database checks require appropriate environment and test DB guards. Browser-level A/B access tests, leakage/caching tests and restores remain necessary and cannot be replaced by fixture tests.

## Broker operating runbook
Tiger is `REQUIRES_REVIEW` and cannot be offered as a real customer connection until app eligibility, true read-only scopes, hosted OAuth/consent, secure per-user token sessions and account coverage are verified. Only a trusted worker may resolve scoped credentials. Each job must provide authoritative coverage, issues, retry/backoff and reauth state. Never use Tiger SDK trading methods. Do not infer missing past fills or zero quantity from a missing page. Customer CSV file uploads are not supported.

## Public Git history remediation
**Branch-history rewrite performed:** all three branch heads now begin from a verified parentless clean root with no personal financial source files. However a direct GitHub API request to an older sensitive SHA still returned its commit object after the rewrite. This is **not** complete permanent erasure. The repository has been publicly visible. Remaining actions:
1. Audit every branch, tag, PR diff/comment, issue attachment, Actions artifact, release, and external deployment for personal portfolio data or credentials. Identify collaborators/forks.
2. **Done for active branches:** previous refs now point at the same clean root. Re-clone local checkouts; never merge old history back. Check all tags, remote refs and clones for lingering older objects.
3. Follow GitHub's documented sensitive-data removal process for cached views/PR refs and contact GitHub Support if needed; rotate any exposed auth material.
4. Re-scan all reachable refs and the default branch, validate builds and remote deployments; document what is **verified** versus still externally retained.
Never claim a commit deletion by itself erases old public history or third-party copies.

## Release verification
- Railway guarded main-branch pre-deploy must apply each approved forward SaaS migration and report a successful version count. Confirm 007 and the real `saas_trade_app` role before activating S2.
- Run a real production snapshot/restore to an isolated DB and verify tenant rows, schema versions and application RLS with non-admin credentials. Disposable CI restore is not sufficient evidence.
- With two independently authenticated Google sessions, test logout/expiry, cross-user UUID manipulation, manual fills, notes, exports, account deletion and revoked membership.
- GitHub history cleanup requires GitHub Support for previously reachable SHA objects, cache and PR data; see GitHub official sensitive-data removal documentation.

## Safeguards
- Data minimization at ingestion, secrets stored encrypted outside app DB, no account IDs or portfolio details in URLs/telemetry/CI fixtures.
- Time-bounded consent, revocation, personal data export and deletion policy before general signup.
- Real restore rehearsal, monitoring, user-separation checks and rollback plan prior to changing hosted private schema.
- AI outputs are separate derived observations, not broker confirmations, not trades.
