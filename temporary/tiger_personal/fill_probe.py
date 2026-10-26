"""Owner-only encrypted ingress and read for bounded Tiger transaction observations.

Isolated Railway runner imports fill_probe_worker, NOT this server DB module.
"""
from __future__ import annotations
import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from decimal import Decimal

from services.saas_api.tiger_oauth import _scope, _key, seal, unseal
from temporary.tiger_personal.api import PilotError, owner_only, number
from temporary.tiger_personal.fill_probe_worker import (
    _ID, _TIME, _SYMBOL, _STATES, _CURRENCIES,
    _transaction, _probe_order, sync_probe,
)

def _payload(value):
    if not isinstance(value, dict) or set(value) != {"subject","account","from","to","probes"}:
        raise PilotError("INVALID_PROBE")
    owner_only(value["subject"])
    account = value["account"]
    if not isinstance(account,str) or not re.fullmatch(r"[A-Za-z0-9]{5,25}",account):
        raise PilotError("INVALID_PROBE")
    begin, end = value["from"], value["to"]
    if (not isinstance(begin,str) or not isinstance(end,str)
            or not re.fullmatch(r"[0-9]{13}",begin) or not re.fullmatch(r"[0-9]{13}",end)
            or int(begin)>=int(end) or int(end)-int(begin)>31*86400000
            or int(end)>int(datetime.now(timezone.utc).timestamp()*1000)+86400000):
        raise PilotError("INVALID_PROBE")
    probes = value["probes"]
    if not isinstance(probes,list) or not 1<=len(probes)<=2:
        raise PilotError("INVALID_PROBE")
    ids=set()
    for p in probes:
        if not isinstance(p,dict) or set(p)!={"orderId","symbol","currency","side",
                                                "orderCommission","commissionCurrency","status","fills"}:
            raise PilotError("INVALID_PROBE")
        if (not isinstance(p["orderId"],str) or not _ID.fullmatch(p["orderId"])
                or p["orderId"] in ids or not isinstance(p["symbol"],str)
                or not _SYMBOL.fullmatch(p["symbol"])
                or p["currency"] not in _CURRENCIES
                or p["side"] not in ("BUY","SELL") or p["status"] not in _STATES
                or not isinstance(p["fills"],list) or len(p["fills"])>24):
            raise PilotError("INVALID_PROBE")
        ids.add(p["orderId"])
        number(p["orderCommission"],True)
        if p["commissionCurrency"] is not None and p["commissionCurrency"] not in _CURRENCIES:
            raise PilotError("INVALID_PROBE")
        if p["status"]=="UNAVAILABLE" and p["fills"]:
            raise PilotError("INVALID_PROBE")
        fill_ids=set()
        for f in p["fills"]:
            if not isinstance(f,dict) or set(f)!={"id","orderId","symbol","currency","side","quantity","price","timeRaw"}:
                raise PilotError("INVALID_PROBE")
            if (not isinstance(f["id"],str) or not _ID.fullmatch(f["id"])
                    or f["id"] in fill_ids or f["orderId"]!=p["orderId"]
                    or f["symbol"]!=p["symbol"] or f["currency"]!=p["currency"]
                    or f["side"]!=p["side"]):
                raise PilotError("INVALID_PROBE")
            fill_ids.add(f["id"])
            qty,price=number(f["quantity"]),number(f["price"])
            if Decimal(qty)<=0 or Decimal(price)<=0:
                raise PilotError("INVALID_PROBE")
            t=f["timeRaw"]
            if t is not None and (not isinstance(t,str) or not _TIME.fullmatch(t)):
                raise PilotError("INVALID_PROBE")
    return account,probes,begin,end


def import_probes(identity, broker, value):
    account,probes,begin,end=_payload(value)
    with broker.transaction():
        wid=_scope(identity,broker,value["subject"])
        fp=hmac.new(_key(),("TIGER:"+account).encode(),hashlib.sha256).hexdigest()
        row=broker.execute("""SELECT a.id FROM saas_broker_accounts a
          JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
          AND c.id=a.connection_id WHERE a.workspace_id=%s
          AND a.external_account_fingerprint=%s AND c.provider_code='TIGER'
          AND c.auth_mode='SIGNATURE' AND c.status='PENDING_AUTH'
          ORDER BY a.created_at LIMIT 1""",(wid,fp)).fetchone()
        if not row:
            raise PilotError("ACCOUNT_NOT_LINKED")
        aid=row[0]
        envelope={"source":"PERSONAL_TRANSACTION_OBSERVATION",
                  "from":begin,"to":end,"probes":probes}
        sha=hashlib.sha256(json.dumps(envelope,sort_keys=True,separators=(",",":")).encode()).hexdigest()
        existing=broker.execute("""SELECT 1 FROM saas_tiger_source_snapshots
          WHERE workspace_id=%s AND account_id=%s AND kind='TRANSACTIONS'
          AND evidence_sha256=%s LIMIT 1""",(wid,aid,sha)).fetchone()
        if not existing:
            broker.execute("""INSERT INTO saas_tiger_source_snapshots
              (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
              VALUES (%s,%s,'TRANSACTIONS',%s,%s,'PARTIAL')""",
              (wid,aid,sha,seal(envelope,wid+":"+str(aid)+":TRANSACTIONS")))
    return {"saved":True,"source":"PERSONAL_TRANSACTION_OBSERVATION","count":len(probes)}


def load_probes(broker,wid,aid):
    records=broker.execute("""SELECT encrypted_payload FROM saas_tiger_source_snapshots
      WHERE workspace_id=%s AND account_id=%s AND kind='TRANSACTIONS'
      ORDER BY observed_at DESC,id DESC LIMIT 600""",(wid,aid)).fetchall()
    orders={}
    for (encrypted,) in records:
        doc=unseal(encrypted,wid+":"+str(aid)+":TRANSACTIONS")
        if not isinstance(doc,dict) or doc.get("source")!="PERSONAL_TRANSACTION_OBSERVATION":
            continue
        for p in doc["probes"]:
            orders.setdefault(p["orderId"],p)
    fills=[]
    seen=set()
    for p in orders.values():
        for f in p["fills"]:
            if f["id"] in seen:
                continue
            seen.add(f["id"])
            fills.append({"sourceRef":hashlib.sha256((str(aid)+":tx:"+f["id"]).encode()).hexdigest(),
                          "symbol":f["symbol"],"currency":f["currency"],
                          "side":f["side"],"quantity":f["quantity"],
                          "price":f["price"],"timeRaw":f["timeRaw"]})
    # These are observed transactions, not validated history, accounting inputs
    # or individual commission allocations.
    return {"fillObservations":fills[:60], "fillProbeCount":len(orders),
            "fillProbeUnavailable":sum(p["status"]=="UNAVAILABLE" for p in orders.values()),
            "fillProbeDifference":sum(p["status"]=="DIFFERENCE" for p in orders.values()),
            "fillProbePartial":sum(p["status"]=="PARTIAL" for p in orders.values()),
            "fillProbeTruncated":len(records)>=600 or len(fills)>60}
