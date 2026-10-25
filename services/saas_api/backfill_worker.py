"""Tenant-scoped, offline-injected P3 window worker; NOT live Tiger integration.

The caller must provide a freshly authenticated subject and an approved,
read-only adapter callback. No server route or automatic scheduler invokes this
module yet. It never places orders, stores plaintext source IDs, or publishes
staged observations to user-facing holdings/journal.
"""
from __future__ import annotations

from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json
import os
import re
from uuid import UUID

from services.broker_connectors.backfill import plan_backfill, source_key
from services.broker_connectors.contracts import BrokerSyncBatch, BrokerSyncRequest, SyncWindow
from services.saas_api.tiger_oauth import _scope, seal

_TICKER = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_CURRENCY = re.compile(r"^[A-Z]{3}$")
_SAFE_ISSUE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_MAX_EVIDENCE = 1000
_LEASE_SECONDS = 90


class WorkerRefused(RuntimeError):
    """Failure code only; never include broker identifiers or payloads."""


def _uuid(value):
    try:
        return UUID(str(value))
    except (ValueError, AttributeError, TypeError) as exc:
        raise WorkerRefused("INVALID_JOB") from exc


def _account_authorized(broker, wid, account_id):
    """Require a currently connected, active, tenant-bound Tiger grant."""
    return broker.execute("""SELECT a.connection_id
      FROM saas_broker_accounts a
      JOIN saas_broker_connections c
        ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
      JOIN saas_tiger_grants g
        ON g.workspace_id=c.workspace_id AND g.connection_id=c.id
      JOIN saas_tiger_account_secrets s
        ON s.workspace_id=a.workspace_id AND s.account_id=a.id
      WHERE a.workspace_id=%s AND a.id=%s
        AND c.provider_code='TIGER' AND c.status='CONNECTED'
        AND c.authorization_expires_at > now() + interval '60 seconds'""",
        (wid,account_id)).fetchone()


def enqueue(identity, broker, subject, account_id, start, end, *, days=30):
    """Owner-authorized idempotent schedule. No broker network access."""
    account_id = _uuid(account_id)
    # Enqueue is source-ready but deliberately not exposed in server.py.
    with broker.transaction():
        wid = _scope(identity,broker,subject)
        related = _account_authorized(broker,wid,account_id)
        if not related:
            raise WorkerRefused("ACCOUNT_NOT_AUTHORIZED")
        plan = plan_backfill(UUID(wid),UUID(str(related[0])),account_id,start,end,days=days)
        row = broker.execute("""INSERT INTO saas_broker_backfill_jobs
          (workspace_id,account_id,idempotency_key,start_utc,end_utc)
          VALUES (%s,%s,%s,%s,%s)
          ON CONFLICT (workspace_id,account_id,idempotency_key)
          DO NOTHING RETURNING id""",
          (wid,account_id,plan.idempotency_key,plan.windows[0].start_utc,
           plan.windows[-1].end_utc)).fetchone()
        if row is None:
            row=broker.execute("""SELECT id FROM saas_broker_backfill_jobs
              WHERE workspace_id=%s AND account_id=%s AND idempotency_key=%s""",
              (wid,account_id,plan.idempotency_key)).fetchone()
        job_id=row[0]
        # A retry cannot overwrite any existing window's state or evidence.
        for win in plan.windows:
            broker.execute("""INSERT INTO saas_broker_backfill_windows
              (workspace_id,job_id,account_id,ordinal,start_utc,end_utc)
              VALUES (%s,%s,%s,%s,%s,%s)
              ON CONFLICT (workspace_id,job_id,ordinal) DO NOTHING""",
              (wid,job_id,account_id,win.ordinal,win.start_utc,win.end_utc))
    return {"jobId":str(job_id),"windows":len(plan.windows),"state":"QUEUED"}


