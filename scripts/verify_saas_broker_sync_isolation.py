"""Disposable PG 18 adversarial A/B RLS test for P3 durable staging."""
import os
import psycopg

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn

with psycopg.connect(dsn) as admin:
    entities=[]
    for i in (1,2):
        uid=admin.execute("INSERT INTO saas_users(google_subject,email) VALUES (%s,%s) RETURNING id",
            (f"p3-backfill-ci-{i}",f"backfill-{i}@example.invalid")).fetchone()[0]
        wid=admin.execute("INSERT INTO saas_workspaces(owner_user_id) VALUES (%s) RETURNING id",
            (uid,)).fetchone()[0]
        conn=admin.execute("""INSERT INTO saas_broker_connections
            (workspace_id,provider_code,auth_mode,status)
            VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",(wid,)).fetchone()[0]
        acc=admin.execute("""INSERT INTO saas_broker_accounts
            (workspace_id,connection_id,external_account_fingerprint,alias)
            VALUES (%s,%s,%s,%s) RETURNING id""",(wid,conn,str(i)*64,f"Synthetic {i}")).fetchone()[0]
        job=admin.execute("""INSERT INTO saas_broker_backfill_jobs
            (workspace_id,account_id,idempotency_key,start_utc,end_utc)
            VALUES (%s,%s,%s,'2026-01-01 UTC','2026-03-01 UTC') RETURNING id""",
            (wid,acc,str(i)*64)).fetchone()[0]
        win=admin.execute("""INSERT INTO saas_broker_backfill_windows
            (workspace_id,job_id,account_id,ordinal,start_utc,end_utc)
            VALUES (%s,%s,%s,0,'2026-01-01 UTC','2026-01-30 UTC') RETURNING id""",
            (wid,job,acc)).fetchone()[0]
        admin.execute("""INSERT INTO saas_broker_source_stage
            (workspace_id,window_id,account_id,kind,source_key_hmac,evidence_sha256,encrypted_payload)
            VALUES (%s,%s,%s,'FILL',%s,%s,%s)""",
            (wid,win,acc,str(i)*64,str(i)*64,bytes([i])*40))
        entities.append((wid,acc,job,win))
    admin.commit()

own,other=entities
with psycopg.connect(dsn,autocommit=True) as client:
    client.execute("SET ROLE saas_broker_app")
    for scope,expected in ((None,0),(own[0],1),(other[0],1)):
        with client.transaction():
            if scope:
                client.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(scope),))
            for table in ("saas_broker_backfill_jobs","saas_broker_backfill_windows","saas_broker_source_stage"):
                assert client.execute("SELECT count(*) FROM "+table).fetchone()[0]==expected, table
    with client.transaction():
        client.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(own[0]),))
        assert client.execute("UPDATE saas_broker_backfill_jobs SET state='RUNNING' WHERE id=%s RETURNING id",
                              (other[2],)).fetchone() is None
        assert client.execute("SELECT has_table_privilege(current_user,'saas_broker_source_stage','UPDATE')").fetchone()[0] is False
        assert client.execute("SELECT has_table_privilege(current_user,'saas_broker_source_stage','DELETE')").fetchone()[0] is False
        assert client.execute("SELECT has_table_privilege(current_user,'saas_trade_events','INSERT')").fetchone()[0] is False
    for statement,params in (
        ("""INSERT INTO saas_broker_backfill_windows
           (workspace_id,job_id,account_id,ordinal,start_utc,end_utc)
           VALUES (%s,%s,%s,1,'2026-01-30 UTC','2026-02-15 UTC')""",
         (other[0],other[2],other[1])),
        ("""INSERT INTO saas_broker_source_stage
           (workspace_id,window_id,account_id,kind,source_key_hmac,evidence_sha256,encrypted_payload)
           VALUES (%s,%s,%s,'FILL',%s,%s,%s)""",
         (other[0],other[3],other[1],"c"*64,"d"*64,b"e"*40)),
    ):
        with client.transaction():
            client.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(own[0]),))
            try:
                client.execute(statement,params)
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Cross-tenant write was not blocked")
print("P3 durable staging A/B RLS PASS (synthetic data only)")
