"""Adversarial tenant A/B broker metadata boundary checks against disposable DB.

Only synthetic accounts; no Tiger network, customer identities, tokens, or trades.
"""
from __future__ import annotations
import os
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import psycopg
from services.saas_api.identity import provision

FP = "a" * 64


def main() -> None:
    if os.environ.get("SAAS_TEST_DB_ACK") != "YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("REFUSED: disposable DB acknowledgement required")
    with psycopg.connect(os.environ["SAAS_DATABASE_URL"]) as conn:
        a = provision(conn, {
            "subject": "1000000000071", "email": "broker-a@example.invalid",
            "email_verified": True, "name": "Broker A"
        })
        b = provision(conn, {
            "subject": "1000000000072", "email": "broker-b@example.invalid",
            "email_verified": True, "name": "Broker B"
        })
        assert a["workspaceId"] != b["workspaceId"]
        conn.execute("CREATE ROLE saas_broker_rls_test NOLOGIN NOSUPERUSER NOBYPASSRLS")
        conn.execute("GRANT USAGE ON SCHEMA public TO saas_broker_rls_test")
        conn.execute("""GRANT SELECT, INSERT ON
                    saas_broker_connections, saas_broker_accounts,
                    saas_broker_sync_runs TO saas_broker_rls_test""")
        conn.execute("SET ROLE saas_broker_rls_test")
        with conn.transaction():
            conn.execute("SELECT set_config('saas.workspace_id', %s, true)", (a["workspaceId"],))
            connection_a = conn.execute(
                """INSERT INTO saas_broker_connections
                   (workspace_id,provider_code,auth_mode)
                   VALUES (%s,'TIGER','OAUTH2') RETURNING id""",
                (a["workspaceId"],)).fetchone()[0]
            account_a = conn.execute(
                """INSERT INTO saas_broker_accounts
                   (workspace_id,connection_id,external_account_fingerprint,alias)
                   VALUES (%s,%s,%s,'Synthetic A') RETURNING id""",
                (a["workspaceId"], connection_a, FP)).fetchone()[0]
            conn.execute(
                """INSERT INTO saas_broker_sync_runs (workspace_id,account_id,start_utc,end_utc)
                   VALUES (%s,%s,'2026-10-20T00:00:00Z','2026-10-21T00:00:00Z')""",
                (a["workspaceId"], account_a))
            for table in ("saas_broker_connections", "saas_broker_accounts",
                          "saas_broker_sync_runs"):
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 1

        with conn.transaction():
            conn.execute("SELECT set_config('saas.workspace_id', %s, true)", (b["workspaceId"],))
            for table in ("saas_broker_connections", "saas_broker_accounts",
                          "saas_broker_sync_runs"):
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0, table
            # Same external account fingerprint in a DIFFERENT workspace is
            # allowed. It must still be independently authorized and stored.
            connection_b = conn.execute(
                """INSERT INTO saas_broker_connections
                   (workspace_id,provider_code,auth_mode)
                   VALUES (%s,'TIGER','OAUTH2') RETURNING id""",
                (b["workspaceId"],)).fetchone()[0]
            conn.execute(
                """INSERT INTO saas_broker_accounts
                   (workspace_id,connection_id,external_account_fingerprint,alias)
                   VALUES (%s,%s,%s,'Synthetic B')""",
                (b["workspaceId"], connection_b, FP))
            try:
                with conn.transaction():
                    conn.execute(
                        """INSERT INTO saas_broker_accounts
                           (workspace_id,connection_id,external_account_fingerprint,alias)
                           VALUES (%s,%s,%s,'Forged other-workspace link')""",
                        (b["workspaceId"], connection_a, "b" * 64))
            except psycopg.errors.ForeignKeyViolation:
                pass
            else:
                raise AssertionError("Cross-tenant account->connection FK allowed")
            try:
                with conn.transaction():
                    conn.execute(
                        """INSERT INTO saas_broker_sync_runs
                           (workspace_id,account_id,start_utc,end_utc)
                           VALUES (%s,%s,'2026-10-20T00:00:00Z','2026-10-21T00:00:00Z')""",
                        (b["workspaceId"], account_a))
            except psycopg.errors.ForeignKeyViolation:
                pass
            else:
                raise AssertionError("Cross-tenant sync account FK allowed")
            try:
                with conn.transaction():
                    conn.execute(
                        """INSERT INTO saas_broker_connections
                           (workspace_id,provider_code,auth_mode)
                           VALUES (%s,'TIGER','OAUTH2')""",
                        (a["workspaceId"],))
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Cross-tenant connection creation allowed")
        with conn.transaction():
            conn.execute("SELECT set_config('saas.workspace_id', '', true)")
            # Tenant scoping must be transactional, never sticky between pooled
            # requests. A reset transaction sees no rows.
            for table in ("saas_broker_connections", "saas_broker_accounts",
                          "saas_broker_sync_runs"):
                assert conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0] == 0, table
        conn.execute("RESET ROLE")
    print("SAAS BROKER RLS PASS: tenant A/B reads, writes, composite FKs, no-context denial")


if __name__ == "__main__":
    main()
