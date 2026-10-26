"""Fail-closed hosted SaaS schema migration runner.

The Railway pre-deploy hook calls --deploy, never application startup. Applied
version checksums are immutable; pending versions are applied atomically under
a transaction-level advisory lock. No historical private ledger is imported.
"""
from __future__ import annotations

import argparse
import hashlib
import os
import re
from pathlib import Path


MIGRATIONS = Path(__file__).resolve().parents[2] / "db" / "saas" / "migrations"
REQUIRED_TABLES = (
    "saas_users", "saas_workspaces", "saas_workspace_memberships",
    "saas_workspace_settings", "saas_journal_entries",
    "saas_broker_connections", "saas_broker_accounts", "saas_broker_sync_runs",
    "saas_trade_events", "saas_journal_records",
    "saas_internal_request_nonces", "saas_internal_rate_limits",
    "saas_tiger_oauth_attempts","saas_tiger_grants","saas_tiger_account_secrets","saas_tiger_source_snapshots",
    "saas_broker_backfill_jobs","saas_broker_backfill_windows","saas_broker_source_stage",
    "saas_broker_dispatch_queue",
    "saas_reconciliation_versions","saas_reconciliation_issues",
    "saas_verified_execution_stage","saas_projection_position_stage",
    "saas_reconciliation_source_links",
    "saas_journal_plan_revisions",
)
ADVISORY_LOCK = 2026102501

# Migration files and release approval MUST ship together in the same dev commit.
# After CI succeeds, main Railway pre-deploy applies every pending approved file
# automatically. No intentional per-feature deferral or per-version operator step.
# An unknown/unreviewed file fails the release rather than modifying live data.
APPROVED_AUTO_MIGRATIONS = frozenset((
    "001_identity.sql",
    "002_broker_links.sql",
    "003_trade_events.sql",
    "004_csv_imports.sql", # immutable applied history; NEVER rewrite/remove
    "005_remove_csv_imports.sql", # forward-only removal of unused staging
    "006_journal_security.sql", # reviewed tenant journal + HMAC nonce/rate tables
    "007_trade_runtime_login.sql", # restricted login with no inline password
    "008_tiger_oauth.sql", # AEAD grant vault, one-use state, tenant RLS, source snapshots
    "009_tiger_runtime_login.sql", # separate non-BYPASSRLS Tiger runtime login
    "010_broker_backfill_staging.sql", # tenant checkpoints and encrypted provider staging
    "011_backfill_worker_fencing.sql", # per-claim lease fencing token
    "012_backfill_page_resume.sql", # encrypted cursor + durable bounded page count
    "013_broker_dispatch_queue.sql", # restricted cross-tenant queue metadata role
    "014_reconciliation_audit.sql", # immutable tenant review versions and staged accounting
    "015_reconciliation_lineage.sql", # typed issues and account-scoped source stage FKs
    "016_journal_plan_revisions.sql", # append-only personal target/stop revisions
))
# Pin unattended migrations to the independently observed production Railway
# API service. These IDs are deployment identifiers, NOT database credentials.
PRODUCTION_RAILWAY_IDENTITY = {
    "RAILWAY_PROJECT_ID": "881e854d-86a2-436f-86a5-b17e5f92e912",
    "RAILWAY_SERVICE_ID": "350c9a6f-4f1e-4aaf-a50d-9ea8c1c5d31e",
    "RAILWAY_ENVIRONMENT_ID": "1a79e220-c75e-40be-a608-2d1f21a3ebb8",
    "RAILWAY_ENVIRONMENT_NAME": "production",
    "RAILWAY_GIT_BRANCH": "main",
    "RAILWAY_GIT_REPO_OWNER": "White-Fantail",
    "RAILWAY_GIT_REPO_NAME": "stock-journal-ai",
}


class SchemaRefused(Exception):
    pass


def manifest(root: Path = MIGRATIONS) -> list[tuple[str, str, str]]:
    files = sorted(root.glob("[0-9][0-9][0-9]_*.sql"))
    if not files or [p.name[:3] for p in files] != [
        f"{n:03d}" for n in range(1, len(files) + 1)
    ]:
        raise SchemaRefused("Missing or non-contiguous SaaS schema migrations")
    return [
        (p.name, hashlib.sha256(p.read_bytes()).hexdigest(), p.read_text(encoding="utf-8"))
        for p in files
    ]


