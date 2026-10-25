"""Disposable PostgreSQL + real localhost HTTP A/B isolation and replay test.

Not a Google browser OAuth test. Only synthetic identities and local ephemeral data.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from uuid import uuid4
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import psycopg

from services.saas_api.identity import resolve

PORT = "18181"
BASE = f"http://127.0.0.1:{PORT}"
SECRET = "ci-only-hmac-secret-should-never-be-deployed-0123456789"


def request(path: str, payload: dict, nonce: str | None = None) -> tuple[int, dict]:
    body=json.dumps(payload,separators=(",",":")).encode()
    stamp=str(int(time.time()))
    nonce=nonce or str(uuid4())
    signature=hmac.new(SECRET.encode(),
        f"{stamp}\n{nonce}\nPOST\n{path}\n".encode()+body,hashlib.sha256).hexdigest()
    req=urllib.request.Request(BASE+path,data=body,method="POST",headers={
        "Content-Type":"application/json",
        "X-Saas-Timestamp":stamp,
        "X-Saas-Nonce":nonce,
        "X-Saas-Signature":signature,
    })
    try:
        with urllib.request.urlopen(req,timeout=7) as res:
            return res.status,json.loads(res.read())
    except urllib.error.HTTPError as err:
        return err.code,json.loads(err.read())


def main():
    if os.environ.get("SAAS_TEST_DB_ACK")!="YES_DISPOSABLE_SAAS_DB":
        raise SystemExit("Only disposable CI database may run HTTP tests")
    dsn=os.environ["SAAS_DATABASE_URL"]
    with psycopg.connect(dsn,autocommit=True) as db:
        db.execute("""CREATE ROLE saas_http_ci LOGIN PASSWORD 'http-ci-password'
                      NOSUPERUSER NOBYPASSRLS IN ROLE saas_trade_runtime""")
    trade_dsn=dsn.replace("saas_ci:synthetic_only","saas_http_ci:http-ci-password")
    env={**os.environ,"SAAS_DATABASE_URL":dsn,"SAAS_TRADE_DATABASE_URL":trade_dsn,
         "SAAS_INTERNAL_SECRET":SECRET,"SAAS_S2_ENABLED":"1","PORT":PORT}
    p=subprocess.Popen([sys.executable,"-m","services.saas_api.server"],
        env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    try:
        for attempt in range(50):
            if p.poll() is not None:
                raise RuntimeError("HTTP service exited")
            try:
                with urllib.request.urlopen(BASE+"/healthz",timeout=1) as res:
                    if res.status==200: break
            except (OSError,urllib.error.URLError):
                time.sleep(.1)
        else: raise RuntimeError("No local HTTP healthz")

        A,B="9000000000000000001","9000000000000000002"
        for sub in [A,B]:
            code,out=request("/internal/v1/provision",{
                "subject":sub,"email":sub+"@example.invalid","email_verified":True,"name":"Synthetic"})
            assert code==200,(code,out)
        key=str(uuid4())
        trade={"idempotencyKey":key,"kind":"EXECUTION","confirm":True,
               "ticker":"TSLA","side":"BUY","quantity":"1","price":"100",
               "currency":"USD","fee":None,"executedAt":"2026-10-20T15:00:00-04:00",
               "rationale":"Synthetic user assertion"}
        code,a_trade=request("/internal/v1/trades/create",{"subject":A,"trade":trade})
        assert code==200,(code,a_trade)
        code,replayed=request("/internal/v1/trades/create",{"subject":A,"trade":trade})
        assert code==200 and replayed["replayed"]
        code,own=request("/internal/v1/trades/list",{"subject":A})
        assert code==200 and len(own["events"])==1
        code,other=request("/internal/v1/trades/list",{"subject":B})
        assert code==200 and other["events"]==[]
        code,_=request("/internal/v1/trades/create",{"subject":B,"trade":{
            "idempotencyKey":str(uuid4()),"kind":"VOID","confirm":True,
            "voidsEventId":a_trade["id"],"rationale":"forged cross-tenant"}})
        assert code==404,code

        note={"idempotencyKey":str(uuid4()),"kind":"THESIS","ticker":"TSLA",
              "content":"Synthetic investment hypothesis","tradeEventId":None}
        code,_=request("/internal/v1/journal/create",{"subject":A,"entry":note})
        assert code==200,code
        code,blist=request("/internal/v1/journal/list",{"subject":B})
        assert code==200 and blist["entries"]==[]
        code,out=request("/internal/v1/journal/export",{"subject":A})
        assert code==200 and out["complete"] and len(out["journal"])==1 and len(out["trades"])==1
        code,out=request("/internal/v1/journal/export",{"subject":B})
        assert code==200 and out["journal"]==[] and out["trades"]==[]
        nonce=str(uuid4())
        code,_=request("/internal/v1/resolve",{"subject":A},nonce)
        assert code==200
        code,refused=request("/internal/v1/resolve",{"subject":A},nonce)
        assert code==429,(code,refused)
        # Non-privileged caller can never pass an arbitrary workspace selector.
        code,_=request("/internal/v1/journal/list",{"subject":A,"workspaceId":"forged"})
        assert code==400,code
        with psycopg.connect(dsn) as db:
            scope=resolve(db,B)
            with db.transaction():
                db.execute("""UPDATE saas_workspace_memberships SET status='REVOKED'
                              WHERE workspace_id=%s AND user_id=%s""",
                              (scope["workspaceId"],scope["userId"]))
        code,_=request("/internal/v1/journal/list",{"subject":B})
        assert code==404,code
        code,_=request("/internal/v1/account/delete",{"subject":A,"confirmation":"not confirmed"})
        assert code==400,code
        code,out=request("/internal/v1/account/delete",{"subject":A,"confirmation":"DELETE_MY_ACCOUNT"})
        assert code==200 and out=={"deleted":True},(code,out)
        code,_=request("/internal/v1/resolve",{"subject":A})
        assert code==404
        print("P1/P2 HTTP PASS: provision, replay, trade, journal, export, A/B denial, revocation, deletion")
    finally:
        p.terminate()
        try:p.wait(timeout=4)
        except subprocess.TimeoutExpired:p.kill()


if __name__=="__main__": main()
