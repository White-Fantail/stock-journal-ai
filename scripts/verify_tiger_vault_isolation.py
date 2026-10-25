"""Negative A/B RLS tests for P3 credential vault on DISPOSABLE CI PostgreSQL.

Only synthetic ciphertext/account aliases. NEVER run on a production DB.
"""
import os
import psycopg

dsn = os.environ.get("SAAS_DATABASE_URL", "")
assert os.environ.get("SAAS_TEST_DB_ACK") == "YES_DISPOSABLE_SAAS_DB", "Disposable database acknowledgement required"
assert "journal_saas_test" in dsn, "Refusing non-CI tenant vault database"

with psycopg.connect(dsn) as admin:
    workspaces = []
    for index in (1, 2):
        uid = admin.execute(
            "INSERT INTO saas_users(google_subject,email) VALUES (%s,%s) RETURNING id",
            (f"888888880{index}",f"tiger-ci-{index}@example.invalid")
        ).fetchone()[0]
        wid = admin.execute("INSERT INTO saas_workspaces(owner_user_id) VALUES (%s) RETURNING id", (uid,)).fetchone()[0]
        connection = admin.execute(
            """INSERT INTO saas_broker_connections(workspace_id,provider_code,auth_mode,status)
               VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",
            (wid,)
        ).fetchone()[0]
        account = admin.execute(
            """INSERT INTO saas_broker_accounts(workspace_id,connection_id,external_account_fingerprint,alias)
               VALUES (%s,%s,%s,%s) RETURNING id""",
            (wid,connection,str(index)*64,f"Synthetic ••••000{index}")
        ).fetchone()[0]
        admin.execute(
            """INSERT INTO saas_tiger_grants(workspace_id,connection_id,ciphertext)
               VALUES (%s,%s,%s)""",
            (wid,connection,bytes([index])*40)
        )
        admin.execute(
            """INSERT INTO saas_tiger_oauth_attempts(workspace_id,state_sha256,connection_id,expires_at)
               VALUES (%s,%s,%s,now() + interval '10 minutes')""",
            (wid,str(index)*64,connection)
        )
        admin.execute(
            """INSERT INTO saas_tiger_account_secrets(workspace_id,account_id,ciphertext)
               VALUES (%s,%s,%s)""",
            (wid,account,bytes([index])*40)
        )
        admin.execute(
            """INSERT INTO saas_tiger_source_snapshots
               (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
               VALUES (%s,%s,'ASSETS',%s,%s,'SNAPSHOT_ONLY')""",
            (wid,account,str(index)*64,bytes([index])*40)
        )
        workspaces.append((wid, connection, account))
    admin.commit()

with psycopg.connect(dsn, autocommit=True) as client:
    client.execute("SET ROLE saas_broker_app")
    assert client.execute("SELECT current_user").fetchone()[0] == "saas_broker_app"
    own, other = workspaces
    with client.transaction():
        client.execute("SELECT set_config('saas.workspace_id',%s,true)", (str(own[0]),))
        for table in ("saas_tiger_grants","saas_tiger_oauth_attempts",
                      "saas_tiger_account_secrets","saas_tiger_source_snapshots"):
            assert client.execute("SELECT count(*) FROM " + table).fetchone()[0] == 1, table
            assert client.execute("SELECT count(*) FROM " + table + " WHERE workspace_id=%s", (other[0],)).fetchone()[0] == 0, table
        assert client.execute("UPDATE saas_tiger_grants SET ciphertext=%s WHERE workspace_id=%s RETURNING id", (b"z"*40, other[0])).fetchone() is None
        assert client.execute("DELETE FROM saas_tiger_grants WHERE workspace_id=%s RETURNING id", (other[0],)).fetchone() is None
        assert client.execute("SELECT has_table_privilege(current_user,'saas_trade_events','INSERT')").fetchone()[0] is False
        assert client.execute("SELECT has_table_privilege(current_user,'saas_tiger_source_snapshots','DELETE')").fetchone()[0] is False
    for statement, params in [
        ("INSERT INTO saas_tiger_grants(workspace_id,connection_id,ciphertext) VALUES (%s,%s,%s)",(other[0],other[1],b"z"*40)),
        ("INSERT INTO saas_tiger_source_snapshots(workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness) VALUES (%s,%s,'ASSETS',%s,%s,'PARTIAL')",(other[0],other[2],"c"*64,b"z"*40))
    ]:
        with client.transaction():
            client.execute("SELECT set_config('saas.workspace_id',%s,true)", (str(own[0]),))
            try:
                client.execute(statement,params)
                raise AssertionError("Cross-tenant write unexpectedly succeeded")
            except psycopg.errors.InsufficientPrivilege:
                pass
            except psycopg.errors.UniqueViolation:
                raise AssertionError("Uniqueness check happened before tenant RLS denial")
    with client.transaction():
        # This must NOT retain an earlier pool transaction's tenant scope.
        assert client.execute("SELECT count(*) FROM saas_tiger_grants").fetchone()[0] == 0
print("P3 Tiger vault RLS A/B tests PASS (synthetic disposable PostgreSQL only)")
