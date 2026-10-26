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



def _fee_review(client, account, order):
    """Observe actual *order-level* itemized charges, never fill-level fees.

    Tiger's documented get_order(show_charges=True) returns Charge category totals
    and after-discount fee details. No assumptions about charge currency or GST.
    An unsupported account/SDK is explicitly UNAVAILABLE.
    """
    default={"status":"UNAVAILABLE","total":None,"currency":None,"details":[]}
    try:
        detail=client.get_order(account=account,id=int(order["id"]),show_charges=True)
        contract=getattr(detail,"contract",None)
        observed_currency=getattr(contract,"currency",None)
        if hasattr(observed_currency,"value"):
            observed_currency=observed_currency.value
        action=getattr(detail,"action",None)
        if hasattr(action,"value"):
            action=action.value
        identity=(str(getattr(detail,"id",None))==order["id"] and
                  str(getattr(detail,"account",None))==account and
                  str(action).upper()==order["side"] and
                  getattr(contract,"symbol",None)==order["symbol"] and
                  observed_currency==order["currency"])
        if not identity:
            return {**default,"status":"DIFFERENCE"}
        currency=getattr(detail,"commission_currency",None)
        if hasattr(currency,"value"):
            currency=currency.value
        if currency is not None and currency not in _CURRENCIES:
            return {**default,"status":"DIFFERENCE"}
        charges=getattr(detail,"charges",None)
        if not isinstance(charges,(tuple,list)) or not charges or len(charges)>8:
            return default
        rows=[]
        total=Decimal(0)
        for charge in charges:
            category=getattr(charge,"category",None)
            sub=getattr(charge,"details",None)
            raw_total=amount(getattr(charge,"total",None))
            if (category not in ("TIGER","THIRD_PARTY")
                    or not isinstance(sub,(list,tuple)) or not sub or len(sub)>12
                    or raw_total is None):
                return {**default,"status":"DIFFERENCE"}
            charge_sum=Decimal(0)
            detail_rows=[]
            for component in sub:
                kind=getattr(component,"type",None)
                raw_amount=amount(getattr(component,"after_discount_amount",None))
                if (not isinstance(kind,str) or not re.fullmatch(r"[A-Z_]{2,40}",kind)
                        or raw_amount is None):
                    return {**default,"status":"DIFFERENCE"}
                charge_sum+=Decimal(raw_amount)
                detail_rows.append({"category":category,"type":kind,"amount":raw_amount})
            if charge_sum != Decimal(raw_total):
                return {**default,"status":"DIFFERENCE"}
            rows.extend(detail_rows)
            total+=Decimal(raw_total)
        # The signed order observation is not guaranteed to be the newest
        # version. Disagreement remains a blocker, not an automatic overwrite.
        order_total=order["fee"]
        latest=amount(getattr(detail,"commission",None))
        if (order_total is None or latest is None or
                Decimal(order_total)!=total or Decimal(latest)!=total):
            return {**default,"status":"DIFFERENCE"}
        return {"status":"MATCHED" if currency is not None else "CURRENCY_UNKNOWN",
                "total":amount(total),"currency":currency,"details":rows}
    except Exception:
        return default


def _probe_order(client, account, order):
    observation = {"orderId":order["id"], "symbol":order["symbol"],
                   "currency":order["currency"], "side":order["side"],
                   "orderCommission":order["fee"],
                   "commissionCurrency":order.get("feeCurrency"),
                   "status":"UNAVAILABLE", "fills":[],
                   "feeReview":_fee_review(client,account,order)}
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
            "feeMatched":sum(o["feeReview"]["status"]=="MATCHED" for o in observations),
            "feeCurrencyUnknown":sum(o["feeReview"]["status"]=="CURRENCY_UNKNOWN" for o in observations),
            "feeDifference":sum(o["feeReview"]["status"]=="DIFFERENCE" for o in observations),
            "feeUnavailable":sum(o["feeReview"]["status"]=="UNAVAILABLE" for o in observations),
            "windowComplete":coverage}