def _claim(identity, broker, subject, job_id):
    """Atomic, tenant-RLS fenced claim; SKIP LOCKED avoids concurrent claims."""
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        job=broker.execute("""SELECT j.account_id,a.connection_id
          FROM saas_broker_backfill_jobs j
          JOIN saas_broker_accounts a
            ON a.workspace_id=j.workspace_id AND a.id=j.account_id
          WHERE j.workspace_id=%s AND j.id=%s FOR UPDATE OF j""",
          (wid,job_id)).fetchone()
        if not job:
            raise WorkerRefused("JOB_NOT_FOUND")
        account_id,connection_id=job
        if not _account_authorized(broker,wid,account_id):
            raise WorkerRefused("ACCOUNT_NOT_AUTHORIZED")
        row=broker.execute("""SELECT w.id,w.start_utc,w.end_utc,w.attempts
          FROM saas_broker_backfill_windows w
          WHERE w.workspace_id=%s AND w.job_id=%s
            AND w.attempts < 5 AND (
              w.state='PENDING'
              OR (w.state='RUNNING' AND w.lease_until < now())
              OR (w.state='PARTIAL' AND w.retry_after IS NOT NULL
                  AND w.retry_after <= now()))
          ORDER BY w.ordinal FOR UPDATE OF w SKIP LOCKED LIMIT 1""",
          (wid,job_id)).fetchone()
        if not row:
            return None
        win_id,start,end,attempts=row
        fenced=broker.execute("""UPDATE saas_broker_backfill_windows
          SET state='RUNNING',attempts=attempts+1,
              lease_token=gen_random_uuid(),
              lease_until=now() + interval '90 seconds',
              retry_after=NULL,finished_at=NULL,issue_codes='{}'
          WHERE workspace_id=%s AND id=%s
          RETURNING lease_token,attempts""",(wid,win_id)).fetchone()
        broker.execute("""UPDATE saas_broker_backfill_jobs
           SET state='RUNNING',updated_at=now()
           WHERE workspace_id=%s AND id=%s""",(wid,job_id))
        return (UUID(wid),UUID(str(connection_id)),UUID(str(account_id)),
                UUID(str(win_id)),fenced[0],start,end,fenced[1])


def _decimal(v, *, positive):
    return (isinstance(v,Decimal) and v.is_finite()
            and (v>0 if positive else v>=0))


def _validate_batch(request, result):
    """Validate normalized read facts, never raw unbounded provider payloads."""
    if (not isinstance(result,BrokerSyncBatch) or result.request!=request
            or result.provider!="TIGER" or result.completeness not in ("COMPLETE","PARTIAL")
            or not isinstance(result.fills,tuple) or len(result.fills)>_MAX_EVIDENCE
            or not isinstance(result.order_count,int) or result.order_count<0):
        raise WorkerRefused("SOURCE_CONTRACT_INVALID")
    issues=set()
    for code in result.issue_codes:
        if not isinstance(code,str) or not _SAFE_ISSUE.fullmatch(code):
            raise WorkerRefused("SOURCE_ISSUE_INVALID")
        issues.add(code)
    if result.completeness!="COMPLETE":
        issues.add("PROVIDER_PARTIAL")
    # The current shadow adapter cannot prove historical coverage, fee scope
    # or currency. Even an otherwise clean read can only stage PARTIAL facts.
    issues.add("HISTORY_COVERAGE_UNVERIFIED")
    prepared=[]
    for fill in result.fills:
        if (not isinstance(fill.provider_fill_id,str) or not fill.provider_fill_id.strip()
                or len(fill.provider_fill_id)>256
                or not isinstance(fill.provider_order_id,str) or not fill.provider_order_id.strip()
                or len(fill.provider_order_id)>256
                or not isinstance(fill.symbol,str) or not _TICKER.fullmatch(fill.symbol)
                or fill.side not in ("BUY","SELL")
                or not _decimal(fill.quantity,positive=True)
                or not _decimal(fill.price,positive=True)
                or not isinstance(fill.currency,str)
                or not isinstance(fill.time_confidence,str)):
            raise WorkerRefused("SOURCE_FACT_INVALID")
        if not _CURRENCY.fullmatch(fill.currency):
            issues.add("CURRENCY_UNVERIFIED")
        if fill.fee_total is None:
            issues.add("FEE_UNKNOWN")
        elif not _decimal(fill.fee_total,positive=False):
            raise WorkerRefused("SOURCE_FEE_INVALID")
        if (fill.executed_at_utc is None
                or fill.executed_at_utc.tzinfo is None
                or fill.executed_at_utc.utcoffset() is None
                or fill.time_confidence!="VERIFIED_OFFSET"):
            issues.add("TIME_UNVERIFIED")
        payload={"kind":"FILL","providerFillId":fill.provider_fill_id,
                 "providerOrderId":fill.provider_order_id,
                 "symbol":fill.symbol,"side":fill.side,
                 "quantity":str(fill.quantity),"price":str(fill.price),
                 "currency":fill.currency,
                 "executedAt":fill.executed_at_utc.astimezone(timezone.utc).isoformat()
                     if fill.executed_at_utc and fill.executed_at_utc.utcoffset() is not None else None,
                 "timeConfidence":fill.time_confidence,
                 "timeRaw":fill.source_time_raw,
                 "fee":str(fill.fee_total) if fill.fee_total is not None else None}
        prepared.append((fill.provider_fill_id,payload))
    if len(prepared)>_MAX_EVIDENCE:
        raise WorkerRefused("SOURCE_TOO_LARGE")
    return prepared,tuple(sorted(issues))


