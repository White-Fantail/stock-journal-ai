"""Disposable PostgreSQL P3 pagination A/B, atomic cursor replay and RLS.

No live Tiger SDK, customer data, broker token, or external network requests.
"""
import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
from uuid import UUID

import psycopg
from services.broker_connectors.contracts import BrokerFill
from services.broker_connectors.paged_contract import ReadPage
from services.saas_api.backfill_worker import WorkerRefused, enqueue, _claim
from services.saas_api.paged_backfill import run_page, run_bounded, _cursor_aad
from services.saas_api.tiger_oauth import unseal

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn
os.environ["SAAS_SOURCE_HMAC_KEY"]="d"*64
os.environ["TIGER_VAULT_KEY_B64"]=base64.b64encode(b"x"*32).decode()
start=datetime(2026,1,1,tzinfo=timezone.utc)

def fill(code):
    return BrokerFill(code,"fake-order", "TEST","BUY",Decimal("2"),Decimal("3"),
                      "USD",start, "VERIFIED_OFFSET",None,start.isoformat())

with psycopg.connect(dsn) as identity:
    users=[]
    for i in (1,2):
        subject=f"8877665544{i}"
        uid=identity.execute(
            "INSERT INTO saas_users(google_subject,email) VALUES (%s,%s) RETURNING id",
            (subject, f"paged-ci-{i}@example.invalid")).fetchone()[0]
        wid=identity.execute("INSERT INTO saas_workspaces(owner_user_id) VALUES (%s) RETURNING id",
                             (uid,)).fetchone()[0]
        identity.execute("""INSERT INTO saas_workspace_memberships
            (workspace_id,user_id,role,status) VALUES (%s,%s,'OWNER','ACTIVE')""",(wid,uid))
        connection=identity.execute("""INSERT INTO saas_broker_connections
            (workspace_id,provider_code,auth_mode,status)
            VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",(wid,)).fetchone()[0]
        handle=identity.execute("""INSERT INTO saas_tiger_grants
            (workspace_id,connection_id,ciphertext) VALUES (%s,%s,%s) RETURNING id""",
            (wid,connection,b"g"*40)).fetchone()[0]
        identity.execute("""UPDATE saas_broker_connections
            SET status='CONNECTED',credential_handle=%s,
            granted_scopes=ARRAY['portfolio.read'],
            authorization_expires_at=now() + interval '1 day'
            WHERE workspace_id=%s AND id=%s""",(handle,wid,connection))
        account=identity.execute("""INSERT INTO saas_broker_accounts
           (workspace_id,connection_id,external_account_fingerprint,alias)
           VALUES (%s,%s,%s,%s) RETURNING id""",
           (wid,connection,str(i)*64,f"Synthetic {i}")).fetchone()[0]
        identity.execute("""INSERT INTO saas_tiger_account_secrets
           (workspace_id,account_id,ciphertext) VALUES (%s,%s,%s)""",(wid,account,b"s"*40))
        users.append((subject,wid,connection,account))
    identity.commit()
    user_a,user_b=users
    with psycopg.connect(dsn,autocommit=True) as broker:
        broker.execute("SET ROLE saas_broker_app")
        job=enqueue(identity,broker,user_a[0],user_a[3],start,start+timedelta(days=1))
        jobid=UUID(job["jobId"])
        second=enqueue(identity,broker,user_b[0],user_b[3],start,start+timedelta(days=1))
        def reader(req, cursor):
            if cursor is None:
                return ReadPage(req,(fill("fake-fill-1"),),"synthetic-opaque-next",False)
            assert cursor=="synthetic-opaque-next"
            return ReadPage(req,(fill("fake-fill-1"),fill("fake-fill-2")),None,True)

        first=run_page(identity,broker,user_a[0],jobid,reader)
        assert first=={"state":"NEXT_PAGE_READY","written":1,"pages":1,"coverage":"PARTIAL"},first
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(user_a[1]),))
            row=broker.execute("""SELECT checkpoint_ciphertext,pages_staged,attempts,state,lease_token
                FROM saas_broker_backfill_windows WHERE job_id=%s""",(jobid,)).fetchone()
            assert row[1:]==(1,0,"PARTIAL",None),row
            cipher=bytes(row[0])
            assert b"synthetic-opaque-next" not in cipher
            windowid=broker.execute("SELECT id FROM saas_broker_backfill_windows WHERE job_id=%s",
                                   (jobid,)).fetchone()[0]
            state=unseal(cipher,_cursor_aad(user_a[1],user_a[3],windowid))
            assert state["next"]=="synthetic-opaque-next"
            assert len(state["seen"])==1
        done=run_bounded(identity,broker,user_a[0],jobid,reader,max_pages=3)
        assert done["state"]=="PARTIAL" and done["written"]==1 and done["pages"]==2,done
        assert run_page(identity,broker,user_a[0],jobid,reader)["state"]=="NO_ELIGIBLE_WINDOW"
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(user_a[1]),))
            row=broker.execute("""SELECT checkpoint_ciphertext,pages_staged,issue_codes
                FROM saas_broker_backfill_windows WHERE job_id=%s""",(jobid,)).fetchone()
            assert row[0] is None and row[1]==2
            assert "HISTORY_COVERAGE_UNVERIFIED" in row[2]
            stored=broker.execute("SELECT count(*) FROM saas_broker_source_stage").fetchone()[0]
            assert stored==2,stored
            assert broker.execute("SELECT count(*) FROM saas_broker_source_stage WHERE account_id=%s",
                                  (user_b[3],)).fetchone()[0]==0
        try:
            run_page(identity,broker,user_a[0],second["jobId"],reader)
        except WorkerRefused as exc:
            assert str(exc)=="JOB_NOT_FOUND",str(exc)
        else:
            raise AssertionError("Foreign workspace job accessed")
        # Re-read same provider IDs in another window: zero duplicate source rows.
        retry=enqueue(identity,broker,user_a[0],user_a[3],start+timedelta(days=5),
                      start+timedelta(days=6))
        again=run_bounded(identity,broker,user_a[0],retry["jobId"],reader,max_pages=3)
        assert again["written"]==0 and again["state"]=="PARTIAL",again

        # Cursor cycle is an error, not a COMPLETE window; first page remains.
        cyclic=enqueue(identity,broker,user_a[0],user_a[3],start+timedelta(days=10),
                       start+timedelta(days=11))
        def loop(req,cursor):
            return ReadPage(req,(), "same-cursor",False)
        assert run_page(identity,broker,user_a[0],cyclic["jobId"],loop)["state"]=="NEXT_PAGE_READY"
        bad=run_page(identity,broker,user_a[0],cyclic["jobId"],loop)
        assert bad["state"]=="FAILED",bad
        assert run_page(identity,broker,user_a[0],cyclic["jobId"],loop)["state"]=="NO_ELIGIBLE_WINDOW"

        # A timeout releases lease and preserves prior encrypted cursor.
        transient=enqueue(identity,broker,user_a[0],user_a[3],start+timedelta(days=15),
                          start+timedelta(days=16))
        def bad_network(req,cursor):
            raise TimeoutError("synthetic credential never revealed")
        t=run_page(identity,broker,user_a[0],transient["jobId"],bad_network)
        assert t["state"]=="PARTIAL",t
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(user_a[1]),))
            broker.execute("""UPDATE saas_broker_backfill_windows
                SET retry_after=now()-interval '1 second' WHERE job_id=%s""",
                (UUID(transient["jobId"]),))
        def terminal(req,cursor):
            return ReadPage(req,(),None,True)
        assert run_page(identity,broker,user_a[0],transient["jobId"],terminal)["state"]=="PARTIAL"

        # Revoking a grant prevents any queued page from being read.
        identity.execute("""UPDATE saas_broker_connections SET status='DISCONNECTED'
           WHERE workspace_id=%s AND id=%s""",(user_b[1],user_b[2]))
        identity.commit()
        try:
            run_page(identity,broker,user_b[0],second["jobId"],reader)
        except WorkerRefused as exc:
            assert str(exc)=="ACCOUNT_NOT_AUTHORIZED"
        else:
            raise AssertionError("Revoked tenant allowed to query pages")
print("P3 paginated worker encrypted resume + duplicate replay + RLS PASS")
