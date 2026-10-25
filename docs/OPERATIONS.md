# Operations, security and privacy playbook
**Updated:** 2026-10-25. All financial records live in the private SaaS datastore, **not GitHub**.

## Branches / deployments
- Develop and test on `dev`. Promotion is a fast-forward `main` update after validation. Keep repository public, deploy only `main` to Vercel/Railway production.
- Railway identity API can use `python -m services.saas_api.schema_admin --deploy` as **pre-deploy**, never startup. It verifies exact main/service/environment identity, `SAAS_AUTO_MIGRATE=1`, `SAAS_MIGRATION_BACKUP_VERIFIED=1`, approved immutable migration names, current checksums and atomic lock/transaction.
- Applied migration versions 001–005 are retained even though CSV upload was retired. Never squash/rewrite that SQL chain to erase a historical feature; add new reviewed forward SQL. Do not drop populated broker/customer tables.
- `SAAS_S2_ENABLED` stays disabled until least-privilege trade DB role + negative signed-in A/B tests prove isolation.
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
**A deletion commit removes only current branch files.** Existing history and the `archive/phase0-2026-10-25` ref may still expose previously pushed personal data. The repository has been publicly visible. To approach full remediation:
1. Audit every branch, tag, PR diff/comment, issue attachment, Actions artifact, release, and external deployment for personal portfolio data or credentials. Identify collaborators/forks.
2. Schedule a deliberate clean-history rewrite with a verified safe commit/tree, move affected refs, delete old archive refs and tags, update upstream clones and break old GitHub references. This is **not** part of ordinary fast-forward releases and cannot guarantee removal from forks/caches.
3. Follow GitHub's documented sensitive-data removal process for cached views/PR refs and contact GitHub Support if needed; rotate any exposed auth material.
4. Re-scan all reachable refs and the default branch, validate builds and remote deployments; document what is **verified** versus still externally retained.
Never claim a commit deletion by itself erases old public history or third-party copies.

## Safeguards
- Data minimization at ingestion, secrets stored encrypted outside app DB, no account IDs or portfolio details in URLs/telemetry/CI fixtures.
- Time-bounded consent, revocation, personal data export and deletion policy before general signup.
- Real restore rehearsal, monitoring, user-separation checks and rollback plan prior to changing hosted private schema.
- AI outputs are separate derived observations, not broker confirmations, not trades.