def validate_applied(
    planned: list[tuple[str, str, str]],
    applied: dict[str, str],
    existing_tables: set[str],
) -> list[tuple[str, str, str]]:
    # Never use a new SaaS schema chain to overwrite or adopt legacy tables.
    if not applied and existing_tables:
        raise SchemaRefused("Database is nonempty but has no recorded SaaS schema versions")
    names = [name for name, _, _ in planned]
    if len(applied) > len(names) or set(applied) - set(names):
        raise SchemaRefused("Unexpected SaaS schema migration history")
    seen_gap = False
    missing = []
    for name, checksum, source in planned:
        if name in applied:
            if seen_gap or applied[name] != checksum:
                raise SchemaRefused("Applied SaaS schema checksums or ordering do not match source")
        else:
            seen_gap = True
            missing.append((name, checksum, source))
    return missing


def validate_auto_deploy(env: dict[str, str], planned: list[tuple[str, str, str]]) -> list[tuple[str, str, str]]:
    """Guard production-only automatic schema changes before opening a DB socket.

    These are deployment guardrails, not a replacement for a real backup or SQL
    review. Fail if code is run outside our Railway main-branch identity API.
    """
    if env.get("SAAS_AUTO_MIGRATE") != "1":
        raise SchemaRefused("Automatic SaaS migrations are not enabled")
    if env.get("SAAS_MIGRATION_BACKUP_VERIFIED") != "1":
        raise SchemaRefused("A recoverable database backup policy must be verified")
    for key, expected in PRODUCTION_RAILWAY_IDENTITY.items():
        if env.get(key) != expected:
            raise SchemaRefused("Unexpected Railway main-branch deployment identity")
    expected_names = sorted(APPROVED_AUTO_MIGRATIONS)
    if [name for name, _, _ in planned] != expected_names:
        raise SchemaRefused("Unreviewed SaaS migration added, removed or renamed")
    if env.get("SAAS_TEST_DB_ACK"):
        raise SchemaRefused("Disposable test database override is not allowed for hosted auto migration")
    return planned


def validate_manual_apply(missing: list[tuple[str, str, str]]) -> None:
    """Manual migration is constrained by the same reviewed release manifest."""
    if any(name not in APPROVED_AUTO_MIGRATIONS for name, _, _ in missing):
        raise SchemaRefused("Unreviewed pending schema change")


