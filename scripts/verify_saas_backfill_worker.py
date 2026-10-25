"""Disposable PostgreSQL 18 P3 worker: A/B, lease fence, retries and replay.

NEVER run on production. Only synthetic facts/IDs and test vault keys.
"""
import base64
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import os
import psycopg
from uuid import UUID

from services.broker_connectors.contracts import BrokerFill, BrokerSyncBatch
from services.saas_api.backfill_worker import (
    WorkerRefused, _claim, _finish, enqueue, run_one,
)
from services.saas_api.tiger_oauth import unseal

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn
os.environ["SAAS_SOURCE_HMAC_KEY"]="a"*64
os.environ["TIGER_VAULT_KEY_B64"]=base64.b64encode(b"k"*32).decode()
start=datetime(2026,1,1,tzinfo=timezone.utc)


def mock_batch(request):
    f=BrokerFill("fake-fill-1","fake-order-1","TEST","BUY",Decimal("1.25"),
                 Decimal("123.45"),"USD",start+timedelta(hours=1),
                 "VERIFIED_OFFSET",Decimal("1.50"),"2026-01-01T01:00:00+00:00")
    return BrokerSyncBatch(request,"TIGER","COMPLETE",(f,),(),1,())


with psycopg.connect(dsn) as identity:
    entities=[]
    for i in (1,2):
        subject=f"8899554411{i}"
        u=identity.execute("INSERT INTO saas_users(google_subject,email) VALUES (%s,%s) RETURNING id",
                           (subject,f"p3-worker-{i}@example.invalid")).fetchone()[0]
        wid=identity.execute("INSERT INTO saas_workspaces(owner_user_id) VALUES (%s) RETURNING id",
                             (u,)).fetchone()[0]
        identity.execute("""INSERT INTO saas_workspace_memberships(workspace_id,user_id,role,status)
                         VALUES (%s,%s,'OWNER','ACTIVE')""",(wid,u))
        conn=identity.execute("""INSERT INTO saas_broker_connections
            (workspace_id,provider_code,auth_mode,status)
            VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",(wid,)).fetchone()[0]
        grant=identity.execute("""INSERT INTO saas_tiger_grants
            (workspace_id,connection_id,ciphertext) VALUES (%s,%s,%s) RETURNING id""",
            (wid,conn,b"g"*40)).fetchone()[0]
        identity.execute("""UPDATE saas_broker_connections
            SET status='CONNECTED',credential_handle=%s,
                granted_scopes=ARRAY['portfolio.read'],
                authorization_expires_at=now()+interval '1 day'
            WHERE workspace_id=%s AND id=%s""",(grant,wid,conn))
        acc=identity.execute("""INSERT INTO saas_broker_accounts
            (workspace_id,connection_id,external_account_fingerprint,alias)
            VALUES (%s,%s,%s,%s) RETURNING id""",(wid,conn,str(i)*64,f"Synthetic {i}")).fetchone()[0]
        identity.execute("""INSERT INTO saas_tiger_account_secrets
            (workspace_id,account_id,ciphertext) VALUES (%s,%s,%s)""",
            (wid,acc,b"s"*40))
        entities.append((subject,wid,conn,acc))
    identity.commit()

    a,b=entities
    with psycopg.connect(dsn,autocommit=True) as broker:
        broker.execute("SET ROLE saas_broker_app")
        def schedule(actor,account,first=start,days=30):
            return enqueue(identity,broker,actor,account,first,
                           first+timedelta(days=60),days=days)

        own=schedule(a[0],a[3])
        replay=schedule(a[0],a[3])
        assert own["jobId"]==replay["jobId"] and own["windows"]==2
        job=UUID(own["jobId"])
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(a[1]),))
            assert broker.execute("""SELECT count(*) FROM saas_broker_backfill_windows
                WHERE job_id=%s""",(job,)).fetchone()[0]==2
        try:
            schedule(a[0],b[3])
        except WorkerRefused as exc:
            assert str(exc)=="ACCOUNT_NOT_AUTHORIZED"
        else:
            raise AssertionError("Cross-tenant account enqueue allowed")

        private=schedule(b[0],b[3])
        try:
            run_one(identity,broker,a[0],private["jobId"],mock_batch)
        except WorkerRefused as exc:
            assert str(exc)=="JOB_NOT_FOUND"
        else:
            raise AssertionError("Cross-tenant job processed")

        first=run_one(identity,broker,a[0],job,mock_batch)
        assert first["state"]=="PARTIAL" and first["written"]==1,first
        assert "HISTORY_COVERAGE_UNVERIFIED" in first["issues"]
        # No retry of terminal partial without a new explicit sync plan.
        second=run_one(identity,broker,a[0],job,mock_batch)
        assert second["state"]=="PARTIAL" and second["written"]==0,second
        empty=run_one(identity,broker,a[0],job,mock_batch)
        assert empty["state"]=="NO_ELIGIBLE_WINDOW",empty
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(a[1]),))
            result=broker.execute("""SELECT source_key_hmac,evidence_sha256,encrypted_payload
               FROM saas_broker_source_stage WHERE account_id=%s ORDER BY observed_at""",
               (a[3],)).fetchall()
            assert len(result)==1
            h,d,cipher=result[0]
            assert len(h)==len(d)==64
            decoded=unseal(cipher,str(a[1])+":"+str(a[3])+":FILL:"+h+":"+d)
            assert decoded["providerFillId"]=="fake-fill-1"
            assert decoded["fee"]=="1.50"
            assert bytes(cipher).find(b"fake-fill-1")==-1
            assert broker.execute("""SELECT state FROM saas_broker_backfill_jobs
                WHERE id=%s""",(job,)).fetchone()[0]=="PARTIAL"

        # Two attempts for the same expired window get different fencing tokens.
        lease_job=schedule(a[0],a[3],start+timedelta(days=100))
        old=_claim(identity,broker,a[0],lease_job["jobId"])
        assert old and old[4]
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(a[1]),))
            broker.execute("""UPDATE saas_broker_backfill_windows
               SET lease_until=now()-interval '1 second'
               WHERE id=%s""",(old[3],))
        current=_claim(identity,broker,a[0],lease_job["jobId"])
        assert current[3]==old[3] and current[4]!=old[4] and current[-1]==2
        stale=_finish(identity,broker,a[0],UUID(lease_job["jobId"]),
                     old,[("synthetic-stale",{"stale":True})],(),None)
        assert stale=={"state":"LEASE_LOST","written":0},stale
        valid=_finish(identity,broker,a[0],UUID(lease_job["jobId"]),
                     current,[],("HISTORY_COVERAGE_UNVERIFIED",),None)
        assert valid["state"]=="PARTIAL",valid

        # A retryable timeout never discloses the provider exception body.
        transient_job=schedule(a[0],a[3],start+timedelta(days=210),days=60)
        attempts=[]
        def timeout(_):
            raise TimeoutError("SENSITIVE_TEST_TOKEN_SHOULD_NOT_ESCAPE")
        for _ in range(5):
            result=run_one(identity,broker,a[0],transient_job["jobId"],timeout)
            attempts.append(result["state"])
            if result["state"]=="FAILED":
                break
            with broker.transaction():
                broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(a[1]),))
                broker.execute("""UPDATE saas_broker_backfill_windows
                   SET retry_after=now()-interval '1 second'
                   WHERE job_id=%s""",(UUID(transient_job["jobId"]),))
        assert attempts==["PARTIAL","PARTIAL","PARTIAL","PARTIAL","FAILED"],attempts
        assert run_one(identity,broker,a[0],transient_job["jobId"],timeout)["state"]=="NO_ELIGIBLE_WINDOW"

        # Read-only scope is rechecked, even for an already-connected grant.
        identity.execute("""UPDATE saas_broker_connections
               SET granted_scopes=ARRAY['trade.execute']
               WHERE workspace_id=%s AND id=%s""",(b[1],b[2]))
        identity.commit()
        try:
            run_one(identity,broker,b[0],private["jobId"],mock_batch)
        except WorkerRefused as exc:
            assert str(exc)=="ACCOUNT_NOT_AUTHORIZED"
        else:
            raise AssertionError("Trade-capable scope was accepted")
        # Revoked grant blocks queued work without touching other tenants.
        identity.execute("""UPDATE saas_broker_connections SET status='DISCONNECTED'
               WHERE workspace_id=%s AND id=%s""",(b[1],b[2]))
        identity.commit()
        try:
            run_one(identity,broker,b[0],private["jobId"],mock_batch)
        except WorkerRefused as exc:
            assert str(exc)=="ACCOUNT_NOT_AUTHORIZED"
        else:
            raise AssertionError("Revoked grant remained usable")
print("P3 offline worker A/B, encrypted replay, lease fencing, bounded retries PASS")
