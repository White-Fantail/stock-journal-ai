"""Private, single-owner Tiger RSA read-only refresh coordinator.

No public domain, no user-supplied broker account, no trading methods.
The API proxy authenticates a fresh workspace owner before signing a request.
All execution state is observational and process-local (never financial truth).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import threading
import time
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from uuid import uuid4
from zoneinfo import ZoneInfo

_PATH_REQUEST = "/internal/personal-refresh/request"
_PATH_STATUS = "/internal/personal-refresh/status"
_ALLOWED = frozenset({_PATH_REQUEST, _PATH_STATUS})
_ET = ZoneInfo("America/New_York")
_GUARD = threading.RLock()
_RUNNING = False
_MANUAL_AT = 0.0
_STARTED_AT = None
_FINISHED_AT = None
_SUCCESS_AT = None
_MODE = None
_STATE = "IDLE"
_SLOTS = set()
_NONCES = {}
_COOLDOWN = 300  # Five minutes between user-initiated runs.
_PORT = 8081


def _iso():
    return datetime.now(timezone.utc).isoformat()


def _snapshot():
    with _GUARD:
        next_at = (_MANUAL_AT + _COOLDOWN) if _MANUAL_AT else None
        return {"state":_STATE, "mode":_MODE, "startedAt":_STARTED_AT,
                "finishedAt":_FINISHED_AT, "lastSuccessfulAt":_SUCCESS_AT,
                "nextAllowedAt":datetime.fromtimestamp(next_at,timezone.utc).isoformat() if next_at else None}


def _authenticated(path, data, headers):
    secret = os.environ.get("POSITIONARY_PERSONAL_BRIDGE_SECRET", "")
    owner = os.environ.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT", "")
    if (os.environ.get("POSITIONARY_PERSONAL_TIGER_ENABLED") != "1"
            or len(secret) < 32 or path not in _ALLOWED
            or type(data) is not dict or set(data) != {"subject"}
            or not isinstance(data["subject"], str)
            or not hmac.compare_digest(data["subject"], owner)):
        return False
    stamp = headers.get("X-Saas-Timestamp", "")
    nonce = headers.get("X-Saas-Nonce", "")
    signature = headers.get("X-Saas-Signature", "")
    if (not stamp.isdecimal() or len(stamp)>12 or
            len(nonce)!=36 or len(signature)!=64):
        return False
    now = int(time.time())
    if abs(now-int(stamp))>30:
        return False
    raw = json.dumps(data,separators=(",",":"),ensure_ascii=True).encode()
    digest = hmac.new(secret.encode(),
                      f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+raw,
                      hashlib.sha256).hexdigest()
    if not hmac.compare_digest(digest,signature):
        return False
    with _GUARD:
        for key,at in list(_NONCES.items()):
            if now-at>60:
                del _NONCES[key]
        if nonce in _NONCES:
            return False
        _NONCES[nonce]=now
    return True


def _quick_sync():
    """Only recent read/query operations; no historical multi-year rescan."""
    from temporary.tiger_personal.history_sync import sync_history
    from temporary.tiger_personal.fill_probe_worker import sync_probe
    result = sync_history(recent_days=30)
    # Partial coverage remains visibly partial and must not become certified.
    if not result["rangeComplete"]:
        raise RuntimeError("PARTIAL_ORDER_WINDOW")
    # Permission-limited Prime accounts may not expose individual fills.
    # This is a successful order refresh, not a certified transaction ledger.
    try:
        sync_probe()
    except Exception:
        print("PERSONAL_RECENT_FILL_PROBE_UNAVAILABLE",flush=True)


def _run(mode):
    global _RUNNING,_STARTED_AT,_FINISHED_AT,_SUCCESS_AT,_MODE,_STATE
    try:
        if mode=="DAILY":
            from temporary.tiger_personal.history_sync import main
            try:
                main()
            except SystemExit as exc:
                if exc.code not in (None,0):
                    raise RuntimeError("DAILY_PARTIAL") from None
        else:
            _quick_sync()
    except Exception:
        # SDK exceptions may contain account IDs, order data and credential text.
        print("PERSONAL_REFRESH_FAILED mode="+mode,flush=True)
        with _GUARD:
            _STATE="FAILED"
            _FINISHED_AT=_iso()
    else:
        print("PERSONAL_REFRESH_COMPLETE mode="+mode,flush=True)
        with _GUARD:
            _SUCCESS_AT=_iso()
            _FINISHED_AT=_SUCCESS_AT
            _STATE="COMPLETED"
    finally:
        with _GUARD:
            _RUNNING=False


def _launch(mode, manual=False):
    global _RUNNING,_MANUAL_AT,_STARTED_AT,_FINISHED_AT,_MODE,_STATE
    with _GUARD:
        now=time.time()
        if _RUNNING:
            return {"state":"RUNNING", **{k:v for k,v in _snapshot().items() if k!="state"}}
        if manual and now-_MANUAL_AT<_COOLDOWN:
            return {"state":"COOLDOWN", **{k:v for k,v in _snapshot().items() if k!="state"}}
        if manual:
            _MANUAL_AT=now
        _RUNNING=True
        _MODE=mode
        _STATE="RUNNING"
        _STARTED_AT=_iso()
        _FINISHED_AT=None
        threading.Thread(target=_run,args=(mode,),daemon=True).start()
        return _snapshot()


def _due_slot(now):
    """Hourly at :30 in the US regular session; daily integrity at 22 UTC."""
    et=now.astimezone(_ET)
    if et.weekday()<5 and 9<=et.hour<=15 and et.minute>=30:
        return "HOURLY",et.strftime("%Y-%m-%d:%H")
    if now.hour>=22:
        return "DAILY",now.strftime("%Y-%m-%d")
    return None


def _scheduler():
    while True:
        try:
            due=_due_slot(datetime.now(timezone.utc))
            if due:
                with _GUARD:
                    needs_run=due not in _SLOTS and not _RUNNING
                    if needs_run:
                        _SLOTS.add(due)
                        # No unbounded in-memory history.
                        if len(_SLOTS)>45:
                            _SLOTS.clear()
                            _SLOTS.add(due)
                if needs_run:
                    _launch(due[0])
        except Exception:
            print("PERSONAL_SCHEDULER_ERROR",flush=True)
        time.sleep(30)


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_args):
        pass  # Never log subject, request or provider fields.

    def reply(self, status, data):
        encoded=json.dumps(data,separators=(",",":")).encode()
        self.send_response(status)
        self.send_header("Content-Type","application/json")
        self.send_header("Content-Length",str(len(encoded)))
        self.send_header("Cache-Control","no-store")
        self.end_headers()
        self.wfile.write(encoded)

    def do_GET(self):
        if self.path=="/healthz":
            return self.reply(200,{"status":"UP"})
        return self.reply(404,{"error":"NOT_FOUND"})

    def do_POST(self):
        if self.path not in _ALLOWED:
            return self.reply(404,{"error":"NOT_FOUND"})
        try:
            n=int(self.headers.get("Content-Length","-1"))
            if n<0 or n>512:
                return self.reply(413,{"error":"INVALID_BODY"})
            raw=self.rfile.read(n)
            data=json.loads(raw)
            # Exact wire bytes must match the authenticated HMAC.
            canonical=json.dumps(data,separators=(",",":"),ensure_ascii=True).encode()
            if raw!=canonical or not _authenticated(self.path,data,self.headers):
                return self.reply(403,{"error":"FORBIDDEN"})
            if self.path==_PATH_STATUS:
                return self.reply(200,_snapshot())
            return self.reply(200,_launch("MANUAL",manual=True))
        except (ValueError,TypeError,UnicodeDecodeError):
            return self.reply(400,{"error":"INVALID_BODY"})


def main():
    from temporary.tiger_personal.runner import configuration
    configuration(os.environ)  # Fail closed if RSA is not enabled.
    if len(os.environ.get("POSITIONARY_PERSONAL_BRIDGE_SECRET",""))<32:
        raise RuntimeError("BRIDGE_UNAVAILABLE")
    threading.Thread(target=_scheduler,daemon=True).start()
    port=int(os.environ.get("PORT",str(_PORT)))
    print("PERSONAL_REFRESH_COORDINATOR_READY",flush=True)
    ThreadingHTTPServer(("0.0.0.0",port),Handler).serve_forever()


if __name__=="__main__":
    main()
