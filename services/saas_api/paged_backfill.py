"""Staged P3 provider-neutral pagination with encrypted crash-safe checkpoints.

Only explicit, authenticated, owner-scoped calls and an injected read-only page
callback. NO Tiger network client, no HTTP endpoint, no production scheduler.
Every page is staged in one DB transaction with the encrypted continuation
cursor and a lease-token fence. No authoritative portfolio is published.
"""
from __future__ import annotations

import hashlib
import json
import os
import re

from services.broker_connectors.contracts import BrokerSyncBatch, BrokerSyncRequest, SyncWindow
from services.broker_connectors.backfill import source_key
from services.broker_connectors.paged_contract import ReadPage, MAX_WINDOW_PAGES
from services.saas_api.backfill_worker import (
    WorkerRefused, _account_authorized, _claim, _finish, _recompute, _scope,
    _uuid, _validate_batch,
)
from services.saas_api.tiger_oauth import seal, unseal


def _cursor_aad(wid, account_id, window_id):
    return f"{wid}:{account_id}:{window_id}:PAGE_CURSOR"


def _load_checkpoint(identity, broker, subject, claim):
    wid, _, account_id, window_id, token, *_ = claim
    with broker.transaction():
        scoped = _scope(identity, broker, subject)
        if scoped != str(wid) or not _account_authorized(broker, scoped, account_id):
            raise WorkerRefused("JOB_NOT_AUTHORIZED")
        record = broker.execute("""SELECT checkpoint_ciphertext, pages_staged
          FROM saas_broker_backfill_windows
          WHERE workspace_id=%s AND account_id=%s AND id=%s
            AND lease_token=%s AND state='RUNNING' AND lease_until>now()""",
          (wid, account_id, window_id, token)).fetchone()
        if not record:
            raise WorkerRefused("LEASE_LOST")
        cipher, count = record
        if cipher is None:
            if count:
                raise WorkerRefused("CHECKPOINT_MISSING")
            return None, [], 0
        try:
            saved = unseal(bytes(cipher), _cursor_aad(wid, account_id, window_id))
        except Exception:
            raise WorkerRefused("CHECKPOINT_INVALID") from None
        if (not isinstance(saved, dict) or set(saved) != {"next", "seen"}
                or not isinstance(saved["next"], str) or not saved["next"]
                or not isinstance(saved["seen"], list)
                or any(not isinstance(item, str) or not re.fullmatch(r"[a-f0-9]{64}", item)
                       for item in saved["seen"])
                or len(saved["seen"]) != count or count > MAX_WINDOW_PAGES):
            raise WorkerRefused("CHECKPOINT_INVALID")
        return saved["next"], saved["seen"], count


def _page_to_stage(request, page, cursor, seen, page_count):
    if not isinstance(page, ReadPage) or page.request != request:
        raise WorkerRefused("PAGE_CONTRACT_INVALID")
    if page_count >= MAX_WINDOW_PAGES:
        raise WorkerRefused("PAGE_LIMIT")
    prior_digest = hashlib.sha256(cursor.encode()).hexdigest() if cursor is not None else None
    if prior_digest is not None and prior_digest not in seen:
        raise WorkerRefused("CHECKPOINT_INVALID")
    if page.next_cursor is not None:
        digest = hashlib.sha256(page.next_cursor.encode()).hexdigest()
        if digest == prior_digest or digest in seen:
            raise WorkerRefused("CURSOR_LOOP")
        if page_count + 1 == MAX_WINDOW_PAGES:
            raise WorkerRefused("PAGE_LIMIT")
        next_seen = seen + [digest]
    else:
        next_seen = seen
    batch = BrokerSyncBatch(request, "TIGER", "PARTIAL",
                            page.fills, (), 0, ("PAGE_COVERAGE_UNVERIFIED",))
    records, issues = _validate_batch(request, batch)
    return records, issues, next_seen


