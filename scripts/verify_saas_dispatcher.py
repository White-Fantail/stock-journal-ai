"""Disposable PostgreSQL dispatch metadata isolation checks."""
import os
from datetime import datetime, timedelta, timezone
import psycopg
from services.saas_api.sync_dispatcher import DispatchRefused,claim,release,tick,verify_role

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn

with psycopg.connect(dsn) as admin:
    owner=admin.execute("""INSERT INTO saas_users(google_subject,email)
        VALUES ('88776611001','dispatch-ci@example.invalid') RETURNING id""").fetchone()[0]
    workspace=admin.execute("""INSERT INTO saas_workspaces(owner_user_id)
        VALUES (%s) RETURNING id""",(owner,)).fetchone()[0]
    admin.execute("""INSERT INTO saas_workspace_memberships
        (workspace_id,user_id,role,status) VALUES (%s,%s,'OWNER','ACTIVE')""",(workspace,owner))
    link=admin.execute("""INSERT INTO saas_broker_connections
        (workspace_id,provider_code,auth_mode,status)
        VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",(workspace,)).fetchone()[0]
    account=admin.execute("""INSERT INTO saas_broker_accounts
        (workspace_id,connection_id,external_account_fingerprint,alias)
        VALUES (%s,%s,%s,'Synthetic') RETURNING id""",
        (workspace,link,"a"*64)).fetchone()[0]
    job=admin.execute("""INSERT INTO saas_broker_backfill_jobs
        (workspace_id,account_id,idempotency_key,start_utc,end_utc)
        VALUES (%s,%s,%s,%s,%s) RETURNING id""",
        (workspace,account,"c"*64,datetime(2026,1,1,tzinfo=timezone.utc),
         datetime(2026,1,2,tzinfo=timezone.utc))).fetchone()[0]
    admin.execute("""INSERT INTO saas_broker_dispatch_queue(workspace_id,job_id)
        VALUES (%s,%s)""",(workspace,job))
    admin.commit()

    with psycopg.connect(dsn,autocommit=True) as dispatch, psycopg.connect(dsn,autocommit=True) as broker:
        dispatch.execute("SET ROLE saas_dispatch_app")
        broker.execute("SET ROLE saas_broker_app")
        verify_role(dispatch)
        with dispatch.transaction():
            assert dispatch.execute("SELECT count(*) FROM saas_broker_dispatch_queue").fetchone()[0]==1
            flags=dispatch.execute("""SELECT
                has_table_privilege(current_user,'saas_tiger_grants','SELECT'),
                has_table_privilege(current_user,'saas_broker_source_stage','SELECT'),
                has_table_privilege(current_user,'saas_trade_events','INSERT'),
                has_table_privilege(current_user,'saas_broker_dispatch_queue','DELETE')""").fetchone()
            assert flags==(False,False,False,False),flags
        with broker.transaction():
            assert broker.execute("SELECT count(*) FROM saas_broker_dispatch_queue").fetchone()[0]==0
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(workspace),))
            assert broker.execute("SELECT count(*) FROM saas_broker_dispatch_queue").fetchone()[0]==1
        try:
            tick(admin,broker,dispatch,None,enabled=True)
        except DispatchRefused as ex:
            assert str(ex)=="DISPATCH_DISABLED"
        else:
            raise AssertionError("Missing read adapter was accepted")
        task=claim(dispatch)
        assert task is not None and task[:2]==(workspace,job)
        assert claim(dispatch) is None
        assert release(dispatch,task,datetime.now(timezone.utc)+timedelta(seconds=10))
        assert claim(dispatch) is None
print("P3 dispatch queue metadata-only access, claim fencing and default gate PASS")
