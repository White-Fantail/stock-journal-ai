"""Disposable PG 18 P4 A/B immutable reconciliation versions and signed staging."""
import hashlib
import hmac
import os
from datetime import datetime,timedelta,timezone
from decimal import Decimal
from uuid import uuid4

import psycopg
from services.broker_connectors.contracts import BrokerPosition
from services.broker_connectors.fifo_projection import VerifiedExecution
from services.broker_connectors.reconciliation import AccountEvidence,CertifiedWindow,PositionEvidence
from services.saas_api.reconciliation_store import (
    AuditRefused, _input_digest, _bound_digest, record_reconciliation,review_status,
)
from services.broker_connectors.backfill import source_key
from services.saas_api.tiger_oauth import TigerError

dsn=os.environ.get("SAAS_DATABASE_URL","")
assert os.environ.get("SAAS_TEST_DB_ACK")=="YES_DISPOSABLE_SAAS_DB"
assert "journal_saas_test" in dsn
os.environ["SAAS_SOURCE_HMAC_KEY"]="c"*64
os.environ["SAAS_P4_ATTESTATION_KEY"]="e"*64
os.environ["SAAS_P4_RECORDING_ENABLED"]="1"
begin=datetime(2026,10,1,tzinfo=timezone.utc)
end=begin+timedelta(days=1)

def evidence(wid,account,*,fee="1"):
    f=VerifiedExecution("PRIVATE_PROVIDER_FILL","TEST","BUY",Decimal("2"),
                        Decimal("10"),"USD",begin,
                        Decimal(fee) if fee is not None else None,
                        "USD" if fee is not None else None)
    return AccountEvidence(wid,account,begin,end,
        (CertifiedWindow(begin,end,True),),(f,),
        PositionEvidence(end,(BrokerPosition("TEST",Decimal("2"),"USD"),),True),
        True,True,True)

def signature(account,links):
    secret=bytes.fromhex(os.environ["SAAS_SOURCE_HMAC_KEY"])
    digest=_bound_digest(_input_digest(account,secret),links,secret)
    return hmac.new(bytes.fromhex(os.environ["SAAS_P4_ATTESTATION_KEY"]),
                    ("positionary:p4:v1:"+digest).encode(),hashlib.sha256).hexdigest()

