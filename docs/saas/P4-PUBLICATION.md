# P4 private broker ledger release contract (offline foundation)

**Status:** implemented in `dev` as a **disabled internal gate**, not live Tiger transaction publishing. User-originated trades and journal notes remain separate from broker-verified ledger facts.

## Immutable data flow

`Tiger read-only evidence -> encrypted P3 stage -> independent coverage certification -> P4 reconciliation version (BLOCKED / STAGED) -> independent publication signature -> immutable private ledger release -> future authenticated read model -> journal annotations.`

- Only a fresh Google OWNER/workspace, account-bound currently authorized Tiger read-only grant and **latest STAGED** reconciliation may be considered.
- The gate obtains an account-scoped transaction advisory lock shared with the review writer, then checks original P3 encrypted source fingerprints are still unique per fill, with exactly one lineage link per staged fill and no missing staged projection. No undocumented raw Tiger fields or unknown fees become verified by calling this method.
- Publication HMAC binds workspace/account, P4 review ID/number and review digest, all keyed fill IDs, exact encrypted source-stage row IDs and evidence SHA, native-currency fill/position values, and the snapshot as-of timestamp. Any change invalidates the signature. Nothing issues an approval inside Positionary.
- `saas_broker_ledger_publications` and `saas_broker_ledger_sources` are append-only FORCE-RLS tables with scoped composite FKs and no mutation privileges to the publisher. A repeated signed release returns its original version; an altered one refuses. Later BLOCKED reviews do **not** erase audit history and must suppress prior releases from any future user-facing read model.
- This does not turn a broker event into a manually authored trade. When a read model is built, the per-symbol journal will reference internal source keys; a resync must never rewrite customer-written theses, entry reasons or risk plans.

## Separation of duties

- `saas_broker_app`: Tiger token/evidence collection and private staging; **cannot INSERT release rows**.
- `saas_publication_app`: distinct non-superuser/NOBYPASSRLS login, NULL password by default and `saas_publication_runtime` privileges; can read strictly scoped input data and INSERT immutable release rows, **cannot INSERT/UPDATE source stage**.
- An external provider-authorized independent verifier must issue the signed release proof. The HMAC verifier in `ledger_publication.py` **does not create proofs**; no REST/Next.js route calls it.
- Never reuse or log the independent release signing key, broker vault encryption key or source HMAC key. A dedicated service identity and real audit evidence are prerequisites to enabling the publisher.

## Operator-owned future prerequisites (not action items for the current dev commit)

1. Obtain Tiger third-party NZ SaaS approval and prove consent cannot grant trade/order execution privileges.
2. Verify history coverage, source fill identity, order/fee/cash/FX/corporate-action semantics and completeness with actual authorized Tiger account evidence; implement and independently review an attestation issuer.
3. Verify deployed production Google A/B isolation and DB roles; perform a real database backup/restore drill, log/alert reviews and key rotation/incident planning.
4. Only after these gates, provision `SAAS_PUBLICATION_RUNTIME_PASSWORD` (64 lowercase hex) in **Railway pre-deploy only** and `SAAS_PUBLICATION_DATABASE_URL` as the restricted login in the future publisher process. `SAAS_P4_PUBLICATION_KEY` is a distinct private 64-hex verifier secret. Explicit opt-in `SAAS_P4_PUBLICATION_ENABLED=1` requires independent review; default unset/off.
5. Implement a limited publisher worker and private, authenticated, source-linked read model that **always checks the latest review** before showing broker-derived figures. Do not expose raw tokens, raw external account IDs or incomplete financial figures.

Migration 017 is forward-only and automatically manifest-reviewed by `schema_admin`; it creates tables and the disabled role, not a production feature launch. It does not modify migrations 001–016.

## Tests

