"""Signed run-level success/failure receipt; no raw account/error in output."""
from __future__ import annotations
import hashlib,hmac,json,time,urllib.request
from uuid import uuid4
from temporary.tiger_personal.runner import configuration
from temporary.tiger_personal.sync_ready import _endpoint

PATH="/internal/v1/tiger/personal-health-import"

def send_health(env, assets, orders, fills, run_id=None):
    _tiger_id,account,_rsa=configuration(env)
    subject=env["POSITIONARY_PERSONAL_GOOGLE_SUBJECT"]
    secret=env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET","")
    if len(secret)<32:raise ValueError("HEALTH_BRIDGE_UNAVAILABLE")
    record={"subject":subject,"account":account,"runId":run_id or str(uuid4()),
            "assets":assets,"orders":orders,"fills":fills}
    raw=json.dumps(record,separators=(",",":")).encode()
    stamp=str(int(time.time())); nonce=str(uuid4())
    sig=hmac.new(secret.encode(),f"{stamp}\n{nonce}\nPOST\n{PATH}\n".encode()+raw,
                 hashlib.sha256).hexdigest()
    request=urllib.request.Request(_endpoint(env)+PATH,data=raw,method="POST",
      headers={"Content-Type":"application/json","X-Saas-Timestamp":stamp,
               "X-Saas-Nonce":nonce,"X-Saas-Signature":sig})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self,*args,**kwargs):
            raise ValueError("HEALTH_REDIRECT_FORBIDDEN")
    with urllib.request.build_opener(NoRedirect()).open(request,timeout=15) as response:
        if response.status!=200:raise ValueError("HEALTH_WRITE_FAILED")
        receipt=json.loads(response.read(1024))
        if receipt.get("saved") is not True or receipt.get("source")!="PERSONAL_RUN_HEALTH":
            raise ValueError("HEALTH_RECEIPT_INVALID")
    return True