def _commit_page(identity, broker, subject, job_id, claim, page, records, issues, next_seen, page_count):
    wid, _, account_id, window_id, token, *_ = claim
    terminal = page.terminal
    source_secret = os.environ.get("SAAS_SOURCE_HMAC_KEY", "")
    # Verify cryptographic dependencies *before* advancing the checkpoint.
    if records and not re.fullmatch(r"[a-f0-9]{64}", source_secret):
        raise WorkerRefused("SOURCE_KEY_NOT_CONFIGURED")
    ciphertext = None
    if not terminal:
        ciphertext = seal({"next": page.next_cursor, "seen": next_seen},
                          _cursor_aad(wid, account_id, window_id))
    with broker.transaction():
        scoped = _scope(identity, broker, subject)
        if scoped != str(wid) or not _account_authorized(broker, scoped, account_id):
            raise WorkerRefused("JOB_NOT_AUTHORIZED")
        # Lock before writing any evidence: stale/expired leases cannot insert.
        row = broker.execute("""SELECT id FROM saas_broker_backfill_windows
           WHERE workspace_id=%s AND account_id=%s AND id=%s
             AND lease_token=%s AND state='RUNNING' AND lease_until>now()
             AND pages_staged=%s FOR UPDATE""",
           (wid, account_id, window_id, token, page_count)).fetchone()
        if not row:
            return {"state": "LEASE_LOST", "written": 0}
        written = 0
        for provider_id, payload in records:
            key = source_key(bytes.fromhex(source_secret), "TIGER", account_id, "FILL", provider_id)
            raw = json.dumps(payload, sort_keys=True, separators=(",", ":"), allow_nan=False).encode()
            digest = hashlib.sha256(raw).hexdigest()
            encrypted = seal(payload, f"{wid}:{account_id}:FILL:{key}:{digest}")
            result = broker.execute("""INSERT INTO saas_broker_source_stage
               (workspace_id,window_id,account_id,kind,source_key_hmac,
                evidence_sha256,encrypted_payload)
               VALUES (%s,%s,%s,'FILL',%s,%s,%s)
               ON CONFLICT (workspace_id,account_id,kind,source_key_hmac,evidence_sha256)
               DO NOTHING RETURNING id""",
               (wid,window_id,account_id,key,digest,encrypted)).fetchone()
            written += int(result is not None)
        updated = broker.execute("""UPDATE saas_broker_backfill_windows
           SET pages_staged=pages_staged+1, checkpoint_ciphertext=%s,
               state='PARTIAL', attempts=0, lease_token=NULL, lease_until=NULL,
               retry_after=CASE WHEN %s THEN NULL ELSE now() END,
               finished_at=CASE WHEN %s THEN now() ELSE NULL END,
               issue_codes=%s
           WHERE workspace_id=%s AND id=%s AND lease_token=%s AND pages_staged=%s
           RETURNING pages_staged""",
           (ciphertext, terminal, terminal, list(issues), wid, window_id, token, page_count)).fetchone()
        if not updated:
            raise WorkerRefused("LEASE_LOST")
        status = _recompute(broker, str(wid), job_id)
        return {"state": status if terminal else "NEXT_PAGE_READY",
                "written": written, "pages": updated[0],
                "coverage": "PARTIAL"}


def run_page(identity, broker, subject, job_id, reader):
    """Process one page, with a bounded, crash-resumable, tenant-fenced commit."""
    job_id = _uuid(job_id)
    if not callable(reader):
        raise WorkerRefused("ADAPTER_NOT_CONFIGURED")
    claim = _claim(identity, broker, subject, job_id)
    if claim is None:
        return {"state": "NO_ELIGIBLE_WINDOW", "written": 0}
    wid, connection_id, account_id, _, _, start, end, _ = claim
    request = BrokerSyncRequest(wid, connection_id, account_id, SyncWindow(start, end))
    try:
        cursor, seen, pages = _load_checkpoint(identity, broker, subject, claim)
        result = reader(request, cursor)
        records, issues, next_seen = _page_to_stage(request, result, cursor, seen, pages)
        return _commit_page(identity, broker, subject, job_id, claim, result,
                            records, issues, next_seen, pages)
    except WorkerRefused as exc:
        # A validation failure cannot establish coverage or expose raw pages.
        result = _finish(identity, broker, subject, job_id, claim, (),
                         (str(exc),), "ERROR")
        return {"state": result["state"], "written": 0}
    except Exception as exc:
        # No exception message, URLs, page cursors or broker identifiers logged.
        code = getattr(exc, "code", "")
        retryable = (code in ("PROVIDER_RATE_LIMIT", "PROVIDER_UNAVAILABLE")
                     or isinstance(exc, (TimeoutError, ConnectionError)))
        problem = "TRANSIENT" if retryable else "ERROR"
        result = _finish(identity, broker, subject, job_id, claim, (),
                         ("PROVIDER_TRANSIENT" if retryable else "SOURCE_ERROR",), problem)
        return {"state": result["state"], "written": 0}


def run_bounded(identity, broker, subject, job_id, reader, *, max_pages=4):
    """Explicit invocation only; not a cron/scheduler or third-party API connector."""
    if type(max_pages) is not int or max_pages < 1 or max_pages > 8:
        raise WorkerRefused("INVALID_BATCH_LIMIT")
    result = None
    for _ in range(max_pages):
        result = run_page(identity, broker, subject, job_id, reader)
        if result["state"] != "NEXT_PAGE_READY":
            return result
    return result
