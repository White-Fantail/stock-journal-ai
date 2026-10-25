"""P3 tenant A/B read-only sync status against disposable PostgreSQL 18."""
import os
from datetime import datetime,timezone,timedelta
import psycopg

from services.saas_api.sync_status import sync_status
from services.saas_api.tiger_oauth import TigerError

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn
start=datetime(2026,1,1,tzinfo=timezone.utc)
users=[]
with psycopg.connect(dsn) as identity:
    for n in (1,2):
        subject=f"8822774411{n}"
        uid=identity.execute("""INSERT INTO saas_users(google_subject,email)
          VALUES (%s,%s) RETURNING id""",
          (subject,f"sync-health-{n}@example.invalid")).fetchone()[0]
        wid=identity.execute("""INSERT INTO saas_workspaces(owner_user_id)
          VALUES (%s) RETURNING id""",(uid,)).fetchone()[0]
        identity.execute("""INSERT INTO saas_workspace_memberships
          (workspace_id,user_id,role,status) VALUES (%s,%s,'OWNER','ACTIVE')""",
          (wid,uid))
        connection=identity.execute("""INSERT INTO saas_broker_connections
          (workspace_id,provider_code,auth_mode,status)
          VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",
          (wid,)).fetchone()[0]
        account=identity.execute("""INSERT INTO saas_broker_accounts
          (workspace_id,connection_id,external_account_fingerprint,alias)
          VALUES (%s,%s,%s,%s) RETURNING id""",
          (wid,connection,str(n)*64,f"Synthetic Tiger {n}")).fetchone()[0]
        job=identity.execute("""INSERT INTO saas_broker_backfill_jobs
          (workspace_id,account_id,idempotency_key,start_utc,end_utc,state)
          VALUES (%s,%s,%s,%s,%s,'PARTIAL') RETURNING id""",
          (wid,account,str(n+2)*64,start,start+timedelta(days=10))).fetchone()[0]
        identity.execute("""INSERT INTO saas_broker_backfill_windows
          (workspace_id,job_id,account_id,ordinal,start_utc,end_utc,state,pages_staged,
           finished_at,issue_codes)
          VALUES (%s,%s,%s,0,%s,%s,'PARTIAL',2,now(),
          ARRAY['HISTORY_COVERAGE_UNVERIFIED','PRIVATE: SHOULD NOT RETURN'])""",
          (wid,job,account,start,start+timedelta(days=5)))
        identity.execute("""INSERT INTO saas_broker_backfill_windows
          (workspace_id,job_id,account_id,ordinal,start_utc,end_utc,state)
          VALUES (%s,%s,%s,1,%s,%s,'PENDING')""",
          (wid,job,account,start+timedelta(days=5),start+timedelta(days=10)))
        users.append((subject,uid,wid,job,account))
    identity.commit()
    with psycopg.connect(dsn,autocommit=True) as broker:
        broker.execute("SET ROLE saas_broker_app")
        a,b=users
        first=sync_status(identity,broker,a[0])
        second=sync_status(identity,broker,b[0])
        assert first["provider"]=="TIGER" and first["syncEnabled"] is False
        assert first["coverage"]=="UNVERIFIED"
        assert len(first["jobs"])==1 and len(second["jobs"])==1
        row=first["jobs"][0]
        assert row["id"]==str(a[3]) and row["accountId"]==str(a[4])
        assert row["processedWindows"]==1 and row["totalWindows"]==2
        assert row["pagesStaged"]==2
        assert row["certifiedWindows"]==0 and row["historyVerified"] is False
        assert row["issueCodes"]==["HISTORY_COVERAGE_UNVERIFIED"]
        assert second["jobs"][0]["id"]==str(b[3])
        assert "PRIVATE" not in str(first)
        assert str(b[3]) not in str(first)
        with broker.transaction():
            assert broker.execute("SELECT count(*) FROM saas_broker_backfill_jobs").fetchone()[0]==0
        identity.execute("""UPDATE saas_workspace_memberships SET status='REVOKED'
            WHERE workspace_id=%s AND user_id=%s""",(a[2],a[1]))
        identity.commit()
        try:
            sync_status(identity,broker,a[0])
        except TigerError as error:
            assert error.code=="NOT_FOUND"
        else:
            raise AssertionError("Revoked owner read private sync jobs")
        assert sync_status(identity,broker,b[0])["jobs"][0]["id"]==str(b[3])
print("P3 account A/B sync health isolation and revoked-owner refusal PASS")