def _recompute(broker,wid,job_id):
    states=[r[0] for r in broker.execute("""SELECT state
      FROM saas_broker_backfill_windows
      WHERE workspace_id=%s AND job_id=%s""",(wid,job_id)).fetchall()]
    if not states:
        raise WorkerRefused("JOB_EMPTY")
    status=("COMPLETE" if all(s=="COMPLETE" for s in states) else
            "AUTH_REQUIRED" if "AUTH_REQUIRED" in states else
            "FAILED" if "FAILED" in states else
            "PARTIAL" if "PARTIAL" in states else
            "RUNNING" if "RUNNING" in states else "PENDING")
    broker.execute("""UPDATE saas_broker_backfill_jobs SET state=%s,updated_at=now()
       WHERE workspace_id=%s AND id=%s""",(status,wid,job_id))
    return status


def _finish(identity,broker,subject,job_id,claim,prepared,issues,problem):
    wid,_,account_id,win_id,lease_token,_,_,attempts=claim
    with broker.transaction():
        actual=_scope(identity,broker,subject)
        if UUID(actual)!=wid:
            raise WorkerRefused("JOB_NOT_FOUND")
        # Revoked consent must not allow a previously running worker to write.
        if not _account_authorized(broker,actual,account_id):
            raise WorkerRefused("ACCOUNT_NOT_AUTHORIZED")
        final="PARTIAL"
        retry=None
        if problem=="AUTH":
            final="AUTH_REQUIRED"
        elif problem=="TRANSIENT":
            final="FAILED" if attempts>=5 else "PARTIAL"
            retry=0 if attempts>=5 else min(30*(2**(attempts-1)),480)
        elif problem=="ERROR":
            final="FAILED"
        # Acquire the fence before any staged insert. Finishing an expired
        # or reclaimed lease cannot publish data or alter job state.
        row=broker.execute("""UPDATE saas_broker_backfill_windows
          SET state=%s,lease_token=NULL,lease_until=NULL,
              retry_after=CASE WHEN %s::integer IS NULL THEN NULL
                               ELSE now() + (%s * interval '1 second') END,
              issue_codes=%s,finished_at=now()
          WHERE workspace_id=%s AND id=%s AND account_id=%s
            AND lease_token=%s AND state='RUNNING' AND lease_until > now()
          RETURNING id""",
          (final,retry,retry,list(issues),actual,win_id,account_id,lease_token)).fetchone()
        if row is None:
            return {"state":"LEASE_LOST","written":0}
        written=0
        secret=os.environ.get("SAAS_SOURCE_HMAC_KEY","")
        if prepared and (len(secret)<64 or not re.fullmatch("[0-9a-f]{64,}",secret)):
            raise WorkerRefused("SOURCE_KEY_NOT_CONFIGURED")
        for provider_id,payload in prepared:
            key=source_key(bytes.fromhex(secret[:64]),"TIGER",account_id,"FILL",provider_id)
            canonical=json.dumps(payload,sort_keys=True,separators=(",",":"),allow_nan=False).encode("utf-8")
            digest=hashlib.sha256(canonical).hexdigest()
            cipher=seal(payload,actual+":"+str(account_id)+":FILL:"+key+":"+digest)
            r=broker.execute("""INSERT INTO saas_broker_source_stage
              (workspace_id,window_id,account_id,kind,source_key_hmac,evidence_sha256,encrypted_payload)
              VALUES (%s,%s,%s,'FILL',%s,%s,%s)
              ON CONFLICT (workspace_id,account_id,kind,source_key_hmac,evidence_sha256)
              DO NOTHING RETURNING id""",
              (actual,win_id,account_id,key,digest,cipher)).fetchone()
            written+=int(r is not None)
        status=_recompute(broker,actual,job_id)
    return {"state":status,"written":written,"issues":list(issues)}


def run_one(identity,broker,subject,job_id,read):
    """Process one bounded window. read(request) is offline-injected (no SDK)."""
    job_id=_uuid(job_id)
    if not callable(read):
        raise WorkerRefused("ADAPTER_NOT_CONFIGURED")
    claim=_claim(identity,broker,subject,job_id)
    if claim is None:
        return {"state":"NO_ELIGIBLE_WINDOW","written":0}
    wid,connection_id,account_id,_,_,start,end,_=claim
    request=BrokerSyncRequest(wid,connection_id,account_id,SyncWindow(start,end))
    try:
        batch=read(request)
        prepared,issues=_validate_batch(request,batch)
        problem=None
    except Exception as exc:
        # The exception body may contain account numbers/tokens. Never print it.
        code=getattr(exc,"code","")
        if code in ("REAUTH_REQUIRED","PROVIDER_ACCESS_DENIED"):
            problem,issues="AUTH",("REAUTH_REQUIRED",)
        elif code in ("PROVIDER_RATE_LIMIT","PROVIDER_UNAVAILABLE") or isinstance(
            exc,(TimeoutError,ConnectionError)):
            problem,issues="TRANSIENT",("PROVIDER_TRANSIENT",)
        else:
            problem,issues="ERROR",("SOURCE_ERROR",)
        prepared=[]
    return _finish(identity,broker,subject,job_id,claim,prepared,issues,problem)