- `python -m unittest discover -s tests -p 'test_saas_ledger_publication.py' -v`: release proof binding, missing approvals and untrusted input fail-closed.
- `python -m scripts.verify_saas_reconciliation_store` on the explicitly acknowledged **disposable** PostgreSQL 18 CI database: staged proof/replay, two-tenant RLS, no collector INSERT, no publisher UPDATE/DELETE, stale review and later conflicting provider evidence.
- `.github/workflows/saas.yml`: tests the production-gated 017 migration and independent login on disposable PostgreSQL, plus restore evidence. Passing CI does not certify production backups or Tiger authorization.


## P4 private read model and journal integration (2026-10-26)

`services/saas_api/ledger_read.py` and the internal `POST /internal/v1/tiger/ledger-read` implement signed, nonce/rate-limited **read-only** retrieval via `saas_broker_app`. No browser-supplied workspace, account or version selector is accepted. The endpoint freshly resolves the Google OWNER, sets transaction-local RLS scope, tests active Tiger inquiry-only consent, coordinates with review writers, then rechecks the **latest** audit state and matches every signed, unchanged staged source against its immutable published manifest. Any BLOCKED revision, revoked grant, missing lineage, conflicting stage version, invalid publication HMAC or missing approval yields **no affected account money/fills**.

Read rollout requires all four explicit conditions: `SAAS_P4_LEDGER_READ_ENABLED=1`, `SAAS_P4_PUBLICATION_ENABLED=1`, `TIGER_PARTNER_OAUTH_APPROVED=1` and `TIGER_READ_ONLY_GRANT_VERIFIED=1`. **All are off unless independently configured.** The read service also needs `SAAS_P4_PUBLICATION_KEY` to verify stored release signatures; it never issues signatures or writes releases. The API returns bounded native-currency Decimal strings, offset-bearing timestamps, internally keyed HMAC source references, and masked account aliases only. No raw provider ID, decrypted source payload, tradeable token, live price, FX translation or unsupported unrealized return is returned. A truncated list is explicitly signaled.

The Next.js server-only `tigerLedgerRead()` gateway independently validates the exact response shape. The private journal loads it only after a fresh session/workspace lookup, separately from the user's authored notes. The interactive per-symbol **Tiger 검증 체결** tab displays verified fills with BROKER_VERIFIED provenance; manual USER_ASSERTED trades and personally authored target/stop/strategy remain separate. On disabled, missing or failed broker read, the journal continues safely with no fake broker activity. A future **per-fill note association** (new immutable user-authored reference table) must be designed separately; grouping a ticker's notes beside fills does not assert that a specific note belongs to a specific fill.

Test gates: `tests/test_saas_ledger_read.py` (negative read cases, exact source matching, inactive gate), plus updated `scripts/verify_saas_reconciliation_store.py` (disposable PostgreSQL 18 account A/B RLS, approved read, withheld after conflicting provider revision). Neither suite proves actual Tiger approval or production backup/recovery.


## Immutable individual broker-fill annotations (migration 018)
`saas_journal_broker_fill_links` has a tenant-scoped primary key on the user-authored journal note and composite FKs to the exact original signed broker-ledger publication, keyed source, verified fill's ticker, note author's membership and TRADE_NOTE kind. The trade login has SELECT-only access to the source version/release metadata required for this check and INSERT-only links and authored notes, **not** Tiger tokens or source-payload decryption.

New `/internal/v1/journal/broker-note/create` accepts only `subject` and `brokerNote: {idempotencyKey,ticker,content,accountId,sourceRef}`, which are server-authorized; workspace/author/version/publication cannot be client-supplied. The service first checks an independently signed currently releasable source using the dedicated broker login, and then inserts the authenticated note and source link in one transaction with latest-review constraints. Replays return the existing note, while a changed request under the same key is a conflict. A superseding provider revision blocks further attachments. Existing notes and exports retain historical references; the UI labels them currently verified **only** while the exact account/source/version appears in the signed latest ledger. Historic notes are not auto-relinked to corrected fills. The rollout remains disabled until official provider and source certification gates are satisfied.
