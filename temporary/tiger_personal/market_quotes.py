"""Owner-only market quote import and annotated valuation, not a P4 ledger.

No credentials or arbitrary symbols arrive from the browser. Quotes are stored
in separate encrypted QUOTES source evidence and bound to the owner's Tiger
account under an RLS transaction.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import re
from datetime import datetime, timezone
from decimal import Decimal, localcontext, ROUND_HALF_EVEN

from services.saas_api.tiger_oauth import _scope, _key, seal, unseal
from temporary.tiger_personal.api import PilotError, number, owner_only

SYMBOL=re.compile(r"^[A-Z][A-Z0-9.]{0,13}$")
TIME=re.compile(r"^[0-9]{13}$")
MODES={"US_DELAYED_15M","REALTIME_PERMISSIONED"}


def _payload(value):
    if not isinstance(value,dict) or set(value)!={"subject","account","quotes"}:
        raise PilotError("INVALID_QUOTE")
    owner_only(value["subject"])
    account=value["account"]
    if not isinstance(account,str) or not re.fullmatch(r"[A-Za-z0-9]{5,25}",account):
        raise PilotError("INVALID_QUOTE")
    quotes=value["quotes"]
    if not isinstance(quotes,list) or not 1<=len(quotes)<=40:
        raise PilotError("INVALID_QUOTE")
    now=int(datetime.now(timezone.utc).timestamp()*1000)
    symbols=set()
    for q in quotes:
        if not isinstance(q,dict) or set(q)!={"symbol","currency","price","quoteAt","mode"}:
            raise PilotError("INVALID_QUOTE")
        symbol=q["symbol"]
        if not isinstance(symbol,str) or not SYMBOL.fullmatch(symbol) or symbol in symbols:
            raise PilotError("INVALID_QUOTE")
        symbols.add(symbol)
        if q["currency"]!="USD" or not isinstance(q["mode"],str) or q["mode"] not in MODES:
            raise PilotError("INVALID_QUOTE")
        price=number(q["price"])
        if Decimal(price)<=0 or not isinstance(q["quoteAt"],str) or not TIME.fullmatch(q["quoteAt"]):
            raise PilotError("INVALID_QUOTE")
        t=int(q["quoteAt"])
        if t>now+300000 or now-t>14*86400000:
            raise PilotError("INVALID_QUOTE_TIME")
    return account,quotes


def import_quotes(identity,broker,payload):
    account,quotes=_payload(payload)
    with broker.transaction():
        wid=_scope(identity,broker,payload["subject"])
        fp=hmac.new(_key(),("TIGER:"+account).encode(),hashlib.sha256).hexdigest()
        row=broker.execute("""SELECT a.id FROM saas_broker_accounts a
           JOIN saas_broker_connections c ON c.workspace_id=a.workspace_id
             AND c.id=a.connection_id
           WHERE a.workspace_id=%s AND a.external_account_fingerprint=%s
             AND c.provider_code='TIGER' AND c.auth_mode='SIGNATURE'
             AND c.status='PENDING_AUTH' LIMIT 1""",(wid,fp)).fetchone()
        if not row:
            raise PilotError("ACCOUNT_NOT_LINKED")
        aid=row[0]
        envelope={"source":"PERSONAL_QUOTE_OBSERVATION","quotes":quotes}
        raw=json.dumps(envelope,sort_keys=True,separators=(",",":")).encode()
        sha=hashlib.sha256(raw).hexdigest()
        exists=broker.execute("""SELECT 1 FROM saas_tiger_source_snapshots
          WHERE workspace_id=%s AND account_id=%s AND kind='QUOTES'
           AND evidence_sha256=%s LIMIT 1""",(wid,aid,sha)).fetchone()
        if not exists:
            broker.execute("""INSERT INTO saas_tiger_source_snapshots
              (workspace_id,account_id,kind,evidence_sha256,encrypted_payload,completeness)
              VALUES (%s,%s,'QUOTES',%s,%s,'SNAPSHOT_ONLY')""",
              (wid,aid,sha,seal(envelope,wid+":"+str(aid)+":QUOTES")))
    return {"saved":True,"source":"PERSONAL_QUOTE_OBSERVATION","count":len(quotes)}


def _string(value,places):
    with localcontext() as ctx:
        ctx.prec=48
        ctx.rounding=ROUND_HALF_EVEN
        value=value.quantize(Decimal(1).scaleb(-places))
    if abs(value)>=Decimal("1e24"):
        return None
    result=format(value,"f").rstrip("0").rstrip(".") if "." in format(value,"f") else format(value,"f")
    return "0" if result in ("","-0") else result


def indicative_quote(position,quote,now_ms,snapshot_ms):
    """Separate price observation from optional *unverified* average-cost maths."""
    if (position.get("symbol")!=quote["symbol"] or position.get("currency")!="USD"
            or quote["currency"]!="USD"):
        return None
    t=int(quote["quoteAt"])
    age=now_ms-t
    observed={"symbol":quote["symbol"],"currency":"USD",
              "price":quote["price"],"quoteAt":quote["quoteAt"],
              "mode":quote["mode"],"stale":age>60*60000,
              "estimatedValue":None,"estimatedUnrealized":None,
              "estimatedReturnPct":None}
    # Snapshot holdings might be updated between reads; do not multiply a
    # historic position by a much newer quote and advertise a return.
    if (age<0 or age>4*86400000 or snapshot_ms is None
            or now_ms-snapshot_ms>36*3600000):
        return observed
    qty=Decimal(position["quantity"])
    avg=position.get("averageCost")
    if qty<=0 or avg is None:
        return observed
    basis=Decimal(avg)*qty
    if basis<=0:
        return observed
    with localcontext() as ctx:
        ctx.prec=48
        value=qty*Decimal(quote["price"])
        pnl=value-basis
        rate=pnl/basis*Decimal(100)
    observed["estimatedValue"]=_string(value,4)
    observed["estimatedUnrealized"]=_string(pnl,4)
    observed["estimatedReturnPct"]=_string(rate,2)
    return observed


def load_quotes(broker,wid,aid,positions,snapshot_at):
    row=broker.execute("""SELECT encrypted_payload FROM saas_tiger_source_snapshots
       WHERE workspace_id=%s AND account_id=%s AND kind='QUOTES'
       ORDER BY observed_at DESC,id DESC LIMIT 1""",(wid,aid)).fetchone()
    if not row:
        return {"marketObservations":[]}
    doc=unseal(row[0],wid+":"+str(aid)+":QUOTES")
    if not isinstance(doc,dict) or doc.get("source")!="PERSONAL_QUOTE_OBSERVATION":
        raise PilotError("INVALID_SOURCE")
    quotes=doc.get("quotes")
    if not isinstance(quotes,list) or len(quotes)>40:
        raise PilotError("INVALID_SOURCE")
    now=int(datetime.now(timezone.utc).timestamp()*1000)
    snap=None
    if snapshot_at:
        try:
            snap=int(snapshot_at.timestamp()*1000)
        except (ValueError,AttributeError):
            snap=None
    mapped={p["symbol"]:p for p in positions if p["currency"]=="USD"}
    seen=set()
    result=[]
    for q in quotes:
        if (not isinstance(q,dict) or set(q)!={"symbol","currency","price","quoteAt","mode"}
                or not isinstance(q["symbol"],str) or q["symbol"] in seen
                or q["symbol"] not in mapped or q["currency"]!="USD"
                or q["mode"] not in MODES or not isinstance(q["quoteAt"],str)
                or not TIME.fullmatch(q["quoteAt"])):
            raise PilotError("INVALID_SOURCE")
        seen.add(q["symbol"])
        observation=indicative_quote(mapped[q["symbol"]],q,now,snap)
        if observation is not None:
            result.append(observation)
    return {"marketObservations":result}
