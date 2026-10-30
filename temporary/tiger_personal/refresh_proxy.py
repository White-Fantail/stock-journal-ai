"""Authenticated SaaS -> isolated Railway personal Tiger refresh request proxy.

Only a fresh Google-owner workspace membership may request or inspect refresh.
The RSA credential remains ONLY in the personal worker. No browser-defined URL,
account ID, worker auth secret, query operation or schedule is accepted.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import urllib.request
import urllib.error
import time
from uuid import uuid4

from services.saas_api.tiger_oauth import _scope
from temporary.tiger_personal.api import owner_only, PilotError

_WORKER="http://positionary-tiger-personal.railway.internal:8081"
_ACTIONS={"request":"/internal/personal-refresh/request",
          "status":"/internal/personal-refresh/status"}
_STATES={"IDLE","RUNNING","COMPLETED","FAILED","COOLDOWN"}
_MODES={None,"MANUAL","HOURLY","DAILY"}


def personal_refresh(identity, broker, subject, action):
    owner_only(subject)
    if action not in _ACTIONS:
        raise PilotError("INVALID_REFRESH")
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        row=broker.execute("""SELECT 1 FROM saas_broker_accounts a
          JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
          AND c.id=a.connection_id WHERE a.workspace_id=%s
          AND c.provider_code='TIGER' AND c.auth_mode='SIGNATURE'
          AND c.status='PENDING_AUTH' LIMIT 1""",(wid,)).fetchone()
        if not row:
            raise PilotError("ACCOUNT_NOT_LINKED")
    secret=os.environ.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
    if len(secret)<32:
        return {"state":"UNAVAILABLE"}
    path=_ACTIONS[action]
    body=json.dumps({"subject":subject},separators=(",",":")).encode()
    stamp=str(int(time.time()))
    nonce=str(uuid4())
    sig=hmac.new(secret.encode(),
      f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+body,hashlib.sha256).hexdigest()
    req=urllib.request.Request(_WORKER+path,method="POST",data=body,headers={
        "Content-Type":"application/json","X-Saas-Timestamp":stamp,
        "X-Saas-Nonce":nonce,"X-Saas-Signature":sig})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*_args,**_kwargs):
            raise ValueError("REDIRECT_DENIED")
    try:
        with urllib.request.build_opener(NoRedirect()).open(req,timeout=3) as response:
            if response.status!=200:
                return {"state":"UNAVAILABLE"}
            result=json.loads(response.read(2048))
    except (urllib.error.URLError,TimeoutError,ValueError,OSError):
        return {"state":"UNAVAILABLE"}
    if (not isinstance(result,dict) or result.get("state") not in _STATES or
            result.get("mode") not in _MODES or
            any(result.get(k) is not None and
                (not isinstance(result[k],str) or len(result[k])>48)
                for k in ("startedAt","finishedAt","lastSuccessfulAt","nextAllowedAt"))):
        return {"state":"UNAVAILABLE"}
    return {k:result.get(k) for k in
            ("state","mode","startedAt","finishedAt","lastSuccessfulAt","nextAllowedAt")}
