"""Strict owner-only ingress and view for the removable personal pilot."""
from __future__ import annotations
import hmac
import os
import re
from decimal import Decimal, InvalidOperation
from services.saas_api.tiger_oauth import _scope, unseal
from temporary.tiger_personal.snapshot_store import save_snapshot
from temporary.tiger_personal.history import load_orders

_SUB = re.compile(r"^[0-9]{3,255}$")
_ACC = re.compile(r"^[A-Za-z0-9]{5,25}$")
_SYM = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_DEC = re.compile(r"^-?(?:0|[1-9][0-9]{0,23})(?:\.[0-9]{1,12})?$")

class PilotError(Exception):
    def __init__(self, code):
        super().__init__(code)
        self.code=code

def owner_only(subject):
    allowed=os.environ.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT","")
    if os.environ.get("POSITIONARY_PERSONAL_TIGER_ENABLED")!="1" or not _SUB.fullmatch(allowed):
        raise PilotError("DISABLED")
    if not isinstance(subject,str) or not hmac.compare_digest(subject,allowed):
        raise PilotError("NOT_AUTHORIZED")

def number(value, optional=False):
    if value is None and optional:
        return None
    if not isinstance(value,str) or not _DEC.fullmatch(value):
        raise PilotError("INVALID_SNAPSHOT")
    try:
        if not Decimal(value).is_finite():
            raise PilotError("INVALID_SNAPSHOT")
    except InvalidOperation as exc:
        raise PilotError("INVALID_SNAPSHOT") from exc
    return value

def verify_payload(payload):
    if not isinstance(payload,dict) or set(payload)!={"subject","account","assets","positions"}:
        raise PilotError("INVALID_PAYLOAD")
    owner_only(payload["subject"])
    account=payload["account"]
    if not isinstance(account,str) or not _ACC.fullmatch(account):
        raise PilotError("INVALID_ACCOUNT")
    assets=payload["assets"]
    if not isinstance(assets,dict) or set(assets)!={"netLiquidation","cashBalance"}:
        raise PilotError("INVALID_SNAPSHOT")
    clean_assets={k:number(v,True) for k,v in assets.items()}
    rows=payload["positions"]
    if not isinstance(rows,list) or len(rows)>100:
        raise PilotError("INVALID_SNAPSHOT")
    clean=[]; seen=set()
    for p in rows:
        if not isinstance(p,dict) or set(p)!={"symbol","currency","quantity","averageCost","marketValue","unrealizedPnl"}:
            raise PilotError("INVALID_SNAPSHOT")
        s,c=p["symbol"],p["currency"]
        if not isinstance(s,str) or not _SYM.fullmatch(s) or not isinstance(c,str) or not re.fullmatch(r"[A-Z]{3}",c) or (s,c) in seen:
            raise PilotError("INVALID_SNAPSHOT")
        seen.add((s,c))
        clean.append({"symbol":s,"currency":c,"quantity":number(p["quantity"]),
            "averageCost":number(p["averageCost"],True),
            "marketValue":number(p["marketValue"],True),
            "unrealizedPnl":number(p["unrealizedPnl"],True)})
    return account,clean_assets,clean

def import_pilot(identity, broker, payload):
    account,assets,positions=verify_payload(payload)
    return save_snapshot(identity,broker,payload["subject"],account,assets,positions)

def view_pilot(identity, broker, subject):
    owner_only(subject)
    with broker.transaction():
        wid=_scope(identity,broker,subject)
        rows=broker.execute("""SELECT a.id,a.alias,c.last_success_at
          FROM saas_broker_accounts a JOIN saas_broker_connections c
          ON c.workspace_id=a.workspace_id AND c.id=a.connection_id
          WHERE a.workspace_id=%s AND c.auth_mode='SIGNATURE'
          AND c.provider_code='TIGER' AND c.status='PENDING_AUTH'
          ORDER BY c.last_success_at DESC LIMIT 5""",(wid,)).fetchall()
        result=[]
        for aid,alias,last in rows:
            item={"alias":alias,"asOf":last.isoformat() if last else None,
                  "assets":None,"positions":[]}
            for kind,key in (("ASSETS","assets"),("POSITIONS","positions")):
                data=broker.execute("""SELECT encrypted_payload FROM saas_tiger_source_snapshots
                  WHERE workspace_id=%s AND account_id=%s AND kind=%s
                  ORDER BY observed_at DESC,id DESC LIMIT 1""",(wid,aid,kind)).fetchone()
                if data:
                    snap=unseal(data[0],wid+":"+str(aid)+":"+kind)
                    if not isinstance(snap,dict) or snap.get("source")!="PERSONAL_SNAPSHOT_ONLY":
                        raise PilotError("INVALID_SOURCE")
                    item[key]=snap["data"]
            item.update(load_orders(broker,wid,aid))
            result.append(item)
    return {"coverage":"SNAPSHOT_ONLY","verified":False,"accounts":result}
