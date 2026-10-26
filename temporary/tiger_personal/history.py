"""Owner-only observed Tiger orders, never independently verified fills.

Stores only allowlisted order metadata in existing encrypted snapshot table.
No OAuth, cash transfer, placing orders, or verified-ledger publication.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from temporary.tiger_personal.api import owner_only, number, PilotError
from services.saas_api.tiger_oauth import _scope, _key, seal, unseal

_ID=re.compile(r"^[0-9]{1,24}$")
_TIME=re.compile(r"^[0-9]{13}$")
_SYMBOL=re.compile(r"^[A-Z0-9.:-]{1,32}$")
_STATUS=re.compile(r"^[A-Z_]{3,32}$")
_ALLOWED={"FILLED","PARTIALLY_FILLED","CANCELLED","EXPIRED","REJECTED",
          "HELD","PENDING","NEW","SUBMITTED","INACTIVE","UNKNOWN"}

def _payload(value):
    if not isinstance(value,dict) or set(value)!={"subject","account","from","to","part","parts","complete","orders"}:
        raise PilotError("INVALID_HISTORY")
    owner_only(value["subject"])
    account=value["account"]
    if not isinstance(account,str) or not re.fullmatch(r"[A-Za-z0-9]{5,25}",account):
        raise PilotError("INVALID_HISTORY")
    begin,end=value["from"],value["to"]
    if not isinstance(begin,str) or not isinstance(end,str) or not _TIME.fullmatch(begin) or not _TIME.fullmatch(end):
        raise PilotError("INVALID_HISTORY")
    a,b=int(begin),int(end)
    if a>=b or b-a>89*86400*1000 or b>int(datetime.now(timezone.utc).timestamp()*1000)+86400000:
        raise PilotError("INVALID_WINDOW")
    part,parts=value["part"],value["parts"]
    if type(part)!=int or type(parts)!=int or parts<1 or parts>40 or not 0<=part<parts:
        raise PilotError("INVALID_HISTORY")
    if type(value["complete"])!=bool:
        raise PilotError("INVALID_HISTORY")
    items=value["orders"]
    if not isinstance(items,list) or len(items)>35:
        raise PilotError("INVALID_HISTORY")
    result=[]
    seen=set()
    for item in items:
        if not isinstance(item,dict) or set(item)!={"id","symbol","currency","side","status","filled","price","fee","at"}:
            raise PilotError("INVALID_ORDER")
        order_id=item["id"]
        if not isinstance(order_id,str) or not _ID.fullmatch(order_id) or order_id in seen:
            raise PilotError("INVALID_ORDER")
        seen.add(order_id)
        if (not isinstance(item["symbol"],str) or not _SYMBOL.fullmatch(item["symbol"])
            or item["side"] not in ("BUY","SELL")
            or not isinstance(item["currency"],str)
            or not re.fullmatch(r"[A-Z]{3}",item["currency"])
            or not isinstance(item["status"],str) or not _STATUS.fullmatch(item["status"])
            or item["status"] not in _ALLOWED):
            raise PilotError("INVALID_ORDER")
        filled=number(item["filled"])
        price=number(item["price"],True)
        fee=number(item["fee"],True)
        if float(filled)<0 or (price is not None and float(price)<0):
            raise PilotError("INVALID_ORDER")
        at=item["at"]
        if at is not None and (type(at)!=str or not _TIME.fullmatch(at)):
            raise PilotError("INVALID_ORDER")
        result.append({"id":order_id,"symbol":item["symbol"],"currency":item["currency"],
                       "side":item["side"],"status":item["status"],"filled":filled,
                       "price":price,"fee":fee,"at":at})
    return account,begin,end,part,parts,value["complete"],result

def import_orders(identity,broker,value):
    account,begin,end,part,parts,complete,orders=_payload(value)
    with broker.transaction():
        wid=_scope(identity,broker,value["subject"])
        fp=hmac.new(_key(),("TIGER:"+account).encode(),hashlib.sha256).hexdigest()
        aid=broker.execute("""SELECT a.id FROM saas_broker_accounts a
          JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
          AND c.id=a.connection_id WHERE a.workspace_id=%s
          AND a.external_account_fingerprint=%s AND c.provider_code='TIGER'
          AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
          ORDER BY a.created_at LIMIT 1""",(wid,fp)).fetchone()
        if not aid:
            raise PilotError("ACCOUNT_NOT_LINKED")
        account_id=str(aid[0])
        envelope={"source":"PERSONAL_ORDER_OBSERVATION","from":begin,"to":end,
                  "part":part,"parts":parts,"complete":complete,"orders":orders}
        raw=json.dumps(envelope,sort_keys=True,separators=(",",":"),allow_nan=False).encode()
        sha=hashlib.sha256(raw).hexdigest()
        existing=broker.execute("""SELECT 1 FROM saas_tiger_source_snapshots
          WHERE workspace_id=%s AND account_id=%s AND kind='TRANSACTIONS'
            AND evidence_sha256=%s LIMIT 1""",(wid,aid[0],sha)).fetchone()
        if not existing:
            broker.execute("""INSERT INTO saas_tiger_source_snapshots
              (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
              VALUES (%s,%s,'TRANSACTIONS',%s,%s,'PARTIAL')""",
              (wid,aid[0],sha,seal(envelope,wid+":"+account_id+":TRANSACTIONS")))
    return {"saved":True,"source":"PERSONAL_ORDER_OBSERVATION","count":len(orders)}

def load_orders(broker,wid,aid,maximum=100,page=0):
    # Historical order data is never called a verified fill or complete history.
    records=broker.execute("""SELECT encrypted_payload FROM saas_tiger_source_snapshots
      WHERE workspace_id=%s AND account_id=%s AND kind='TRANSACTIONS'
      ORDER BY observed_at DESC,id DESC LIMIT 600""",(wid,aid)).fetchall()
    seen={}
    windows=set()
    partial=False
    for (encrypted,) in records:
        doc=unseal(encrypted,wid+":"+str(aid)+":TRANSACTIONS")
        if not isinstance(doc,dict) or doc.get("source")!="PERSONAL_ORDER_OBSERVATION":
            continue
        windows.add((doc["from"],doc["to"]))
        if not doc.get("complete"):
            partial=True
        for item in doc["orders"]:
            if item["id"] not in seen:
                # Key by provider order ID, never symbol and timestamp.
                seen[item["id"]]={"sourceRef":hashlib.sha256(
                     (str(aid)+":"+item["id"]).encode()).hexdigest(),**{k:v for k,v in item.items() if k!="id"}}
    result=sorted(seen.values(),key=lambda x:int(x["at"] or 0),reverse=True)
    start=page*maximum
    return {"orders":result[start:start+maximum],"truncated":len(records)>=600,
            "hasMore":len(result)>start+maximum,"totalOrders":len(result),
            "windowCount":len(windows),"partial":partial or len(records)>=600}
