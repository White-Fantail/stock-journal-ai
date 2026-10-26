"""Bounded owner-only Prime transaction observation, never verified execution ledger.

Tiger get_transactions is account-type dependent. Observe only documented read
methods; missing/malformed/partial pages never become accounting-grade fills.
All evidence stays encrypted, tenant-scoped and PERSONAL_TRANSACTION_OBSERVATION.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from uuid import uuid4

from services.saas_api.tiger_oauth import _scope, _key, seal, unseal
from temporary.tiger_personal.api import PilotError, owner_only, number
from temporary.tiger_personal.runner import configuration
from temporary.tiger_personal.sync_ready import _endpoint, amount
from temporary.tiger_personal.history_sync import _pages

PATH = "/internal/v1/tiger/personal-transactions-import"
_ID = re.compile(r"^[0-9]{1,24}$")
_SYMBOL = re.compile(r"^[A-Z0-9.:-]{1,32}$")
_TIME = re.compile(r"^(?:[0-9]{13}|[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2})$")
_STATES = {"OBSERVED", "DIFFERENCE", "PARTIAL", "UNAVAILABLE"}
_CURRENCIES = {"USD", "NZD", "AUD", "HKD", "SGD", "EUR", "GBP", "CAD", "JPY", "CNY"}


def _transaction(item, account, order):
    """Reject any transaction not proven to belong to the exact queried order."""
    ident, oid = getattr(item, "id", None), getattr(item, "order_id", None)
    contract = getattr(item, "contract", None)
    symbol = getattr(contract, "symbol", None)
    currency = getattr(contract, "currency", None)
    if hasattr(currency, "value"):
        currency = currency.value
    action = getattr(item, "action", None)
    if hasattr(action, "value"):
        action = action.value
    observed = getattr(item, "account", None)
    if (not _ID.fullmatch(str(ident)) or str(oid) != order["id"]
            or observed is not None and str(observed) != account
            or symbol != order["symbol"] or currency != order["currency"]
            or str(action).upper() != order["side"]):
        raise ValueError("TRANSACTION_IDENTITY_UNVERIFIED")
    scale = getattr(item, "filled_quantity_scale", None)
    raw = amount(getattr(item, "filled_quantity", None))
    if (type(scale) is not int or not 0 <= scale <= 12 or raw is None
            or Decimal(raw) <= 0 or Decimal(raw) != Decimal(raw).to_integral_value()):
        raise ValueError("TRANSACTION_SCALE_UNVERIFIED")
    quantity = amount(Decimal(raw).scaleb(-scale))
    price = amount(getattr(item, "filled_price", None))
    if price is None or Decimal(price) <= 0:
        raise ValueError("TRANSACTION_PRICE_UNVERIFIED")
    t = getattr(item, "transacted_at", None)
    original_time = str(t) if t is not None else None
    if original_time is not None and not _TIME.fullmatch(original_time):
        raise ValueError("TRANSACTION_TIME_UNVERIFIED")
    # Tiger's transaction examples include naive date-time strings: never
    # assign a made-up UTC or exchange timezone to the source field.
    return {"id":str(ident), "orderId":order["id"], "symbol":symbol,
            "currency":currency, "side":order["side"], "quantity":quantity,
            "price":price, "timeRaw":original_time}


def _probe_order(client, account, order):
    observation = {"orderId":order["id"], "symbol":order["symbol"],
                   "currency":order["currency"], "side":order["side"],
                   "orderCommission":order["fee"],
                   "commissionCurrency":order.get("feeCurrency"),
                   "status":"UNAVAILABLE", "fills":[]}
    try:
        pages, seen, token, rows = 0, set(), "", {}
        while pages < 3:
            # SDK page_token is required to make the response structure explicit.
            response = client.get_transactions(account=account, order_id=int(order["id"]),
                                               limit=40, page_token=token)
            page = getattr(response, "result", None)
            next_token = getattr(response, "next_page_token", None)
            if not isinstance(page, (list, tuple)) or len(page) > 40:
                return observation
            for item in page:
                transaction = _transaction(item, account, order)
                original = rows.get(transaction["id"])
                if original is not None and original != transaction:
                    observation["status"] = "DIFFERENCE"
                    return observation
                rows[transaction["id"]] = transaction
            pages += 1
            if not next_token:
                break
            if (not isinstance(next_token, str) or len(next_token) > 512
                    or next_token in seen or len(rows) > 24):
                observation["status"] = "PARTIAL"
                break
            seen.add(next_token)
            token = next_token
        else:
            observation["status"] = "PARTIAL"
        # If more than 24 individual fills, retain a bounded sample only.
        all_fills = sorted(rows.values(), key=lambda r:r["id"])
        observation["fills"] = all_fills[:24]
        if len(all_fills) > 24:
            observation["status"] = "PARTIAL"
        if observation["status"] == "UNAVAILABLE":
            raw_order = Decimal(order["filled"]).scaleb(-order["filledScale"])
            observed_qty = sum((Decimal(f["quantity"]) for f in all_fills), Decimal(0))
            observation["status"] = "OBSERVED" if all_fills and observed_qty == raw_order else "DIFFERENCE"
    except Exception:
        # The SDK can raise for unsupported Prime transaction access. Never
        # log errors, which may contain account identifiers or provider bodies.
        return observation
    return observation


def _send(subject, account, begin, end, probes, env):
    secret = env.get("POSITIONARY_PERSONAL_BRIDGE_SECRET", "")
    if len(secret) < 32:
        raise ValueError("BRIDGE_UNAVAILABLE")
    raw = json.dumps({"subject":subject, "account":account,
                      "from":str(begin), "to":str(end), "probes":probes},
                     separators=(",",":"), allow_nan=False).encode()
    if len(raw) > 24576:
        raise ValueError("BODY_TOO_LARGE")
    stamp, nonce = str(int(time.time())), str(uuid4())
    signature = hmac.new(secret.encode(),
       f"{stamp}\n{nonce}\nPOST\n{PATH}\n".encode() + raw, hashlib.sha256).hexdigest()
    req = urllib.request.Request(_endpoint(env)+PATH, data=raw, method="POST",
           headers={"Content-Type":"application/json", "X-Saas-Timestamp":stamp,
                    "X-Saas-Nonce":nonce, "X-Saas-Signature":signature})
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *args, **kwargs):
            raise ValueError("REDIRECT_DENIED")
    with urllib.request.build_opener(NoRedirect()).open(req, timeout=20) as reply:
        if reply.status != 200:
            raise ValueError("NOT_SAVED")
        result = json.loads(reply.read(1024))
    if result.get("saved") is not True or result.get("source") != "PERSONAL_TRANSACTION_OBSERVATION":
        raise ValueError("INVALID_RECEIPT")


def sync_probe(env=None, client_factory=None):
    env = os.environ if env is None else env
    tiger_id, account, key = configuration(env)
    _endpoint(env)
    subject = env.get("POSITIONARY_PERSONAL_GOOGLE_SUBJECT", "")
    if not re.fullmatch(r"[0-9]{3,255}", subject):
        raise ValueError("OWNER_MISSING")
    if client_factory is None:
        from tigeropen.tiger_open_config import TigerOpenClientConfig
        from tigeropen.trade.trade_client import TradeClient
        cfg = TigerOpenClientConfig()
        cfg.tiger_id, cfg.account, cfg.private_key = tiger_id, account, key
        cfg.license = env.get("POSITIONARY_PERSONAL_LICENSE", "TBKIWI")
        cfg.timeout, cfg.retry_max_tries = 10, 1
        client = TradeClient(cfg)
    else:
        client = client_factory(tiger_id, account, key)
    now = datetime.now(timezone.utc)
    start = now-timedelta(days=30)
    begin, end = int(start.timestamp()*1000), int(now.timestamp()*1000)
    orders, coverage = _pages(client, account, begin, end)
    candidates = sorted(
        (o for o in orders if Decimal(o["filled"]) > 0),
        key=lambda o:int(o["at"] or 0), reverse=True)[:6]
    observations = [_probe_order(client, account, o) for o in candidates]
    # Still record that the orders window was incomplete, never falsely
    # convert a transaction sample into complete history.
    if not coverage:
        observations = [{**o, "status":"PARTIAL"} if o["status"]=="OBSERVED" else o
                        for o in observations]
    for i in range(0, len(observations), 2):
        _send(subject, account, begin, end, observations[i:i+2], env)
    return {"ordersProbed":len(observations),
            "matchedSamples":sum(o["status"]=="OBSERVED" for o in observations),
            "queryUnavailable":sum(o["status"]=="UNAVAILABLE" for o in observations),
            "windowComplete":coverage}


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
