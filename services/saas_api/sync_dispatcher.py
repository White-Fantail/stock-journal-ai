"""Trusted, disabled-by-default P3 job dispatcher.

The dispatch-only connection sees opaque queue metadata. Broker reads remain
under scoped RLS with fresh active-owner authorization. No Tiger network calls,
scheduled entrypoint, HTTP routes or order APIs are enabled by this module.
"""
from datetime import datetime, timedelta, timezone
from services.saas_api.backfill_worker import WorkerRefused, _scope
from services.saas_api.identity import resolve
from services.saas_api.paged_backfill import run_page


class DispatchRefused(RuntimeError):
    pass


def verify_role(dispatch):
    """Dispatch principal must NOT inherit broker vault/ledger permissions."""
    row=dispatch.execute("""SELECT rolsuper,rolbypassrls,
      pg_has_role(current_user,'saas_broker_dispatch_runtime','USAGE'),
      has_any_column_privilege(current_user,'saas_broker_dispatch_queue','UPDATE'),
      has_table_privilege(current_user,'saas_tiger_grants','SELECT'),
      has_table_privilege(current_user,'saas_tiger_account_secrets','SELECT'),
      has_table_privilege(current_user,'saas_broker_source_stage','SELECT')
      FROM pg_roles WHERE rolname=current_user""").fetchone()
    if row!=(False,False,True,True,False,False,False):
        raise DispatchRefused("DISPATCH_ROLE_INVALID")


def claim(dispatch):
    """Claim one due opaque job, nonblocking across concurrent dispatchers."""
    with dispatch.transaction():
        return dispatch.execute("""WITH due AS (
          SELECT workspace_id,job_id FROM saas_broker_dispatch_queue
           WHERE ready_after<=now() AND (claim_until IS NULL OR claim_until<now())
           ORDER BY ready_after,created_at FOR UPDATE SKIP LOCKED LIMIT 1
        )
        UPDATE saas_broker_dispatch_queue q
         SET claim_token=gen_random_uuid(),claim_until=now()+interval '2 minutes'
        FROM due
        WHERE q.workspace_id=due.workspace_id AND q.job_id=due.job_id
        RETURNING q.workspace_id,q.job_id,q.claim_token""").fetchone()


def active_owner(identity, workspace_id):
    row=identity.execute("""SELECT u.google_subject FROM saas_workspaces w
       JOIN saas_users u ON u.id=w.owner_user_id AND u.status='ACTIVE'
       JOIN saas_workspace_memberships m ON m.workspace_id=w.id
        AND m.user_id=u.id AND m.role='OWNER' AND m.status='ACTIVE'
       WHERE w.id=%s AND w.status='ACTIVE'""",(workspace_id,)).fetchone()
    if not row:
        return None
    resolved=resolve(identity,row[0])
    return row[0] if resolved and resolved["workspaceId"]==str(workspace_id) else None


def next_due(identity, broker, subject, workspace_id, job_id):
    with broker.transaction():
        if _scope(identity,broker,subject)!=str(workspace_id):
            raise DispatchRefused("SCOPE_CHANGED")
        rows=broker.execute("""SELECT state,retry_after,lease_until
          FROM saas_broker_backfill_windows WHERE workspace_id=%s AND job_id=%s""",
          (workspace_id,job_id)).fetchall()
        dates=[]
        for state,retry,lease in rows:
            if state=="PENDING":
                dates.append(datetime.now(timezone.utc))
            elif state=="RUNNING" and lease is not None:
                dates.append(lease)
            elif state=="PARTIAL" and retry is not None:
                dates.append(retry)
        return min(dates) if dates else None


def release(dispatch, task, due):
    wid,jid,token=task
    # Terminal work is parked, not repeatedly polled. This role cannot DELETE.
    if due is None:
        due=datetime(9999,1,1,tzinfo=timezone.utc)
    with dispatch.transaction():
        row=dispatch.execute("""UPDATE saas_broker_dispatch_queue
          SET ready_after=%s,claim_until=NULL,claim_token=NULL
          WHERE workspace_id=%s AND job_id=%s AND claim_token=%s
            AND claim_until>now() RETURNING job_id""",
          (due,wid,jid,token)).fetchone()
        return row is not None


def tick(identity,broker,dispatch,reader,*,enabled=False):
    """Explicit single tick; enable flag is a trusted process-only switch."""
    if enabled is not True or not callable(reader):
        raise DispatchRefused("DISPATCH_DISABLED")
    verify_role(dispatch)
    task=claim(dispatch)
    if not task:
        return {"status":"IDLE"}
    wid,jid,_=task
    try:
        subject=active_owner(identity,wid)
        if not subject:
            release(dispatch,task,datetime.now(timezone.utc)+timedelta(hours=1))
            return {"status":"SUSPENDED"}
        try:
            result=run_page(identity,broker,subject,jid,reader)
        except WorkerRefused as exc:
            if str(exc) in ("ACCOUNT_NOT_AUTHORIZED","JOB_NOT_FOUND"):
                release(dispatch,task,datetime.now(timezone.utc)+timedelta(hours=1))
                return {"status":"SUSPENDED"}
            raise
        due=next_due(identity,broker,subject,wid,jid)
        if due is not None:
            due=max(due,datetime.now(timezone.utc)+timedelta(seconds=2))
        release(dispatch,task,due)
        return {"status":"PROCESSED","state":result["state"]}
    except Exception:
        # Do not emit exception messages, workspace IDs, provider payloads.
        release(dispatch,task,datetime.now(timezone.utc)+timedelta(minutes=2))
        return {"status":"RETRY_SCHEDULED"}


def bounded_cycle(identity,broker,dispatch,reader,*,enabled=False,max_ticks=4):
    if type(max_ticks) is not int or not 1<=max_ticks<=8:
        raise DispatchRefused("INVALID_TICK_LIMIT")
    results=[]
    for _ in range(max_ticks):
        item=tick(identity,broker,dispatch,reader,enabled=enabled)
        results.append(item)
        if item["status"]=="IDLE":
            break
    return tuple(results)