def main() -> int:
    parser = argparse.ArgumentParser(description="Railway SaaS schema bootstrap (operator only)")
    parser.add_argument("--status", action="store_true", help="Readonly schema inspection")
    parser.add_argument("--apply", action="store_true", help="Operator-approved manual schema apply")
    parser.add_argument("--deploy", action="store_true", help="Railway main pre-deploy migration (guarded)")
    parser.add_argument("--approve-schema-change", action="store_true",
                        help="Confirm this is the intended isolated SaaS database")
    parser.add_argument("--backup-verified", action="store_true",
                        help="Confirm a recoverable backup was verified by the operator")
    args = parser.parse_args()
    if sum((args.status, args.apply, args.deploy)) != 1:
        parser.error("Choose exactly one of --status, --apply or --deploy")
    if args.apply and (not args.approve_schema_change or not args.backup_verified):
        parser.error("--apply requires --approve-schema-change and --backup-verified")
    if args.deploy and (args.approve_schema_change or args.backup_verified):
        parser.error("--deploy takes no manual operator approval flags")
    dsn = os.environ.get("SAAS_DATABASE_URL", "")
    if not dsn:
        raise SchemaRefused("SAAS_DATABASE_URL not configured")
    planned = manifest()
    if args.deploy:
        validate_auto_deploy(dict(os.environ), planned)
        if not re.fullmatch(r"[0-9a-f]{64}", os.environ.get("SAAS_TRADE_RUNTIME_PASSWORD", "")):
            raise SchemaRefused("Missing strong runtime DB login secret")
        dispatch_password = os.environ.get("SAAS_DISPATCH_RUNTIME_PASSWORD", "")
        if dispatch_password and not re.fullmatch(r"[0-9a-f]{64}", dispatch_password):
            raise SchemaRefused("Malformed dispatch runtime secret")
        broker_password = os.environ.get("SAAS_BROKER_RUNTIME_PASSWORD", "")
        if broker_password and not re.fullmatch(r"[0-9a-f]{64}", broker_password):
            raise SchemaRefused("Malformed dedicated broker runtime secret")
        if os.environ.get("TIGER_PARTNER_OAUTH_APPROVED") == "1" and not broker_password:
            raise SchemaRefused("Tiger approved but broker runtime login is not configured")

    # Import lazily so pure, dependency-free validation tests can run in CI.
    import psycopg
    with psycopg.connect(dsn, connect_timeout=5) as conn:
        with conn.transaction():
            with conn.cursor() as c:
                c.execute("SELECT pg_advisory_xact_lock(%s)", (ADVISORY_LOCK,))
                c.execute("SELECT to_regclass('public.saas_schema_versions')")
                tracked = c.fetchone()[0] is not None
                if tracked:
                    c.execute("SELECT name, sha256 FROM public.saas_schema_versions")
                    applied = {str(name): str(digest).strip() for name, digest in c.fetchall()}
                else:
                    applied = {}
                c.execute("""SELECT tablename FROM pg_catalog.pg_tables
                             WHERE schemaname='public'""")
                existing = {str(row[0]) for row in c.fetchall()}
                # Version table without version records must not be mistaken
                # for a virgin database.
                if tracked and not applied:
                    raise SchemaRefused("Empty version registry needs operator review")
                missing = validate_applied(planned, applied, existing if not tracked else set())
                if args.status:
                    print("SCHEMA STATUS: applied=", len(applied),
                          "pending=", len(missing), "tracked=", tracked)
                    return 0 if not missing else 2
                if args.apply:
                    validate_manual_apply(missing)
                # Pending approved migrations are never silently skipped.
                to_apply = missing

                if not tracked:
                    c.execute("""CREATE TABLE public.saas_schema_versions (
                                 name text PRIMARY KEY, sha256 char(64) NOT NULL)""")
                for name, checksum, source in to_apply:
                    # Execute each immutable SQL file and its ledger insertion
                    # in one transaction. A failure rolls back the entire batch.
                    c.execute(source)
                    c.execute("""INSERT INTO public.saas_schema_versions(name,sha256)
                                 VALUES (%s,%s)""", (name, checksum))
                c.execute("""SELECT tablename FROM pg_catalog.pg_tables
                             WHERE schemaname='public'""")
                tables = {str(row[0]) for row in c.fetchall()}
                if set(REQUIRED_TABLES) - tables:
                    raise SchemaRefused("Expected SaaS tables are missing after applying schema")
                final_versions = set(applied) | {name for name, _, _ in to_apply}
                if args.deploy and "007_trade_runtime_login.sql" in final_versions:
                    # Password arrives only from the private Railway pre-deploy
                    # environment; keep it out of SQL files, repository and logs.
                    secret = os.environ["SAAS_TRADE_RUNTIME_PASSWORD"]
                    c.execute("SELECT set_config('saas.trade_login_secret',%s,true)",(secret,))
                    c.execute("""DO $set_login$
                        BEGIN
                          EXECUTE format('ALTER ROLE saas_trade_app PASSWORD %L',
                            current_setting('saas.trade_login_secret'));
                        END
                        $set_login$""")
                    c.execute("SELECT set_config('saas.trade_login_secret','',true)")
                if args.deploy and "009_tiger_runtime_login.sql" in final_versions:
                    broker_secret = os.environ.get("SAAS_BROKER_RUNTIME_PASSWORD", "")
                    if broker_secret:
                        c.execute("SELECT set_config('saas.broker_login_secret',%s,true)", (broker_secret,))
                        c.execute("""DO $set_tiger_login$
                            BEGIN
                              EXECUTE format('ALTER ROLE saas_broker_app PASSWORD %L',
                                current_setting('saas.broker_login_secret'));
                            END
                            $set_tiger_login$""")
                        c.execute("SELECT set_config('saas.broker_login_secret','',true)")
                if args.deploy and "013_broker_dispatch_queue.sql" in final_versions:
                    secret = os.environ.get("SAAS_DISPATCH_RUNTIME_PASSWORD", "")
                    if secret:
                        c.execute("SELECT set_config('saas.dispatch_login_secret',%s,true)",(secret,))
                        c.execute("""DO $login$
                          BEGIN
                            EXECUTE format('ALTER ROLE saas_dispatch_app PASSWORD %L',
                              current_setting('saas.dispatch_login_secret'));
                          END
                          $login$""")
                        c.execute("SELECT set_config('saas.dispatch_login_secret','',true)")
                if "005_remove_csv_imports.sql" in final_versions:
                    if {"saas_csv_import_batches", "saas_csv_import_rows"} & tables:
                        raise SchemaRefused("Removed CSV tables unexpectedly remain")
                elif "004_csv_imports.sql" in final_versions:
                    if {"saas_csv_import_batches", "saas_csv_import_rows"} - tables:
                        raise SchemaRefused("CSV staging tables missing from historical version 004")
    print("SAAS SCHEMA APPLIED/VERIFIED:", len(applied) + len(to_apply), "version(s)")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except SchemaRefused as error:
        print("SAAS SCHEMA REFUSED:", error)
        raise SystemExit(1)
    except Exception as error:
        # Do not print exceptions that may contain database hostnames,
        # user names, credentials or SQL source data.
        print("SAAS SCHEMA FAILED:", type(error).__name__)
        raise SystemExit(1)
