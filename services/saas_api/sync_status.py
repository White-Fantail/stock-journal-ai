"""Read-only, workspace-scoped P3 sync health. No evidence or credentials.

Reports the *processing state*, not verified historical coverage. All operations
use the broker runtime's FORCE-RLS tenant scope from a fresh Google membership.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import re

from services.saas_api.tiger_oauth import _scope

_ISSUE = re.compile(r"^[A-Z][A-Z0-9_]{1,63}$")
_STATES = frozenset(("PENDING","RUNNING","PARTIAL","COMPLETE","FAILED","AUTH_REQUIRED"))


def _iso(value):
    return value.isoformat() if isinstance(value, datetime) else None


def _issues(values):
    if not isinstance(values, (tuple, list)):
        return []
    return sorted({v for v in values if isinstance(v,str) and _ISSUE.fullmatch(v)})[:12]


def _format_job(row, windows):
    job_id, account_id, alias, state, start, end, updated, connection_status = row
    total = len(windows)
    terminal = sum(
        (w[1] == "COMPLETE") or
        (w[1] == "PARTIAL" and w[4] is not None and w[6] is None and w[3] > 0)
        for w in windows
    )
    finished = sum(w[1] == "COMPLETE" for w in windows)
    pending = sum(w[1] == "PENDING" for w in windows)
    running = sum(w[1] == "RUNNING" for w in windows)
    failed = sum(w[1] in ("FAILED","AUTH_REQUIRED") for w in windows)
    issues = _issues([issue for w in windows for issue in (w[7] or [])])
    next_retry = min((w[5] for w in windows if w[5] is not None),default=None)
    pages = sum(int(w[3]) for w in windows)
    # Zero pending windows do not imply verified historical completeness.
    return {"id": str(job_id), "accountId":str(account_id), "accountAlias":str(alias),
            "connectionStatus":str(connection_status),
            "state":state if state in _STATES else "PARTIAL",
            "startUtc":_iso(start),"endUtc":_iso(end),"updatedAt":_iso(updated),
            "totalWindows":total,"processedWindows":terminal,"certifiedWindows":finished,
            "pendingWindows":pending,"runningWindows":running,"blockedWindows":failed,
            "pagesStaged":pages,"nextRetryAt":_iso(next_retry),
            "issueCodes":issues,"historyVerified":False,
            "coverage":"UNVERIFIED"}


def sync_status(identity, broker, subject):
    """Bounded owner-only DTO; no cursor, tokens, HMAC keys or raw trade values."""
    with broker.transaction():
        wid = _scope(identity,broker,subject)
        jobs = broker.execute("""SELECT j.id,j.account_id,a.alias,j.state,
                  j.start_utc,j.end_utc,j.updated_at,c.status
             FROM saas_broker_backfill_jobs j
             JOIN saas_broker_accounts a
               ON a.workspace_id=j.workspace_id AND a.id=j.account_id
             JOIN saas_broker_connections c
               ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
             WHERE j.workspace_id=%s
             ORDER BY j.updated_at DESC,j.id DESC LIMIT 25""",(wid,)).fetchall()
        by_job=defaultdict(list)
        if jobs:
            for row in broker.execute("""SELECT job_id,ordinal,state,attempts,pages_staged,
                         finished_at,retry_after,checkpoint_ciphertext,issue_codes
                FROM saas_broker_backfill_windows
                WHERE workspace_id=%s AND job_id = ANY(%s::uuid[])
                ORDER BY job_id,ordinal""",(wid,[j[0] for j in jobs])).fetchall():
                # Only presence of checkpoint ciphertext is inspected. NEVER return it.
                job_id,ordinal,state,attempts,pages,finished,retry,cipher,issues=row
                if 0 <= ordinal < 256:
                    by_job[job_id].append(
                        (ordinal,state,attempts,pages,finished,retry,
                         cipher,issues))
    results=[_format_job(job,by_job[job[0]]) for job in jobs]
    return {"provider":"TIGER","syncEnabled":False,
            "coverage":"UNVERIFIED","jobs":results}