with psycopg.connect(dsn) as identity:
    users=[]
    for n in (1,2):
        subject=f"8888764200{n}"
        user=identity.execute("""INSERT INTO saas_users(google_subject,email)
          VALUES (%s,%s) RETURNING id""",(subject,f"p4-ci-{n}@example.invalid")).fetchone()[0]
        wid=identity.execute("INSERT INTO saas_workspaces(owner_user_id) VALUES (%s) RETURNING id",
                             (user,)).fetchone()[0]
        identity.execute("""INSERT INTO saas_workspace_memberships(workspace_id,user_id,role,status)
          VALUES (%s,%s,'OWNER','ACTIVE')""",(wid,user))
        conn=identity.execute("""INSERT INTO saas_broker_connections
          (workspace_id,provider_code,auth_mode,status)
          VALUES (%s,'TIGER','OAUTH2','PENDING_AUTH') RETURNING id""",(wid,)).fetchone()[0]
        grant=identity.execute("""INSERT INTO saas_tiger_grants
          (workspace_id,connection_id,ciphertext) VALUES (%s,%s,%s) RETURNING id""",
          (wid,conn,b"g"*40)).fetchone()[0]
        identity.execute("""UPDATE saas_broker_connections SET status='CONNECTED',
          credential_handle=%s,granted_scopes=ARRAY['portfolio.read'],
          authorization_expires_at=now()+interval '2 days'
          WHERE workspace_id=%s AND id=%s""",(grant,wid,conn))
        account=identity.execute("""INSERT INTO saas_broker_accounts
          (workspace_id,connection_id,external_account_fingerprint,alias)
          VALUES (%s,%s,%s,%s) RETURNING id""",
          (wid,conn,str(n)*64,f"Test {n}")).fetchone()[0]
        identity.execute("""INSERT INTO saas_tiger_account_secrets
          (workspace_id,account_id,ciphertext) VALUES (%s,%s,%s)""",(wid,account,b"s"*40))
        users.append((subject,user,wid,account,conn))
    identity.commit()
    a,b=users
    with psycopg.connect(dsn,autocommit=True) as broker:
        broker.execute("SET ROLE saas_broker_app")
        pending=evidence(a[2],a[3],fee=None)
        bad=record_reconciliation(identity,broker,a[0],pending)
        assert bad["state"]=="BLOCKED" and "FEE_UNKNOWN" in bad["issues"],bad
        assert bad["version"]==1 and bad["published"] is False
        retry=record_reconciliation(identity,broker,a[0],pending)
        assert retry["replayed"] and retry["version"]==1,retry
        good=evidence(a[2],a[3])
        blocked=record_reconciliation(identity,broker,a[0],good)
        assert blocked["version"]==2 and blocked["state"]=="BLOCKED"
        assert blocked["issues"]==["INDEPENDENT_ATTESTATION_REQUIRED","SOURCE_EVIDENCE_MISSING"],blocked

        # The proof must refer to exactly one persisted, tenant-scoped
        # encrypted original-fill record; a guessed/absent row cannot stage.
        staged_key=source_key(bytes.fromhex(os.environ["SAAS_SOURCE_HMAC_KEY"]),
                              "TIGER",a[3],"FILL","PRIVATE_PROVIDER_FILL")
        job=identity.execute("""INSERT INTO saas_broker_backfill_jobs
            (workspace_id,account_id,idempotency_key,start_utc,end_utc)
            VALUES (%s,%s,%s,%s,%s) RETURNING id""",
            (a[2],a[3],"7"*64,begin,end)).fetchone()[0]
        window=identity.execute("""INSERT INTO saas_broker_backfill_windows
            (workspace_id,job_id,account_id,ordinal,start_utc,end_utc)
            VALUES (%s,%s,%s,0,%s,%s) RETURNING id""",
            (a[2],job,a[3],begin,end)).fetchone()[0]
        stage=identity.execute("""INSERT INTO saas_broker_source_stage
            (workspace_id,window_id,account_id,kind,source_key_hmac,evidence_sha256,
             encrypted_payload)
            VALUES (%s,%s,%s,'FILL',%s,%s,%s) RETURNING id""",
            (a[2],window,a[3],staged_key,"f"*64,b"x"*40)).fetchone()[0]
        identity.commit()
        links=((stage,staged_key,"f"*64),)

        # Explicitly signed evidence still cannot stage until official
        # provider approval and inquiry-only scope certification exist.
        sig=signature(good,links)
        without_approval=record_reconciliation(identity,broker,a[0],good,attestation=sig)
        assert without_approval["version"]==3 and without_approval["state"]=="BLOCKED"
        os.environ["TIGER_PARTNER_OAUTH_APPROVED"]="1"
        os.environ["TIGER_READ_ONLY_GRANT_VERIFIED"]="1"
        assert record_reconciliation(identity,broker,a[0],good,attestation="0"*64)["state"]=="BLOCKED"
        success=record_reconciliation(identity,broker,a[0],good,attestation=sig)
        assert success=={"state":"STAGED","version":4,"replayed":False,
                         "issues":[],"published":False},success
        repeated=record_reconciliation(identity,broker,a[0],good,attestation=sig)
        assert repeated["replayed"] and repeated["version"]==4

        # Tenant RLS, immutable stage and issue history must be real in PG.
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(a[2]),))
            versions=broker.execute("""SELECT state,version_num FROM saas_reconciliation_versions
              WHERE workspace_id=%s ORDER BY version_num""",(a[2],)).fetchall()
            assert versions==[("BLOCKED",1),("BLOCKED",2),("BLOCKED",3),("STAGED",4)],versions
            assert broker.execute("SELECT count(*) FROM saas_verified_execution_stage").fetchone()[0]==1
            assert broker.execute("SELECT count(*) FROM saas_projection_position_stage").fetchone()[0]==1
            assert broker.execute("""SELECT count(*) FROM saas_reconciliation_issues""").fetchone()[0]>=5
            assert broker.execute("SELECT count(*) FROM saas_reconciliation_source_links").fetchone()[0]==2
            metadata=broker.execute("""SELECT code,category,severity,evidence_scope
                FROM saas_reconciliation_issues
                WHERE code='FEE_UNKNOWN' ORDER BY version_id LIMIT 1""").fetchone()
            assert metadata==("FEE_UNKNOWN","FEES","BLOCKER","EXECUTION"),metadata
            row=broker.execute("SELECT source_key_hmac FROM saas_verified_execution_stage").fetchone()[0]
            assert len(row)==64 and "PRIVATE_PROVIDER_FILL" not in row
        with broker.transaction():
            broker.execute("SELECT set_config('saas.workspace_id',%s,true)",(str(b[2]),))
            assert broker.execute("SELECT count(*) FROM saas_reconciliation_versions").fetchone()[0]==0
            assert broker.execute("SELECT count(*) FROM saas_verified_execution_stage").fetchone()[0]==0
            assert broker.execute("SELECT count(*) FROM saas_projection_position_stage").fetchone()[0]==0
            assert broker.execute("SELECT count(*) FROM saas_reconciliation_source_links").fetchone()[0]==0

        # The runtime principal cannot rewrite or remove past decisions.
        with broker.transaction():
            try:
                broker.execute("UPDATE saas_reconciliation_versions SET state='STAGED'")
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Reconciliation UPDATE was allowed")
        with broker.transaction():
            try:
                broker.execute("DELETE FROM saas_reconciliation_issues")
            except psycopg.errors.InsufficientPrivilege:
                pass
            else:
                raise AssertionError("Issue DELETE was allowed")
        report=review_status(identity,broker,a[0])
        assert len(report["accounts"])==1 and report["accounts"][0]["version"]==4
        assert report["accounts"][0]["issues"]==[] and report["published"] is False
        assert report["accounts"][0]["sourceEvidenceCount"]==1
        assert "PRIVATE_PROVIDER_FILL" not in str(report)
        assert review_status(identity,broker,b[0])["accounts"]==[]

        try:
            record_reconciliation(identity,broker,a[0],evidence(b[2],b[3]),
                                  attestation=signature(evidence(b[2],b[3]),()))
        except AuditRefused as exc:
            assert str(exc)=="ACCOUNT_NOT_AUTHORIZED"
        else:
            raise AssertionError("Cross-tenant account write")
        identity.execute("""UPDATE saas_workspace_memberships SET status='REVOKED'
          WHERE workspace_id=%s AND user_id=%s""",(a[2],a[1]))
        identity.commit()
        try:
            review_status(identity,broker,a[0])
        except TigerError as exc:
            assert exc.code=="NOT_FOUND"
        else:
            raise AssertionError("Revoked owner read review status")
        assert review_status(identity,broker,b[0])["accounts"]==[]
print("P4 append-only A/B audit, signed staging, versioned issue resolution PASS")
